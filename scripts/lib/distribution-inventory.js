'use strict';

// Schema, validation, default-classification, and publication-surface generation
// helpers for dhpk's distribution inventory
// (openspec/changes/curate-dhpk-distribution-surfaces). The checked-in
// manifests/distribution-inventory.json is the SSOT lifecycle assignment for every
// consumer-reachable skill and module; this module owns its shape, reconciliation
// against canonical packages, and pure generation of publication surfaces from an
// inventory object. scripts/ci/gen-*.js are thin CLI wrappers: they read/write the
// checked-in files and call the pure functions here — never fs-couple generation
// logic into a CLI script, so an older inventory revision (task 5.4 rollback) can
// be generated from without touching disk beyond the one read.

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { collectInventory, relativePosix } = require('./asset-inventory');

const LIFECYCLES = ['promoted', 'optional', 'experimental', 'deprecated'];
const SURFACES = ['claude-core', 'claude-module', 'codex-sync', 'codex-native'];
const V2_SCHEMA = 'dhpk.distribution-inventory.v2';
const PUBLIC_SKILL_NAME = /^dhpk-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPABILITY_ID = /^dhpk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function skillIdFromPath(relPath) {
  return path.basename(path.dirname(relPath));
}

// Deterministic default classification: root skills/ -> promoted/claude-core
// (the broadly-applicable core surface); modules/*/skills/ and the modules
// themselves -> optional/claude-module (opt-in stack packs, per design.md
// decision 3). codex-sync is added wherever codex/skills/ already mirrors the
// skill (symlink to the canonical root skill, or an explicit physical module
// mirror) — the project-local install-codex-skills.sh path. No skill is
// classified experimental or deprecated in this first migration phase
// (design.md Non-Goals: no canonical deletions yet).
function classifyCanonicalInventory(root) {
  const inv = collectInventory(root);
  const codexSkillsDir = path.join(root, 'codex', 'skills');
  const codexMirrorNames = fs.existsSync(codexSkillsDir) ? fs.readdirSync(codexSkillsDir) : [];
  const codexMirrorSet = new Set(codexMirrorNames);

  const skills = inv.paths.skills.map((absPath) => {
    const relPath = relativePosix(root, absPath);
    const dirRel = path.dirname(relPath);
    const id = skillIdFromPath(relPath);
    const isModuleSkill = /^modules\//.test(relPath);
    const surfaces = isModuleSkill ? ['claude-module'] : ['claude-core'];
    if (codexMirrorSet.has(id)) surfaces.push('codex-sync');
    return {
      id,
      path: dirRel,
      lifecycle: isModuleSkill ? 'optional' : 'promoted',
      surfaces,
    };
  });

  const moduleDirs = fs.existsSync(path.join(root, 'modules'))
    ? fs.readdirSync(path.join(root, 'modules'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    : [];
  const modules = moduleDirs.map((id) => ({
    id,
    path: `modules/${id}`,
    lifecycle: 'optional',
    surfaces: ['claude-module'],
  }));

  return {
    schema: 'dhpk.distribution-inventory.v1',
    description:
      'Machine-readable lifecycle and publication-surface assignment for every ' +
      'consumer-reachable dhpk skill and module. Generators derive Claude/Codex ' +
      'publication surfaces from this file; directory placement and README prose ' +
      'are not authoritative. See openspec/changes/curate-dhpk-distribution-surfaces.',
    lifecycles: LIFECYCLES,
    surfaces: SURFACES,
    skills,
    modules,
  };
}

function serializeInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function findByPath(entries, relPath) {
  return entries.find((e) => e.path === relPath);
}

function isSafeInventoryPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  if (value.includes('\\') || path.posix.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '.' && normalized !== '..' && !normalized.startsWith('../');
}

function validateSupportingAssets({ inventory, root, exists = fs.existsSync }) {
  const errors = [];
  const entries = inventory && Array.isArray(inventory.supporting_assets)
    ? inventory.supporting_assets
    : [];
  const ids = new Set();
  const destinations = new Set();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      errors.push('supporting asset entry is not an object');
      continue;
    }
    const id = entry.id;
    const source = entry.source;
    const destination = entry.destination;
    if (typeof id !== 'string' || id.trim() === '') {
      errors.push('supporting asset is missing a non-empty id');
    } else if (ids.has(id)) {
      errors.push(`duplicate supporting asset id: ${id}`);
    } else {
      ids.add(id);
    }
    if (!isSafeInventoryPath(source)) {
      errors.push(`supporting asset ${id || '<unknown>'} source must be a safe relative path: ${source}`);
    }
    if (!isSafeInventoryPath(destination)) {
      errors.push(`supporting asset ${id || '<unknown>'} destination must be a safe relative path: ${destination}`);
    } else if (destinations.has(destination)) {
      errors.push(`duplicate supporting asset destination: ${destination}`);
    } else {
      destinations.add(destination);
    }
    if (isSafeInventoryPath(source) && root && !exists(path.resolve(root, ...source.split('/')))) {
      errors.push(`supporting asset source does not exist: ${source}`);
    }
    if (entry.canonical_source !== undefined) {
      if (!isSafeInventoryPath(entry.canonical_source)) {
        errors.push(`supporting asset ${id || '<unknown>'} canonical_source must be a safe relative path: ${entry.canonical_source}`);
      } else if (root && !exists(path.resolve(root, ...entry.canonical_source.split('/')))) {
        errors.push(`supporting asset canonical source does not exist: ${entry.canonical_source}`);
      }
      for (const field of ['canonical_digest', 'projection_digest']) {
        if (typeof entry[field] !== 'string' || !/^[a-f0-9]{64}$/.test(entry[field])) {
          errors.push(`supporting asset ${id || '<unknown>'} ${field} must be a SHA-256 hex digest`);
        }
      }
    }
  }
  return { errors };
}

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Transformed Codex supporting assets are intentionally not byte-identical to
// their Claude canonical source. Refresh their provenance as one deterministic
// operation so a policy edit never requires hand-editing checked-in digests.
function refreshSupportingDigests(inventory, root) {
  const refreshed = JSON.parse(JSON.stringify(inventory));
  for (const entry of refreshed.supporting_assets || []) {
    if (!entry.canonical_source) continue;
    const canonical = path.join(root, entry.canonical_source);
    const projection = path.join(root, entry.source);
    if (!fs.existsSync(canonical) || !fs.existsSync(projection)) {
      throw new Error(`cannot refresh supporting provenance for ${entry.id || '<unknown>'}: source is missing`);
    }
    entry.canonical_digest = digestFile(canonical);
    entry.projection_digest = digestFile(projection);
  }
  return refreshed;
}

function validateDistributionInventory({
  inventory,
  canonicalSkillPaths = [],
  canonicalModulePaths = [],
  generatedPromotedSkillIds = [],
}) {
  if (inventory && inventory.schema === V2_SCHEMA) {
    return validateDistributionInventoryV2({ inventory });
  }

  const errors = [];
  const lifecycleSet = new Set(inventory.lifecycles || LIFECYCLES);
  const surfaceSet = new Set(inventory.surfaces || SURFACES);

  for (const relPath of canonicalSkillPaths) {
    if (!findByPath(inventory.skills || [], relPath)) {
      errors.push(`missing lifecycle entry: skill ${relPath} has no distribution inventory entry`);
    }
  }
  for (const relPath of canonicalModulePaths) {
    if (!findByPath(inventory.modules || [], relPath)) {
      errors.push(`missing lifecycle entry: module ${relPath} has no distribution inventory entry`);
    }
  }

  // Skills and modules are separate namespaces (a module and one of its own
  // skills may legitimately share an id, e.g. modules/ios-platform's
  // "ios-platform" skill) — duplicates are checked within each list, not
  // across both.
  for (const [kind, entries] of [['skill', inventory.skills || []], ['module', inventory.modules || []]]) {
    const seenIds = new Set();
    for (const entry of entries) {
      if (!lifecycleSet.has(entry.lifecycle)) {
        errors.push(`invalid lifecycle: ${entry.id} declares '${entry.lifecycle}', expected one of ${[...lifecycleSet].join('/')}`);
      }
      const surfaces = entry.surfaces || [];
      if (new Set(surfaces).size !== surfaces.length) {
        errors.push(`duplicate surface membership: ${entry.id} lists a surface more than once (${surfaces.join(', ')})`);
      }
      for (const surface of surfaces) {
        if (!surfaceSet.has(surface)) {
          errors.push(`invalid surface: ${entry.id} declares '${surface}', expected one of ${[...surfaceSet].join('/')}`);
        }
      }
      if (seenIds.has(entry.id)) {
        errors.push(`duplicate entry: ${kind} ${entry.id} appears more than once in the distribution inventory`);
      }
      seenIds.add(entry.id);

      // Task 4.3: a deprecated entry must carry compatibility-window metadata
      // and migration guidance — design.md decision 5 ("Deprecate in two
      // stages") requires the canonical source and a migration note to remain
      // available for a declared window, not just disappear from promotion.
      if (entry.lifecycle === 'deprecated') {
        const dep = entry.deprecation;
        if (!dep || typeof dep !== 'object') {
          errors.push(`missing deprecation metadata: ${kind} ${entry.id} is 'deprecated' but declares no 'deprecation' object (expected since/compatibilityWindowEnds/migrationNote)`);
        } else {
          for (const field of ['since', 'compatibilityWindowEnds', 'migrationNote']) {
            if (typeof dep[field] !== 'string' || dep[field].trim() === '') {
              errors.push(`incomplete deprecation metadata: ${kind} ${entry.id} is missing deprecation.${field}`);
            }
          }
        }
      }
    }
  }

  const byId = new Map((inventory.skills || []).map((s) => [s.id, s]));
  for (const id of generatedPromotedSkillIds) {
    const entry = byId.get(id);
    if (entry && entry.lifecycle === 'deprecated') {
      errors.push(`deprecated skill leaks into promoted output: ${id} is 'deprecated' but appears in the generated promoted surface`);
    }
  }

  return { errors };
}

// Task 1 naming/topology contract. Kept separate from the v1 lifecycle
// validator above so the existing release manifest can remain readable and
// backwards-compatible until the package migration task changes its schema.
// The function is pure; filesystem shape and projection checks live in
// scripts/lib/skill-topology.js.
function validateDistributionInventoryV2(input = {}) {
  const inventory = input && Object.prototype.hasOwnProperty.call(input, 'inventory')
    ? input.inventory
    : input;
  const errors = [];
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return { ok: false, errors: ['distribution inventory must be an object'] };
  }
  if (inventory.schema !== V2_SCHEMA) {
    errors.push(`distribution inventory schema must be ${V2_SCHEMA}, got '${inventory.schema || '<missing>'}'`);
  }
  if (!Array.isArray(inventory.skills)) {
    errors.push('distribution inventory v2 requires a skills array');
    return { ok: false, errors };
  }

  const ids = new Set();
  const names = new Set();
  const capabilities = new Set();
  const lifecycleSet = new Set(LIFECYCLES);
  const surfaceSet = new Set(SURFACES);

  inventory.skills.forEach((entry, index) => {
    const prefix = `skill[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${prefix} must be an object`);
      return;
    }

    for (const field of ['id', 'name', 'path', 'capability_id', 'lifecycle', 'tier', 'profiles', 'surfaces']) {
      if (!Object.prototype.hasOwnProperty.call(entry, field)) {
        errors.push(`${prefix} is missing required field '${field}'`);
      }
    }

    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      errors.push(`${prefix}.id must be a non-empty string`);
    } else if (ids.has(entry.id)) {
      errors.push(`duplicate stable id: ${entry.id}`);
    } else {
      ids.add(entry.id);
    }

    if (typeof entry.name !== 'string' || !PUBLIC_SKILL_NAME.test(entry.name) || entry.name.length > 63) {
      errors.push(`${prefix}.name must match ^dhpk-[a-z0-9]+(?:-[a-z0-9]+)*$ and be at most 63 characters: '${entry.name}'`);
    } else if (names.has(entry.name)) {
      errors.push(`duplicate public skill name: ${entry.name}`);
    } else {
      names.add(entry.name);
    }

    const expectedPath = typeof entry.name === 'string' ? `skills/${entry.name}` : null;
    if (entry.path !== expectedPath || !/^skills\/[^/]+$/.test(entry.path || '')) {
      errors.push(`${prefix}.path must be the flat canonical path '${expectedPath || 'skills/<name>'}'; got '${entry.path}'`);
    }

    if (typeof entry.capability_id !== 'string' || !CAPABILITY_ID.test(entry.capability_id)) {
      errors.push(`${prefix}.capability_id must match ^dhpk\\.[a-z0-9]+(?:[.-][a-z0-9]+)*$: '${entry.capability_id}'`);
    } else if (capabilities.has(entry.capability_id)) {
      errors.push(`duplicate capability_id: ${entry.capability_id}`);
    } else {
      capabilities.add(entry.capability_id);
    }

    if (typeof entry.lifecycle !== 'string' || !lifecycleSet.has(entry.lifecycle)) {
      errors.push(`${prefix}.lifecycle must be one of ${LIFECYCLES.join('/')}: '${entry.lifecycle}'`);
    }
    if (entry.tier !== 'core' && entry.tier !== 'optional') {
      errors.push(`${prefix}.tier must be 'core' or 'optional': '${entry.tier}'`);
    }

    if (!Array.isArray(entry.profiles) || entry.profiles.length === 0 || entry.profiles.some((profile) => typeof profile !== 'string' || profile.trim() === '')) {
      errors.push(`${prefix}.profiles must be a non-empty string array`);
    } else if (new Set(entry.profiles).size !== entry.profiles.length) {
      errors.push(`${prefix}.profiles must not contain duplicate values`);
    }

    if (!Array.isArray(entry.surfaces)) {
      errors.push(`${prefix}.surfaces must be a string array`);
    } else {
      if (new Set(entry.surfaces).size !== entry.surfaces.length) {
        errors.push(`${prefix}.surfaces must not contain duplicate values`);
      }
      for (const surface of entry.surfaces) {
        if (typeof surface !== 'string' || !surfaceSet.has(surface)) {
          errors.push(`${prefix}.surfaces contains invalid surface '${surface}'`);
        }
      }
    }

    if (entry.legacy_names !== undefined) {
      if (!Array.isArray(entry.legacy_names) || entry.legacy_names.length === 0 || entry.legacy_names.some((legacy) => typeof legacy !== 'string' || legacy.trim() === '')) {
        errors.push(`${prefix}.legacy_names must be a non-empty string array when present`);
      } else if (new Set(entry.legacy_names).size !== entry.legacy_names.length) {
        errors.push(`${prefix}.legacy_names must not contain duplicate values`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

// Task 1.4: reconcile the inventory against canonical packages, the module
// catalog, install profiles, and per-skill Codex (agents/openai.yaml)
// metadata. Distinct from validateDistributionInventory's structural checks
// (missing/invalid/duplicate/deprecated-leak) — this layer checks that
// declared surfaces are actually backed by the artifacts they claim.
function reconcileDistribution({
  inventory,
  codexMirrorNames = [],
  moduleCatalogIds = [],
  hasOpenaiMetadata = () => false,
}) {
  const errors = [];
  const mirrorSet = new Set(codexMirrorNames);
  const catalogSet = new Set(moduleCatalogIds);

  for (const m of inventory.modules || []) {
    if (!catalogSet.has(m.id)) {
      errors.push(`optional module absent from its catalog: ${m.id} has no manifests/module-catalog.json entry`);
    }
  }

  for (const s of inventory.skills || []) {
    const surfaces = s.surfaces || [];
    const projectionName = inventory && inventory.schema === V2_SCHEMA ? s.name : s.id;
    if (surfaces.includes('codex-sync') && !mirrorSet.has(projectionName)) {
      errors.push(`codex-sync surface without a mirror: ${s.id} declares codex-sync but codex/skills/${projectionName} does not exist`);
    }
    if ((surfaces.includes('codex-sync') || surfaces.includes('codex-native')) && !hasOpenaiMetadata(s)) {
      errors.push(`codex surface without agents/openai.yaml: ${s.id} declares a Codex surface but ${s.path}/agents/openai.yaml is missing`);
    }
  }

  return { errors };
}

// Task 2.2: derive the Claude plugin.json `skills[]` directory-root
// registration and the "generated promoted" skill id set from a distribution
// inventory object (pure — no fs access, so a rollback (task 5.4) can call
// this against a prior inventory revision read from disk by the caller).
//
// Claude's plugin.json format has no per-skill granularity (design.md
// decision 3): it registers whole directories. So a root stays registered as
// long as at least one of its skills is not deprecated — deprecating one
// skill in a module with other live skills does not, and cannot, remove that
// skill from host discovery. generatedSkillIds is the inventory-derived
// "should be promoted" set used for counts/validation (task 4) and is
// documentation truth, not a claim that the host actually hides anything;
// scripts/ci/gen-claude-manifest.js records that host limitation.
function generateClaudeSkillRoots(inventory) {
  const live = (inventory.skills || []).filter((s) => s.lifecycle !== 'deprecated');
  if (inventory && inventory.schema === V2_SCHEMA) {
    return {
      roots: live.length > 0 ? ['./skills/'] : [],
      generatedSkillIds: live.map((s) => s.id).sort(),
    };
  }

  const hasRootSkill = live.some((s) => !s.path.startsWith('modules/'));
  const liveModuleIds = new Set(
    live
      .filter((s) => s.path.startsWith('modules/'))
      .map((s) => s.path.split('/')[1])
  );

  const roots = [];
  if (hasRootSkill) roots.push('./skills/');
  for (const id of [...liveModuleIds].sort()) roots.push(`./modules/${id}/skills/`);

  return {
    roots,
    generatedSkillIds: live.map((s) => s.id).sort(),
  };
}

// Task 4.1/4.2: scoped counts, kept independently derived so a documentation
// claim can cite the count whose scope actually matches it (harness-count-integrity
// spec: canonical inventory must never stand in for a narrower published surface).
function computeScopedCounts(inventory) {
  const skills = inventory.skills || [];
  const modules = inventory.modules || [];
  const byLifecycle = (entries, lifecycle) => entries.filter((s) => s.lifecycle === lifecycle).length;
  const generated = generateClaudeSkillRoots(inventory);

  return {
    canonical: skills.length,
    canonicalModules: modules.length,
    promotedCore: byLifecycle(skills, 'promoted'),
    optional: byLifecycle(skills, 'optional'),
    experimental: byLifecycle(skills, 'experimental'),
    deprecated: byLifecycle(skills, 'deprecated'),
    // Module lifecycle counts, kept symmetric with the skill counts above —
    // validateDistributionInventory()'s deprecation-metadata requirement
    // applies to modules too, so a scoped-count consumer needs these to
    // report module deprecations with the same rigor as skill deprecations.
    optionalModules: byLifecycle(modules, 'optional'),
    experimentalModules: byLifecycle(modules, 'experimental'),
    deprecatedModules: byLifecycle(modules, 'deprecated'),
    claudePublished: generated.generatedSkillIds.length,
    codexPublished: skills.filter((s) => (s.surfaces || []).some((surf) => surf === 'codex-sync' || surf === 'codex-native')).length,
  };
}

module.exports = {
  LIFECYCLES,
  SURFACES,
  V2_SCHEMA,
  PUBLIC_SKILL_NAME,
  CAPABILITY_ID,
  classifyCanonicalInventory,
  serializeInventory,
  validateSupportingAssets,
  refreshSupportingDigests,
  validateDistributionInventory,
  validateDistributionInventoryV2,
  validateInventoryV2: validateDistributionInventoryV2,
  reconcileDistribution,
  generateClaudeSkillRoots,
  computeScopedCounts,
};

// Re-export the topology primitive from the inventory module so CI callers can
// consume one shared distribution API without importing two implementation
// files. The require is intentionally at the end to keep the topology module
// independent from inventory validation and avoid a circular dependency.
const { validateSkillTopology, validateTopology } = require('./skill-topology');
module.exports.validateSkillTopology = validateSkillTopology;
module.exports.validateTopology = validateTopology;
