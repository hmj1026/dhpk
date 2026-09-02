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
const { compileDistribution, verifyDistribution } = require('./distribution-compiler');
const { fingerprint, createDistributionArtifact, projectionError } = require('./distribution-projection-contract');
const { REQUIRED_SURFACES, REQUIRED_RUNTIME_SURFACES } = require('./harness-surfaces');
const { validateInternalRuntimeSkills } = require('./internal-runtime-skills');
const { assertCanonicalSkillPath } = require('./distribution-inventory-regeneration');

const LIFECYCLES = ['promoted', 'optional', 'experimental', 'deprecated'];
const INVOCATION_CLASSES = ['implicit-eligible', 'explicit-only'];
const SURFACES = [
  'claude-core',
  'claude-module',
  'codex-sync',
  'codex-native',
  'agent-plugin',
  'cursor-plugin',
  'cursor-sync',
  'agy-plugin',
];
const V2_SCHEMA = 'dhpk.distribution-inventory.v2';
const PUBLIC_SKILL_NAME = /^dhpk-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPABILITY_ID = /^dhpk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PLATFORM_MATRIX_SCHEMA = 'dhpk.platform-capability-matrix.v1';
const PLATFORM_STATUSES = [
  'PASS',
  'FAIL',
  'NOT_RUN',
  'NOT_CONFIGURED',
  'SKIP_INCOMPATIBLE',
  'BLOCKED',
  'UNAVAILABLE',
];
const PORTABLE_FRONTMATTER_ALLOWLIST = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
];
const CLIENT_METADATA_BOUNDARY = {
  claude: ['disable-model-invocation', 'context', 'argument-hint'],
  codex: ['agents/openai.yaml', 'policy.allow_implicit_invocation'],
  cursor: ['rules/frontmatter', 'variables', 'hooks'],
};
const PROJECTION_CONTRACT_SCHEMA = 'dhpk.distribution-projection-contract.v1';
const PROJECTION_SYMLINK_POLICIES = ['forbid', 'contained-relative', 'declared-source-relative'];
const PROJECTION_STAGES = ['structural', 'package', 'consumer-runtime'];
const MIGRATED_SELECTION_SURFACES = ['agent-plugin', 'cursor-plugin', 'codex-native'];
const SELECTION_POLICY_SOURCES = ['surface_membership', 'projection', 'platform_matrix', 'entry_surfaces'];

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
    const canonical = assertCanonicalSkillPath(relPath);
    const dirRel = path.dirname(relPath);
    const id = skillIdFromPath(relPath);
    const isModuleSkill = canonical.classification === 'module';
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

function preserveProjectionContract(generated, existing) {
  if (!existing || typeof existing !== 'object') return generated;
  const contract = {};
  for (const key of ['surfaces', 'surface_membership', 'platform_matrix', 'portable_frontmatter', 'projection_contract', 'retired_skills', 'agent_roster']) {
    if (Object.prototype.hasOwnProperty.call(existing, key)) contract[key] = existing[key];
  }
  return { ...generated, ...contract };
}

function serializeInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

// The inventory is the checked-in selection SSOT, so its writer must preserve
// the last accepted revision if a disk write or rename fails. A same-directory
// temporary file keeps the final rename on one filesystem and avoids exposing
// a partially truncated manifest to a concurrent validator.
function writeInventoryAtomically(filePath, content, filesystem = fs) {
  const directory = path.dirname(filePath);
  const temporaryDirectory = filesystem.mkdtempSync(path.join(directory, '.distribution-inventory-tmp-'));
  const temporaryPath = path.join(temporaryDirectory, path.basename(filePath));
  try {
    filesystem.writeFileSync(temporaryPath, content, { mode: 0o644, flag: 'wx' });
    filesystem.renameSync(temporaryPath, filePath);
  } finally {
    if (filesystem.existsSync(temporaryDirectory)) {
      filesystem.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
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

// Retirement rows are deliberately separate from active skill entries. They
// are identity and migration evidence only: no projection compiler is allowed
// to treat them as materializable skills or discovery aliases.
function validateSkillRetirements({ inventory } = {}) {
  const errors = [];
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return { errors };

  const rows = inventory.retired_skills;
  if (rows === undefined) return { errors };
  if (!Array.isArray(rows)) return { errors: ['distribution inventory retired_skills must be an array'] };

  const activeSkills = Array.isArray(inventory.skills) ? inventory.skills : [];
  const activeIds = new Set(activeSkills.map((entry) => entry && entry.id).filter((value) => typeof value === 'string'));
  const activeNames = new Set(activeSkills.map((entry) => entry && entry.name).filter((value) => typeof value === 'string'));
  const retiredIds = new Set();
  const retiredNames = new Set();
  const allowedSurfaces = new Set(SURFACES);
  const agentRoster = new Set(
    Array.isArray(inventory.agent_roster)
      ? inventory.agent_roster.filter((id) => typeof id === 'string')
      : [],
  );

  rows.forEach((entry, index) => {
    const prefix = `retired_skills[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${prefix} must be an object`);
      return;
    }

    for (const field of ['id', 'name', 'canonicalPath', 'priorSurfaces', 'retiredIn', 'reasonCode', 'replacements', 'rollback']) {
      if (!Object.prototype.hasOwnProperty.call(entry, field)) errors.push(`${prefix} is missing required field '${field}'`);
    }
    const allowedFields = new Set([
      'id', 'name', 'canonicalPath', 'priorSurfaces', 'retiredIn', 'reasonCode',
      'replacements', 'rollback',
    ]);
    for (const field of Object.keys(entry)) {
      if (!allowedFields.has(field)) errors.push(`${prefix}.${field} is not allowed for alias-free retirement rows`);
    }

    if (typeof entry.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.id)) {
      errors.push(`${prefix}.id must be a safe non-empty identifier (letters, digits, dot, underscore, hyphen; max 128 characters)`);
    } else if (retiredIds.has(entry.id)) {
      errors.push(`duplicate retired stable id: ${entry.id}`);
    } else if (activeIds.has(entry.id)) {
      errors.push(`retired stable id overlaps active skill: ${entry.id}`);
    } else {
      retiredIds.add(entry.id);
    }

    if (typeof entry.name !== 'string' || !PUBLIC_SKILL_NAME.test(entry.name) || entry.name.length > 63) {
      errors.push(`${prefix}.name must match ^dhpk-[a-z0-9]+(?:-[a-z0-9]+)*$ and be at most 63 characters: '${entry.name}'`);
    } else if (retiredNames.has(entry.name)) {
      errors.push(`duplicate retired public skill name: ${entry.name}`);
    } else if (activeNames.has(entry.name)) {
      errors.push(`retired public skill name overlaps active skill: ${entry.name}`);
    } else {
      retiredNames.add(entry.name);
    }

    const expectedPath = typeof entry.name === 'string' ? `skills/${entry.name}` : null;
    if (entry.canonicalPath !== expectedPath || !/^skills\/[^/]+$/.test(entry.canonicalPath || '')) {
      errors.push(`${prefix}.canonicalPath must be the flat canonical path '${expectedPath || 'skills/<name>'}'; got '${entry.canonicalPath}'`);
    }

    if (!Array.isArray(entry.priorSurfaces) || entry.priorSurfaces.length === 0) {
      errors.push(`${prefix}.priorSurfaces must be a non-empty surface array`);
    } else {
      const seen = new Set();
      for (const surface of entry.priorSurfaces) {
        if (typeof surface !== 'string' || !allowedSurfaces.has(surface)) errors.push(`${prefix}.priorSurfaces contains invalid surface '${surface}'`);
        else if (seen.has(surface)) errors.push(`${prefix}.priorSurfaces contains duplicate surface '${surface}'`);
        seen.add(surface);
      }
    }

    if (typeof entry.retiredIn !== 'string' || !/^\d+\.\d+\.\d+$/.test(entry.retiredIn)) {
      errors.push(`${prefix}.retiredIn must be a semantic version string`);
    }
    if (typeof entry.reasonCode !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.reasonCode)) {
      errors.push(`${prefix}.reasonCode must be a lowercase hyphenated code`);
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'legacy_names')) {
      errors.push(`${prefix}.legacy_names is forbidden for alias-free retirements`);
    }

    if (!Array.isArray(entry.replacements) || entry.replacements.length === 0) {
      errors.push(`${prefix}.replacements must be a non-empty array`);
    } else {
      entry.replacements.forEach((replacement, replacementIndex) => {
        const replacementPrefix = `${prefix}.replacements[${replacementIndex}]`;
        if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
          errors.push(`${replacementPrefix} must be an object`);
          return;
        }
        const replacementFields = replacement.kind === 'model-default'
          ? new Set(['kind'])
          : new Set(['kind', 'id', 'mode']);
        for (const field of Object.keys(replacement)) {
          if (!replacementFields.has(field)) errors.push(`${replacementPrefix}.${field} is not allowed for ${replacement.kind || 'unknown'} replacements`);
        }
        if (!['skill', 'agent', 'model-default'].includes(replacement.kind)) {
          errors.push(`${replacementPrefix}.kind must be skill, agent, or model-default`);
        }
        if (replacement.kind === 'model-default') {
          if (replacement.id !== undefined || replacement.mode !== undefined) {
            errors.push(`${replacementPrefix} model-default replacement must not declare id or mode`);
          }
        } else if (typeof replacement.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(replacement.id)) {
          errors.push(`${replacementPrefix}.id must be a safe non-empty identifier for ${replacement.kind} replacements`);
        } else if (replacement.kind === 'skill' && !activeIds.has(replacement.id)) {
          errors.push(`${replacementPrefix}.id must reference an active skill: '${replacement.id}'`);
        } else if (replacement.kind === 'agent'
            && (!Array.isArray(inventory.agent_roster) || !agentRoster.has(replacement.id))) {
          errors.push(`${replacementPrefix}.id must reference an inventory-owned active agent: '${replacement.id}'`);
        }
        if (replacement.mode !== undefined && (typeof replacement.mode !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(replacement.mode))) {
          errors.push(`${replacementPrefix}.mode must be a safe non-empty identifier when present`);
        }
      });
    }

    if (!entry.rollback || typeof entry.rollback !== 'object' || Array.isArray(entry.rollback)) {
      errors.push(`${prefix}.rollback must be an object`);
    } else if (Object.keys(entry.rollback).some((field) => field !== 'release')) {
      errors.push(`${prefix}.rollback may only declare release`);
    } else if (typeof entry.rollback.release !== 'string' || !/^\d+\.\d+\.\d+$/.test(entry.rollback.release)) {
      errors.push(`${prefix}.rollback.release must be a semantic version string`);
    }

    const memberships = inventory.surface_membership;
    if (memberships && typeof memberships === 'object' && !Array.isArray(memberships) && typeof entry.id === 'string') {
      for (const [surface, values] of Object.entries(memberships)) {
        if (Array.isArray(values) && values.includes(entry.id)) {
          errors.push(`${prefix}.id '${entry.id}' must not remain in active surface_membership.${surface}`);
        }
      }
    }
  });

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

    if (entry.invokable !== undefined && typeof entry.invokable !== 'boolean') {
      errors.push(`${prefix}.invokable must be a boolean when present`);
    }
    if (entry.invocation_class !== undefined && !INVOCATION_CLASSES.includes(entry.invocation_class)) {
      errors.push(`${prefix}.invocation_class must be one of ${INVOCATION_CLASSES.join('/')}: '${entry.invocation_class}'`);
    }
    if (entry.invokable === false && JSON.stringify([...(entry.surfaces || [])].sort()) !== JSON.stringify([...SURFACES].sort())) {
      errors.push(`${prefix} non-invokable internal skills must be registered on every distribution surface`);
    }

    if (entry.legacy_names !== undefined) {
      if (!Array.isArray(entry.legacy_names) || entry.legacy_names.length === 0 || entry.legacy_names.some((legacy) => typeof legacy !== 'string' || legacy.trim() === '')) {
        errors.push(`${prefix}.legacy_names must be a non-empty string array when present`);
      } else if (new Set(entry.legacy_names).size !== entry.legacy_names.length) {
        errors.push(`${prefix}.legacy_names must not contain duplicate values`);
      }
    }
  });

  const retirements = validateSkillRetirements({ inventory });
  errors.push(...retirements.errors);
  const membership = validateSurfaceMembership({ inventory, ids });
  errors.push(...membership.errors);
  const matrix = validatePlatformCapabilityMatrix(inventory.platform_matrix, {
    requireRequiredSurfaces: inventory.platform_matrix !== undefined,
    projectionContract: inventory.projection_contract,
  });
  errors.push(...matrix.errors);
  const frontmatter = validatePortableFrontmatterContract(inventory.portable_frontmatter);
  errors.push(...frontmatter.errors);
  const projection = validateProjectionContract(inventory.projection_contract);
  errors.push(...projection.errors);
  const selection = validateSelectionPolicyAgainstInventory({ inventory });
  errors.push(...selection.errors);
  const profilePolicy = validateCapabilityProfilePolicy({ inventory });
  errors.push(...profilePolicy.errors);
  const internalRuntime = validateInternalRuntimeSkills({ inventory, skillIds: ids });
  errors.push(...internalRuntime.errors);
  const routing = validateSkillRoutingFamilies({ families: inventory.skill_routing_families, skillIds: ids, skills: inventory.skills });
  errors.push(...routing.errors);

  return { ok: errors.length === 0, errors };
}

// Family routing is inventory metadata, not another projection interface. It
// preserves old invocation IDs while one router selects conditional detail.
function validateSkillRoutingFamilies({ families, skillIds = new Set(), skills = [] } = {}) {
  const errors = [];
  if (families === undefined) return { errors };
  if (!Array.isArray(families)) return { errors: ['skill_routing_families must be an array when present'] };
  const familyIds = new Set();
  const aliasIds = new Map();
  for (const [index, family] of families.entries()) {
    const prefix = `skill_routing_families[${index}]`;
    if (!family || typeof family !== 'object' || Array.isArray(family)) { errors.push(`${prefix} must be an object`); continue; }
    if (typeof family.id !== 'string' || family.id.trim() === '' || familyIds.has(family.id)) errors.push(`${prefix}.id must be a unique non-empty string`);
    else familyIds.add(family.id);
    if (typeof family.router_id !== 'string' || !skillIds.has(family.router_id)) errors.push(`${prefix} references missing router '${family.router_id}'`);
    if (!['implicit-eligible', 'explicit-only'].includes(family.invocation_class)) errors.push(`${prefix}.invocation_class is unsupported`);
    const surfaces = Array.isArray(family.surfaces) ? family.surfaces : [];
    for (const surface of surfaces) if (!SURFACES.includes(surface)) errors.push(`${prefix} declares unsupported surface '${surface}'`);
    if (!family.selectors || typeof family.selectors !== 'object' || Array.isArray(family.selectors) || Object.keys(family.selectors).length === 0) errors.push(`${prefix}.selectors must be a non-empty object`);
    else for (const [selector, reference] of Object.entries(family.selectors)) {
      if (selector.trim() === '' || !isSafeInventoryPath(reference)) errors.push(`${prefix}.selectors.${selector} must be a safe relative path`);
    }
    if (!Array.isArray(family.aliases) || family.aliases.length === 0) { errors.push(`${prefix}.aliases must be a non-empty array`); continue; }
    for (const alias of family.aliases) {
      if (!alias || typeof alias.id !== 'string' || alias.id.trim() === '') { errors.push(`${prefix}.aliases contains an invalid alias`); continue; }
      if (!family.selectors || !Object.prototype.hasOwnProperty.call(family.selectors, alias.selector)) errors.push(`${prefix}.aliases.${alias.id} has ambiguous/missing selector '${alias.selector}'`);
      if (alias.invocation_class !== family.invocation_class) errors.push(`${prefix}.aliases.${alias.id} has conflicting invocation class`);
      if (JSON.stringify(alias.surfaces || []) !== JSON.stringify(surfaces)) errors.push(`${prefix}.aliases.${alias.id} has unsupported surface membership`);
      const skill = skills.find((entry) => entry.id === alias.id);
      if (skills.length && (!skill || !(skill.legacy_names || []).includes(alias.id))) errors.push(`${prefix}.aliases.${alias.id} does not preserve a stable legacy identifier`);
      else if (skill && JSON.stringify(skill.surfaces) !== JSON.stringify(alias.surfaces)) errors.push(`${prefix}.aliases.${alias.id} drifts from canonical surface membership`);
      if (skill && family.selectors && family.selectors[alias.selector] !== `${skill.path}/SKILL.md`) {
        errors.push(`${prefix}.aliases.${alias.id} selector reference must match canonical skill path`);
      }
      if (aliasIds.has(alias.id)) errors.push(`duplicate alias '${alias.id}' in ${aliasIds.get(alias.id)} and ${family.id}`);
      else aliasIds.set(alias.id, family.id);
    }
  }
  return { errors };
}

// Convert inventory-owned routing metadata to the stable public shape used by
// projection consumers.  The inventory remains the only policy source: this
// helper clones every value, sorts the collections that have semantic order,
// and returns a deeply frozen view without mutating the caller's object.
function normalizeSkillRoutingFamilies({ inventory } = {}) {
  const families = inventory && Array.isArray(inventory.skill_routing_families)
    ? inventory.skill_routing_families
    : [];
  const skills = inventory && Array.isArray(inventory.skills) ? inventory.skills : [];
  const skillIds = new Set(skills.map((skill) => skill && skill.id).filter((id) => typeof id === 'string'));
  const validation = validateSkillRoutingFamilies({ families, skillIds, skills });
  if (validation.errors.length > 0) return freezeProjectionValue([]);

  const normalized = families.map((family) => ({
    id: family.id,
    routerId: family.router_id,
    invocationClass: family.invocation_class,
    surfaces: [...family.surfaces].sort(),
    selectors: Object.fromEntries(
      Object.entries(family.selectors)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([selector, reference]) => [selector, reference]),
    ),
    aliases: family.aliases
      .map((alias) => ({
        id: alias.id,
        selector: alias.selector,
        invocationClass: alias.invocation_class,
        surfaces: [...alias.surfaces].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  })).sort((left, right) => left.id.localeCompare(right.id));

  return freezeProjectionValue(normalized);
}

function routingLookupFamily(family) {
  if (!family || typeof family !== 'object' || Array.isArray(family)) return null;
  const hasSnakeRouter = Object.prototype.hasOwnProperty.call(family, 'router_id');
  const hasCamelRouter = Object.prototype.hasOwnProperty.call(family, 'routerId');
  if (hasSnakeRouter && hasCamelRouter && family.router_id !== family.routerId) return null;
  const hasSnakeInvocation = Object.prototype.hasOwnProperty.call(family, 'invocation_class');
  const hasCamelInvocation = Object.prototype.hasOwnProperty.call(family, 'invocationClass');
  if (hasSnakeInvocation && hasCamelInvocation && family.invocation_class !== family.invocationClass) return null;

  const routerId = hasCamelRouter ? family.routerId : family.router_id;
  const invocationClass = hasCamelInvocation ? family.invocationClass : family.invocation_class;
  if (typeof family.id !== 'string' || family.id.trim() === '' || typeof routerId !== 'string' || routerId.trim() === '') return null;
  if (!['implicit-eligible', 'explicit-only'].includes(invocationClass)) return null;
  if (!Array.isArray(family.surfaces) || family.surfaces.some((surface) => !SURFACES.includes(surface))) return null;
  if (!family.selectors || typeof family.selectors !== 'object' || Array.isArray(family.selectors) || Object.keys(family.selectors).length === 0) return null;

  const selectors = {};
  for (const [selector, reference] of Object.entries(family.selectors)) {
    if (typeof selector !== 'string' || selector.trim() === '' || !isSafeInventoryPath(reference)) return null;
    selectors[selector] = reference;
  }

  if (!Array.isArray(family.aliases) || family.aliases.length === 0) return null;
  const aliases = [];
  for (const alias of family.aliases) {
    if (!alias || typeof alias !== 'object' || Array.isArray(alias)) return null;
    const aliasSnakeInvocation = Object.prototype.hasOwnProperty.call(alias, 'invocation_class');
    const aliasCamelInvocation = Object.prototype.hasOwnProperty.call(alias, 'invocationClass');
    if (aliasSnakeInvocation && aliasCamelInvocation && alias.invocation_class !== alias.invocationClass) return null;
    const aliasInvocation = aliasCamelInvocation ? alias.invocationClass : alias.invocation_class;
    if (typeof alias.id !== 'string' || alias.id.trim() === '' || typeof alias.selector !== 'string' || !Object.prototype.hasOwnProperty.call(selectors, alias.selector)) return null;
    if (aliasInvocation !== invocationClass) return null;
    if (!Array.isArray(alias.surfaces) || alias.surfaces.some((surface) => !SURFACES.includes(surface))) return null;
    if (JSON.stringify([...alias.surfaces].sort()) !== JSON.stringify([...family.surfaces].sort())) return null;
    aliases.push({ id: alias.id, selector: alias.selector, invocationClass: aliasInvocation, surfaces: [...alias.surfaces].sort() });
  }
  aliases.sort((left, right) => left.id.localeCompare(right.id));
  for (let index = 1; index < aliases.length; index += 1) {
    if (aliases[index - 1].id === aliases[index].id) return null;
  }
  return { id: family.id, routerId, invocationClass, surfaces: [...family.surfaces].sort(), selectors, aliases };
}

// Resolve one exact selector or one retained alias.  A malformed family,
// unsafe path, missing selector, duplicate alias, or conflicting selector is
// deliberately indistinguishable from an unknown route: callers receive null
// and can never fall back to sibling-version detail.
function resolveSkillRoutingReference({ inventory, families, familyId, selector, id } = {}) {
  const source = families === undefined
    ? normalizeSkillRoutingFamilies({ inventory })
    : families;
  if (!Array.isArray(source) || source.length === 0) return null;
  const records = source.map(routingLookupFamily);
  if (records.some((record) => record === null)) return null;

  const familyIds = new Set();
  for (const record of records) {
    if (familyIds.has(record.id)) return null;
    familyIds.add(record.id);
  }

  if (familyId !== undefined && (typeof familyId !== 'string' || familyId.trim() === '')) return null;
  if (selector !== undefined && (typeof selector !== 'string' || selector.trim() === '')) return null;
  if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) return null;

  let family = null;
  let selectedSelector = selector;
  if (id !== undefined) {
    const matches = [];
    for (const candidate of records) {
      for (const alias of candidate.aliases) if (alias.id === id) matches.push({ family: candidate, alias });
    }
    if (matches.length !== 1) return null;
    if (familyId !== undefined && matches[0].family.id !== familyId) return null;
    if (selector !== undefined && matches[0].alias.selector !== selector) return null;
    family = matches[0].family;
    selectedSelector = matches[0].alias.selector;
  } else {
    if (familyId === undefined || selector === undefined) return null;
    const matches = records.filter((candidate) => candidate.id === familyId);
    if (matches.length !== 1) return null;
    family = matches[0];
  }

  if (!family || !Object.prototype.hasOwnProperty.call(family.selectors, selectedSelector)) return null;
  const reference = family.selectors[selectedSelector];
  return isSafeInventoryPath(reference) ? reference : null;
}

function resolveSkillRoutingAlias({ families = [], id } = {}) {
  for (const family of families) for (const alias of family.aliases || []) {
    if (alias.id === id) {
      const routerId = family.router_id === undefined ? family.routerId : family.router_id;
      return { familyId: family.id, routerId, selector: alias.selector, reference: family.selectors && family.selectors[alias.selector] };
    }
  }
  return null;
}

// Resolve an identifier without introducing compatibility aliases. Active
// inventory entries win; retired rows are consulted only after active lookup
// fails, and unknown identifiers retain their original input for diagnostics.
function resolveSkillIdentity({ inventory, identifier } = {}) {
  const skills = inventory && Array.isArray(inventory.skills) ? inventory.skills : [];
  const active = skills.find((entry) => entry && (
    entry.id === identifier
    || entry.name === identifier
    || (Array.isArray(entry.legacy_names) && entry.legacy_names.includes(identifier))
  ));
  if (active) {
    return {
      state: 'active',
      stableId: active.id,
      publicName: active.name || active.id,
    };
  }

  const retirementValidation = validateSkillRetirements({ inventory });
  if (retirementValidation.errors.length > 0) return { state: 'unknown', identifier };

  const retired = inventory && Array.isArray(inventory.retired_skills) ? inventory.retired_skills : [];
  const retiredEntry = retired.find((entry) => entry && (
    entry.id === identifier
    || entry.name === identifier
  ));
  if (retiredEntry) {
    return {
      state: 'retired',
      stableId: retiredEntry.id,
      publicName: retiredEntry.name,
      retiredIn: retiredEntry.retiredIn,
      reasonCode: retiredEntry.reasonCode,
      replacements: Array.isArray(retiredEntry.replacements)
        ? retiredEntry.replacements.map((replacement) => ({ ...replacement }))
        : [],
    };
  }

  return { state: 'unknown', identifier };
}

function formatSkillIdentityDiagnostic({ inventory, resolution } = {}) {
  if (!resolution || resolution.state !== 'retired'
    || typeof resolution.retiredIn !== 'string'
    || typeof resolution.reasonCode !== 'string'
    || !Array.isArray(resolution.replacements)) return '';
  const retirementValidation = validateSkillRetirements({ inventory });
  if (retirementValidation.errors.length > 0) return '';
  const retiredRows = inventory && Array.isArray(inventory.retired_skills) ? inventory.retired_skills : [];
  const retiredEntry = retiredRows.find((entry) => entry
    && entry.id === resolution.stableId
    && entry.name === resolution.publicName
    && entry.retiredIn === resolution.retiredIn
    && entry.reasonCode === resolution.reasonCode
    && JSON.stringify(entry.replacements) === JSON.stringify(resolution.replacements));
  if (!retiredEntry) return '';
  const skills = inventory && Array.isArray(inventory.skills) ? inventory.skills : [];
  const replacements = (resolution.replacements || []).map((replacement) => {
    if (replacement.kind === 'model-default') return 'model-default guidance';
    let identity = replacement.id || '<missing successor>';
    if (replacement.kind === 'skill') {
      const successor = skills.find((entry) => entry && entry.id === replacement.id);
      identity = successor && successor.name ? successor.name : `dhpk-${identity}`;
    }
    const mode = replacement.mode ? ` (${replacement.mode})` : '';
    return `${replacement.kind} ${identity}${mode}`;
  });
  const guidance = replacements.length > 0 ? replacements.join(', ') : 'no successor guidance';
  return `run-skill: skill '${resolution.publicName || resolution.stableId}' retired in ${resolution.retiredIn || 'an earlier release'} (reason: ${resolution.reasonCode || 'unspecified'}); use ${guidance}.`;
}

function validateSurfaceMembership({ inventory, ids: skillIds = new Set() }) {
  const errors = [];
  const membership = inventory && inventory.surface_membership;
  if (membership === undefined) return { errors };
  if (!membership || typeof membership !== 'object' || Array.isArray(membership)) {
    return { errors: ['surface_membership must be an object when present'] };
  }
  const knownIds = new Set(skillIds);
  for (const [surface, values] of Object.entries(membership)) {
    if (!SURFACES.includes(surface)) {
      errors.push(`surface_membership declares unsupported surface '${surface}'`);
      continue;
    }
    if (!Array.isArray(values)) {
      errors.push(`surface_membership.${surface} must be a string array`);
      continue;
    }
    const seen = new Set();
    for (const id of values) {
      if (typeof id !== 'string' || id.trim() === '') {
        errors.push(`surface_membership.${surface} contains an empty/non-string stable id`);
      } else if (!knownIds.has(id)) {
        errors.push(`surface_membership.${surface} references unknown stable id '${id}'`);
      } else if (seen.has(id)) {
        errors.push(`surface_membership.${surface} contains duplicate stable id '${id}'`);
      }
      seen.add(id);
    }
  }
  for (const requiredSurface of ['agent-plugin', 'cursor-plugin', 'cursor-sync']) {
    if (!Object.prototype.hasOwnProperty.call(membership, requiredSurface)) {
      errors.push(`surface_membership is missing required '${requiredSurface}' selection`);
    }
  }
  return { errors };
}

function validateRequiredSurfaceList(requiredSurfaces, {
  label = 'required_surfaces',
  fullRelease = true,
} = {}) {
  const errors = [];
  if (!Array.isArray(requiredSurfaces) || requiredSurfaces.length === 0) {
    errors.push(`${label} must be a non-empty array`);
    return { errors, value: null };
  }
  const seen = new Set();
  for (const surface of requiredSurfaces) {
    if (typeof surface !== 'string' || !REQUIRED_SURFACES.includes(surface)) {
      errors.push(`${label} contains unknown surface '${surface}'`);
    } else if (seen.has(surface)) {
      errors.push(`${label} contains duplicate surface '${surface}'`);
    }
    seen.add(surface);
  }
  if (fullRelease && errors.length === 0
    && (requiredSurfaces.length !== REQUIRED_SURFACES.length
      || requiredSurfaces.some((surface, index) => surface !== REQUIRED_SURFACES[index]))) {
    errors.push(`${label} must exactly match the canonical required surface order: ${REQUIRED_SURFACES.join(', ')}`);
  }
  return { errors, value: errors.length === 0 ? [...requiredSurfaces] : null };
}

function validateRequiredRuntimeSurfaceList(requiredRuntimeSurfaces, requiredSurfaces, {
  label = 'required_runtime_surfaces',
  fullRelease = true,
} = {}) {
  const errors = [];
  if (!Array.isArray(requiredRuntimeSurfaces) || requiredRuntimeSurfaces.length === 0) {
    errors.push(`${label} must be a non-empty array`);
    return { errors, value: null };
  }
  const seen = new Set();
  const allowed = Array.isArray(requiredSurfaces) ? new Set(requiredSurfaces) : new Set(REQUIRED_SURFACES);
  let previousIndex = -1;
  for (const surface of requiredRuntimeSurfaces) {
    if (typeof surface !== 'string' || !REQUIRED_SURFACES.includes(surface)) {
      errors.push(`${label} contains unknown surface '${surface}'`);
    } else if (surface === 'cursor-sync') {
      errors.push(`${label} must not include cursor-sync`);
    } else if (!allowed.has(surface)) {
      errors.push(`${label} contains surface '${surface}' outside required_surfaces`);
    } else if (seen.has(surface)) {
      errors.push(`${label} contains duplicate surface '${surface}'`);
    }
    const index = REQUIRED_SURFACES.indexOf(surface);
    if (index >= 0 && index < previousIndex) errors.push(`${label} must preserve required surface order`);
    if (index >= 0) previousIndex = index;
    seen.add(surface);
  }
  if (fullRelease && errors.length === 0
    && (requiredRuntimeSurfaces.length !== REQUIRED_RUNTIME_SURFACES.length
      || requiredRuntimeSurfaces.some((surface, index) => surface !== REQUIRED_RUNTIME_SURFACES[index]))) {
    errors.push(`${label} must exactly match the canonical required runtime surface order: ${REQUIRED_RUNTIME_SURFACES.join(', ')}`);
  }
  return { errors, value: errors.length === 0 ? [...requiredRuntimeSurfaces] : null };
}

function validateRequiredSurfaceProjectionContracts(requiredSurfaces, projectionContract) {
  const errors = [];
  if (!projectionContract || typeof projectionContract !== 'object' || Array.isArray(projectionContract)) {
    return { errors: ['projection_contract is required for required surface validation'] };
  }
  const surfaces = projectionContract.surfaces;
  if (!surfaces || typeof surfaces !== 'object' || Array.isArray(surfaces)) {
    return { errors: ['projection_contract.surfaces is required for required surface validation'] };
  }
  for (const surface of requiredSurfaces) {
    if (!surfaces[surface] || typeof surfaces[surface] !== 'object' || Array.isArray(surfaces[surface])) {
      errors.push(`required surface '${surface}' has no matching projection contract`);
    }
  }
  return { errors };
}

function validatePlatformCapabilityMatrix(matrix, {
  requireRequiredSurfaces = false,
  projectionContract,
} = {}) {
  const errors = [];
  if (matrix === undefined) {
    if (requireRequiredSurfaces) errors.push('platform_matrix is required for required surface validation');
    return { errors };
  }
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    return { errors: ['platform_matrix must be an object when present'] };
  }
  if (matrix.schema !== PLATFORM_MATRIX_SCHEMA) {
    errors.push(`platform_matrix schema must be ${PLATFORM_MATRIX_SCHEMA}, got '${matrix.schema || '<missing>'}'`);
  }
  if (!Array.isArray(matrix.entries)) {
    errors.push('platform_matrix.entries must be an array');
    return { errors };
  }
  let requiredSurfaceValidation = { errors: [], value: null };
  if (requireRequiredSurfaces || Object.prototype.hasOwnProperty.call(matrix, 'required_surfaces')) {
    requiredSurfaceValidation = validateRequiredSurfaceList(matrix.required_surfaces, {
      label: 'platform_matrix.required_surfaces',
      fullRelease: true,
    });
    errors.push(...requiredSurfaceValidation.errors);
    if (projectionContract !== undefined && requiredSurfaceValidation.value) {
      errors.push(...validateRequiredSurfaceProjectionContracts(
        requiredSurfaceValidation.value,
        projectionContract,
      ).errors);
    }
  }
  const runtimeLabel = 'platform_matrix.required_runtime_surfaces';
  const runtimeSurfaceValidation = validateRequiredRuntimeSurfaceList(
    matrix.required_runtime_surfaces,
    requiredSurfaceValidation.value || matrix.required_surfaces,
    { label: runtimeLabel, fullRelease: true },
  );
  if (requireRequiredSurfaces || Object.prototype.hasOwnProperty.call(matrix, 'required_runtime_surfaces')) {
    errors.push(...runtimeSurfaceValidation.errors);
  }
  const ids = new Set();
  for (const [index, entry] of matrix.entries.entries()) {
    const prefix = `platform_matrix.entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    for (const field of ['id', 'public_name', 'surface', 'source_paths', 'destination', 'transform', 'fallback', 'evidence']) {
      if (!Object.prototype.hasOwnProperty.call(entry, field)) errors.push(`${prefix} is missing required field '${field}'`);
    }
    if (typeof entry.id !== 'string' || !/^dhpk\.platform\.[a-z0-9.-]+$/.test(entry.id)) {
      errors.push(`${prefix}.id must be a stable dhpk.platform.* identifier`);
    } else if (ids.has(entry.id)) {
      errors.push(`duplicate platform matrix id: ${entry.id}`);
    } else ids.add(entry.id);
    if (typeof entry.public_name !== 'string' || entry.public_name.trim() === '') errors.push(`${prefix}.public_name must be non-empty`);
    if (typeof entry.surface !== 'string' || !SURFACES.includes(entry.surface)) errors.push(`${prefix}.surface must be a known distribution surface`);
    if (!Array.isArray(entry.source_paths) || entry.source_paths.length === 0 || entry.source_paths.some((p) => !isSafeInventoryPath(p))) {
      errors.push(`${prefix}.source_paths must be a non-empty array of safe relative paths`);
    }
    for (const field of ['destination', 'transform', 'fallback']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') errors.push(`${prefix}.${field} must be non-empty`);
    }
    const projectionMode = entry.projection_mode || (entry.shared_surface ? 'shared' : 'overlay');
    if (!['owner', 'shared', 'overlay'].includes(projectionMode)) {
      errors.push(`${prefix}.projection_mode must be 'owner', 'shared', or 'overlay'`);
    }
    if (projectionMode === 'owner' && entry.shared_surface !== undefined) {
      errors.push(`${prefix}.shared_surface is not valid for an owner projection`);
    }
    if (projectionMode === 'shared') {
      if (typeof entry.shared_surface !== 'string' || !SURFACES.includes(entry.shared_surface)) {
        errors.push(`${prefix}.shared_surface must name a known source surface for shared projections`);
      } else if (entry.shared_surface === entry.surface) {
        errors.push(`${prefix}.shared_surface must differ from the destination surface`);
      }
    } else if (entry.shared_surface !== undefined) {
      errors.push(`${prefix}.shared_surface is only valid for projection_mode 'shared'`);
    }
    if (typeof entry.evidence !== 'string' || !PLATFORM_STATUSES.includes(entry.evidence)) {
      errors.push(`${prefix}.evidence must be one of ${PLATFORM_STATUSES.join('/')}`);
    }
  }
  return { errors };
}

// Validate both the inventory-owned list and the copy carried by an upcoming
// full/scoped plan. The helper is intentionally pure so preflight and release
// aggregation can share it without creating another selection policy.
function validateRequiredSurfacePlan({
  inventory,
  requiredSurfaces,
  planRequiredSurfaces,
  requiredRuntimeSurfaces,
  planRequiredRuntimeSurfaces,
  fullRelease = true,
} = {}) {
  const matrix = inventory && inventory.platform_matrix;
  const projectionContract = inventory && inventory.projection_contract;
  const matrixResult = validatePlatformCapabilityMatrix(matrix, {
    requireRequiredSurfaces: true,
    projectionContract,
  });
  const errors = [...matrixResult.errors];
  const plan = planRequiredSurfaces === undefined ? requiredSurfaces : planRequiredSurfaces;
  const matrixList = matrix && matrix.required_surfaces;
  const matrixRuntimeList = matrix && matrix.required_runtime_surfaces;
  if (plan !== undefined) {
    const planResult = validateRequiredSurfaceList(plan, {
      label: 'plan.required_surfaces',
      fullRelease,
    });
    errors.push(...planResult.errors);
    if (planResult.value && Array.isArray(matrixList)) {
      if (fullRelease && JSON.stringify(planResult.value) !== JSON.stringify(matrixList)) {
        errors.push('plan.required_surfaces must exactly match platform_matrix.required_surfaces for a full release');
      }
      if (!fullRelease) {
        const missing = planResult.value.filter((surface) => !matrixList.includes(surface));
        if (missing.length > 0) {
          errors.push(`plan.required_surfaces contains surfaces absent from platform_matrix.required_surfaces: ${missing.join(', ')}`);
        }
      }
    }
  }
  const runtimePlan = planRequiredRuntimeSurfaces === undefined
    ? requiredRuntimeSurfaces
    : planRequiredRuntimeSurfaces;
  if (runtimePlan !== undefined) {
    const runtimeResult = validateRequiredRuntimeSurfaceList(runtimePlan, matrixList, {
      label: 'plan.required_runtime_surfaces',
      fullRelease,
    });
    errors.push(...runtimeResult.errors);
    if (runtimeResult.value && Array.isArray(matrixRuntimeList)) {
      if (fullRelease && JSON.stringify(runtimeResult.value) !== JSON.stringify(matrixRuntimeList)) {
        errors.push('plan.required_runtime_surfaces must exactly match platform_matrix.required_runtime_surfaces for a full release');
      }
      if (!fullRelease) {
        const missing = runtimeResult.value.filter((surface) => !matrixRuntimeList.includes(surface));
        if (missing.length > 0) errors.push(`plan.required_runtime_surfaces contains surfaces absent from platform_matrix.required_runtime_surfaces: ${missing.join(', ')}`);
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    requiredSurfaces: Array.isArray(matrixList) ? [...matrixList] : null,
    requiredRuntimeSurfaces: Array.isArray(matrixRuntimeList) ? [...matrixRuntimeList] : null,
  };
}

function validatePortableFrontmatterContract(contract) {
  const errors = [];
  if (contract === undefined) return { errors };
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return { errors: ['portable_frontmatter must be an object when present'] };
  }
  if (!Array.isArray(contract.allowlist) || contract.allowlist.length === 0) {
    errors.push('portable_frontmatter.allowlist must be a non-empty string array');
  } else {
    for (const field of contract.allowlist) {
      if (!PORTABLE_FRONTMATTER_ALLOWLIST.includes(field)) errors.push(`portable_frontmatter.allowlist contains non-portable field '${field}'`);
    }
  }
  if (!Array.isArray(contract.client_owned) || contract.client_owned.length === 0) {
    errors.push('portable_frontmatter.client_owned must be a non-empty string array');
  }
  return { errors };
}

function validateProjectionContract(contract) {
  const errors = [];
  if (contract === undefined) return { errors };
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return { errors: ['projection_contract must be an object when present'] };
  }
  if (contract.schema !== PROJECTION_CONTRACT_SCHEMA) {
    errors.push(`projection_contract schema must be ${PROJECTION_CONTRACT_SCHEMA}, got '${contract.schema || '<missing>'}'`);
  }
  if (!contract.compiler || typeof contract.compiler !== 'object') {
    errors.push('projection_contract.compiler must be an object');
  } else {
    for (const field of ['id', 'version']) {
      if (typeof contract.compiler[field] !== 'string' || contract.compiler[field].trim() === '') {
        errors.push(`projection_contract.compiler.${field} must be non-empty`);
      }
    }
  }
  if (!Array.isArray(contract.symlink_policies) || contract.symlink_policies.length === 0) {
    errors.push('projection_contract.symlink_policies must be a non-empty string array');
  } else {
    for (const policy of contract.symlink_policies) {
      if (!PROJECTION_SYMLINK_POLICIES.includes(policy)) {
        errors.push(`projection_contract.symlink_policies contains unsupported policy '${policy}'`);
      }
    }
  }
  if (!contract.surfaces || typeof contract.surfaces !== 'object' || Array.isArray(contract.surfaces)) {
    errors.push('projection_contract.surfaces must be an object');
    return { errors };
  }
  for (const surface of SURFACES) {
    const rule = contract.surfaces[surface];
    if (!rule || typeof rule !== 'object') {
      errors.push(`projection_contract.surfaces is missing '${surface}'`);
      continue;
    }
    for (const field of ['adapter', 'owner', 'symlink_policy']) {
      if (typeof rule[field] !== 'string' || rule[field].trim() === '') {
        errors.push(`projection_contract.surfaces.${surface}.${field} must be non-empty`);
      }
    }
    if (typeof rule.symlink_policy === 'string' && !PROJECTION_SYMLINK_POLICIES.includes(rule.symlink_policy)) {
      errors.push(`projection_contract.surfaces.${surface}.symlink_policy is unsupported: '${rule.symlink_policy}'`);
    }
    if (!Array.isArray(rule.verification_stages) || rule.verification_stages.length === 0) {
      errors.push(`projection_contract.surfaces.${surface}.verification_stages must be a non-empty array`);
    } else {
      for (const stage of rule.verification_stages) {
        if (!PROJECTION_STAGES.includes(stage)) {
          errors.push(`projection_contract.surfaces.${surface}.verification_stages contains unsupported stage '${stage}'`);
        }
      }
    }
    if (MIGRATED_SELECTION_SURFACES.includes(surface)) {
      const policy = rule.selection_policy;
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
        errors.push(`projection_contract.surfaces.${surface}.selection_policy must be an object`);
      } else {
        if (!SELECTION_POLICY_SOURCES.includes(policy.source)) {
          errors.push(`projection_contract.surfaces.${surface}.selection_policy has unsupported selection policy source '${policy.source || '<missing>'}'`);
        }
        if (!Array.isArray(policy.precedence) || policy.precedence.length === 0) {
          errors.push(`projection_contract.surfaces.${surface}.selection_policy.precedence must be a non-empty array`);
        } else {
          const seenPrecedence = new Set();
          for (const source of policy.precedence) {
            if (!SELECTION_POLICY_SOURCES.includes(source)) {
              errors.push(`projection_contract.surfaces.${surface}.selection_policy.precedence contains unsupported source '${source}'`);
            } else if (seenPrecedence.has(source)) {
              errors.push(`projection_contract.surfaces.${surface}.selection_policy.precedence contains duplicate source '${source}'`);
            }
            seenPrecedence.add(source);
          }
          if (typeof policy.source === 'string' && !seenPrecedence.has(policy.source)) {
            errors.push(`projection_contract.surfaces.${surface}.selection_policy source '${policy.source}' is absent from precedence`);
          }
          if (surface === 'codex-native' && (policy.source !== 'entry_surfaces' || policy.precedence.length !== 1 || policy.precedence[0] !== 'entry_surfaces')) {
            errors.push('projection_contract.surfaces.codex-native selection policy cannot broaden beyond entry_surfaces');
          }
        }
      }
    }
  }
  for (const surface of Object.keys(contract.surfaces)) {
    if (!SURFACES.includes(surface)) errors.push(`projection_contract.surfaces declares unsupported surface '${surface}'`);
  }
  return { errors };
}

function validateSelectionPolicyAgainstInventory({ inventory } = {}) {
  const errors = [];
  const contract = inventory && inventory.projection_contract;
  if (!contract || !contract.surfaces) return { errors };
  for (const surface of MIGRATED_SELECTION_SURFACES) {
    const policy = contract.surfaces[surface] && contract.surfaces[surface].selection_policy;
    if (!policy || !Array.isArray(policy.precedence)) continue;
    for (const source of policy.precedence) {
      if (source === 'surface_membership' && (!inventory.surface_membership || !Object.prototype.hasOwnProperty.call(inventory.surface_membership, surface)) && policy.source === source) {
        errors.push(`selection policy for '${surface}' requires surface_membership.${surface}`);
      }
      if (source === 'projection' && (!inventory.projections || !Object.prototype.hasOwnProperty.call(inventory.projections, surface)) && policy.source === source) {
        errors.push(`selection policy for '${surface}' requires projections.${surface}`);
      }
      if (source === 'platform_matrix' && (!inventory.platform_matrix || !Array.isArray(inventory.platform_matrix.entries) || !inventory.platform_matrix.entries.some((entry) => entry && entry.surface === surface)) && policy.source === source) {
        errors.push(`selection policy for '${surface}' requires platform_matrix entries`);
      }
    }
    if (surface === 'codex-native' && inventory.surface_membership && Object.prototype.hasOwnProperty.call(inventory.surface_membership, surface)) {
      errors.push('codex-native selection policy cannot declare a duplicate surface_membership allowlist');
    }
  }
  return { errors };
}

function validateCapabilityProfilePolicy({ inventory } = {}) {
  const errors = [];
  const policy = inventory && inventory.profile_policy;
  if (policy === undefined) return { errors };
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return { errors: ['profile_policy must be an object when present'] };
  if (typeof policy.version !== 'string' || policy.version.trim() === '') errors.push('profile_policy.version must be a non-empty string');
  const active = new Set((inventory.skills || []).filter((entry) => entry && entry.lifecycle !== 'deprecated').map((entry) => entry.id));
  const retired = new Set((inventory.retired_skills || []).map((entry) => entry && entry.id).filter(Boolean));
  if (!Array.isArray(policy.required_core_ids) || policy.required_core_ids.length === 0) {
    errors.push('profile_policy.required_core_ids must be a non-empty array of stable IDs');
  } else {
    if (new Set(policy.required_core_ids).size !== policy.required_core_ids.length) errors.push('profile_policy.required_core_ids must not contain duplicates');
    for (const id of policy.required_core_ids) {
      if (typeof id !== 'string' || id.trim() === '') errors.push('profile_policy.required_core_ids contains a missing stable ID');
      else if (!active.has(id)) errors.push(`profile_policy.required_core_ids references inactive stable ID '${id}'`);
      else if (retired.has(id)) errors.push(`profile_policy.required_core_ids references retired stable ID '${id}'`);
      const entry = (inventory.skills || []).find((skill) => skill && skill.id === id);
      if (entry && entry.tier !== 'core' && entry.lifecycle !== 'promoted') errors.push(`profile_policy.required_core_ids stable ID '${id}' is not promoted/core`);
    }
  }
  if (!policy.profiles || typeof policy.profiles !== 'object' || Array.isArray(policy.profiles)) {
    errors.push('profile_policy.profiles must be an object');
  } else {
    for (const id of ['minimal', 'full', 'compat-v1']) {
      const profile = policy.profiles[id];
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) errors.push(`profile_policy.profiles.${id} is required`);
      else if (typeof profile.selection !== 'string' || profile.selection.trim() === '') errors.push(`profile_policy.profiles.${id}.selection must be a non-empty string`);
    }
  }
  return { errors };
}

// Task 1.4: reconcile the inventory against canonical packages, the module
// catalog, install profiles, and per-skill Codex (agents/openai.yaml)
// metadata. Distinct from validateDistributionInventory's structural checks
// (missing/invalid/duplicate/deprecated-leak) — this layer checks that
// declared surfaces are actually backed by the artifacts they claim.
function reconcileDistribution({
  inventory,
  codexMirrorNames = [],
  cursorMirrorNames = [],
  moduleCatalogIds = [],
  hasOpenaiMetadata = () => false,
}) {
  const errors = [];
  const mirrorSet = new Set(codexMirrorNames);
  const cursorMirrorSet = new Set(cursorMirrorNames);
  const catalogSet = new Set(moduleCatalogIds);

  for (const m of inventory.modules || []) {
    if (!catalogSet.has(m.id)) {
      errors.push(`optional module absent from its catalog: ${m.id} has no manifests/module-catalog.json entry`);
    }
  }

  const membershipIds = new Set(
    inventory && inventory.surface_membership && Array.isArray(inventory.surface_membership['cursor-sync'])
      ? inventory.surface_membership['cursor-sync']
      : [],
  );

  for (const s of inventory.skills || []) {
    const surfaces = s.surfaces || [];
    const projectionName = inventory && inventory.schema === V2_SCHEMA ? s.name : s.id;
    if (surfaces.includes('codex-sync') && !mirrorSet.has(projectionName)) {
      errors.push(`codex-sync surface without a mirror: ${s.id} declares codex-sync but codex/skills/${projectionName} does not exist`);
    }
    if ((surfaces.includes('cursor-sync') || membershipIds.has(s.id)) && !cursorMirrorSet.has(projectionName)) {
      errors.push(`cursor-sync surface without a mirror: ${s.id} declares cursor-sync but cursor/skills/${projectionName} does not exist`);
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
  const registered = (inventory.skills || []).filter((s) => s.lifecycle !== 'deprecated');
  const invokable = registered.filter((s) => s.invokable !== false);
  if (inventory && inventory.schema === V2_SCHEMA) {
    return {
      roots: registered.length > 0 ? ['./skills/'] : [],
      registeredSkillIds: registered.map((s) => s.id).sort(),
      generatedSkillIds: invokable.map((s) => s.id).sort(),
    };
  }

  const hasRootSkill = registered.some((s) => !s.path.startsWith('modules/'));
  const liveModuleIds = new Set(
    registered
      .filter((s) => s.path.startsWith('modules/'))
      .map((s) => s.path.split('/')[1])
  );

  const roots = [];
  if (hasRootSkill) roots.push('./skills/');
  for (const id of [...liveModuleIds].sort()) roots.push(`./modules/${id}/skills/`);

  return {
    roots,
    registeredSkillIds: registered.map((s) => s.id).sort(),
    generatedSkillIds: invokable.map((s) => s.id).sort(),
  };
}

function freezeProjectionValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeProjectionValue(child);
  return Object.freeze(value);
}

function normalizedInventoryView(inventory, generated) {
  const normalize = (entries) => (entries || [])
    .map((entry) => ({
      id: entry.id,
      name: entry.name || null,
      path: entry.path,
      lifecycle: entry.lifecycle,
      invokable: entry.invokable !== false,
      surfaces: [...(entry.surfaces || [])].sort(),
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const normalizeRetirements = (entries) => (entries || [])
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      canonicalPath: entry.canonicalPath,
      priorSurfaces: [...(entry.priorSurfaces || [])].sort(),
      retiredIn: entry.retiredIn,
      reasonCode: entry.reasonCode,
      replacements: (entry.replacements || [])
        .map((replacement) => ({
          kind: replacement.kind,
          ...(replacement.id === undefined ? {} : { id: replacement.id }),
          ...(replacement.mode === undefined ? {} : { mode: replacement.mode }),
        }))
        .sort((left, right) => `${left.kind}:${left.id || ''}:${left.mode || ''}`.localeCompare(`${right.kind}:${right.id || ''}:${right.mode || ''}`)),
      rollback: entry.rollback && typeof entry.rollback === 'object'
        ? { release: entry.rollback.release }
        : null,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return freezeProjectionValue({
    schema: inventory && inventory.schema ? inventory.schema : null,
    roots: [...generated.roots],
    generatedSkillIds: [...generated.generatedSkillIds],
    skills: normalize(inventory && inventory.skills),
    modules: normalize(inventory && inventory.modules),
    retiredSkills: normalizeRetirements(inventory && inventory.retired_skills),
  });
}

function projectionOutput(stableId, source, destination, content, transform) {
  const bytes = Buffer.from(content);
  return {
    stableId,
    source,
    destination,
    content: bytes,
    expectedFingerprint: crypto.createHash('sha256').update(bytes).digest('hex'),
    transform,
    mode: 0o644,
    symlinkPolicy: 'forbid',
  };
}

// Claude's plugin manifest is intentionally a thin consumer surface: its
// skills[] field registers directory roots while the inventory remains the
// lifecycle and selection SSOT. This compiler emits a deterministic inventory
// view and publication-root view so the shared compiler/verifier can bind the
// existing check without making the manifest itself authoritative.
function compileClaudeProjection({ inventory, compilerVersion = 'claude-1' } = {}) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return { ok: false, error: projectionError('INVALID_INPUT', 'compile', 'inventory is required') };
  }
  const generated = generateClaudeSkillRoots(inventory);
  // Keep Claude's generated metadata on the same normalized router view that
  // Codex and parity checks consume. The Claude host still registers roots;
  // this view records the per-alias contract without changing that host shape.
  const { buildSkillRoutingProjection } = require('./skill-routing-projection');
  const { compareRoutingProjections } = require('./distribution-projection-parity');
  const routingProjection = buildSkillRoutingProjection({ inventory, surface: 'claude-module' });
  const inventoryView = freezeProjectionValue({
    ...normalizedInventoryView(inventory, generated),
    skillRoutingProjection: routingProjection,
  });
  const rootsContent = `${JSON.stringify({ roots: generated.roots, generatedSkillIds: generated.generatedSkillIds }, null, 2)}\n`;
  const inventoryContent = `${JSON.stringify(inventoryView, null, 2)}\n`;
  const entries = [
    projectionOutput(
      'claude:inventory-view',
      'manifests/distribution-inventory.json',
      'generated/inventory-view.json',
      inventoryContent,
      { id: 'claude-inventory-view', version: '1' },
    ),
    projectionOutput(
      'claude:publication-roots',
      'manifests/distribution-inventory.json',
      'generated/publication-roots.json',
      rootsContent,
      { id: 'claude-publication-roots', version: '1' },
    ),
  ];
  const compiled = compileDistribution({
    compilerVersion,
    surface: 'claude-core',
    inventoryFingerprint: fingerprint(inventoryView),
    ownershipRoot: '.claude-plugin',
    entries,
  });
  if (!compiled.ok) return compiled;
  const plan = compiled.value;
  const adapter = {
    identity: { id: 'claude-inventory-projection', version: compilerVersion },
    render: () => ({
      adapter: { id: 'claude-inventory-projection', version: compilerVersion },
      outputs: entries.map((entry) => ({
        stableId: entry.stableId,
        destination: entry.destination,
        content: entry.content,
        mode: entry.mode,
      })),
      metadata: { generated, inventoryView, routingProjection },
    }),
    validate: (rendered) => {
      const expected = buildSkillRoutingProjection({ inventory, surface: 'claude-module' });
      const metadataParity = compareRoutingProjections({
        expected,
        actual: rendered.metadata && rendered.metadata.routingProjection,
      });
      if (!metadataParity.ok) {
        throw new Error(`Claude routing projection metadata drift: ${metadataParity.diagnostics.join('; ')}`);
      }
      const inventoryOutput = (rendered.outputs || []).find((entry) => entry.stableId === 'claude:inventory-view');
      let publishedView;
      try {
        publishedView = JSON.parse(Buffer.from(inventoryOutput && inventoryOutput.content || '').toString('utf8'));
      } catch (_) {
        throw new Error('Claude inventory-view output is not valid JSON');
      }
      const artifactParity = compareRoutingProjections({
        expected,
        actual: publishedView && publishedView.skillRoutingProjection,
      });
      if (!artifactParity.ok) {
        throw new Error(`Claude routing projection artifact drift: ${artifactParity.diagnostics.join('; ')}`);
      }
      return rendered;
    },
  };
  return {
    ok: true,
    plan,
    generated,
    inventoryView,
    routingProjection,
    adapter,
  };
}

function verifyClaudeProjection({ inventory, pluginSkills = [], stage = 'structural', observedAt, publishedInventoryView } = {}) {
  const compiled = compileClaudeProjection({ inventory });
  if (!compiled.ok) return compiled;
  const { compareRoutingProjections } = require('./distribution-projection-parity');
  const routingParity = compareRoutingProjections({
    expected: compiled.routingProjection,
    actual: publishedInventoryView === undefined
      ? compiled.inventoryView.skillRoutingProjection
      : publishedInventoryView && publishedInventoryView.skillRoutingProjection,
  });
  const registered = Array.isArray(pluginSkills) ? pluginSkills.filter((value) => typeof value === 'string') : [];
  const generatedSet = new Set(compiled.generated.roots);
  const registeredSet = new Set(registered);
  const missing = [...generatedSet].filter((root) => !registeredSet.has(root)).sort();
  const extra = [...registeredSet].filter((root) => !generatedSet.has(root)).sort();
  const diagnostics = [
    ...routingParity.diagnostics.map((diagnostic) => `DRIFT [skill-routing-projection]: ${diagnostic}`),
    ...missing.map((root) => `DRIFT [gen-claude-manifest]: inventory expects root '${root}' but plugin.json skills[] does not register it`),
    ...extra.map((root) => `DRIFT [gen-claude-manifest]: plugin.json skills[] registers '${root}' with no inventory-eligible skill backing it`),
  ];
  if (!routingParity.ok) diagnostics.push(`FAIL [skill-routing-projection]: ${routingParity.mismatches.length} routing mismatch(es).`);
  if (missing.length > 0 || extra.length > 0) diagnostics.push(`FAIL [gen-claude-manifest]: ${missing.length + extra.length} root mismatch(es).`);
  const artifactResult = createDistributionArtifact({
    planFingerprint: compiled.plan.planFingerprint,
    adapter: compiled.adapter.identity,
    artifactFingerprint: fingerprint({ roots: [...registeredSet].sort() }),
    outputs: [],
    metadata: { registeredRoots: [...registeredSet].sort() },
  });
  if (!artifactResult.ok) return artifactResult;
  const evidenceResult = verifyDistribution(stage, artifactResult.value, {
    identity: { id: 'claude-inventory-validator', version: '1' },
    verify: () => ({
      verdict: missing.length === 0 && extra.length === 0 && routingParity.ok ? 'PASS' : 'FAIL',
      claims: ['inventory-derived Claude publication roots', 'Claude plugin skills[] root registration', 'Claude routing projection parity'],
      observations: [`checked ${registeredSet.size} registered root(s)`, `checked ${compiled.routingProjection.entries.length} routing projection entr${compiled.routingProjection.entries.length === 1 ? 'y' : 'ies'}`],
      diagnostics,
      observedAt,
    }),
  });
  const evidence = evidenceResult.ok ? evidenceResult.value : evidenceResult;
  return {
    ok: missing.length === 0 && extra.length === 0 && routingParity.ok && evidenceResult.ok && evidence.verdict === 'PASS',
    plan: compiled.plan,
    generated: compiled.generated,
    inventoryView: compiled.inventoryView,
    missing,
    extra,
    evidence,
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
  INVOCATION_CLASSES,
  SURFACES,
  V2_SCHEMA,
  PUBLIC_SKILL_NAME,
  CAPABILITY_ID,
  PLATFORM_MATRIX_SCHEMA,
  REQUIRED_SURFACES,
  REQUIRED_RUNTIME_SURFACES,
  PLATFORM_STATUSES,
  PORTABLE_FRONTMATTER_ALLOWLIST,
  CLIENT_METADATA_BOUNDARY,
  PROJECTION_CONTRACT_SCHEMA,
  PROJECTION_SYMLINK_POLICIES,
  PROJECTION_STAGES,
  classifyCanonicalInventory,
  preserveProjectionContract,
  serializeInventory,
  writeInventoryAtomically,
  validateSupportingAssets,
  refreshSupportingDigests,
  validateDistributionInventory,
  validateSkillRetirements,
  validateDistributionInventoryV2,
  validateSkillRoutingFamilies,
  normalizeSkillRoutingFamilies,
  resolveSkillRoutingReference,
  resolveSkillRoutingAlias,
  resolveSkillIdentity,
  formatSkillIdentityDiagnostic,
  validateInventoryV2: validateDistributionInventoryV2,
  validateSurfaceMembership,
  validatePlatformCapabilityMatrix,
  validateRequiredRuntimeSurfaceList,
  validateRequiredSurfacePlan,
  validatePortableFrontmatterContract,
  validateProjectionContract,
  validateSelectionPolicyAgainstInventory,
  validateCapabilityProfilePolicy,
  MIGRATED_SELECTION_SURFACES,
  SELECTION_POLICY_SOURCES,
  reconcileDistribution,
  generateClaudeSkillRoots,
  compileClaudeProjection,
  verifyClaudeProjection,
  computeScopedCounts,
};

// Re-export the topology primitive from the inventory module so CI callers can
// consume one shared distribution API without importing two implementation
// files. The require is intentionally at the end to keep the topology module
// independent from inventory validation and avoid a circular dependency.
const { validateSkillTopology, validateTopology } = require('./skill-topology');
module.exports.validateSkillTopology = validateSkillTopology;
module.exports.validateTopology = validateTopology;

// Re-export the inventory-owned routing projection helpers so Claude, Codex,
// and focused parity consumers share one normalized family/alias view. The
// projection module resolves inventory normalization lazily to keep this
// boundary free of a circular initialization hazard.
const {
  buildSkillRoutingProjection,
  compareSkillRoutingProjections,
} = require('./skill-routing-projection');
module.exports.buildSkillRoutingProjection = buildSkillRoutingProjection;
module.exports.compareSkillRoutingProjections = compareSkillRoutingProjections;
