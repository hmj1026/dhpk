'use strict';

// Read-only marketplace cutover planning contract (task 5.1 preparatory slice).
// Every plan and revalidation call is bracketed by a full physical snapshot of
// the project and every outside root a case touches; equality proves zero
// mutation of bytes, link literals, receipts, journals, and activation state.
// Formal mutation, fault recovery, durable receipts, and activation: NOT_RUN.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const fx = require('./_lib/marketplace-cutover-fixtures');
const cutover = require('../scripts/lib/marketplace-cutover-plan');

const PLAN_KEYS = [
  'actions', 'activation', 'binding', 'conflicts', 'context', 'mutation', 'observations',
  'planFingerprint', 'receipts', 'recovery', 'retainedHostDependencies', 'runtime', 'schema', 'state',
];
const REVALIDATION_KEYS = ['activation', 'mutation', 'ok', 'reasons', 'runtime', 'state'];
const GOLDEN_HISTORICAL_TREE = '254fd1000515139b2de7aebd52abea9fc0c8d4eedd281fdbdcd30688f4f3170b';

// Representative Codex plugin activation state; the change defines no marker
// file, so a project config enabling the plugin stands in for it.
const ACTIVATION_MARKER = path.join('.codex', 'config.toml');
const ACTIVATION_BYTES = '[plugins."dhpk@openai-curated"]\nenabled = false\n';

function writeActivationMarker(project) {
  fx.writeFile(path.join(project, ACTIVATION_MARKER), ACTIVATION_BYTES);
}

function assertActivationMarker(env) {
  assert.strictEqual(fs.readFileSync(path.join(env.project, ACTIVATION_MARKER), 'utf8'), ACTIVATION_BYTES);
}

function setup() {
  const project = fx.makeProject();
  writeActivationMarker(project);
  const pluginRoot = fx.makeOutside('plugin');
  fs.mkdirSync(path.join(pluginRoot, 'skills'), { recursive: true });
  return { project, pluginRoot, roots: [project, pluginRoot] };
}

function plan(env, input) {
  const before = fx.snapshotTrees(env.roots);
  const result = cutover.planMarketplaceCutover(input);
  assert.strictEqual(fx.snapshotTrees(env.roots), before, 'planning must not mutate any observed root');
  assertActivationMarker(env);
  return result;
}

function revalidate(env, stored, input) {
  const before = fx.snapshotTrees(env.roots);
  const result = cutover.revalidateMarketplaceCutoverPlan(stored, input);
  assert.strictEqual(fx.snapshotTrees(env.roots), before, 'revalidation must not mutate any observed root');
  assertActivationMarker(env);
  assert.deepStrictEqual(Object.keys(result).sort(), REVALIDATION_KEYS);
  assert.strictEqual(result.mutation, false);
  assert.strictEqual(result.activation, 'NOT_RUN');
  assert.strictEqual(result.runtime, 'NOT_RUN');
  return result;
}

function codes(result) {
  return result.conflicts.map((conflict) => conflict.code);
}

function actionAt(result, relative) {
  return result.actions.filter((action) => action.path === relative);
}

function ownedCopyEnv() {
  const env = setup();
  const entry = fx.historicalCopyEntry(env.project, 'flow-guide');
  fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ 'flow-guide': entry }));
  return env;
}

test('historical complete fingerprint fixture matches the installer golden literal', () => {
  const tree = fx.makeOutside('golden');
  fx.writeFile(path.join(tree, 'SKILL.md'), '---\nname: golden\n---\nbody\n');
  fx.writeFile(path.join(tree, '__pycache__', 'x.pyc'), Buffer.from('\0cache'));
  assert.strictEqual(fx.completeTreeFingerprint(tree), GOLDEN_HISTORICAL_TREE);
  fx.cleanup(tree);
});

test('plan is deterministic, frozen, input-preserving, and invariant to reordered selection/context', () => {
  const env = ownedCopyEnv();
  const input = fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot });
  const inputCopy = JSON.parse(JSON.stringify(input));
  const first = plan(env, input);
  assert.deepStrictEqual(input, inputCopy, 'input must not be mutated');
  assert.deepStrictEqual(Object.keys(first).sort(), PLAN_KEYS);
  assert.strictEqual(first.schema, 'dhpk.marketplace-cutover-plan.v1');
  assert.strictEqual(first.mutation, false);
  assert.strictEqual(first.activation, 'NOT_RUN');
  assert.strictEqual(first.runtime, 'NOT_RUN');
  assert.match(first.planFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.actions) && Object.isFrozen(first.binding));
  assert.throws(() => { first.actions.push({}); }, TypeError);

  const second = plan(env, input);
  assert.deepStrictEqual(second, first);

  const reordered = JSON.parse(JSON.stringify(input));
  reordered.selectedStableIds = ['repo-verify', 'flow-guide', 'repo-verify'];
  reordered.context.sources = [
    { sourceId: 'user:none', kind: 'user', root: path.join(env.pluginRoot, 'user'), enabled: false, entries: [] },
    { ...reordered.context.sources[0], entries: reordered.context.sources[0].entries.slice().reverse() },
  ];
  const ordered = JSON.parse(JSON.stringify(reordered));
  ordered.context.sources = ordered.context.sources.slice().reverse();
  const a = plan(env, reordered);
  const b = plan(env, ordered);
  assert.strictEqual(a.planFingerprint, b.planFingerprint);
  assert.deepStrictEqual(a.binding.selectedStableIds, ['flow-guide', 'repo-verify']);
  assert.deepStrictEqual(a.binding, {
    inventoryFingerprint: first.binding.inventoryFingerprint,
    selectedStableIds: ['flow-guide', 'repo-verify'],
    candidateArtifactFingerprint: fx.CANDIDATE,
  });
  fx.cleanup(...env.roots);
});

test('owned unchanged copy yields only a remove-owned-entry proposal', () => {
  const env = ownedCopyEnv();
  const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'READY_FOR_MIGRATION');
  assert.deepStrictEqual(result.conflicts, []);
  const [action] = actionAt(result, '.codex/skills/flow-guide');
  assert.strictEqual(action.kind, 'remove-owned-entry');
  assert.strictEqual(action.stableId, 'flow-guide');
  assert.strictEqual(action.ownership.marker, 'copy:skills/flow-guide');
  assert.strictEqual(action.ownership.receipt, '.codex/.dhpk-installed.json');
  assert.strictEqual(action.guidance.kind, 'successor');
  assert.deepStrictEqual(result.actions.map((entry) => entry.kind), ['remove-owned-entry']);
  assert.strictEqual(result.recovery.state, 'CLEAR');
  assert.ok(fs.existsSync(path.join(env.project, '.codex/skills/flow-guide/SKILL.md')));
  fx.cleanup(...env.roots);
});

test('modified managed bytes or ignored cache are preserved and block', () => {
  for (const relative of ['SKILL.md', '__pycache__/helper.cpython-312.pyc']) {
    const env = ownedCopyEnv();
    fx.writeFile(path.join(env.project, '.codex/skills/flow-guide', relative), 'edited by owner\n');
    const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
    assert.strictEqual(result.state, 'BLOCKED', relative);
    assert.deepStrictEqual(codes(result), ['MODIFIED_MANAGED'], relative);
    assert.deepStrictEqual(actionAt(result, '.codex/skills/flow-guide').map((a) => a.kind), ['preserve']);
    fx.cleanup(...env.roots);
  }
});

test('identical foreign entry without a receipt is an unowned collision', () => {
  const env = setup();
  fx.writeSkillTree(fx.codexSkillPath(env.project, 'flow-guide'), 'flow-guide');
  const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(codes(result), ['UNOWNED_COLLISION']);
  assert.deepStrictEqual(actionAt(result, '.codex/skills/flow-guide').map((a) => a.kind), ['preserve']);
  fx.cleanup(...env.roots);
});

test('managed symlink with the exact literal proposes remove-link; retarget to same bytes is preserved', () => {
  const env = setup();
  const source = path.join(env.pluginRoot, 'legacy', 'flow-guide');
  const twin = path.join(env.pluginRoot, 'twin', 'flow-guide');
  fx.writeSkillTree(source, 'flow-guide');
  fx.writeSkillTree(twin, 'flow-guide');
  const entry = fx.historicalSymlinkEntry(env.project, 'flow-guide', source);
  fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ 'flow-guide': entry }, { mode: 'symlink' }));
  const owned = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(owned.state, 'READY_FOR_MIGRATION');
  const [link] = actionAt(owned, '.codex/skills/flow-guide');
  assert.strictEqual(link.kind, 'remove-link');
  assert.strictEqual(link.ownership.linkTarget, source);

  const destination = fx.codexSkillPath(env.project, 'flow-guide');
  fs.unlinkSync(destination);
  fs.symlinkSync(twin, destination);
  const retargeted = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(retargeted.state, 'BLOCKED');
  assert.deepStrictEqual(codes(retargeted), ['RETARGETED_MANAGED']);
  assert.deepStrictEqual(actionAt(retargeted, '.codex/skills/flow-guide').map((a) => a.kind), ['preserve']);
  fx.cleanup(...env.roots);
});

test('shared Codex+Cursor projection proposes only the obsolete Codex link and retains shared content', () => {
  const env = setup();
  fx.buildProjectProjection(env.project, [{ stableId: 'flow-guide', name: 'flow-guide' }],
    { cursor: ['flow-guide'], codex: ['flow-guide'] });
  const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'READY_FOR_MIGRATION');
  assert.deepStrictEqual(result.actions.map((a) => [a.kind, a.path]), [
    ['remove-codex-binding', '.codex/skills/flow-guide'],
  ]);
  assert.strictEqual(result.actions[0].ownership.linkTarget, '../../.agents/skills/flow-guide');
  assert.deepStrictEqual(result.retainedHostDependencies, [{
    host: 'cursor',
    stableIds: ['flow-guide'],
    sharedPaths: ['.agents/skills/flow-guide'],
    bindingPaths: ['.cursor/skills/flow-guide'],
    receiptPath: '.agents/.dhpk-installed.json',
  }]);
  const receipt = result.receipts.find((entry) => entry.path === '.agents/.dhpk-installed.json');
  assert.strictEqual(receipt.present, true);
  assert.match(receipt.rawFingerprint, /^[a-f0-9]{64}$/);
  fx.cleanup(...env.roots);
});

test('retained shared content still competing in Codex requires relocation', () => {
  const env = setup();
  fx.buildProjectProjection(env.project, [{ stableId: 'flow-guide', name: 'flow-guide' }],
    { cursor: ['flow-guide'], codex: ['flow-guide'] });
  const shared = path.join(env.project, '.agents/skills');
  const sources = [
    fx.pluginSource(env.pluginRoot, ['flow-guide', 'repo-verify']),
    { sourceId: 'project:agents', kind: 'project', root: shared, enabled: true,
      entries: [{ stableId: 'flow-guide', name: 'flow-guide', path: path.join(shared, 'flow-guide') }] },
  ];
  const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot, sources }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(codes(result), ['RETAINED_HOST_RELOCATION_REQUIRED']);
  assert.ok(result.actions.every((a) => !a.path.startsWith('.agents/')));
  fx.cleanup(...env.roots);
});

test('revalidation is CURRENT without drift, never approves activation, and rejects tampering', () => {
  const env = ownedCopyEnv();
  const input = fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot });
  const stored = plan(env, input);
  const current = revalidate(env, stored, input);
  assert.deepStrictEqual(current, { ok: true, state: 'CURRENT', reasons: [], mutation: false, activation: 'NOT_RUN', runtime: 'NOT_RUN' });
  const tampered = JSON.parse(JSON.stringify(stored));
  tampered.actions = [];
  const rejected = revalidate(env, tampered, input);
  assert.strictEqual(rejected.ok, false);
  assert.strictEqual(rejected.state, 'BLOCKED');
  assert.deepStrictEqual(rejected.reasons, ['PLAN_FINGERPRINT_MISMATCH']);
  fx.cleanup(...env.roots);
});

test('each drift of bytes, receipt, IDs, candidate, or sources makes the plan STALE_PLAN', () => {
  const expected = {
    bytes: ['STATE_DRIFT', 'OBSERVATION_DRIFT', 'ACTION_DRIFT', 'CONFLICT_DRIFT'],
    receipt: ['RECEIPT_DRIFT'],
    ids: ['BINDING_DRIFT'],
    inventory: ['BINDING_DRIFT'],
    candidate: ['BINDING_DRIFT'],
    sources: ['CONTEXT_DRIFT'],
    session: ['CONTEXT_DRIFT'],
  };
  const drifts = {
    bytes: (env) => fx.writeFile(path.join(env.project, '.codex/skills/flow-guide/SKILL.md'), 'drift\n'),
    receipt: (env) => {
      const file = path.join(env.project, '.codex/.dhpk-installed.json');
      fs.writeFileSync(file, `${JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')))}\n`);
    },
    ids: (env, input) => ({ ...input, selectedStableIds: ['flow-guide'] }),
    inventory: (env, input) => {
      const inventory = fx.fixtureInventory();
      inventory.skills.push({ id: 'extra', name: 'extra', path: 'skills/extra' });
      return { ...input, inventory };
    },
    candidate: (env, input) => ({ ...input, candidateArtifactFingerprint: `sha256:${'d'.repeat(64)}` }),
    sources: (env, input) => ({
      ...input,
      context: { ...input.context, sources: [...input.context.sources,
        { sourceId: 'user:home', kind: 'user', root: path.join(env.pluginRoot, 'user'), enabled: true, entries: [] }] },
    }),
    session: (env, input) => ({ ...input, context: { ...input.context, sessionId: 'session-0002' } }),
  };
  for (const [label, drift] of Object.entries(drifts)) {
    const env = ownedCopyEnv();
    const input = fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot });
    const stored = plan(env, input);
    const fresh = drift(env, input) || input;
    const result = revalidate(env, stored, fresh);
    assert.strictEqual(result.state, 'STALE_PLAN', label);
    assert.strictEqual(result.ok, false, label);
    assert.deepStrictEqual(result.reasons, expected[label], label);
    fx.cleanup(...env.roots);
  }
});

test('identical bytes behind a new inode make the plan stale', () => {
  const env = ownedCopyEnv();
  const input = fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot });
  const stored = plan(env, input);
  const file = path.join(env.project, '.codex/skills/flow-guide/SKILL.md');
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(`${file}.next`, bytes);
  fs.renameSync(`${file}.next`, file);
  const result = revalidate(env, stored, input);
  assert.strictEqual(result.state, 'STALE_PLAN');
  assert.ok(result.reasons.includes('OBSERVATION_DRIFT'));
  fx.cleanup(...env.roots);
});

test('traversal receipt keys and symlinked ancestors block without touching outside content', () => {
  const env = setup();
  const outside = fx.makeOutside('escape');
  env.roots.push(outside);
  const victim = path.join(outside, 'victim');
  fx.writeSkillTree(victim, 'victim');
  const victimFingerprint = fx.completeTreeFingerprint(victim);
  // Resolved from .codex/, three parent hops reach the real outside victim.
  const escaping = `skills/../../../${path.basename(outside)}/victim`;
  assert.strictEqual(path.resolve(env.project, '.codex', escaping), victim);
  const escapeEntry = {
    destination: escaping,
    mode: 'copy',
    destination_fingerprint: victimFingerprint,
    fingerprint: victimFingerprint,
    ownership_marker: `copy:${escaping}`,
    name: 'flow-guide',
    id: 'flow-guide',
  };
  for (const key of ['../../escape', 'flow-guide']) {
    fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ [key]: escapeEntry }));
    const traversal = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
    assert.strictEqual(traversal.state, 'BLOCKED', key);
    assert.deepStrictEqual(codes(traversal), ['UNSAFE_PATH'], key);
    assert.deepStrictEqual(traversal.actions, [], key);
    for (const entry of [...traversal.actions, ...traversal.observations]) {
      assert.ok(!entry.path.startsWith('..') && !path.isAbsolute(entry.path), `${key}: ${entry.path}`);
    }
  }
  fx.cleanup(env.project);

  const linked = fx.makeProject();
  env.roots[0] = linked;
  env.project = linked;
  fx.writeSkillTree(path.join(outside, 'skills', 'flow-guide'), 'flow-guide');
  writeActivationMarker(linked);
  fs.symlinkSync(path.join(outside, 'skills'), path.join(linked, '.codex', 'skills'));
  const entry = fx.historicalCopyEntry(linked, 'flow-guide', { write: false });
  fx.writeHistoricalReceipt(linked, fx.historicalReceipt({ 'flow-guide': entry }));
  const ancestor = plan(env, fx.cutoverInput(linked, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(ancestor.state, 'BLOCKED');
  assert.deepStrictEqual([...new Set(codes(ancestor))], ['UNSAFE_PATH']);
  assert.ok(ancestor.actions.every((a) => a.kind === 'preserve'));
  fx.cleanup(...env.roots);
});

test('nested links, special files, and orphaned or malformed entries cannot prove ownership', () => {
  const cases = {
    nestedLink: (env) => fs.symlinkSync('SKILL.md', path.join(fx.codexSkillPath(env.project, 'flow-guide'), 'alias.md')),
    special: (env) => {
      require('node:child_process').execFileSync('mkfifo', [path.join(fx.codexSkillPath(env.project, 'flow-guide'), 'pipe')]);
    },
    orphaned: (env, entry) => ({ ...entry, orphaned: true }),
    marker: (env, entry) => ({ ...entry, ownership_marker: 'copy:skills/other' }),
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const env = setup();
    const entry = fx.historicalCopyEntry(env.project, 'flow-guide');
    const next = mutate(env, entry) || entry;
    fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ 'flow-guide': next }));
    const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
    assert.strictEqual(result.state, 'BLOCKED', label);
    assert.deepStrictEqual(codes(result), ['OWNERSHIP_UNPROVEN'], label);
    assert.deepStrictEqual(result.actions.map((a) => a.kind), ['preserve'], label);
    fx.cleanup(...env.roots);
  }
});

test('active, malformed, self-unbound journals, non-final receipts, and shared transactions require recovery', () => {
  const cases = {
    active: (env) => fx.writeJournal(env.project, '20261001T000000Z-1'),
    malformed: (env) => fx.writeJournal(env.project, '20261001T000000Z-2', {}, '{not json'),
    selfUnbound: (env) => fx.writeJournal(env.project, '20261001T000000Z-3', { phase: 'committed', relative: '.dhpk-transaction-other.json' }),
    nonterminal: (env) => fx.writeJournal(env.project, '20261001T000000Z-4', { phase: 'rollback_incomplete' }),
    receiptNotFinal: (env) => 'not-final',
    sharedTransaction: (env) => fx.writeFile(path.join(env.project, '.agents/.dhpk-installed.transaction.json'), '{}\n'),
  };
  for (const [label, arrange] of Object.entries(cases)) {
    const env = setup();
    const entry = fx.historicalCopyEntry(env.project, 'flow-guide');
    const overrides = arrange(env) === 'not-final' ? { transaction_id: 'run-1', transaction_final: false } : {};
    fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ 'flow-guide': entry }, overrides));
    const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
    assert.strictEqual(result.state, 'BLOCKED', label);
    assert.ok(codes(result).includes('RECOVERY_REQUIRED'), label);
    assert.strictEqual(result.recovery.state, 'RECOVERY_REQUIRED', label);
    assert.ok(result.actions.every((a) => a.kind === 'preserve'), label);
    fx.cleanup(...env.roots);
  }
});

test('terminal committed journal with a bound identity does not require recovery', () => {
  const env = ownedCopyEnv();
  fx.writeJournal(env.project, '20261001T000000Z-5', { phase: 'committed' });
  const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.recovery.state, 'CLEAR');
  assert.strictEqual(result.state, 'READY_FOR_MIGRATION');
  fx.cleanup(...env.roots);
});

test('incomplete or invalid consumer context blocks', () => {
  for (const overrides of [{ enumerationState: 'NOT_RUN' }, { enumerationState: 'BLOCKED' }, { sessionId: '' }, { host: 'cursor' }]) {
    const env = ownedCopyEnv();
    const sources = [fx.pluginSource(env.pluginRoot, ['flow-guide', 'repo-verify'])];
    const context = fx.codexContext(sources, overrides);
    const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot, context }));
    assert.strictEqual(result.state, 'BLOCKED', JSON.stringify(overrides));
    assert.ok(codes(result).includes('CONTEXT_INCOMPLETE'), JSON.stringify(overrides));
    fx.cleanup(...env.roots);
  }
});

test('older or unknown historical receipt schemas block instead of upgrading', () => {
  for (const schema of [2, 4, undefined]) {
    const env = setup();
    const entry = fx.historicalCopyEntry(env.project, 'flow-guide');
    fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ 'flow-guide': entry }, { schema_version: schema }));
    const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
    assert.strictEqual(result.state, 'BLOCKED', String(schema));
    assert.deepStrictEqual(codes(result), ['RECEIPT_UNSUPPORTED'], String(schema));
    assert.deepStrictEqual(result.actions, [], String(schema));
    fx.cleanup(...env.roots);
  }
});

test('retired and renamed identities carry guidance only, never aliases or commands', () => {
  const env = setup();
  const retired = fx.historicalCopyEntry(env.project, 'dhpk-bug-fix', { id: 'bug-fix' });
  const renamed = fx.historicalCopyEntry(env.project, 'dhpk-laravel', { id: 'laravel' });
  fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ 'dhpk-bug-fix': retired, 'dhpk-laravel': renamed }));
  const input = fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot, selectedStableIds: ['flow-guide', 'laravel'] });
  const result = plan(env, input);
  assert.strictEqual(result.state, 'READY_FOR_MIGRATION');
  const [bugFix] = actionAt(result, '.codex/skills/dhpk-bug-fix');
  assert.strictEqual(bugFix.kind, 'remove-owned-entry');
  assert.deepStrictEqual(bugFix.guidance, {
    kind: 'retired',
    stableId: 'bug-fix',
    reasonCode: 'merged-into-adaptive-workflow',
    replacements: [{ kind: 'skill', id: 'flow-guide', mode: 'classify' }],
  });
  const [laravel] = actionAt(result, '.codex/skills/dhpk-laravel');
  assert.deepStrictEqual(laravel.guidance, { kind: 'renamed', stableId: 'laravel', oldName: 'dhpk-laravel', newName: 'laravel' });
  const keys = fx.deepKeys(result);
  for (const banned of ['alias', 'aliases', 'command', 'commands']) assert.ok(!keys.has(banned), banned);
  fx.cleanup(...env.roots);
});

test('unknown, ambiguous, or mismatched identities block', () => {
  const ambiguous = fx.fixtureInventory();
  ambiguous.renamed_skill_names.push({ id: 'tdd', oldName: 'dhpk-laravel', newName: 'tdd' });
  const cases = [
    ['IDENTITY_UNKNOWN', 'mystery-skill', 'mystery-skill', fx.fixtureInventory()],
    ['IDENTITY_AMBIGUOUS', 'dhpk-laravel', null, ambiguous],
    ['IDENTITY_MISMATCH', 'flow-guide', 'tdd', fx.fixtureInventory()],
  ];
  for (const [code, name, id, inventory] of cases) {
    const env = setup();
    const entry = fx.historicalCopyEntry(env.project, name, { id });
    fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ [name]: entry }));
    const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot, inventory }));
    assert.strictEqual(result.state, 'BLOCKED', code);
    assert.deepStrictEqual(codes(result), [code]);
    fx.cleanup(...env.roots);
  }
});

test('real distribution inventory plans an empty project read-only', () => {
  const env = setup();
  const inventoryPath = path.join(__dirname, '..', 'manifests', 'distribution-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const input = fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot, inventory, selectedStableIds: ['flow-guide'] });
  const result = plan(env, input);
  assert.strictEqual(result.state, 'READY_FOR_MIGRATION');
  assert.deepStrictEqual(result.actions, []);
  assert.deepStrictEqual(revalidate(env, result, input).state, 'CURRENT');
  fx.cleanup(...env.roots);
});

// ---- Hardening: hostile on-disk input must yield BLOCKED plans, never throws ----

const MIB = 1024 * 1024;

function sparseFile(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'w');
  fs.ftruncateSync(fd, bytes);
  fs.closeSync(fd);
}

// Hostile cases skip the byte-hash snapshot (it would read the huge file itself).
function planDirect(env, input) {
  let result;
  assert.doesNotThrow(() => { result = cutover.planMarketplaceCutover(input); });
  assert.ok(!JSON.stringify(result).includes(env.project), 'plan must not leak absolute project paths');
  return result;
}

function removalKinds(result) {
  return result.actions.filter((a) => a.kind !== 'preserve').map((a) => a.kind);
}

test('oversized historical receipt blocks with INPUT_LIMIT_EXCEEDED instead of being read', () => {
  const env = ownedCopyEnv();
  sparseFile(path.join(env.project, '.codex/.dhpk-installed.json'), MIB + 1);
  const result = planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(codes(result), ['INPUT_LIMIT_EXCEEDED']);
  assert.deepStrictEqual(removalKinds(result), []);
  fx.cleanup(...env.roots);
});

test('oversized transaction journal requires recovery with JOURNAL_TOO_LARGE', () => {
  const env = ownedCopyEnv();
  sparseFile(path.join(env.project, '.codex/.dhpk-transaction-20261001T000000Z-9.json'), MIB + 1);
  const result = planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(result.recovery.findings.map((f) => f.reason), ['JOURNAL_TOO_LARGE']);
  assert.deepStrictEqual(removalKinds(result), []);
  fx.cleanup(...env.roots);
});

test('deep or huge-key historical receipt JSON blocks with INPUT_LIMIT_EXCEEDED', () => {
  const deep = `${'['.repeat(5000)}${']'.repeat(5000)}`;
  const manyKeys = Array.from({ length: 30000 }, (_, i) => `"k${i}":0`).join(',');
  const shapes = {
    deep: `{"schema_version":3,"managed_entries":{"skills":{}},"x":${deep}}`,
    manyKeys: `{"schema_version":3,"managed_entries":{"skills":{}},"x":{${manyKeys}}}`,
  };
  for (const [label, text] of Object.entries(shapes)) {
    assert.ok(text.length < MIB, label);
    const env = setup();
    fx.writeFile(path.join(env.project, '.codex/.dhpk-installed.json'), text);
    const result = planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
    assert.strictEqual(result.state, 'BLOCKED', label);
    assert.deepStrictEqual(codes(result), ['INPUT_LIMIT_EXCEEDED'], label);
    fx.cleanup(...env.roots);
  }
});

test('oversized file inside a receipt-claimed tree blocks without an ERR_FS_FILE_TOO_LARGE crash', () => {
  const env = ownedCopyEnv();
  sparseFile(path.join(env.project, '.codex/skills/flow-guide/huge.bin'), 3 * 1024 * MIB);
  const result = planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(codes(result), ['OWNERSHIP_UNPROVEN']);
  assert.deepStrictEqual(removalKinds(result), []);
  const observed = result.observations.find((o) => o.path === '.codex/skills/flow-guide');
  assert.strictEqual(observed.reason, 'FILE_TOO_LARGE');
  fx.cleanup(...env.roots);
});

test('unreadable subdirectory blocks without leaking absolute paths', () => {
  if (process.getuid() === 0) return; // chmod 000 does not restrict root
  const nested = ownedCopyEnv();
  const locked = path.join(nested.project, '.codex/skills/flow-guide/locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0);
  try {
    const result = planDirect(nested, fx.cutoverInput(nested.project, { pluginRoot: nested.pluginRoot }));
    assert.strictEqual(result.state, 'BLOCKED');
    assert.deepStrictEqual(codes(result), ['OWNERSHIP_UNPROVEN']);
    assert.deepStrictEqual(removalKinds(result), []);
    assert.strictEqual(result.observations.find((o) => o.path === '.codex/skills/flow-guide').reason, 'UNREADABLE');
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  fx.cleanup(...nested.roots);

  const top = ownedCopyEnv();
  const skills = path.join(top.project, '.codex/skills');
  fs.chmodSync(skills, 0);
  try {
    const result = planDirect(top, fx.cutoverInput(top.project, { pluginRoot: top.pluginRoot }));
    assert.strictEqual(result.state, 'BLOCKED');
    assert.ok(codes(result).includes('UNREADABLE'));
    assert.deepStrictEqual(removalKinds(result), []);
  } finally {
    fs.chmodSync(skills, 0o755);
  }
  fx.cleanup(...top.roots);
});

// Simulates a concurrent swap after the lstat observation: the lstat answers
// with a decoy regular-file stat while the real path is something else.
function withSwappedLstat(target, decoy, body) {
  const original = fs.lstatSync;
  fs.lstatSync = (file, options) => original.call(fs, file === target ? decoy : file, options);
  try {
    return body();
  } finally {
    fs.lstatSync = original;
  }
}

test('a symlink swapped in after lstat is never followed (receipt)', () => {
  const env = ownedCopyEnv();
  const receipt = path.join(env.project, '.codex/.dhpk-installed.json');
  const decoy = path.join(env.pluginRoot, 'decoy.json');
  fs.writeFileSync(decoy, '{}');
  const real = path.join(env.pluginRoot, 'real.json');
  fs.copyFileSync(receipt, real);
  fs.unlinkSync(receipt);
  fs.symlinkSync(real, receipt);
  const result = withSwappedLstat(receipt, decoy, () => planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot })));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(removalKinds(result), []);
  assert.strictEqual(result.receipts.find((r) => r.path === '.codex/.dhpk-installed.json').type, 'swapped');
  fx.cleanup(...env.roots);
});

test('a symlink swapped in after lstat is never followed (tree file)', () => {
  const env = ownedCopyEnv();
  const file = path.join(env.project, '.codex/skills/flow-guide/SKILL.md');
  const decoy = path.join(env.pluginRoot, 'decoy.md');
  const real = path.join(env.pluginRoot, 'real.md');
  fs.copyFileSync(file, real);
  fs.copyFileSync(file, decoy);
  fs.unlinkSync(file);
  fs.symlinkSync(real, file);
  const result = withSwappedLstat(file, decoy, () => planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot })));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(removalKinds(result), []);
  assert.strictEqual(result.observations.find((o) => o.path === '.codex/skills/flow-guide').reason, 'SWAPPED');
  fx.cleanup(...env.roots);
});

// Added after the fix: under the old code this case would block forever.
test('a FIFO swapped in after lstat blocks without hanging', () => {
  const env = ownedCopyEnv();
  const receipt = path.join(env.project, '.codex/.dhpk-installed.json');
  const decoy = path.join(env.pluginRoot, 'decoy.json');
  fs.writeFileSync(decoy, '{}');
  fs.unlinkSync(receipt);
  require('node:child_process').execFileSync('mkfifo', [receipt]);
  const result = withSwappedLstat(receipt, decoy, () => planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot })));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(removalKinds(result), []);
  fx.cleanup(...env.roots);
});

test('a plan that is not READY carries no removal actions', () => {
  const env = setup();
  const owned = fx.historicalCopyEntry(env.project, 'flow-guide');
  const modified = fx.historicalCopyEntry(env.project, 'repo-verify');
  fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ 'flow-guide': owned, 'repo-verify': modified }));
  fx.writeFile(path.join(env.project, '.codex/skills/repo-verify/SKILL.md'), 'edited\n');
  const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(codes(result), ['MODIFIED_MANAGED']);
  assert.deepStrictEqual(result.actions.map((a) => [a.kind, a.path]), [['preserve', '.codex/skills/repo-verify']]);
  fx.cleanup(...env.roots);
});

test('a name claimed by both the historical receipt and the projection is preserved, never removed', () => {
  const env = setup();
  fx.buildProjectProjection(env.project, [{ stableId: 'flow-guide', name: 'flow-guide' }],
    { cursor: ['flow-guide'], codex: ['flow-guide'] });
  const entry = fx.historicalCopyEntry(env.project, 'flow-guide', { write: false });
  fx.writeHistoricalReceipt(env.project, fx.historicalReceipt({ 'flow-guide': entry }));
  const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(codes(result), ['OWNERSHIP_UNPROVEN']);
  assert.deepStrictEqual(actionAt(result, '.codex/skills/flow-guide').map((a) => a.kind), ['preserve']);
  assert.deepStrictEqual(removalKinds(result), []);
  fx.cleanup(...env.roots);
});

test('an Object.prototype-named orphaned receipt key is classified, not silently skipped', () => {
  const env = setup();
  fx.writeFile(path.join(env.project, '.codex/skills/constructor/SKILL.md'), 'foreign\n');
  const receipt = fx.historicalReceipt({}, {
    orphaned_entries: { skills: { constructor: { source: 'skills/constructor', mode: 'copy', ownership_marker: 'copy:skills/constructor' } } },
  });
  fx.writeHistoricalReceipt(env.project, receipt);
  const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(codes(result), ['IDENTITY_UNKNOWN']);
  assert.deepStrictEqual(actionAt(result, '.codex/skills/constructor').map((a) => a.kind), ['preserve']);
  fx.cleanup(...env.roots);
});

// ---- Round 2: unknown recovery, shared budgets, total containment, fd hygiene ----

function chmodRestore(target, mode, body) {
  fs.chmodSync(target, mode);
  try {
    return body();
  } finally {
    fs.chmodSync(target, 0o755);
  }
}

function journalEnv() {
  const env = setup();
  fx.writeJournal(env.project, '20261001T000000Z-7', { phase: 'active' });
  fs.mkdirSync(path.join(env.project, '.codex/skills'), { recursive: true });
  return env;
}

test('N1: a journal plus an unreadable skills directory never reports recovery CLEAR', () => {
  if (process.getuid() === 0) return;
  const env = journalEnv();
  const result = chmodRestore(path.join(env.project, '.codex/skills'), 0, () => planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot })));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.ok(codes(result).includes('UNREADABLE'));
  assert.strictEqual(result.recovery.state, 'RECOVERY_REQUIRED');
  assert.deepStrictEqual(result.recovery.findings.map((f) => f.reason), ['JOURNAL_NONTERMINAL']);
  assert.ok(result.recovery.unverified.length > 0);
  assert.deepStrictEqual(removalKinds(result), []);
  fx.cleanup(...env.roots);
});

test('N1: an unlistable .codex directory reports RECOVERY_UNKNOWN, never CLEAR', () => {
  if (process.getuid() === 0) return;
  const env = journalEnv();
  const result = chmodRestore(path.join(env.project, '.codex'), 0o111, () => planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot })));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.ok(codes(result).includes('UNREADABLE'));
  assert.strictEqual(result.recovery.state, 'RECOVERY_UNKNOWN');
  assert.deepStrictEqual(removalKinds(result), []);
  fx.cleanup(...env.roots);
});

test('N1: a clean plan has no unverified inspections', () => {
  const env = setup();
  const result = plan(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.recovery.state, 'CLEAR');
  assert.deepStrictEqual(result.recovery.unverified, []);
  fx.cleanup(...env.roots);
});

test('N2: total hashed bytes across one plan are budgeted (INPUT_LIMIT_EXCEEDED, no throw)', () => {
  const env = ownedCopyEnv();
  for (let i = 0; i < 9; i += 1) sparseFile(path.join(env.project, `.codex/skills/flow-guide/part${i}.bin`), 31 * MIB);
  const result = planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.ok(codes(result).includes('INPUT_LIMIT_EXCEEDED'));
  assert.deepStrictEqual(removalKinds(result), []);
  fx.cleanup(...env.roots);
});

test('N2: more than the journal-file cap blocks with INPUT_LIMIT_EXCEEDED instead of throwing', () => {
  const env = setup();
  for (let i = 0; i < 300; i += 1) fx.writeJournal(env.project, `20261001T000000Z-${i}`, { phase: 'committed' });
  const result = planDirect(env, fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot }));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.ok(codes(result).includes('INPUT_LIMIT_EXCEEDED'));
  assert.notStrictEqual(result.recovery.state, 'CLEAR');
  fx.cleanup(...env.roots);
});

test('N2: oversized directory listings (tree and skills root) block with INPUT_LIMIT_EXCEEDED', () => {
  const tree = ownedCopyEnv();
  for (let i = 0; i < 5000; i += 1) fx.writeFile(path.join(tree.project, `.codex/skills/flow-guide/many/f${i}`), '');
  const treeResult = planDirect(tree, fx.cutoverInput(tree.project, { pluginRoot: tree.pluginRoot }));
  assert.strictEqual(treeResult.state, 'BLOCKED');
  assert.ok(codes(treeResult).includes('INPUT_LIMIT_EXCEEDED'));
  assert.deepStrictEqual(removalKinds(treeResult), []);
  fx.cleanup(...tree.roots);

  const root = setup();
  for (let i = 0; i < 5000; i += 1) fx.writeFile(path.join(root.project, `.codex/skills/foreign${i}/x`), '');
  const rootResult = planDirect(root, fx.cutoverInput(root.project, { pluginRoot: root.pluginRoot }));
  assert.strictEqual(rootResult.state, 'BLOCKED');
  assert.ok(codes(rootResult).includes('INPUT_LIMIT_EXCEEDED'));
  fx.cleanup(...root.roots);
});

function withThrowingRealpath(code, body) {
  const original = fs.realpathSync;
  fs.realpathSync = () => { throw Object.assign(new Error('/secret/abs/path failed'), { code }); };
  try {
    return body();
  } finally {
    fs.realpathSync = original;
  }
}

test('N3: an unexpected throw anywhere in planning yields a BLOCKED plan carrying only a code', () => {
  const env = ownedCopyEnv();
  const input = fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot });
  const result = withThrowingRealpath('EIO', () => planDirect(env, input));
  assert.strictEqual(result.state, 'BLOCKED');
  assert.deepStrictEqual(result.actions, []);
  assert.ok(!JSON.stringify(result).includes('/secret/abs/path'));
  assert.ok(codes(result).length > 0 && result.conflicts.some((c) => c.detail === 'EIO'));
  assert.notStrictEqual(result.recovery.state, 'CLEAR');
  fx.cleanup(...env.roots);
});

test('N3: an unsearchable ancestor of the project root blocks instead of throwing', () => {
  if (process.getuid() === 0) return;
  const ancestor = fx.makeOutside('anc');
  const project = path.join(ancestor, 'proj');
  fs.mkdirSync(project);
  const input = fx.cutoverInput(project, { pluginRoot: ancestor });
  const result = chmodRestore(ancestor, 0, () => {
    let out;
    assert.doesNotThrow(() => { out = cutover.planMarketplaceCutover(input); });
    return out;
  });
  assert.strictEqual(result.state, 'BLOCKED');
  assert.ok(!JSON.stringify(result).includes(ancestor));
  fx.cleanup(ancestor);
});

test('N3: revalidation never reports CURRENT when re-planning fails', () => {
  const env = ownedCopyEnv();
  const input = fx.cutoverInput(env.project, { pluginRoot: env.pluginRoot });
  const stored = plan(env, input);
  assert.strictEqual(stored.state, 'READY_FOR_MIGRATION');
  let result;
  withThrowingRealpath('EIO', () => {
    assert.doesNotThrow(() => { result = cutover.revalidateMarketplaceCutoverPlan(stored, input); });
  });
  assert.notStrictEqual(result.state, 'CURRENT');
  assert.strictEqual(result.ok, false);
  assert.ok(!JSON.stringify(result).includes('/secret/abs/path'));
  fx.cleanup(...env.roots);
});

test('N4: repeated plans over FIFO-swap and oversized fixtures leak no file descriptors', () => {
  if (!fs.existsSync('/proc/self/fd')) return;
  const countFds = () => fs.readdirSync('/proc/self/fd').length;
  const fifo = ownedCopyEnv();
  const receipt = path.join(fifo.project, '.codex/.dhpk-installed.json');
  const decoy = path.join(fifo.pluginRoot, 'decoy.json');
  fs.writeFileSync(decoy, '{}');
  fs.unlinkSync(receipt);
  require('node:child_process').execFileSync('mkfifo', [receipt]);
  const big = ownedCopyEnv();
  sparseFile(path.join(big.project, '.codex/skills/flow-guide/huge.bin'), 33 * MIB);
  sparseFile(path.join(big.project, '.codex/.dhpk-transaction-20261001T000000Z-9.json'), MIB + 1);
  const fifoInput = fx.cutoverInput(fifo.project, { pluginRoot: fifo.pluginRoot });
  const bigInput = fx.cutoverInput(big.project, { pluginRoot: big.pluginRoot });
  const once = () => {
    withSwappedLstat(receipt, decoy, () => cutover.planMarketplaceCutover(fifoInput));
    cutover.planMarketplaceCutover(bigInput);
  };
  once();
  const before = countFds();
  for (let i = 0; i < 25; i += 1) once();
  assert.strictEqual(countFds(), before);
  fx.cleanup(...fifo.roots, ...big.roots);
});

run('marketplace-cutover-plan');
