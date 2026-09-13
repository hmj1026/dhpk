#!/usr/bin/env node
'use strict';

// Produce the reproducible inventory/install/discovery baseline consumed by
// the workflow-architecture issues. This is evidence, not a second selection
// registry: manifests/distribution-inventory.json remains the SSOT.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { extract: extractFrontmatter } = require('./_lib/frontmatter');

const SCHEMA = 'dhpk.skill-baseline.v1';
const RUNTIME_STATUSES = new Set(['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE']);

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function sha256File(root, relativePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex');
  } catch (_error) {
    return null;
  }
}

function fileExists(root, relativePath) {
  try {
    return fs.statSync(path.join(root, relativePath)).isFile();
  } catch (_error) {
    return false;
  }
}

function directoryExists(root, relativePath) {
  try {
    return fs.statSync(path.join(root, relativePath)).isDirectory();
  } catch (_error) {
    return false;
  }
}

function collectFiles(root, relativePath) {
  const absolute = path.join(root, relativePath);
  if (!directoryExists(root, relativePath)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join('/'));
  }
  return files;
}

function collectPackageAssets(root, skillPath) {
  const assets = [];
  for (const directory of ['references', 'scripts', 'templates', 'roles', 'policy']) {
    assets.push(...collectFiles(root, path.join(skillPath, directory)));
  }
  return assets.sort();
}

function collectCanonicalSkillPaths(root) {
  const roots = [path.join(root, 'skills')];
  const modulesRoot = path.join(root, 'modules');
  if (fs.existsSync(modulesRoot)) {
    for (const entry of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(path.join(modulesRoot, entry.name, 'skills'));
    }
  }

  function walk(relativePath) {
    if (!directoryExists(root, relativePath)) return [];
    if (fileExists(root, path.join(relativePath, 'SKILL.md'))) return [relativePath.split(path.sep).join('/')];
    const absolute = path.join(root, relativePath);
    return fs.readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => walk(path.join(relativePath, entry.name)));
  }

  return roots.flatMap((directory) => walk(path.relative(root, directory))).sort();
}

function reconcileSourceTree(root, inventory) {
  const sourcePaths = collectCanonicalSkillPaths(root);
  const inventoryPaths = (inventory.skills || []).map((entry) => entry.path).sort();
  const counts = new Map();
  for (const entry of inventory.skills || []) counts.set(entry.path, (counts.get(entry.path) || 0) + 1);
  return {
    sourcePaths,
    inventoryPaths,
    unlistedSourcePaths: sourcePaths.filter((entry) => !inventoryPaths.includes(entry)),
    missingSourcePaths: inventoryPaths.filter((entry) => !sourcePaths.includes(entry)),
    duplicateInventoryPaths: [...counts.entries()].filter(([, count]) => count > 1).map(([entry]) => entry).sort(),
  };
}

function profileMemberships(profiles) {
  const result = new Map();
  for (const [profileId, profile] of Object.entries((profiles && profiles.profiles) || {})) {
    for (const id of [...(profile.skillIds || []), ...(profile.modules || [])]) {
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(profileId);
    }
  }
  return result;
}

function extractLocalLinks(root, skillPath) {
  const entrypoint = path.join(root, skillPath, 'SKILL.md');
  if (!fs.existsSync(entrypoint)) return { links: [], unresolved: [] };
  const source = fs.readFileSync(entrypoint, 'utf8');
  const links = [];
  const unresolved = [];
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(source))) {
    const target = match[1].trim().split(/[?#]/, 1)[0];
    if (!target || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) continue;
    const resolved = path.normalize(path.join(skillPath, target));
    if (fileExists(root, resolved) || directoryExists(root, resolved)) links.push(resolved.split(path.sep).join('/'));
    else unresolved.push(target);
  }
  return { links: [...new Set(links)].sort(), unresolved: [...new Set(unresolved)].sort() };
}

function existingDisposition(id, inventory) {
  if ((inventory.retired_skills || []).some((entry) => entry.id === id)) return 'retired-ledger';
  if ((inventory.renamed_skill_names || []).some((entry) => entry.id === id)) return 'renamed-ledger';
  return 'decision-required';
}

function fieldEvidence(value, basis, missingReason = 'No value is declared in the inventory or source frontmatter.') {
  const documented = value != null && !(typeof value === 'string' && value.trim() === '');
  return {
    status: documented ? 'DOCUMENTED' : 'NOT_DOCUMENTED',
    value: documented ? value : 'NOT_DOCUMENTED',
    basis,
    ...(documented ? {} : { reason: missingReason }),
  };
}

function readSkillContract(root, entry) {
  const usage = entry.usage || {};
  const skillFile = path.join(root, entry.path, 'SKILL.md');
  let frontmatter = { present: false, values: {} };
  if (fs.existsSync(skillFile)) frontmatter = extractFrontmatter(fs.readFileSync(skillFile, 'utf8'));
  const actions = Array.isArray(usage.actions) ? usage.actions : [];
  const actionInputs = [...new Set(actions.map((action) => action.input_kind).filter(Boolean))];
  const actionPermissions = [...new Set(actions.map((action) => action.effect_authority).filter(Boolean))];
  const taskValue = usage.summary || frontmatter.values.description || null;
  const taskBasis = usage.summary ? 'inventory.usage.summary' : 'skill.frontmatter.description';
  const descriptionOutput = String(frontmatter.values.description || '').match(/\bOutput:\s*([^.;]+)/i);
  const fields = {
    independentTask: fieldEvidence(taskValue, taskBasis),
    inputs: fieldEvidence(
      usage.input_kind || (actionInputs.length ? actionInputs : null),
      usage.input_kind ? 'inventory.usage.input_kind' : 'inventory.usage.actions[].input_kind',
    ),
    outputs: fieldEvidence(
      usage.output_kind || usage.outputs || (descriptionOutput && descriptionOutput[1].trim()) || null,
      usage.output_kind || usage.outputs ? 'inventory.usage.output_kind' : 'skill.frontmatter.description Output clause',
    ),
    permissions: fieldEvidence(
      usage.effect_authority || (actionPermissions.length ? actionPermissions : null),
      usage.effect_authority ? 'inventory.usage.effect_authority' : 'inventory.usage.actions[].effect_authority',
    ),
    completion: fieldEvidence(usage.completion, 'inventory.usage.completion'),
  };
  return {
    ...fields,
    syntax: fieldEvidence(usage.syntax, 'inventory.usage.syntax'),
    actions: actions.map((action) => ({
      id: action.id || null,
      summary: action.summary || null,
      input: action.input_kind || 'NOT_DOCUMENTED',
      permission: action.effect_authority || 'NOT_DOCUMENTED',
    })),
    missing: Object.entries(fields).filter(([, field]) => field.status === 'NOT_DOCUMENTED').map(([name]) => name),
  };
}

function unknownDependency(reason) {
  return { status: 'UNKNOWN', values: [], reason };
}

function collectDependencyInventory(root, entry, references) {
  const skillFile = path.join(root, entry.path, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    return {
      localLinks: { status: 'UNAVAILABLE', values: [], reason: 'SKILL.md is unavailable.' },
      packageAssets: { status: 'OBSERVED', values: collectPackageAssets(root, entry.path) },
      optionalToolsProviders: unknownDependency('SKILL.md is unavailable; tool/provider declarations cannot be scanned.'),
      hiddenRepoRoot: unknownDependency('SKILL.md is unavailable; repository-root references cannot be scanned.'),
      environment: unknownDependency('SKILL.md is unavailable; environment references cannot be scanned.'),
      siblingSkills: unknownDependency('SKILL.md is unavailable; sibling-skill references cannot be scanned.'),
    };
  }
  const content = fs.readFileSync(skillFile, 'utf8');
  const frontmatter = extractFrontmatter(content);
  const allowedTools = frontmatter.values['allowed-tools'] || null;
  const required = (entry.usage && (entry.usage.requires || entry.usage.dependencies)) || null;
  const toolMatches = [...new Set([
    ...(allowedTools ? [allowedTools] : []),
    ...(Array.isArray(required) ? required : required ? [required] : []),
  ])];
  const rootMatches = [...new Set(content.match(/\b(?:scripts|manifests|rules|agents|codex|modules)\/[A-Za-z0-9_./-]+/g) || [])];
  const environmentMatches = [...new Set([
    ...(content.match(/\b(?:DHPK|CLAUDE|CODEX|AGY|GITHUB|NODE|HOME)_[A-Z0-9_]+\b/g) || []),
    ...(content.match(/process\.env\.[A-Z0-9_]+/g) || []),
  ])];
  const siblingMatches = references.links.filter((link) => link.startsWith('skills/') && link !== entry.path);
  return {
    localLinks: { status: 'OBSERVED', values: references.links },
    packageAssets: { status: 'OBSERVED', values: collectPackageAssets(root, entry.path) },
    optionalToolsProviders: toolMatches.length
      ? { status: 'OBSERVED', values: toolMatches, basis: 'SKILL.md allowed-tools / inventory usage dependency declarations' }
      : unknownDependency('No structured optional tool/provider declaration was found in SKILL.md or inventory usage.'),
    hiddenRepoRoot: rootMatches.length
      ? { status: 'OBSERVED', values: rootMatches, basis: 'SKILL.md repository-relative references' }
      : unknownDependency('No explicit repository-root dependency was found; runtime access outside the skill directory was not executed.'),
    environment: environmentMatches.length
      ? { status: 'OBSERVED', values: environmentMatches, basis: 'SKILL.md environment references' }
      : unknownDependency('No explicit environment dependency was found; process environment was not probed.'),
    siblingSkills: siblingMatches.length
      ? { status: 'OBSERVED', values: siblingMatches, basis: 'resolved local links' }
      : unknownDependency('No sibling-skill link was found; dynamic skill loading was not executed.'),
  };
}

function metadataEstimate(root, entry) {
  const skillFile = path.join(root, entry.path, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    return { status: 'UNAVAILABLE', source: `${entry.path}/SKILL.md`, words: null, tokens: null };
  }
  const frontmatter = extractFrontmatter(fs.readFileSync(skillFile, 'utf8'));
  const description = String(frontmatter.values.description || '').trim();
  return {
    status: description ? 'OBSERVED' : 'NOT_DOCUMENTED',
    source: `${entry.path}/SKILL.md:description`,
    words: description ? description.split(/\s+/u).length : 0,
    tokens: description ? Math.ceil(Array.from(description).length / 4) : 0,
  };
}

function toolMetadata(root, entry) {
  const relativePath = path.join(entry.path, 'agents', 'openai.yaml').split(path.sep).join('/');
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { status: 'NOT_DOCUMENTED', path: relativePath, fingerprint: null, fields: {} };
  }
  const content = fs.readFileSync(absolutePath, 'utf8');
  const fields = {};
  for (const field of ['display_name', 'short_description', 'default_prompt']) {
    const match = content.match(new RegExp(`^\\s*${field}:\\s*[\"']?(.+?)[\"']?\\s*$`, 'm'));
    fields[field] = match ? match[1] : 'NOT_DOCUMENTED';
  }
  return { status: 'OBSERVED', path: relativePath, fingerprint: sha256File(root, relativePath), fields };
}

function contextSet(status, set, evidence = {}) {
  return { status, set, ...evidence };
}

function buildInitialContext(root, inventory, profiles, skills, modules) {
  const catalogSkillIds = skills.map((entry) => entry.id).sort();
  const catalogModuleIds = modules.map((entry) => entry.id).sort();
  const profileSets = Object.entries((profiles && profiles.profiles) || {}).map(([id, profile]) => ({
    id,
    skillIds: Array.isArray(profile.skillIds) ? profile.skillIds.slice().sort() : [],
    moduleIds: Array.isArray(profile.modules) ? profile.modules.slice().sort() : [],
  }));
  const surfaces = (inventory.platform_matrix && inventory.platform_matrix.required_surfaces || []).slice().sort();
  const openAiMetadata = skills.map((entry) => toolMetadata(root, entry));
  return {
    catalog: contextSet('OBSERVED', {
      skillIds: catalogSkillIds,
      moduleIds: catalogModuleIds,
      surfaces: Array.isArray(inventory.surfaces) ? inventory.surfaces.slice().sort() : [],
    }, {
      source: 'manifests/distribution-inventory.json',
      fingerprint: sha256File(root, 'manifests/distribution-inventory.json'),
      profiles: profileSets,
    }),
    installed: contextSet('NOT_RUN', { skillIds: [], moduleIds: [], surfaces: [] }, {
      expectedProfiles: profileSets,
      fingerprint: null,
      reason: 'No private HOME or installed consumer state is read by the static baseline collector.',
    }),
    discoverable: contextSet('NOT_RUN', { skillIds: [], moduleIds: [], surfaces }, {
      expectedSurfaces: surfaces,
      fingerprint: null,
      reason: 'No Claude/Codex/Cursor/AGY client session is started by the static baseline collector.',
    }),
    loaded: contextSet('NOT_RUN', { skillIds: [], moduleIds: [], tools: [] }, {
      fingerprint: null,
      reason: 'No runtime client session or tool loader is invoked by the baseline collector.',
    }),
    sessionStart: {
      status: 'NOT_RUN',
      command: 'bash scripts/hooks/session-start.sh',
      activeModules: null,
      stdout: null,
      stderr: null,
      reason: 'SessionStart is a runtime hook and is intentionally outside static inventory collection.',
    },
    toolMetadata: {
      status: openAiMetadata.every((entry) => entry.status === 'OBSERVED') ? 'OBSERVED' : 'PARTIAL',
      source: 'skills/*/agents/openai.yaml',
      entries: openAiMetadata,
      roster: (inventory.agent_roster || []).slice().sort(),
    },
  };
}

function dispositionRecord(id, inventory) {
  const retired = (inventory.retired_skills || []).find((entry) => entry.id === id);
  if (retired) {
    return {
      status: 'RETIRED_LEDGER',
      successor: retired.replacements || null,
      migration: retired.rollback || null,
      rationale: retired.reasonCode || 'inventory.retired_skills entry',
    };
  }
  const renamed = (inventory.renamed_skill_names || []).find((entry) => entry.id === id);
  if (renamed) {
    return {
      status: 'RENAMED_LEDGER',
      successor: { name: renamed.newName, path: renamed.newPath },
      migration: renamed.rollback || null,
      rationale: 'inventory.renamed_skill_names entry',
    };
  }
  return {
    status: 'DECISION_REQUIRED',
    successor: null,
    migration: null,
    rationale: 'Current posture only; future selection or retirement decisions belong to issues #468 and #469.',
  };
}

function ownerForSkill(id, inventory) {
  const external = (inventory.external_skill_packages || []).find((packageEntry) => (packageEntry.stable_ids || []).includes(id));
  return external ? { kind: 'external', package: external.id, policy: external.policy || null } : { kind: 'DHPK' };
}

function baselineSkill(entry, memberships, inventory, root) {
  const references = extractLocalLinks(root, entry.path);
  return {
    id: entry.id,
    stableId: entry.id,
    publicName: entry.name || entry.id,
    path: entry.path,
    owner: ownerForSkill(entry.id, inventory),
    lifecycle: entry.lifecycle || null,
    tier: entry.tier || null,
    invocationClass: entry.invocation_class || null,
    profiles: memberships.get(entry.id) || [],
    surfaces: Array.isArray(entry.surfaces) ? entry.surfaces.slice().sort() : [],
    source: {
      directory: directoryExists(root, entry.path),
      entrypoint: fileExists(root, path.join(entry.path, 'SKILL.md')),
      localLinks: references.links,
      unresolvedLinks: references.unresolved,
      packageAssets: collectPackageAssets(root, entry.path),
    },
    disposition: existingDisposition(entry.id, inventory),
    contract: readSkillContract(root, entry),
    dispositionRecord: dispositionRecord(entry.id, inventory),
    dependencies: collectDependencyInventory(root, entry, references),
  };
}

function collectTestReuseCandidates(root) {
  const testFiles = collectFiles(root, 'tests').filter((file) => file.endsWith('.test.js'));
  const testFileSet = new Set(testFiles);
  const candidates = [];
  for (const source of testFiles) {
    const content = fs.readFileSync(path.join(root, source), 'utf8');
    const pattern = /require\(\s*['"](\.\/?[^'"]+\.test(?:\.js)?)['"]\s*\)/g;
    let match;
    while ((match = pattern.exec(content))) {
      const targetAbsolute = path.resolve(root, path.dirname(source), match[1]);
      const target = path.relative(root, targetAbsolute).split(path.sep).join('/');
      const targetWithExtension = target.endsWith('.js') ? target : `${target}.js`;
      if (testFileSet.has(targetWithExtension) && targetWithExtension !== source) {
        candidates.push({
          kind: 'duplicate-test-entry',
          status: 'INVESTIGATE',
          owner: 'issue-470',
          entrypoint: source,
          implementation: targetWithExtension,
          evidencePaths: [source, targetWithExtension],
          rationale: 'The aggregate runner discovers both test files, while the entrypoint also requires the implementation test file.',
        });
      }
    }
  }
  return candidates.sort((left, right) => `${left.entrypoint}:${left.implementation}`.localeCompare(`${right.entrypoint}:${right.implementation}`));
}

function hostForSurface(surface) {
  return {
    'claude-core': 'Claude Code',
    'claude-module': 'Claude Code',
    'codex-sync': 'Codex CLI',
    'codex-native': 'Codex CLI',
    'cursor-sync': 'Cursor',
    'cursor-plugin': 'Cursor',
    'agent-plugin': 'Agent Plugin consumer',
    'agy-plugin': 'AGY CLI',
  }[surface] || null;
}

function baselineModule(entry, memberships, root) {
  return {
    id: entry.id,
    path: entry.path,
    lifecycle: entry.lifecycle || null,
    profiles: memberships.get(entry.id) || [],
    surfaces: Array.isArray(entry.surfaces) ? entry.surfaces.slice().sort() : [],
    source: { directory: directoryExists(root, entry.path) },
  };
}

function normalizeRuntimeRows(inventory) {
  const matrix = inventory.platform_matrix || {};
  const rows = (matrix.entries || []).map((entry) => ({
    id: entry.id,
    surface: entry.surface,
    host: hostForSurface(entry.surface),
    clientVersion: null,
    installRoute: entry.destination || null,
    profile: null,
    selection: null,
    sourcePaths: entry.source_paths || [],
    destination: entry.destination || null,
    status: RUNTIME_STATUSES.has(entry.evidence) ? entry.evidence : 'NOT_RUN',
    evidence: entry.evidence || 'NOT_RUN',
    source: 'platform-matrix',
  }));
  const matrixSurfaces = new Set(rows.map((entry) => entry.surface));
  for (const surface of matrix.required_surfaces || []) {
    if (matrixSurfaces.has(surface)) continue;
    rows.push({
      id: `dhpk.platform.${surface}.baseline`,
      surface,
      host: hostForSurface(surface),
      clientVersion: null,
      installRoute: null,
      profile: null,
      selection: null,
      sourcePaths: [],
      destination: null,
      status: 'NOT_RUN',
      evidence: 'NOT_RUN',
      source: 'required-surface-no-matrix-row',
    });
  }
  return rows;
}

function gitCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch (_error) {
    return null;
  }
}

function gitTree(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_error) {
    return null;
  }
}

function gitTreeForCommit(root, commit) {
  if (!commit) return null;
  try {
    return execFileSync('git', ['rev-parse', `${commit}^{tree}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_error) {
    return null;
  }
}

function resolveSourceTree(root, sourceCommit, sourceTree, provenanceRoot = root) {
  const expected = gitTreeForCommit(provenanceRoot, sourceCommit) || (!sourceCommit ? gitTree(root) : null);
  if (sourceCommit && !expected) {
    throw new Error(`source commit ${sourceCommit} cannot be resolved in provenance root ${provenanceRoot}`);
  }
  if (sourceTree && expected && sourceTree !== expected) {
    throw new Error(`source tree ${sourceTree} does not match source commit ${sourceCommit || 'HEAD'} tree ${expected}`);
  }
  return sourceTree || expected;
}

function collectRootFiles(root, relativePath = '') {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap((entry) => {
    if (entry.name === '.git') return [];
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) return collectRootFiles(root, child);
    return entry.isFile() || entry.isSymbolicLink() ? [child.split(path.sep).join('/')] : [];
  });
}

function verifyRootMatchesCommit(root, provenanceRoot, sourceCommit) {
  let treeListing;
  try {
    treeListing = execFileSync('git', ['ls-tree', '-r', '--name-only', sourceCommit], {
      cwd: provenanceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_error) {
    throw new Error(`source commit ${sourceCommit} cannot be resolved in provenance root ${provenanceRoot}`);
  }
  const expectedFiles = treeListing.trim().split('\n').filter(Boolean);
  const actualFiles = collectRootFiles(root);
  const expectedSet = new Set(expectedFiles);
  const actualSet = new Set(actualFiles);
  const missing = expectedFiles.filter((file) => !actualSet.has(file));
  const extra = actualFiles.filter((file) => !expectedSet.has(file));
  if (missing.length || extra.length) {
    throw new Error(`collection root does not match source commit ${sourceCommit} (missing=${missing.slice(0, 3).join(',') || 'none'}; extra=${extra.slice(0, 3).join(',') || 'none'})`);
  }
  for (const relativePath of expectedFiles) {
    const absolute = path.join(root, relativePath);
    const actualStat = fs.lstatSync(absolute);
    const actual = actualStat.isSymbolicLink()
      ? Buffer.from(fs.readlinkSync(absolute))
      : fs.readFileSync(absolute);
    const expected = execFileSync('git', ['show', `${sourceCommit}:${relativePath}`], {
      cwd: provenanceRoot,
      encoding: null,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!actual.equals(expected)) {
      throw new Error(`collection root file ${relativePath} does not match source commit ${sourceCommit}`);
    }
  }
  return true;
}

function buildBaseline({ root, sourceCommit = null, sourceTree = null, provenanceRoot = null, runtimeRows = null } = {}) {
  if (sourceCommit) verifyRootMatchesCommit(root, provenanceRoot || root, sourceCommit);
  const inventory = readJson(root, 'manifests/distribution-inventory.json');
  const profiles = readJson(root, 'manifests/install-profiles.json');
  const memberships = profileMemberships(profiles);
  const skills = (inventory.skills || []).map((entry) => baselineSkill(entry, memberships, inventory, root));
  const modules = (inventory.modules || []).map((entry) => baselineModule(entry, memberships, root));
  const sourceReconciliation = reconcileSourceTree(root, inventory);
  const requiredSurfaces = inventory.platform_matrix && inventory.platform_matrix.required_surfaces || [];
  const observedRows = runtimeRows || normalizeRuntimeRows(inventory);
  const missingSurfaceRows = requiredSurfaces.filter((surface) => !observedRows.some((row) => row.surface === surface));
  const resolvedSourceTree = resolveSourceTree(root, sourceCommit, sourceTree, provenanceRoot || root);
  return {
    schema: SCHEMA,
    sourceCommit: sourceCommit || gitCommit(root),
    sourceTree: resolvedSourceTree,
    inventorySchema: inventory.schema || null,
    static: {
      skills,
      modules,
      metadataEstimates: skills.map((entry) => ({ id: entry.id, ...metadataEstimate(root, entry) })),
      counts: {
        skills: skills.length,
        modules: modules.length,
        decisionRequired: skills.filter((entry) => entry.disposition === 'decision-required').length,
        external: skills.filter((entry) => entry.owner.kind === 'external').length,
      },
      sourceReconciliation,
    },
    initialContext: buildInitialContext(root, inventory, profiles, skills, modules),
    analysis: {
      testReuseCandidates: collectTestReuseCandidates(root),
      note: 'Candidates identify work for issue #470 to measure and decide; they do not change the inventory or test runner in this baseline.',
    },
    runtimeObserved: {
      status: 'NOT_RUN',
      host: process.platform,
      node: process.version,
      rows: observedRows,
      missingRequiredSurfaces: missingSurfaceRows,
      note: 'Static package and discovery evidence is separate from real client/session runtime proof.',
    },
    limitations: [
      'No automatic login, private HOME copy, or external client session is performed by this baseline collector.',
      'NOT_RUN, NOT_CONFIGURED, BLOCKED, and UNAVAILABLE are retained as non-PASS runtime evidence.',
      `Collector host is ${os.platform()} ${os.arch()} with Node ${process.version}; compare like-for-like CI runs for timing.`
    ],
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { root: path.join(__dirname, '..', '..'), sourceCommit: null, sourceTree: null, provenanceRoot: null, write: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.root = path.resolve(argv[++index]);
    else if (argument === '--source-commit') options.sourceCommit = argv[++index];
    else if (argument === '--source-tree') options.sourceTree = argv[++index];
    else if (argument === '--provenance-root') options.provenanceRoot = path.resolve(argv[++index]);
    else if (argument === '--write') options.write = path.resolve(argv[++index]);
    else if (argument === '--json') options.json = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const baseline = buildBaseline(options);
  const output = `${JSON.stringify(baseline, null, 2)}\n`;
  if (options.write) {
    fs.mkdirSync(path.dirname(options.write), { recursive: true });
    fs.writeFileSync(options.write, output, { mode: 0o644 });
  } else {
    process.stdout.write(output);
  }
  return baseline;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`skill-baseline: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  SCHEMA,
  buildBaseline,
  collectPackageAssets,
  extractLocalLinks,
  hostForSurface,
  normalizeRuntimeRows,
  collectTestReuseCandidates,
  dispositionRecord,
  readSkillContract,
  parseArgs,
  profileMemberships,
  gitTree,
  verifyRootMatchesCommit,
};
