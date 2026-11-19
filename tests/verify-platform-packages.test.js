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
  verifyPublicPlugin,
  verifyDirectoryPlugin,
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
    assert.strictEqual(codexNativeIds.length, 14);
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
      const expectedFlowDriveEntries = surface === 'codex-native' ? ['SKILL.md', 'references'] : ['SKILL.md', 'distribution.yaml', 'references'];
      if (surface === 'codex-native') expectedFlowDriveEntries.push('agents');
      assert.deepStrictEqual(fs.readdirSync(flowDrive).sort(), expectedFlowDriveEntries.sort(), `${surface} Flow Drive package entries`);
      if (surface === 'codex-native') {
        assert.deepStrictEqual(fs.readdirSync(path.join(flowDrive, 'agents')), ['openai.yaml']);
      }
      const flowDriveReferences = fs.readdirSync(path.join(flowDrive, 'references')).sort();
      const curatedChildren = selection.skills
        .filter((entry) => entry.owner === 'flow-drive' && entry.kind !== 'entry')
        .map((entry) => byId.get(entry.id).name);
      assert.deepStrictEqual(flowDriveReferences, ['migration.md', ...curatedChildren].sort());
      assert.ok(!flowDriveReferences.includes('execution-bundle'), 'retired Flow Drive runtime resources stay absent');
      const provenance = JSON.parse(fs.readFileSync(path.join(output, 'provenance.json'), 'utf8'));
      if (surface === 'codex-native') assert.deepStrictEqual(provenance.runtimeSupportStableIds, inventory.internal_runtime_skills[surface]);
      assert.strictEqual(provenance.profileId, surface === 'codex-native' ? 'codex-native' : 'common', `${surface} must record its named default selection`);
      assert.deepStrictEqual(provenance.selectedStableIds, selectedIds, `${surface} must retain canonical selected IDs`);
      assert.deepStrictEqual(provenance.emittedStableIds, selectedIds, `${surface} must not claim unselected entries`);

      // Only the Codex native package is committed; the AGY package is built on
      // demand by the verifier itself, so there is nothing to track for it.
      const packagePath = surface === 'codex-native' ? 'plugins/dhpk' : null;
      if (!packagePath && surface !== 'agy-plugin') continue;
      if (packagePath) {
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
      }

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

// The Agent, Cursor and AGY packages are built on demand, so the verifier is
// exercised on a clean clone of the current commit: it builds what it verifies.
function createCloneFixture() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-platform-subset-'));
  const clone = path.join(root, 'repo');
  const cloned = spawnSync('git', ['clone', '--quiet', ROOT, clone], { encoding: 'utf8' });
  assert.strictEqual(cloned.status, 0, cloned.stdout + cloned.stderr);
  return { root, clone };
}

const cloneFixture = createCloneFixture();

test('public verifier builds and verifies only the selected Agent package', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'verify-platform-packages.js'),
    '--surface', 'agent-plugin', '--repo-root', cloneFixture.clone,
  ], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.verdict, 'PASS');
  assert.deepStrictEqual(Object.keys(report.surfaces), ['agent-plugin']);
  assert.deepStrictEqual(report.selection, { requested: ['agent-plugin'], resolved: ['agent-plugin'] });
  assert.deepStrictEqual(Object.keys(report.policyParity.projections), ['claude']);
  assert.ok(fs.existsSync(path.join(cloneFixture.clone, 'dist', 'on-demand', 'dhpk-agent', 'provenance.json')), 'the verifier builds the package it checks');
  assert.ok(!fs.existsSync(path.join(cloneFixture.clone, 'dist', 'on-demand', 'dhpk-cursor')), 'unselected on-demand packages are not built');
});

test('public Cursor selection builds and verifies its Agent owner dependency', () => {
  try {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'verify-platform-packages.js'),
      '--surface', 'cursor-plugin', '--repo-root', cloneFixture.clone,
    ], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'PASS');
    assert.deepStrictEqual(Object.keys(report.surfaces), ['agent-plugin', 'cursor-plugin']);
    assert.deepStrictEqual(report.selection, { requested: ['cursor-plugin'], resolved: ['agent-plugin', 'cursor-plugin'] });
    assert.strictEqual(report.surfaces['cursor-plugin'].conformance, 'PASS');
  } finally {
    // the clone is removed by the last test below
  }
});

test('public AGY selection runs the AGY conformance rules on the built package', () => {
  try {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'verify-platform-packages.js'),
      '--surface', 'agy-plugin', '--repo-root', cloneFixture.clone,
    ], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.surfaces['agy-plugin'].conformance, 'PASS');
  } finally {
    fs.rmSync(cloneFixture.root, { recursive: true, force: true });
  }
});

test('Public Plugin built from the committed tree passes publication conformance', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const result = verifyPublicPlugin({ root: ROOT, inventory });
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.conformance, 'PASS');
  assert.ok(result.fileCount > 0);
});

test('public-plugin is a selectable verifier surface with no dependencies', () => {
  assert.deepStrictEqual(resolveSurfaceSelection(['public-plugin']), {
    ok: true, requested: ['public-plugin'], resolved: ['public-plugin'],
  });
});

test('Directory Plugin built from the committed tree passes conformance and claude validate', () => {
  const result = verifyDirectoryPlugin({ root: ROOT });
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.conformance, 'PASS');
});

test('directory-plugin is a selectable verifier surface with no dependencies', () => {
  assert.deepStrictEqual(resolveSurfaceSelection(['directory-plugin']), {
    ok: true, requested: ['directory-plugin'], resolved: ['directory-plugin'],
  });
});

run('verify-platform-packages');
