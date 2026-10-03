'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  resolveSurfaceSelection,
  reportFromSurfaces,
  expectedAgyPolicy,
  expectedCursorPolicyBody,
  cleanCheckoutReport,
} = require('../scripts/ci/verify-platform-packages');

const ROOT = path.join(__dirname, '..');

test('surface selection rejects unknown surfaces and dependency metadata', () => {
  assert.deepStrictEqual(resolveSurfaceSelection(['agent-plugin']), {
    ok: true, requested: ['agent-plugin'], resolved: ['agent-plugin'],
  });
  assert.match(resolveSurfaceSelection(['missing-surface']).error, /unknown package surface/);
  assert.match(resolveSurfaceSelection(['cursor-plugin'], { 'cursor-plugin': ['missing-owner'] }).error, /unknown dependency/);
  assert.match(resolveSurfaceSelection(['cursor-plugin'], { 'cursor-plugin': ['agent-plugin'] }).error, /missing dependency metadata/);
});

test('subset reporting does not dereference absent Host surfaces', () => {
  const report = reportFromSurfaces({ 'codex-native': { selectedSkillIds: [], errors: [] } });
  assert.strictEqual(report.verdict, 'PASS');
  assert.deepStrictEqual(report.errors, []);
});

test('an unprofiled generation materializes the common and surface-specific Host catalog', () => {
  // Package generators reject symlinked ancestors; macOS exposes os.tmpdir() as /var.
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-unprofiled-platform-'));
  const sourceParent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-unprofiled-source-'));
  const sourceRoot = path.join(sourceParent, 'checkout');
  let worktreeAdded = false;
  try {
    const checkedOut = spawnSync('git', ['worktree', 'add', '--detach', sourceRoot, 'HEAD'], {
      cwd: ROOT, encoding: 'utf8',
    });
    assert.strictEqual(checkedOut.status, 0, checkedOut.stdout + checkedOut.stderr);
    worktreeAdded = true;
    for (const surface of ['agent-plugin', 'agy-plugin']) {
      const output = path.join(root, surface);
      const result = spawnSync(path.join(sourceRoot, 'bin', 'dhpk'), [
        'distribution', surface, 'generate', '--output', output, '--version', '0.48.3', '--json',
      ], { cwd: sourceRoot, encoding: 'utf8' });
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.skillCount, 17, `${surface} must publish fifteen common entries and two Host-only entries`);
      const provenance = JSON.parse(fs.readFileSync(path.join(output, 'provenance.json'), 'utf8'));
      assert.strictEqual(provenance.profileId, undefined, `${surface} must not narrow without an explicit --profile`);
    }
  } finally {
    if (worktreeAdded) spawnSync('git', ['worktree', 'remove', '--force', sourceRoot], { cwd: ROOT, encoding: 'utf8' });
    fs.rmSync(sourceParent, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('platform package verifier permits declared Cursor runtime support but reports undeclared shared overlaps at the top level', () => {
  const agent = { selectedSkillIds: ['declared-runtime-support', 'undeclared-shared'], errors: [] };
  const declaredRuntimeSupport = {
    selectedSkillIds: ['declared-runtime-support'],
    sharedSkillIds: ['declared-runtime-support', 'undeclared-shared'],
    runtimeSupportStableIds: ['declared-runtime-support'],
    sharedSkillSurface: 'agent-plugin',
    sharedSkillSource: 'plugins/dhpk-agent/skills/',
    errors: [],
  };
  const allowed = reportFromSurfaces({ 'agent-plugin': agent, 'cursor-plugin': declaredRuntimeSupport });
  const undeclared = reportFromSurfaces({
    'agent-plugin': agent,
    'cursor-plugin': {
      selectedSkillIds: ['declared-runtime-support', 'undeclared-shared'],
      sharedSkillIds: ['declared-runtime-support', 'undeclared-shared'],
      runtimeSupportStableIds: ['declared-runtime-support'],
      sharedSkillSurface: 'agent-plugin',
      sharedSkillSource: 'plugins/dhpk-agent/skills/',
      errors: [],
    },
  });

  assert.deepStrictEqual(allowed.errors, []);
  assert.strictEqual(allowed.verdict, 'PASS');
  assert.deepStrictEqual(undeclared.errors, ['Cursor overlay repeats shared skill IDs without a declared runtime-support exception: undeclared-shared']);
  assert.strictEqual(undeclared.verdict, 'FAIL');
});

test('policy parity applies the generators\' repository-link rewrite before comparing AGY and Cursor projections', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-policy-links-'));
  try {
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'contracts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'contracts', 'reviewer-contract.md'), '# Contract\n');
    const canonicalPath = path.join(root, 'rules', 'execution-policy.md');
    const canonical = [
      '# Policy',
      '',
      'See the [reviewer contract](../docs/contracts/reviewer-contract.md#shape).',
      'A [missing doc](../docs/absent.md) keeps only its label.',
      'An [external link](https://example.com/x) is untouched.',
      '',
    ].join('\n');
    fs.writeFileSync(canonicalPath, canonical);
    const url = 'https://github.com/hmj1026/dhpk/blob/main/docs/contracts/reviewer-contract.md#shape';

    const agy = expectedAgyPolicy(canonical, canonicalPath, root);
    assert.ok(agy.includes(`[reviewer contract](${url})`), agy);
    assert.ok(agy.includes('A [missing doc] keeps only its label.'), agy);
    assert.ok(agy.includes('[external link](https://example.com/x)'), agy);
    assert.notStrictEqual(agy, canonical, 'an unrewritten projection must not satisfy parity');

    const cursor = expectedCursorPolicyBody(canonical, canonicalPath, root);
    assert.ok(cursor.includes(`[reviewer contract](${url})`), cursor);
    assert.ok(!cursor.includes('../docs/contracts/reviewer-contract.md'), cursor);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a dirty source checkout yields a FAIL report instead of a thrown stack trace', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-dirty-checkout-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'dirty\n');
    const report = cleanCheckoutReport(root);
    assert.deepStrictEqual(report, {
      verdict: 'FAIL',
      surfaces: {},
      errors: ['source checkout must be clean before generating provenance-bound package'],
    });
    fs.rmSync(path.join(root, 'untracked.txt'));
    assert.strictEqual(cleanCheckoutReport(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createHistoricalFixture() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-platform-subset-'));
  const clone = path.join(root, 'repo');
  const cloned = spawnSync('git', ['clone', '--quiet', ROOT, clone], { encoding: 'utf8' });
  assert.strictEqual(cloned.status, 0, cloned.stdout + cloned.stderr);
  const provenance = JSON.parse(fs.readFileSync(path.join(clone, 'plugins', 'dhpk-agent', 'provenance.json'), 'utf8'));
  const checkedOut = spawnSync('git', ['checkout', '--quiet', provenance.generatedFromCommit], { cwd: clone, encoding: 'utf8' });
  assert.strictEqual(checkedOut.status, 0, checkedOut.stdout + checkedOut.stderr);
  const cursorReceiptPath = path.join(clone, 'plugins', 'dhpk-cursor', 'provenance.json');
  const cursorReceipt = JSON.parse(fs.readFileSync(cursorReceiptPath, 'utf8'));
  cursorReceipt.owner = 'plugins/dhpk-agent';
  fs.writeFileSync(cursorReceiptPath, `${JSON.stringify(cursorReceipt, null, 2)}\n`);
  for (const args of [['config', 'user.email', 'test@example.invalid'], ['config', 'user.name', 'subset-fixture']]) {
    const configured = spawnSync('git', args, { cwd: clone, encoding: 'utf8' });
    assert.strictEqual(configured.status, 0, configured.stdout + configured.stderr);
  }
  const committed = spawnSync('git', ['add', 'plugins/dhpk-cursor/provenance.json'], { cwd: clone, encoding: 'utf8' });
  assert.strictEqual(committed.status, 0, committed.stdout + committed.stderr);
  const commit = spawnSync('git', ['commit', '--quiet', '-m', 'corrupt unrelated Cursor receipt'], { cwd: clone, encoding: 'utf8' });
  assert.strictEqual(commit.status, 0, commit.stdout + commit.stderr);
  const generated = path.join(root, 'generated-agent');
  const generatedResult = spawnSync(process.execPath, [
    path.join(clone, 'scripts', 'ci', 'gen-agent-plugin-package.js'), generated,
  ], { cwd: clone, encoding: 'utf8' });
  assert.strictEqual(generatedResult.status, 0, generatedResult.stdout + generatedResult.stderr);
  fs.rmSync(path.join(clone, 'plugins', 'dhpk-agent'), { recursive: true, force: true });
  fs.cpSync(generated, path.join(clone, 'plugins', 'dhpk-agent'), { recursive: true });
  const regenerated = spawnSync('git', ['add', 'plugins/dhpk-agent'], { cwd: clone, encoding: 'utf8' });
  assert.strictEqual(regenerated.status, 0, regenerated.stdout + regenerated.stderr);
  const packageCommit = spawnSync('git', ['commit', '--quiet', '-m', 'refresh Agent fixture package'], { cwd: clone, encoding: 'utf8' });
  assert.strictEqual(packageCommit.status, 0, packageCommit.stdout + packageCommit.stderr);
  return { root, clone };
}

const historicalFixture = createHistoricalFixture();

test('public verifier filters an unrelated corrupt Cursor receipt from an Agent-only run', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'verify-platform-packages.js'),
    '--surface', 'agent-plugin', '--repo-root', historicalFixture.clone,
  ], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.verdict, 'PASS');
  assert.deepStrictEqual(Object.keys(report.surfaces), ['agent-plugin']);
  assert.deepStrictEqual(report.selection, { requested: ['agent-plugin'], resolved: ['agent-plugin'] });
  assert.deepStrictEqual(Object.keys(report.policyParity.projections), ['claude']);
});

test('public Cursor selection verifies its Agent owner dependency and fails on the selected receipt', () => {
  try {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'verify-platform-packages.js'),
      '--surface', 'cursor-plugin', '--repo-root', historicalFixture.clone,
    ], { encoding: 'utf8' });
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'FAIL');
    assert.deepStrictEqual(Object.keys(report.surfaces), ['agent-plugin', 'cursor-plugin']);
    assert.deepStrictEqual(report.selection, { requested: ['cursor-plugin'], resolved: ['agent-plugin', 'cursor-plugin'] });
    assert.ok(report.surfaces['cursor-plugin'].errors.some((error) => /provenance owner/i.test(error)), report.errors.join('; '));
  } finally {
    fs.rmSync(historicalFixture.root, { recursive: true, force: true });
  }
});

run('verify-platform-packages');
