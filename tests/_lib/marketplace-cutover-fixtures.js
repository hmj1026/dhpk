'use strict';

// Physical fixtures for the read-only marketplace cutover plan (task 5.1 prep).
// Historical schema-3 Codex receipts and project projection receipts are built
// directly; the retired installer and the projection publisher are never run.
// readProjectProjectionReceipt is used only as a read-only fixture self-check.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { completeTreeFingerprint } = require('./install-codex-skills-fixtures');
const { readProjectProjectionReceipt } = require('../../scripts/lib/project-agent-projection-publisher');

const PROJECTION_CONFIG = Object.freeze({
  schema: 'dhpk.project-agent-projection.v1',
  scope: 'project',
  owner: 'dhpk.project-agent-projection',
  managed_root: '.agents/skills',
  receipt: '.agents/.dhpk-installed.json',
});
const CANDIDATE = `sha256:${'c'.repeat(64)}`;
const HOST_SHAPES = Object.freeze({
  claude: { surface: 'claude-core', transformId: 'claude-project-skill', adapterId: 'claude-project-discovery', root: '.claude/skills' },
  cursor: { surface: 'cursor-plugin', transformId: 'cursor-project-skill', adapterId: 'cursor-project-discovery', root: '.cursor/skills' },
  codex: { surface: 'codex-sync', transformId: 'codex-project-skill', adapterId: 'codex-project-discovery', root: '.codex/skills' },
});

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

function fixtureInventory() {
  return {
    schema: 'fixture.distribution-inventory',
    skills: [
      { id: 'flow-guide', name: 'flow-guide', path: 'skills/flow-guide' },
      { id: 'repo-verify', name: 'repo-verify', path: 'skills/repo-verify' },
      { id: 'laravel', name: 'laravel', path: 'skills/laravel' },
      { id: 'tdd', name: 'tdd', path: 'skills/tdd' },
    ],
    renamed_skill_names: [
      { id: 'laravel', oldName: 'dhpk-laravel', oldPath: 'skills/dhpk-laravel', newName: 'laravel', newPath: 'skills/laravel' },
    ],
    retired_skills: [
      {
        id: 'bug-fix',
        name: 'dhpk-bug-fix',
        canonicalPath: 'skills/dhpk-bug-fix',
        retiredIn: '0.47.0',
        reasonCode: 'merged-into-adaptive-workflow',
        replacements: [{ kind: 'skill', id: 'flow-guide', mode: 'classify' }],
      },
    ],
    project_agent_projection: { ...PROJECTION_CONFIG },
  };
}

function makeProject() {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cutover-plan-')));
  fs.mkdirSync(path.join(project, '.git'));
  return project;
}

function makeOutside(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-cutover-${label}-`)));
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// A skill tree with an ignored bytecode cache so the complete (not the
// distributable) historical fingerprint is what proves ownership.
function writeSkillTree(directory, name) {
  writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\n---\n${name} body\n`);
  writeFile(path.join(directory, '__pycache__', 'helper.cpython-312.pyc'), Buffer.from(`\0cache-${name}`));
}

function codexSkillPath(project, name) {
  return path.join(project, '.codex', 'skills', name);
}

function historicalCopyEntry(project, name, { id = name, write = true } = {}) {
  const destination = codexSkillPath(project, name);
  if (write) writeSkillTree(destination, name);
  const fingerprint = completeTreeFingerprint(destination);
  const relative = `skills/${name}`;
  return {
    destination: relative,
    source: relative,
    mode: 'copy',
    source_fingerprint: fingerprint,
    destination_fingerprint: fingerprint,
    fingerprint,
    ownership_marker: `copy:${relative}`,
    name,
    ...(id ? { id } : {}),
  };
}

function historicalSymlinkEntry(project, name, target, { id = name } = {}) {
  const destination = codexSkillPath(project, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.symlinkSync(target, destination);
  const relative = `skills/${name}`;
  return {
    destination: relative,
    source: relative,
    mode: 'symlink',
    source_fingerprint: sha(target),
    destination_fingerprint: sha(target),
    fingerprint: sha(target),
    ownership_marker: `symlink:${relative}`,
    destination_target: target,
    id,
    name,
  };
}

function historicalReceipt(skills, overrides = {}) {
  return {
    schema_version: 3,
    plugin_version: '0.60.0',
    source_fingerprint: 'a'.repeat(64),
    mode: 'copy',
    installed_at: '2026-09-01T00:00:00Z',
    managed_entries: { skills, agents: {} },
    orphaned_entries: {},
    reconciliation: { state: 'current', status: 'current', complete: true },
    state: 'current',
    ...overrides,
  };
}

function writeHistoricalReceipt(project, receipt) {
  const file = path.join(project, '.codex', '.dhpk-installed.json');
  writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return file;
}

function writeJournal(project, run, overrides = {}, raw = null) {
  const relative = `.dhpk-transaction-${run}.json`;
  const journal = {
    run,
    pid: 999999,
    relative,
    phase: 'active',
    started: true,
    plugin_version: '0.60.0',
    source_fingerprint: 'a'.repeat(64),
    receipt_snapshot_present: false,
    receipt_snapshot: null,
    prunes: [],
    mutations: [],
    ...overrides,
  };
  const file = path.join(project, '.codex', relative);
  writeFile(file, raw === null ? `${JSON.stringify(journal, null, 2)}\n` : raw);
  return file;
}

function hostBinding(hostId, ids, entries) {
  const shape = HOST_SHAPES[hostId];
  const bound = entries.filter((entry) => ids.includes(entry.stableId))
    .sort((left, right) => left.name.localeCompare(right.name));
  const paths = bound.map((entry) => ({
    stableId: entry.stableId,
    name: entry.name,
    path: `${shape.root}/${entry.name}`,
    target: path.posix.relative(shape.root, `${PROJECTION_CONFIG.managed_root}/${entry.name}`),
  }));
  const binding = {
    shape: 'project-skill-directory',
    surface: shape.surface,
    evidenceSource: 'entry_surfaces',
    transform: { id: shape.transformId, version: '1' },
    discovery: {
      adapterId: shape.adapterId,
      adapterVersion: '1.0.0',
      kind: 'symlink',
      sourceRoot: PROJECTION_CONFIG.managed_root,
      destinationRoot: shape.root,
      paths: paths.map((entry) => entry.path),
    },
  };
  if (hostId !== 'claude') {
    binding.selectedStableIds = ids.slice().sort();
    binding.emittedStableIds = ids.slice().sort();
    binding.bindingShape = 'native-link';
    binding.bindings = paths.map((entry) => ({ ...entry, shape: 'native-link' }));
  }
  return { binding, paths };
}

// hosts: { cursor: [stableId...], codex: [...], claude: [...] } (claude binds all).
function buildProjectProjection(project, entries, hosts) {
  const managed = path.join(project, PROJECTION_CONFIG.managed_root);
  const receiptEntries = [];
  const generatedFingerprints = {};
  const sourceFingerprints = {};
  for (const entry of entries) {
    const content = `---\nname: ${entry.name}\n---\nshared ${entry.name}\n`;
    writeFile(path.join(managed, entry.name, 'SKILL.md'), content);
    const generated = `${entry.name}/SKILL.md`;
    generatedFingerprints[generated] = sha(content);
    sourceFingerprints[entry.stableId] = sha(`source:${entry.name}`);
    receiptEntries.push({
      stableId: entry.stableId,
      name: entry.name,
      source: `skills/${entry.name}`,
      sourceFingerprint: sha(`source:${entry.name}`),
      sourceFiles: [{ path: 'SKILL.md', digest: sha(content) }],
      generatedPaths: [generated],
    });
  }
  const hostBindings = {};
  const bindingPaths = {};
  for (const hostId of Object.keys(hosts).sort()) {
    const ids = hostId === 'claude' ? entries.map((entry) => entry.stableId) : hosts[hostId];
    const { binding, paths } = hostBinding(hostId, ids, entries);
    hostBindings[hostId] = binding;
    bindingPaths[hostId] = paths.map(({ path: bindingPath, target }) => ({ path: bindingPath, target }))
      .sort((left, right) => left.path.localeCompare(right.path));
    for (const entry of paths) {
      const destination = path.join(project, entry.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.symlinkSync(entry.target, destination);
    }
  }
  const payload = {
    schema: 'dhpk.project-agent-projection-receipt.v1',
    generatorVersion: '2.0.0',
    scope: 'project',
    managedRoot: PROJECTION_CONFIG.managed_root,
    receiptPath: PROJECTION_CONFIG.receipt,
    projectionOwner: { owner: PROJECTION_CONFIG.owner },
    profileId: 'portable-core',
    planFingerprint: sha('fixture-plan'),
    artifactFingerprint: sha('fixture-artifact'),
    selectedIds: entries.map((entry) => entry.stableId).sort(),
    emittedIds: entries.map((entry) => entry.stableId).sort(),
    hostBindings,
    bindings: JSON.parse(JSON.stringify(hostBindings)),
    bindingPaths,
    entries: receiptEntries.sort((left, right) => left.name.localeCompare(right.name)),
    managedPaths: Object.keys(generatedFingerprints).sort(),
    generatedFingerprints,
    sourceFingerprints,
    rollback: null,
  };
  const receipt = { ...payload, receiptFingerprint: sha(JSON.stringify(sorted(payload))) };
  const receiptPath = path.join(project, PROJECTION_CONFIG.receipt);
  writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  readProjectProjectionReceipt(projectionRoots(project));
  return { receipt, receiptPath, managed };
}

function projectionRoots(project) {
  const managedRoot = path.join(project, PROJECTION_CONFIG.managed_root);
  return {
    sourceRoot: null,
    projectRoot: project,
    agentsRoot: path.dirname(managedRoot),
    managedRoot,
    receiptPath: path.join(project, PROJECTION_CONFIG.receipt),
    config: { ...PROJECTION_CONFIG },
  };
}

function pluginSource(root, ids) {
  return {
    sourceId: 'plugin:dhpk',
    kind: 'plugin',
    root,
    enabled: true,
    entries: ids.map((id) => ({ stableId: id, name: id, path: path.join(root, 'skills', id) })),
  };
}

function codexContext(sources, overrides = {}) {
  return {
    host: 'codex',
    consumerVersion: '0.130.0',
    sessionId: 'session-0001',
    enumerationState: 'COMPLETE',
    sources,
    ...overrides,
  };
}

function cutoverInput(project, {
  inventory = fixtureInventory(),
  selectedStableIds = ['flow-guide', 'repo-verify'],
  candidateArtifactFingerprint = CANDIDATE,
  pluginRoot,
  sources = null,
  context = null,
} = {}) {
  const resolvedSources = sources || [pluginSource(pluginRoot, selectedStableIds)];
  return {
    projectRoot: project,
    inventory,
    selectedStableIds,
    candidateArtifactFingerprint,
    context: context || codexContext(resolvedSources),
  };
}

// Full physical snapshot: type, mode, dev/ino, size, bytes hash, link literal.
// Times are excluded; special files are recorded without being opened.
function snapshotTrees(roots) {
  const records = [];
  const visit = (absolute) => {
    let stat;
    try {
      stat = fs.lstatSync(absolute, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        records.push([absolute, 'missing']);
        return;
      }
      throw error;
    }
    const base = [absolute, String(stat.mode), String(stat.dev), String(stat.ino), String(stat.size)];
    if (stat.isSymbolicLink()) {
      records.push([...base, 'symlink', fs.readlinkSync(absolute)]);
    } else if (stat.isFile()) {
      records.push([...base, 'file', sha(fs.readFileSync(absolute))]);
    } else if (stat.isDirectory()) {
      records.push([...base, 'directory']);
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(absolute, name));
    } else {
      records.push([...base, 'special']);
    }
  };
  for (const root of roots.slice().sort()) visit(root);
  return JSON.stringify(records);
}

function deepKeys(value, keys = new Set()) {
  if (Array.isArray(value)) value.forEach((entry) => deepKeys(entry, keys));
  else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      keys.add(key);
      deepKeys(value[key], keys);
    }
  }
  return keys;
}

function cleanup(...roots) {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

module.exports = {
  CANDIDATE,
  PROJECTION_CONFIG,
  buildProjectProjection,
  cleanup,
  codexContext,
  codexSkillPath,
  completeTreeFingerprint,
  cutoverInput,
  deepKeys,
  fixtureInventory,
  historicalCopyEntry,
  historicalReceipt,
  historicalSymlinkEntry,
  makeOutside,
  makeProject,
  pluginSource,
  snapshotTrees,
  writeFile,
  writeHistoricalReceipt,
  writeJournal,
  writeSkillTree,
};
