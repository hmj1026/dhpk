'use strict';

// Physical Codex native release-package generation and validation
// (make-codex-plugin-distribution-install-safe). Distinct from
// scripts/lib/distribution-inventory.js's Claude-surface generation: a native
// Codex package must contain exactly the non-deprecated skills whose
// distribution-inventory `surfaces` explicitly include `codex-native` — not
// every `promoted` skill — as real files (no symlinks), with a manifest
// `skills` field that resolves inside the package directory (no
// parent-relative escape). These are the two concrete failure shapes behind
// GitHub issue #88, plus the native/promoted membership mismatch that issue
// #88's follow-up change fixes.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Bump when the generation algorithm (selection, layout, or manifest-merge
// logic) changes in a way that could produce a different package from the
// same inventory + canonical sources. Independent of the dhpk release
// version recorded as provenance.sourceVersion.
const GENERATOR_VERSION = '2.1.0';

function lstatOrNull(candidate) {
  try {
    return fs.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function ensurePhysicalDirectory(directory, label) {
  const stat = lstatOrNull(directory);
  if (!stat) {
    fs.mkdirSync(directory, { recursive: true });
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`refusing symlinked ${label}: ${directory}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${directory}`);
  }
}

function confinedChild(parent, name) {
  const resolvedParent = path.resolve(parent);
  const candidate = path.resolve(resolvedParent, name);
  if (path.dirname(candidate) !== resolvedParent) {
    throw new Error(`native skill output escapes skills directory: ${name}`);
  }
  return candidate;
}

// Walks packageRoot and reports any symlink found (a native package must be
// 100% physical files — a symlink survives only as long as its target and the
// source checkout that contains it both remain present, which a clean
// marketplace cache install does not guarantee; see issue #88).
function findSymlinks(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      found.push(fp);
    } else if (entry.isDirectory()) {
      found.push(...findSymlinks(fp));
    }
  }
  return found;
}

function resolvesInsidePackage(manifestSkillsField, packageRoot) {
  if (path.isAbsolute(manifestSkillsField)) return false;
  const resolved = path.resolve(packageRoot, manifestSkillsField);
  const rel = path.relative(packageRoot, resolved);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..');
}

function validateNativeCandidate({ manifestSkillsField, packageRoot }) {
  const errors = [];

  if (path.isAbsolute(manifestSkillsField)) {
    errors.push(`manifest skills field is an absolute path escaping the package root: '${manifestSkillsField}'`);
  } else if (!resolvesInsidePackage(manifestSkillsField, packageRoot)) {
    errors.push(`manifest skills field is parent-relative and escapes the package directory: '${manifestSkillsField}' (native release candidates must resolve inside their own installed package — see issue #88)`);
  }

  const skillsRoot = path.resolve(packageRoot, manifestSkillsField);
  if (resolvesInsidePackage(manifestSkillsField, packageRoot)) {
    for (const link of findSymlinks(skillsRoot)) {
      const rel = path.relative(packageRoot, link);
      errors.push(`symlink-dependent entry in native candidate: '${rel}' is a symlink; a clean marketplace cache install does not preserve it (issue #88)`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function readSkillFrontmatterName(skillFile) {
  if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) return null;
  const text = fs.readFileSync(skillFile, 'utf8');
  const block = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!block) return null;
  const nameLine = block[1].match(/^name\s*:\s*(.*?)\s*$/m);
  if (!nameLine) return null;
  const value = nameLine[1].trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1).trim();
  }
  return value;
}

// Validate the identity dimension independently from fingerprints and
// membership. A public native directory must carry the same public name in
// SKILL.md frontmatter; stable inventory ids remain provenance-only.
function validateNativeSkillIdentity({ packageRoot, inventory, manifestSkillsField = './skills/' }) {
  const errors = [];
  if (!resolvesInsidePackage(manifestSkillsField, packageRoot)) return { ok: true, errors };
  const skillsRoot = path.resolve(packageRoot, manifestSkillsField);
  for (const skill of selectNativeSkills(inventory)) {
    const publicName = skill.name || skill.id;
    const skillFile = path.join(skillsRoot, publicName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const actualName = readSkillFrontmatterName(skillFile);
    if (actualName !== publicName) {
      errors.push(`native skill '${publicName}' SKILL.md frontmatter name '${actualName || '(missing)'}' does not match public name '${publicName}'`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Native membership SHALL be the explicit `codex-native` inventory surface,
// never inferred from `lifecycle=promoted` (spec: "Native publication uses an
// explicit inventory surface"). Deprecated entries are excluded even if they
// still carry `codex-native` — the two-stage deprecation window keeps a
// deprecated skill's surfaces intact for compatibility, but it must not be
// (re)published into a fresh native package.
function selectNativeSkills(inventory) {
  return (inventory.skills || []).filter(
    (s) => (s.surfaces || []).includes('codex-native') && s.lifecycle !== 'deprecated'
  );
}

// Checks a candidate's actual public-name directory set against the
// inventory-derived codex-native surface — the membership dimension, distinct
// from validateNativeCandidate's structural (symlink/path) checks. Stable IDs
// remain in diagnostics and provenance, but never identify a native directory.
// `candidateSkillIds` remains accepted as a compatibility alias for callers
// that have not yet renamed their local variable; its values are directory
// names, i.e. public names for v2 inventories.
function validateNativeMembership({ candidateSkillNames, candidateSkillIds, inventory }) {
  const selected = selectNativeSkills(inventory);
  const expected = new Map(selected.map((s) => [s.name || s.id, s.id]));
  const inventoryIdsByName = new Map((inventory.skills || []).map((s) => [s.name || s.id, s.id]));
  const candidateNames = candidateSkillNames || candidateSkillIds || [];
  const candidate = new Set(candidateNames);
  const errors = [];

  for (const name of candidateNames) {
    if (!expected.has(name)) {
      const stableId = inventoryIdsByName.get(name);
      const diagnostic = stableId ? ` (stable id '${stableId}')` : '';
      errors.push(`unexpected skill in native candidate: '${name}'${diagnostic} is not in the codex-native inventory surface (native publication must not include promoted-but-non-native content; candidate directories use public names)`);
    }
  }
  for (const [name, id] of expected) {
    if (!candidate.has(name)) {
      errors.push(`missing skill from native candidate: '${name}' (stable id '${id}') is codex-native in the inventory but absent from the package`);
    }
  }

  return { ok: errors.length === 0, errors };
}

const DEFAULT_MANIFEST_TEMPLATE = {
  description: 'dhpk codex-native physical Codex release candidate (generated; not a second source of truth — see docs/distribution-surfaces.md).',
};

// Materialize the physical, explicitly-allowlisted codex-native package from
// a distribution inventory. Copies real file content (dereferencing any
// canonical-source symlinks) for every selected skill. If a plugin.json
// already exists at the destination, its fields (author, homepage, license,
// keywords, interface, ...) are preserved — only `name`, `version`, and
// `skills` are generator-controlled — so regenerating the tracked marketplace
// package never silently strips its marketplace descriptor. Returns the
// candidate's manifest field, stable selected skill ids, public selected skill
// names, per-skill fingerprints keyed by public name, and deterministic
// provenance (no wall-clock fields, so two runs against the same inputs
// produce byte-identical output — see spec.md "Unchanged sources are
// generated twice").
function materializeNativePackage({
  inventory,
  root,
  outDir,
  name = 'dhpk-native',
  version = '0.0.0',
  sourceCommit = 'unknown',
  generatorVersion = GENERATOR_VERSION,
}) {
  const selected = selectNativeSkills(inventory);
  ensurePhysicalDirectory(outDir, 'output root');
  const skillsOutDir = path.join(outDir, 'skills');
  ensurePhysicalDirectory(skillsOutDir, 'skills output directory');

  // Regeneration is a full replace, not additive: a skill removed from the
  // codex-native surface since outDir was last populated must not leave its
  // stale directory behind — outDir is routinely an existing tracked package
  // (prepare-release.js regenerates directly into plugins/dhpk/). Public names
  // are the only native directory identity; this also removes old id-based
  // output left by the pre-consolidation generator.
  const selectedNames = new Set(selected.map((s) => s.name || s.id));
  for (const existing of fs.readdirSync(skillsOutDir)) {
    if (!selectedNames.has(existing)) {
      fs.rmSync(path.join(skillsOutDir, existing), { recursive: true, force: true });
    }
  }

  const fingerprints = {};
  for (const skill of selected) {
    const srcDir = path.join(root, skill.path);
    const publicName = skill.name || skill.id;
    const dstDir = confinedChild(skillsOutDir, publicName);
    const sourceFrontmatterName = readSkillFrontmatterName(path.join(srcDir, 'SKILL.md'));
    if (sourceFrontmatterName !== publicName) {
      throw new Error(`native skill '${publicName}' source SKILL.md frontmatter name '${sourceFrontmatterName || '(missing)'}' does not match public name '${publicName}'`);
    }
    // A selected skill may have lost files since the prior generation. Replace
    // only that validated direct child before copying so stale descendants
    // cannot survive while unrelated package metadata remains intact.
    if (lstatOrNull(dstDir)) fs.rmSync(dstDir, { recursive: true, force: true });
    fs.cpSync(srcDir, dstDir, { recursive: true, dereference: true });
    fingerprints[publicName] = fingerprintDir(dstDir);
  }

  const codexPluginDir = path.join(outDir, '.codex-plugin');
  ensurePhysicalDirectory(codexPluginDir, 'plugin metadata directory');
  const manifestPath = path.join(codexPluginDir, 'plugin.json');
  const template = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : DEFAULT_MANIFEST_TEMPLATE;
  const manifest = { ...template, name, version, skills: './skills/' };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'fingerprints.json'), `${JSON.stringify(fingerprints, null, 2)}\n`);

  const skillIds = selected.map((s) => s.id).sort();
  const skillNames = selected.map((s) => s.name || s.id).sort();
  const provenance = {
    sourceVersion: version,
    sourceCommit,
    inventoryDigest: crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
    generatorVersion,
    selectedSkillIds: skillIds,
    selectedSkillNames: skillNames,
  };
  fs.writeFileSync(path.join(outDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);

  return { manifestSkillsField: manifest.skills, skillIds, skillNames, fingerprints, provenance };
}

function fingerprintDir(dir) {
  const digest = crypto.createHash('sha256');
  const walk = (d, relBase) => {
    for (const name of fs.readdirSync(d).sort()) {
      const fp = path.join(d, name);
      const rel = path.join(relBase, name);
      if (fs.statSync(fp).isDirectory()) {
        walk(fp, rel);
      } else {
        digest.update(rel.split(path.sep).join('/'));
        digest.update('\0');
        digest.update(fs.readFileSync(fp));
      }
    }
  };
  walk(dir, '');
  return digest.digest('hex');
}

module.exports = {
  GENERATOR_VERSION,
  validateNativeCandidate,
  validateNativeSkillIdentity,
  validateNativeMembership,
  selectNativeSkills,
  materializeNativePackage,
  fingerprintDir,
};
