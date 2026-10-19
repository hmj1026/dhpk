'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { createCiPlan } = require('../scripts/lib/ci-plan');

const SMOKE_SUITE = 'skill-script-operability.test.js';
const RESOURCE_SUITES = [
  'modules.test.js', 'run-agy.test.js', 'run-codex.test.js',
  'run-cli-transport.test.js', 'cli-dispatch-launcher.test.js',
  'cli-role-resolver.test.js', 'flow-drive-cli-dispatch.test.js',
  'flow-drive-relocation.test.js', 'skill-resource-sync-security.test.js',
  'skill-runtime-path-contract.test.js',
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

function withChangedFiles(files, check, suites = AVAILABLE_SUITES) {
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
    check(createCiPlan({ root, baseSha, headSha, checkoutSha: headSha, baseRef: 'develop' }));
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

for (const file of [
  'skills/flow-drive/scripts/dispatch.js',
  'skills/flow-drive/scripts/task-contract.js',
  'skills/flow-drive/scripts/graph-runner.js',
  'skills/flow-drive/scripts/target-policy.js',
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
  'flow-drive': ['invocation.js', 'launch-dispatch.js'],
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
  'skills/flow-drive/scripts/new-cli.js',
  'skills/new-skill/scripts/launch-dispatch.js',
  'skills/flow-drive/scripts/nested/launch-dispatch.js',
  'skills/flow-drive/scripts/launch-dispatch.js.backup',
]) {
  test(`unrecognized script changes fail closed: ${file}`, () => {
    withChangedFiles([file], assertFullPlan);
  });
}

test('mixed CLI and internal changes retain the complete test plan', () => {
  withChangedFiles([
    'skills/flow-drive/scripts/launch-dispatch.js',
    'skills/flow-drive/scripts/dispatch.js',
  ], assertFullPlan);
});

for (const file of [
  'skills/flow-drive/scripts/adapters/run-agy.sh',
  'skills/flow-drive/scripts/transport/run-cli-transport.py',
  'skills/flow-drive/scripts/dispatch-runtime/build-cli-dispatch-context.js',
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
  withChangedFiles(['skills/flow-drive/scripts/launch-dispatch.js'], (plan) => {
    assert.strictEqual(plan.mode, 'full');
    assert.strictEqual(plan.shardCount, 4);
    assert.deepStrictEqual(plan.testFiles, ['utils.test.js']);
  }, ['utils.test.js']);
});

run('ci-plan');
