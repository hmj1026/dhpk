'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  resolveSurfaceSelection,
  profileSelectionFromReceipt,
  reportFromSurfaces,
  expectedAgyPolicy,
  expectedCursorPolicyBody,
  cleanCheckoutReport,
} = require('../scripts/ci/verify-platform-packages');

const ROOT = path.join(__dirname, '..');

test('platform verifier maps only the exact owned legacy Codex receipt to the named native selection', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'module-catalog.json'), 'utf8'));
  const ids = profiles.profiles['codex-native'].skillIds;
  const owner = 'plugins/dhpk';
  const receipt = {
    surface: 'codex-native',
    owner,
    profileId: 'compat-v1',
    selectedStableIds: ids,
    selectedSkillIds: ids,
    installation: {
      profileId: 'compat-v1',
      scope: 'project',
      selectedStableIds: ids,
      ownership: { owner, roots: [owner] },
    },
  };
  const resolved = profileSelectionFromReceipt({
    root: ROOT, receipt, surface: 'codex-native', inventory, profiles, moduleCatalog,
  });
  assert.strictEqual(resolved.profileId, 'codex-native');
  assert.deepStrictEqual(resolved.selectedStableIds.slice().sort(), ids.slice().sort());

  for (const mutate of [
    (candidate) => candidate.installation.selectedStableIds.pop(),
    (candidate) => { candidate.installation.ownership.owner = 'plugins/other'; },
    (candidate) => { candidate.installation.scope = 'user'; },
    (candidate) => { candidate.installation.ownership.roots = ['plugins/other']; },
  ]) {
    const candidate = JSON.parse(JSON.stringify(receipt));
    mutate(candidate);
    assert.throws(() => profileSelectionFromReceipt({
      root: ROOT, receipt: candidate, surface: 'codex-native', inventory, profiles, moduleCatalog,
    }), /unknown profile 'compat-v1'|missing profile selection field/i);
  }
});

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

test('default common receipts retain canonical IDs and the platform verifier replays them', () => {
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
    const version = JSON.parse(fs.readFileSync(path.join(sourceRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const commonIds = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifests', 'install-profiles.json'), 'utf8'))
      .profiles.common.skillIds;
    const codexNativeIds = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifests', 'install-profiles.json'), 'utf8'))
      .profiles['codex-native'].skillIds;
    assert.strictEqual(commonIds.length, 14);
    assert.strictEqual(codexNativeIds.length, 16);
    const inventory = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifests/distribution-inventory.json'), 'utf8'));
    const selection = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifests/marketplace-selection.json'), 'utf8'));
    const byId = new Map(inventory.skills.map((entry) => [entry.id, entry]));
    const verificationFailures = [];
    for (const surface of ['agent-plugin', 'agy-plugin', 'codex-native']) {
      const output = path.join(root, surface);
      const result = spawnSync(path.join(sourceRoot, 'bin', 'dhpk'), [
        'distribution', surface, 'generate', '--output', output, '--version', version, '--json',
      ], { cwd: sourceRoot, encoding: 'utf8' });
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      const hostOnlyIds = selection.skills.filter((entry) => entry.selection === 'host-only'
        && byId.get(entry.id).surfaces.includes(surface)).map((entry) => entry.id);
      assert.deepStrictEqual(hostOnlyIds.sort(), surface === 'codex-native' ? ['library-author', 'opsx-apply-resume'] : []);
      const selectedIds = surface === 'codex-native' ? codexNativeIds : commonIds;
      const expectedPhysicalIds = [...new Set([...selectedIds, ...(surface === 'codex-native' ? [] : hostOnlyIds), ...inventory.internal_runtime_skills[surface]])].sort();
      assert.strictEqual(report.skillCount, expectedPhysicalIds.length, `${surface} must retain its declared physical entries`);
      assert.deepStrictEqual(fs.readdirSync(path.join(output, 'skills')).sort(), expectedPhysicalIds.map((id) => byId.get(id).name).sort());
      for (const id of ['agy-fast-worker', 'cli-dispatch-context', 'cli-transport', 'codex-bridge']) assert.ok(!expectedPhysicalIds.includes(id), id);
      const flowDrive = path.join(output, 'skills', byId.get('flow-drive').name);
      assert.deepStrictEqual(fs.readdirSync(flowDrive).sort(), ['SKILL.md', 'agents', 'distribution.yaml', 'references']);
      assert.deepStrictEqual(fs.readdirSync(path.join(flowDrive, 'agents')), ['openai.yaml']);
      assert.deepStrictEqual(fs.readdirSync(path.join(flowDrive, 'references')), ['migration.md']);
      const provenance = JSON.parse(fs.readFileSync(path.join(output, 'provenance.json'), 'utf8'));
      if (surface === 'codex-native') assert.deepStrictEqual(provenance.runtimeSupportStableIds, inventory.internal_runtime_skills[surface]);
      assert.strictEqual(provenance.profileId, surface === 'codex-native' ? 'codex-native' : 'common', `${surface} must record its named default selection`);
      assert.deepStrictEqual(provenance.selectedStableIds, selectedIds, `${surface} must retain canonical selected IDs`);
      assert.deepStrictEqual(provenance.emittedStableIds, selectedIds, `${surface} must not claim unselected entries`);

      const packagePath = surface === 'agy-plugin' ? 'plugins/dhpk-agy' : surface === 'codex-native' ? 'plugins/dhpk' : null;
      if (!packagePath) continue;
      const tracked = path.join(sourceRoot, packagePath);
      fs.rmSync(tracked, { recursive: true, force: true });
      fs.cpSync(output, tracked, { recursive: true });
      const added = spawnSync('git', ['add', packagePath], { cwd: sourceRoot, encoding: 'utf8' });
      assert.strictEqual(added.status, 0, added.stdout + added.stderr);
      const committed = spawnSync('git', [
        '-c', 'user.name=common-verifier-fixture',
        '-c', 'user.email=test@example.invalid',
        'commit', '--quiet', '-m', `refresh ${surface} common fixture`,
      ], { cwd: sourceRoot, encoding: 'utf8' });
      assert.strictEqual(committed.status, 0, committed.stdout + committed.stderr);

      const verified = spawnSync(process.execPath, [
        path.join(ROOT, 'scripts', 'ci', 'verify-platform-packages.js'),
        '--surface', surface, '--repo-root', sourceRoot,
      ], { encoding: 'utf8' });
      let verification;
      try { verification = JSON.parse(verified.stdout); } catch (_) {
        verificationFailures.push(`${surface}: verifier returned non-JSON output: ${verified.stdout}${verified.stderr}`);
        continue;
      }
      const summary = verification.surfaces && verification.surfaces[surface];
      if (!summary || summary.structural !== 'PASS' || summary.receipt !== 'PASS'
        || summary.deterministic !== 'PASS' || (summary.errors || []).length > 0) {
        verificationFailures.push(`${surface}: ${JSON.stringify(summary || verification)}${verified.stderr}`);
      }
    }
    assert.deepStrictEqual(verificationFailures, [], verificationFailures.join('\n'));
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

test('policy parity checks the AGY pointer and Cursor repository-link rewrite', () => {
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

    const packageRoot = path.join(root, 'package');
    const projectedPath = path.join(packageRoot, 'rules', 'execution-policy.md');
    const selectedResourcePath = path.join(
      packageRoot,
      'skills',
      'flow-guide',
      'references',
      'execution-bundle',
      'rules',
      'execution-policy.md',
    );
    fs.mkdirSync(path.dirname(projectedPath), { recursive: true });
    fs.mkdirSync(path.dirname(selectedResourcePath), { recursive: true });
    fs.writeFileSync(selectedResourcePath, '# Selected policy resource\n');
    const agy = expectedAgyPolicy(canonical, canonicalPath, root);
    fs.writeFileSync(projectedPath, agy);
    const policyFrontmatter = agy.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    assert.ok(policyFrontmatter, 'AGY execution policy has parseable trigger metadata');
    assert.match(policyFrontmatter[1], /^trigger:\s*model_decision\s*$/m);
    const policyLink = agy.match(/\[[^\]]+\]\(([^)]+)\)/);
    assert.ok(policyLink, 'AGY execution policy points to its selected bundle resource');
    assert.ok(!path.isAbsolute(policyLink[1]), 'AGY execution policy link is relative');
    const resolvedResourcePath = path.resolve(path.dirname(projectedPath), policyLink[1]);
    const packageRelativeResource = path.relative(packageRoot, resolvedResourcePath);
    assert.ok(
      packageRelativeResource && packageRelativeResource !== '..' && !packageRelativeResource.startsWith(`..${path.sep}`),
      'AGY policy resource stays inside the package',
    );
    assert.strictEqual(resolvedResourcePath, selectedResourcePath);
    assert.ok(fs.statSync(resolvedResourcePath).isFile(), 'AGY policy link resolves to the selected package resource');

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
  // Freeze the matching generation before checkout exposes older package outputs.
  const frozenCursor = path.join(root, 'frozen-cursor');
  fs.cpSync(path.join(clone, 'plugins', 'dhpk-cursor'), frozenCursor, { recursive: true });
  const provenance = JSON.parse(fs.readFileSync(path.join(clone, 'plugins', 'dhpk-agent', 'provenance.json'), 'utf8'));
  const checkedOut = spawnSync('git', ['checkout', '--quiet', provenance.generatedFromCommit], { cwd: clone, encoding: 'utf8' });
  assert.strictEqual(checkedOut.status, 0, checkedOut.stdout + checkedOut.stderr);
  fs.rmSync(path.join(clone, 'plugins', 'dhpk-cursor'), { recursive: true });
  fs.cpSync(frozenCursor, path.join(clone, 'plugins', 'dhpk-cursor'), { recursive: true });
  const cursorReceiptPath = path.join(clone, 'plugins', 'dhpk-cursor', 'provenance.json');
  const cursorReceipt = JSON.parse(fs.readFileSync(cursorReceiptPath, 'utf8'));
  cursorReceipt.owner = 'plugins/dhpk-agent';
  fs.writeFileSync(cursorReceiptPath, `${JSON.stringify(cursorReceipt, null, 2)}\n`);
  for (const args of [['config', 'user.email', 'test@example.invalid'], ['config', 'user.name', 'subset-fixture']]) {
    const configured = spawnSync('git', args, { cwd: clone, encoding: 'utf8' });
    assert.strictEqual(configured.status, 0, configured.stdout + configured.stderr);
  }
  const committed = spawnSync('git', ['add', 'plugins/dhpk-cursor'], { cwd: clone, encoding: 'utf8' });
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
