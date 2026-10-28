'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { createCiPlan } = require('../scripts/lib/ci-plan');

const CI_PLAN_CLI = path.join(__dirname, '..', 'scripts/ci/ci-plan.js');
const ALL_PACKAGE_SURFACES = ['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin'];

const SMOKE_SUITE = 'skill-script-operability.test.js';
const RESOURCE_SUITES = [
  'modules.test.js', 'run-agy.test.js', 'run-codex.test.js',
  'run-cli-transport.test.js', 'cli-dispatch-launcher.test.js',
  'cli-role-resolver.test.js', 'verify-handoff.test.js',
  'verification-handoff-isolation.test.js', 'native-agent-support.test.js',
  'skill-resource-sync-security.test.js', 'skill-runtime-path-contract.test.js',
];
const HOOK_SUITES = [
  'hooks-wiring.test.js', 'postcompact-restore.test.js', 'pre-agent-warmstart.test.js',
  'pre-bash-guard.test.js', 'pre-edit-guard.test.js', 'pre-route.test.js',
  'pretool-branch-safety-dedup.test.js', 'session-end.test.js',
  'session-install-health-ask.test.js', 'session-install-health-version.test.js',
  'session-start.test.js', 'stop-advisory-dispatch-graduation.test.js',
  'subagent-stop-quality.test.js', 'subagent-stop-verify.test.js',
  'userpromptsubmit-skill-hint.test.js', 'validate-test-hooks.test.js',
];
const INSTALLER_SUITES = [
  'dhpk-install-lifecycle.test.js', 'install.test.js', 'install-assets.test.js',
  'install-codex-skills.test.js', 'install-codex-skills-planning.test.js',
  'install-codex-skills-reconciliation.test.js', 'install-codex-skills-uninstall.test.js',
  'install-codex-sync-shared.test.js', 'install-cursor-harness.test.js',
  'install-prompts.test.js', 'macos-installer-darwin.test.js',
  'macos-installer-files.test.js', 'native-shared-skill-install.test.js',
];
const AVAILABLE_SUITES = [SMOKE_SUITE, ...RESOURCE_SUITES, 'utils.test.js'];

function classificationFor(paths, baseSha, headSha, kindForPath = () => 'behavior') {
  return {
    baseSha,
    headSha,
    entries: paths.map((file) => ({ path: file, kind: kindForPath(file), reason: 'Scoped test declaration.' })),
  };
}

function withChangedFiles(files, check, suites = AVAILABLE_SUITES, kindForPath = () => 'behavior') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ci-plan-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const write = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'maintenance.auto', 'false');
    git('config', 'gc.auto', '0');
    suites.forEach((suite) => write(`tests/${suite}`, '// fixture owner suite\n'));
    files.forEach((file) => write(file, 'baseline\n'));
    git('add', '.');
    git('commit', '--no-verify', '-qm', 'base');
    const baseSha = git('rev-parse', 'HEAD');
    files.forEach((file) => write(file, 'changed\n'));
    git('add', '-A');
    git('commit', '--no-verify', '-qm', 'head');
    const headSha = git('rev-parse', 'HEAD');
    const classification = classificationFor(files, baseSha, headSha, kindForPath);
    check(createCiPlan({ root, baseSha, headSha, checkoutSha: headSha, baseRef: 'develop', classification }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertFullPlan(plan) {
  assert.strictEqual(plan.mode, 'full');
  assert.strictEqual(plan.reason, 'owner-mapping-unavailable');
  assert.strictEqual(plan.shardCount, 4);
  assert.deepStrictEqual(plan.testFiles, AVAILABLE_SUITES.slice().sort());
  assert.ok(plan.requiredJobs.includes('macos-installer'));
}

function withCiPlanCliFixture(
  check,
  changedPaths = ['scripts/ci/verify-platform-packages.js'],
  kindForPath = () => 'behavior',
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ci-plan-cli-source-'));
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ci-plan-cli-evidence-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const writeSource = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const runCli = (args) => spawnSync(process.execPath, [CI_PLAN_CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
  });

  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'maintenance.auto', 'false');
    git('config', 'gc.auto', '0');
    writeSource('tests/fixture.test.js', '// committed suite fixture\n');
    changedPaths.forEach((file) => writeSource(file, 'before\n'));
    git('add', '-A');
    git('commit', '--no-verify', '-qm', 'base source');
    const baseSha = git('rev-parse', 'HEAD');
    changedPaths.forEach((file) => writeSource(file, 'after\n'));
    git('add', '-A');
    git('commit', '--no-verify', '-qm', 'changed source');
    const headSha = git('rev-parse', 'HEAD');

    const classificationPath = path.join(evidenceRoot, 'classification.json');
    const planPath = path.join(evidenceRoot, 'ci-plan.json');
    const classification = {
      baseSha,
      headSha,
      entries: changedPaths.map((file) => ({
        path: file,
        kind: kindForPath(file),
        reason: 'The fixture declares this committed source change.',
      })),
    };
    fs.writeFileSync(classificationPath, `${JSON.stringify(classification)}\n`);
    const planResult = runCli([
      'plan', '--base-sha', baseSha, '--head-sha', headSha, '--checkout-sha', headSha,
      '--base-ref', 'develop', '--classification-file', classificationPath, '--out', planPath,
    ]);
    assert.strictEqual(planResult.status, 0, `${planResult.stdout}\n${planResult.stderr}`);
    const validateArgs = [
      'validate', '--plan', planPath, '--base-sha', baseSha, '--head-sha', headSha,
      '--checkout-sha', headSha, '--base-ref', 'develop', '--classification-file', classificationPath,
    ];

    check({
      root,
      evidenceRoot,
      baseSha,
      headSha,
      classificationPath,
      planPath,
      plan: JSON.parse(fs.readFileSync(planPath, 'utf8')),
      git,
      writeSource,
      runCli,
      validate: (flags = []) => runCli([...validateArgs, ...flags]),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
}

function assertCliPass(result) {
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: CI plan is valid/);
}

function assertCliFailure(result, pattern) {
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, pattern);
}

test('wording declarations for the execution-policy kernel retain full CI', () => {
  withChangedFiles(['rules/execution-policy-kernel.md'], (plan) => {
    assert.strictEqual(plan.mode, 'full');
    assert.strictEqual(plan.reason, 'shared-core-change');
  }, AVAILABLE_SUITES, () => 'wording');
});

test('wording declarations for shared tool-routing policy retain full CI', () => {
  withChangedFiles(['rules/tool-routing.md'], (plan) => {
    assert.strictEqual(plan.mode, 'full');
    assert.strictEqual(plan.reason, 'shared-core-change');
  }, AVAILABLE_SUITES, () => 'wording');
});

for (const file of [
  '.github/workflows/ci.yml',
  'tests/_lib/fixture.js',
  'scripts/hooks/_lib/shared.sh',
]) {
  test(`shared-core directory changes report the shared-core reason: ${file}`, () => {
    withChangedFiles([file], (plan) => {
      assert.strictEqual(plan.mode, 'full');
      assert.strictEqual(plan.reason, 'shared-core-change');
    }, AVAILABLE_SUITES, () => 'wording');
  });
}

for (const file of [
  'skills/repo-verify/scripts/lib/runner-utils.js',
  'skills/flow-guide/scripts/_lib/runtime-loader.js',
  'skills/laravel/scripts/version-resolver.js',
  'skills/phpunit/scripts/version-resolver.js',
]) {
  test(`internal module changes retain full CI: ${file}`, () => {
    withChangedFiles([file], assertFullPlan);
  });
}

// These entry paths come from the independently audited executable inventory.
const SMOKE_ENTRIES = {
  'change-verdict': ['check-unrelated-changes.sh', 'review-cli.sh', 'risk-analyze.js'],
  'code-trace': ['diagnose/analyze-function-calls.sh', 'diagnose/check-tools.sh', 'diagnose/find-polluter.sh', 'diagnose/generate-flow-diagram.sh', 'diagnose/search-database-queries.sh', 'diagnose/trace-data-flow.sh'],
  'dhpk-deploy-list': ['check-golden.sh', 'deploy-list.sh'],
  'dhpk-feature-verify': ['api-exec.sh', 'health-probe.sh'],
  'dhpk-project-audit': ['audit.js'],
  'dhpk-repo-intake': ['intake_cached.js', 'scan_delta.js', 'scan_repo.js'],
  'flow-guide': ['action-runner.js', 'analyze.js', 'openspec_gate_check.py', 'pre-route.sh', 'prepare_dev_scope.py', 'prepare_workflow_profile.py', 'route-result.js', 'usage-card.js', 'workflow_gate_check.py'],
  'git-smart-commit': ['collect-changes.js'],
  'harness-setup': ['install-assets.sh', 'install-codex-project.sh'],
  'js-static-checks': ['status.js'],
  laravel: ['resolve-version.js'],
  'opsx-apply-resume': ['detect-phase.sh', 'extract-compact.sh', 'post-obs.sh', 'set-handoff-state.sh', 'write-handoff.sh'],
  phpunit: ['resolve-version.js'],
  precommit: ['precommit-runner.js'],
  'release-creator': ['release-runner.sh'],
  'repo-verify': ['verify-runner.js'],
  swift: ['generate_icons.swift', 'iconify_gen.sh'],
};

for (const [skill, entries] of Object.entries(SMOKE_ENTRIES)) {
  for (const entry of entries) {
    const file = `skills/${skill}/scripts/${entry}`;
    test(`executed CLI entry selects its smoke suite: ${file}`, () => {
      withChangedFiles([file], (plan) => {
        assert.strictEqual(plan.mode, 'selected');
        assert.deepStrictEqual(plan.testFiles, [SMOKE_SUITE]);
        assert.strictEqual(plan.shardCount, 1);
        assert.ok(plan.skippedJobs.includes('macos-installer'));
      });
    });
  }
}

for (const file of [
  'scripts/cli-dispatch/new-cli.js',
  'skills/new-skill/scripts/launch-dispatch.js',
  'scripts/cli-dispatch/nested/launch-dispatch.js',
  'scripts/cli-dispatch/launch-dispatch.js.backup',
]) {
  test(`unrecognized script changes fail closed: ${file}`, () => {
    withChangedFiles([file], assertFullPlan);
  });
}

test('mixed CLI and internal changes retain the complete test plan', () => {
  withChangedFiles([
    'scripts/cli-dispatch/dispatch-runtime/launch-cli-dispatch.js',
    'scripts/lib/runner-utils.js',
  ], assertFullPlan);
});

for (const file of [
  'scripts/cli-dispatch/adapters/run-agy.sh',
  'scripts/cli-dispatch/transport/run-cli-transport.py',
  'scripts/cli-dispatch/dispatch-runtime/build-cli-dispatch-context.js',
  'scripts/cli-dispatch/verify-handoff.js',
]) {
  test(`resource runtime changes retain their behavior suites: ${file}`, () => {
    withChangedFiles([file], (plan) => {
      assert.strictEqual(plan.mode, 'selected');
      assert.deepStrictEqual(plan.testFiles, RESOURCE_SUITES.slice().sort());
      assert.strictEqual(plan.shardCount, 1);
      assert.ok(plan.requiredJobs.includes('macos-installer'));
    });
  });
}

test('hook owner changes require the macOS installer job', () => {
  withChangedFiles(['scripts/hooks/sample.sh'], (plan) => {
    assert.strictEqual(plan.mode, 'selected');
    assert.ok(plan.requiredJobs.includes('macos-installer'));
  }, HOOK_SUITES);
});

test('installer owner changes require the macOS installer job', () => {
  withChangedFiles(['scripts/install.sh'], (plan) => {
    assert.strictEqual(plan.mode, 'selected');
    assert.ok(plan.requiredJobs.includes('macos-installer'));
  }, INSTALLER_SUITES);
});

test('CLI changes fail closed when the smoke suite is unavailable', () => {
  withChangedFiles(['scripts/cli-dispatch/dispatch-runtime/launch-cli-dispatch.js'], (plan) => {
    assert.strictEqual(plan.mode, 'full');
    assert.strictEqual(plan.shardCount, 4);
    assert.deepStrictEqual(plan.testFiles, ['utils.test.js']);
  }, ['utils.test.js']);
});

test('a complete current wording declaration keeps canonical content on the light route', () => {
  withChangedFiles(['skills/demo/SKILL.md'], (plan) => {
    assert.strictEqual(plan.mode, 'light');
    assert.strictEqual(plan.classification.status, 'accepted');
    assert.deepStrictEqual(plan.classification.entries.map((entry) => entry.path), ['skills/demo/SKILL.md']);
    assert.deepStrictEqual(plan.generatedChecks, ['claude-marketplace']);
  }, AVAILABLE_SUITES, () => 'wording');
});

test('a wording edit with its required .none marker and generated companion remains light', () => {
  withChangedFiles([
    'skills/flow-drive/SKILL.md',
    'changelog.d/1113-none.none',
    'generated/claude-marketplace/package/skills/flow-drive/SKILL.md',
  ], (plan) => {
    assert.strictEqual(plan.mode, 'light');
    assert.strictEqual(plan.classification.status, 'accepted');
    assert.deepStrictEqual(plan.generatedChecks, ['claude-marketplace']);
    assert.ok(plan.requiredJobs.includes('preflight'));
    assert.ok(plan.skippedJobs.includes('tests'));
  }, AVAILABLE_SUITES, () => 'wording');
});

test('a Markdown behavior declaration selects its checked-in installer owner suites', () => {
  withChangedFiles(['skills/harness-setup/SKILL.md'], (plan) => {
    assert.strictEqual(plan.mode, 'selected');
    assert.deepStrictEqual(plan.testFiles, INSTALLER_SUITES.slice().sort());
    assert.ok(plan.requiredJobs.includes('macos-installer'));
    assert.deepStrictEqual(plan.generatedChecks, ['claude-marketplace']);
  }, INSTALLER_SUITES, () => 'behavior');
});

test('mixed wording and behavior changes keep generated checks and union behavior owners', () => {
  withChangedFiles(['docs/guide.md', 'skills/harness-setup/SKILL.md'], (plan) => {
    assert.strictEqual(plan.mode, 'selected');
    assert.deepStrictEqual(plan.testFiles, INSTALLER_SUITES.slice().sort());
    assert.deepStrictEqual(plan.generatedChecks, ['claude-marketplace']);
  }, INSTALLER_SUITES, (file) => file === 'skills/harness-setup/SKILL.md' ? 'behavior' : 'wording');
});

test('unmapped Markdown behavior declarations retain full verification', () => {
  withChangedFiles(['skills/flow-drive/SKILL.md'], (plan) => {
    assert.strictEqual(plan.mode, 'full');
    assert.strictEqual(plan.reason, 'owner-mapping-unavailable');
    assert.strictEqual(plan.shardCount, 4);
  }, AVAILABLE_SUITES, () => 'behavior');
});

test('missing, stale, or incomplete declarations cannot lower canonical content to light', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ci-plan-classification-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const write = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    AVAILABLE_SUITES.forEach((suite) => write(`tests/${suite}`, '// owner suite\n'));
    write('docs/guide.md', 'before\n');
    git('add', '.');
    git('commit', '--no-verify', '-qm', 'base');
    const baseSha = git('rev-parse', 'HEAD');
    write('docs/guide.md', 'after\n');
    git('add', '-A');
    git('commit', '--no-verify', '-qm', 'head');
    const headSha = git('rev-parse', 'HEAD');

    const missing = createCiPlan({ root, baseSha, headSha, checkoutSha: headSha, baseRef: 'develop' });
    assert.strictEqual(missing.mode, 'full');
    assert.strictEqual(missing.reason, 'classification-missing');

    const stale = createCiPlan({
      root, baseSha, headSha, checkoutSha: headSha, baseRef: 'develop',
      classification: classificationFor(['docs/guide.md'], 'stale-base', headSha, () => 'wording'),
    });
    assert.strictEqual(stale.mode, 'full');
    assert.strictEqual(stale.reason, 'classification-identity-mismatch');

    const incomplete = createCiPlan({
      root, baseSha, headSha, checkoutSha: headSha, baseRef: 'develop',
      classification: classificationFor([], baseSha, headSha, () => 'wording'),
    });
    assert.strictEqual(incomplete.mode, 'full');
    assert.strictEqual(incomplete.reason, 'classification-paths-mismatch');

    const extra = createCiPlan({
      root, baseSha, headSha, checkoutSha: headSha, baseRef: 'develop',
      classification: classificationFor(['docs/guide.md', 'docs/extra.md'], baseSha, headSha, () => 'wording'),
    });
    assert.strictEqual(extra.mode, 'full');
    assert.strictEqual(extra.reason, 'classification-paths-mismatch');

    const duplicate = createCiPlan({
      root, baseSha, headSha, checkoutSha: headSha, baseRef: 'develop',
      classification: classificationFor(['docs/guide.md', 'docs/guide.md'], baseSha, headSha, () => 'wording'),
    });
    assert.strictEqual(duplicate.mode, 'full');
    assert.strictEqual(duplicate.reason, 'classification-invalid');

    const invalidKind = createCiPlan({
      root, baseSha, headSha, checkoutSha: headSha, baseRef: 'develop',
      classification: classificationFor(['docs/guide.md'], baseSha, headSha, () => 'text-only'),
    });
    assert.strictEqual(invalidKind.mode, 'full');
    assert.strictEqual(invalidKind.reason, 'classification-invalid');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shared policy paths and declared unknown impact always retain full verification', () => {
  withChangedFiles(['docs/testing-governance.md'], (plan) => {
    assert.strictEqual(plan.mode, 'full');
    assert.strictEqual(plan.reason, 'shared-core-change');
  }, AVAILABLE_SUITES, () => 'wording');

  withChangedFiles(['docs/guide.md'], (plan) => {
    assert.strictEqual(plan.mode, 'full');
    assert.strictEqual(plan.reason, 'unknown-impact');
  }, AVAILABLE_SUITES, () => 'unknown');

  withChangedFiles(['docs/guide.md'], (plan) => {
    assert.strictEqual(plan.mode, 'full');
    assert.strictEqual(plan.reason, 'shared-core-change');
  }, AVAILABLE_SUITES, () => 'shared-core');
});

test('validate requires the complete planned surface set when preflight selection is requested', () => {
  withCiPlanCliFixture(({ plan, validate }) => {
    assert.deepStrictEqual(plan.packageSurfaces, ALL_PACKAGE_SURFACES);
    assertCliFailure(validate(['--surfaces', 'agent-plugin']), /selected package surfaces do not match the plan/);
  });
});

test('validate accepts repeated surface flags that match a full plan', () => {
  withCiPlanCliFixture(({ validate }) => {
    const flags = ALL_PACKAGE_SURFACES.flatMap((surface) => ['--surface', surface]);
    assertCliPass(validate([...flags, '--require-clean']));
  });
});

test('validate accepts comma-separated IDs through the singular surface option', () => {
  withCiPlanCliFixture(({ validate }) => {
    const surfaces = ALL_PACKAGE_SURFACES.join(',');
    assertCliPass(validate(['--surface', surfaces, '--require-clean']));
    assertCliPass(validate([`--surface=${surfaces}`, '--require-clean']));
  });
});

test('validate accepts a comma-separated surface list that matches a full plan', () => {
  withCiPlanCliFixture(({ validate }) => {
    assertCliPass(validate(['--surfaces', ALL_PACKAGE_SURFACES.join(','), '--require-clean']));
  });
});

test('validate accepts equals forms of surface selectors', () => {
  withCiPlanCliFixture(({ validate }) => {
    const flags = ALL_PACKAGE_SURFACES.map((surface) => `--surface=${surface}`);
    assertCliPass(validate([...flags, '--require-clean']));
    assertCliPass(validate([`--surfaces=${ALL_PACKAGE_SURFACES.join(',')}`, '--require-clean']));
  });
});

test('validate expands Cursor dependency closure when comparing selected and planned surfaces', () => {
  withCiPlanCliFixture(({ plan, validate }) => {
    assert.deepStrictEqual(plan.packageSurfaces, ALL_PACKAGE_SURFACES);
    assertCliPass(validate(['--surface', 'cursor-plugin', '--surface', 'codex-native', '--surface', 'agy-plugin', '--require-clean']));
  });
});

test('validate rejects unknown and empty package surface selectors', () => {
  withCiPlanCliFixture(({ validate }) => {
    assertCliFailure(validate(['--surface', 'not-a-package-surface']), /unknown package surface/);
    assertCliFailure(validate(['--surfaces', ',']), /unknown package surface/);
    assertCliFailure(validate(['--surface=']), /--surface requires a value/);
    assertCliFailure(validate(['--require-clean=false']), /--require-clean does not accept a value/);
  });
});

test('surface preflight reports an invalid plan without reading missing plan fields', () => {
  withCiPlanCliFixture(({ planPath, validate }) => {
    fs.writeFileSync(planPath, '{"schema":"dhpk.ci-plan.v1"}\n');
    const result = validate(['--surface', 'agent-plugin', '--require-clean']);
    assertCliFailure(result, /plan package surfaces are missing/);
    assert.doesNotMatch(result.stderr, /Cannot read properties of undefined/);
  });
});

test('validate preserves classification identity checks for stale plans', () => {
  withCiPlanCliFixture(({ classificationPath, validate }) => {
    const classification = JSON.parse(fs.readFileSync(classificationPath, 'utf8'));
    fs.writeFileSync(classificationPath, `${JSON.stringify({ ...classification, baseSha: 'stale-base' })}\n`);
    assertCliFailure(
      validate(['--surfaces', ALL_PACKAGE_SURFACES.join(','), '--require-clean']),
      /plan classification does not match the independently supplied classification/,
    );
  });
});

test('validate rejects a source plan after the checkout advances to a generated-output commit', () => {
  withCiPlanCliFixture(({ git, writeSource, validate }) => {
    writeSource('generated/package/marker.txt', 'generated output\n');
    git('add', '-A');
    git('commit', '--no-verify', '-qm', 'generated package output');
    assertCliFailure(
      validate(['--surfaces', ALL_PACKAGE_SURFACES.join(','), '--require-clean']),
      /checkout identity does not match git HEAD/,
    );
  });
});

test('validate with --require-clean rejects tracked and untracked source dirt', () => {
  withCiPlanCliFixture(({ writeSource, root, validate }) => {
    writeSource('scripts/ci/verify-platform-packages.js', 'local tracked edit\n');
    assertCliFailure(
      validate(['--surfaces', ALL_PACKAGE_SURFACES.join(','), '--require-clean']),
      /source checkout must be clean/,
    );

    writeSource('scripts/ci/verify-platform-packages.js', 'after\n');
    assertCliPass(validate(['--surfaces', ALL_PACKAGE_SURFACES.join(','), '--require-clean']));
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked evidence\n');
    assertCliFailure(
      validate(['--surfaces', ALL_PACKAGE_SURFACES.join(','), '--require-clean']),
      /source checkout must be clean/,
    );
  });
});

test('clean source validation passes with the required plan surfaces', () => {
  withCiPlanCliFixture(({ validate }) => {
    assertCliPass(validate(['--surfaces', ALL_PACKAGE_SURFACES.join(','), '--require-clean']));
  });
});

test('empty-surface light plans allow valid extra selected surfaces', () => {
  withCiPlanCliFixture(({ plan, validate }) => {
    assert.strictEqual(plan.mode, 'light');
    assert.deepStrictEqual(plan.packageSurfaces, []);
    assertCliPass(validate(['--surface', 'agent-plugin', '--require-clean']));
  }, ['skills/demo/SKILL.md'], () => 'wording');
});

test('plain validate retains its existing behavior without new preflight flags', () => {
  withCiPlanCliFixture(({ writeSource, validate }) => {
    writeSource('scripts/ci/verify-platform-packages.js', 'local tracked edit\n');
    assertCliPass(validate());
  });
});

test('surface and clean preflight flags are rejected outside validate', () => {
  withCiPlanCliFixture(({ baseSha, headSha, classificationPath, planPath, runCli }) => {
    const planArgs = [
      '--base-sha', baseSha, '--head-sha', headSha, '--checkout-sha', headSha,
      '--base-ref', 'develop', '--classification-file', classificationPath,
    ];
    const aggregateArgs = ['--plan', planPath, '--results', path.join(os.tmpdir(), 'missing-results.json')];
    for (const result of [
      runCli(['plan', ...planArgs, '--require-clean']),
      runCli(['plan', ...planArgs, '--surface', 'agent-plugin']),
      runCli(['plan', ...planArgs, '--surfaces=agent-plugin']),
      runCli(['aggregate', ...aggregateArgs, '--require-clean']),
      runCli(['aggregate', ...aggregateArgs, '--surfaces', 'agent-plugin']),
      runCli(['aggregate', ...aggregateArgs, '--require-clean=false']),
    ]) {
      assertCliFailure(result, /only supported by validate/);
    }
  });
});

run('ci-plan');
