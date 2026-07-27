'use strict';

// Physical Codex native release-package generation and validation (task 3.2,
// curate-dhpk-distribution-surfaces). Distinct from scripts/lib/distribution-inventory.js's
// Claude-surface generation: a native Codex package must contain ONLY promoted
// skills, as real files (no symlinks), with a manifest `skills` field that
// resolves inside the package directory (no parent-relative escape) — the two
// concrete failure shapes behind GitHub issue #88.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

// Task 3.2: build the physical, promoted-only release candidate from a
// distribution inventory. Copies real file content (dereferencing any
// canonical-source symlinks) for every skill classified `promoted` — design.md
// decision 4 scopes the native surface to promoted content only, narrower than
// Claude's directory-root surface. Returns the candidate's manifest field and
// per-skill source fingerprints so a caller can validate + stage-install it.
function materializeNativePackage({ inventory, root, outDir, name = 'dhpk-native', version = '0.0.0' }) {
  const promoted = (inventory.skills || []).filter((s) => s.lifecycle === 'promoted');
  const skillsOutDir = path.join(outDir, 'skills');
  fs.mkdirSync(skillsOutDir, { recursive: true });

  const fingerprints = {};
  for (const skill of promoted) {
    const srcDir = path.join(root, skill.path);
    const dstDir = path.join(skillsOutDir, skill.id);
    fs.cpSync(srcDir, dstDir, { recursive: true, dereference: true });
    fingerprints[skill.id] = fingerprintDir(dstDir);
  }

  const codexPluginDir = path.join(outDir, '.codex-plugin');
  fs.mkdirSync(codexPluginDir, { recursive: true });
  const manifest = {
    name,
    version,
    description: 'dhpk promoted-only physical Codex release candidate (generated; not a second source of truth — see docs/distribution-surfaces.md).',
    skills: './skills/',
  };
  fs.writeFileSync(path.join(codexPluginDir, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'fingerprints.json'), `${JSON.stringify(fingerprints, null, 2)}\n`);

  return { manifestSkillsField: manifest.skills, skillIds: promoted.map((s) => s.id).sort(), fingerprints };
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
  validateNativeCandidate,
  materializeNativePackage,
  fingerprintDir,
};
