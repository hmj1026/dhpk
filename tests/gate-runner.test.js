'use strict';

// Coverage for scripts/lib/gate-runner.js: runs a fixed list of shell steps,
// never stops early (every step's result is recorded for evidence), and
// composes a release-evidence-shaped stage object (verdict/commands/failureReasons).

const { test, run, assert } = require('./_lib/tinytest');
const { runSteps } = require('../scripts/lib/gate-runner');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('all steps passing yields verdict PASS with no failure reasons', () => {
  const stage = runSteps([
    { name: 'a', cmd: 'node', args: ['-e', 'process.exit(0)'] },
    { name: 'b', cmd: 'node', args: ['-e', 'process.exit(0)'] },
  ], { environment: 'test' });
  assert.strictEqual(stage.verdict, 'PASS');
  assert.deepStrictEqual(stage.commands, [
    { cmd: 'node -e process.exit(0)', exitCode: 0 },
    { cmd: 'node -e process.exit(0)', exitCode: 0 },
  ]);
  assert.deepStrictEqual(stage.failureReasons, []);
});

test('a failing step yields verdict FAIL and records the exit code', () => {
  const stage = runSteps([
    { name: 'a', cmd: 'node', args: ['-e', 'process.exit(0)'] },
    { name: 'b', cmd: 'node', args: ['-e', 'process.exit(1)'] },
  ], { environment: 'test' });
  assert.strictEqual(stage.verdict, 'FAIL');
  assert.deepStrictEqual(stage.commands.map((command) => command.exitCode), [0, 1]);
  assert.deepStrictEqual(stage.failureReasons, ['b: exited 1']);
});

test('every step runs even after an earlier one fails (full evidence, not fail-fast)', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-gate-runner-'));
  const marker = path.join(directory, 'second-step-ran');
  try {
    const stage = runSteps([
      { name: 'first', cmd: 'node', args: ['-e', 'process.exit(7)'] },
      { name: 'second', cmd: 'node', args: ['-e', "require('node:fs').writeFileSync(process.argv[1], 'ran')", marker] },
    ], { environment: 'test' });
    assert.deepStrictEqual(stage.commands.map((command) => command.exitCode), [7, 0]);
    assert.deepStrictEqual(stage.failureReasons, ['first: exited 7']);
    assert.strictEqual(stage.verdict, 'FAIL');
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'ran', 'later steps must run after an earlier failure');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('passes an explicit environment to every step', () => {
  const stage = runSteps([
    {
      name: 'environment',
      cmd: 'node',
      args: ['-e', "if (process.env.DHPK_GATE_RUNNER_TEST !== 'present') process.exit(1)"],
    },
  ], {
    environment: 'test',
    env: { ...process.env, DHPK_GATE_RUNNER_TEST: 'present' },
  });
  assert.strictEqual(stage.verdict, 'PASS');
});

test('merges per-step environment overrides without losing the gate environment', () => {
  const stage = runSteps([
    {
      name: 'environment',
      cmd: 'node',
      args: ['-e', "if (process.env.DHPK_GATE_RUNNER_TEST !== 'present' || process.env.DHPK_STEP_TEST !== 'present') process.exit(1)"],
      env: { DHPK_STEP_TEST: 'present' },
    },
  ], {
    environment: 'test',
    env: { ...process.env, DHPK_GATE_RUNNER_TEST: 'present' },
  });
  assert.strictEqual(stage.verdict, 'PASS');
});

{
  // Collected cases from tests/source-gate-cli.test.js.
  // CLI-level coverage for scripts/release/source-gate.js. Uses --steps-file
  // (test-only override) so the suite stays fast instead of shelling the real
  // heavy commands (tests/run-all.js, openspec validate) on every run — those
  // are exercised for real in RELEASE.md's checklist and task 5.3's full sweep.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const CLI = path.join(ROOT, 'scripts', 'release', 'source-gate.js');

  function withStepsFile(steps, callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-source-gate-'));
    try {
      const file = path.join(directory, 'steps.json');
      fs.writeFileSync(file, JSON.stringify(steps));
      return callback(file);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  function writeExecutable(file, contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }

  function mkLocalGateRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-source-gate-repo-'));
    const probe = path.join(root, 'worker-pool.txt');
    const scripts = path.join(root, 'scripts');
    fs.mkdirSync(path.join(scripts, 'ci'), { recursive: true });
    fs.mkdirSync(path.join(scripts, 'release'), { recursive: true });
    fs.writeFileSync(path.join(scripts, 'ci', 'validate-changelog-fragments.js'), '');
    fs.writeFileSync(path.join(scripts, 'release', 'prepare-release.js'), '');
    writeExecutable(
      path.join(scripts, 'ci', 'run-bounded-node-test.sh'),
      `#!/usr/bin/env node
  require('node:fs').writeFileSync(${JSON.stringify(probe)}, process.env.DHPK_TEST_JOBS || '');
  `
    );
    const bin = path.join(root, 'bin');
    writeExecutable(path.join(bin, 'openspec'), '#!/bin/sh\nexit 0\n');
    return { root, probe, bin };
  }

  function ciWorkerPool() {
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const match = workflow.match(/\n  tests:\n([\s\S]*?)(?=\n  [a-z][a-z0-9-]*:\n|$)/);
    assert.ok(match, 'CI must declare a tests matrix job');
    const workers = match[1].match(/DHPK_TEST_JOBS:\s*[\"']?(\d+)/);
    assert.ok(workers, 'CI must declare a worker-pool size for the tests matrix');
    return workers[1];
  }

  test('prints a PASS SOURCE stage as JSON when every step succeeds', () => {
    withStepsFile([{ name: 'ok', cmd: process.execPath, args: ['-e', 'process.exit(0)'] }], (stepsFile) => {
      const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8' });
      assert.strictEqual(res.status, 0, res.stderr);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.verdict, 'PASS');
      assert.deepStrictEqual(stage.commands, [{ cmd: `${process.execPath} -e process.exit(0)`, exitCode: 0 }]);
      assert.strictEqual(stage.environment, process.env.CI ? 'ci' : process.platform === 'darwin' ? 'local-portable' : 'local');
      assert.deepStrictEqual(stage.failureReasons, []);
    });
  });

  test('exits non-zero and reports failureReasons when a step fails', () => {
    withStepsFile([{ name: 'boom', cmd: process.execPath, args: ['-e', 'process.exit(1)'] }], (stepsFile) => {
      const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8' });
      assert.strictEqual(res.status, 1);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.verdict, 'FAIL');
      assert.deepStrictEqual(stage.commands, [{ cmd: `${process.execPath} -e process.exit(1)`, exitCode: 1 }]);
      assert.deepStrictEqual(stage.failureReasons, ['boom: exited 1']);
    });
  });

  test('inherits CI-owned strict cgroup policy for source-gate steps', () => {
    withStepsFile([{
      name: 'policy',
      cmd: process.execPath,
      args: ['-e', "if (process.env.DHPK_BOUNDED_REQUIRE_CGROUP !== '1' || process.env.DHPK_BOUNDED_ALLOW_FALLBACK !== '0') process.exit(1)"],
    }], (stepsFile) => {
      const env = {
        ...process.env,
        CI: 'true',
        DHPK_BOUNDED_REQUIRE_CGROUP: '1',
        DHPK_BOUNDED_ALLOW_FALLBACK: '0',
        DHPK_RELEASE_TARGET_BRANCH: 'main',
      };
      const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
      assert.strictEqual(res.status, 0, res.stderr);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.environment, 'ci');
      assert.deepStrictEqual(stage.failureReasons, []);
      assert.strictEqual(stage.commands[0].exitCode, 0);
    });
  });

  test('does not leak the release target context into generic source-gate steps', () => {
    withStepsFile([{
      name: 'policy',
      cmd: process.execPath,
      args: ['-e', "if (process.env.DHPK_RELEASE_TARGET_BRANCH) process.exit(1)"],
    }], (stepsFile) => {
      const env = { ...process.env, DHPK_RELEASE_TARGET_BRANCH: 'main' };
      delete env.CI;
      const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
      assert.strictEqual(res.status, 0, res.stderr);
      const stage = JSON.parse(res.stdout);
      assert.deepStrictEqual(stage.failureReasons, []);
      assert.strictEqual(stage.commands[0].exitCode, 0);
    });
  });

  test('uses the portable policy for local macOS source-gate steps', () => {
    withStepsFile([{
      name: 'policy',
      cmd: process.execPath,
      args: ['-e', "if (process.platform === 'darwin' && (process.env.DHPK_BOUNDED_REQUIRE_CGROUP !== '0' || process.env.DHPK_BOUNDED_ALLOW_FALLBACK !== '1')) process.exit(1)"],
    }], (stepsFile) => {
      const env = { ...process.env, DHPK_BOUNDED_REQUIRE_CGROUP: '1', DHPK_BOUNDED_ALLOW_FALLBACK: '0' };
      delete env.CI;
      const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
      assert.strictEqual(res.status, 0, res.stderr);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.environment, process.platform === 'darwin' ? 'local-portable' : 'local');
      assert.deepStrictEqual(stage.failureReasons, []);
      assert.strictEqual(stage.commands[0].exitCode, 0);
    });
  });

  test('local source gate uses the same worker pool as the CI Tests stage', () => {
    const fixture = mkLocalGateRepo();
    const env = {
      ...process.env,
      PATH: [fixture.bin, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
    };
    delete env.CI;
    delete env.DHPK_TEST_JOBS;
    delete env.DHPK_RELEASE_TARGET_BRANCH;

    try {
      const res = spawnSync(process.execPath, [
        CLI,
        '--version', '1.0.0',
        '--repo-root', fixture.root,
      ], { encoding: 'utf8', env });
      assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.verdict, 'PASS');
      assert.strictEqual(stage.commands.length, 4, 'source gate must execute all four default stages');
      assert.deepStrictEqual(stage.commands.map((command) => command.exitCode), [0, 0, 0, 0]);
      assert.deepStrictEqual(stage.failureReasons, []);
      assert.ok(stage.commands[0].cmd.includes('validate-changelog-fragments.js'));
      assert.ok(stage.commands[1].cmd.includes('prepare-release.js'));
      assert.ok(stage.commands[2].cmd.includes('run-bounded-node-test.sh'));
      assert.ok(stage.commands[3].cmd.includes('openspec'));

      const observed = fs.readFileSync(fixture.probe, 'utf8');
      assert.strictEqual(observed, ciWorkerPool());
      assert.strictEqual(observed, '4');
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

{
  // Collected cases from tests/package-gate-cli.test.js.
  // CLI-level coverage for scripts/release/package-gate.js. Uses --steps-file
  // (test-only override, same pattern as the collected source-gate cases) so the suite
  // stays fast instead of shelling the real staged-package/install-smoke steps
  // on every run.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const CLI = path.join(ROOT, 'scripts', 'release', 'package-gate.js');

  function mkStepsFile(steps, callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-package-gate-'));
    try {
      const file = path.join(directory, 'steps.json');
      fs.writeFileSync(file, JSON.stringify(steps));
      return callback(file);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  test('prints a PASS PACKAGE stage as JSON when every step succeeds', () => {
    mkStepsFile([{ name: 'ok', cmd: 'node', args: ['-e', 'process.exit(0)'] }], (stepsFile) => {
      const res = spawnSync('node', [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8' });
      assert.strictEqual(res.status, 0, res.stderr);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.verdict, 'PASS');
    });
  });

  test('exits non-zero and reports failureReasons when a step fails', () => {
    mkStepsFile([{ name: 'boom', cmd: 'node', args: ['-e', 'process.exit(1)'] }], (stepsFile) => {
      const res = spawnSync('node', [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8' });
      assert.notStrictEqual(res.status, 0);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.verdict, 'FAIL');
      assert.ok(stage.failureReasons.some((r) => r.includes('boom')));
    });
  });

  test('default package gate reports shared-copy drift before package checks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-package-copy-gate-'));
    try {
      fs.mkdirSync(path.join(root, 'scripts', 'ci'), { recursive: true });
      fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
      for (const name of ['validate-plugin', 'gen-claude-marketplace-package',
        'validate-distribution', 'verify-staged-package-version',
        'validate-cursor-sync', 'verify-platform-packages']) {
        fs.writeFileSync(path.join(root, 'scripts', 'ci', `${name}.js`), 'process.exit(0);\n');
      }
      fs.writeFileSync(path.join(root, 'bin', 'dhpk'), '#!/bin/sh\nexit 0\n');
      fs.writeFileSync(path.join(root, 'scripts', 'ci', 'sync-skill-resources.js'),
        'if (process.argv[2] !== "--check") process.exit(2);\nconsole.error("stale managed copy");\nprocess.exit(1);\n');
      const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--repo-root', root], {
        encoding: 'utf8', timeout: 10000,
      });
      assert.strictEqual(res.status, 1, res.stderr);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.verdict, 'FAIL');
      assert.match(stage.commands[0].cmd, /sync-skill-resources\.js --check$/);
      assert.strictEqual(stage.commands[0].exitCode, 1);
      assert.ok(stage.failureReasons.some((reason) => /skill-resource-copies.*stale managed copy/.test(reason)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

{
  // Collected cases from tests/publish-gate-cli.test.js.
  // CLI-level coverage for scripts/release/publish-gate.js: the task-3.4
  // mechanism that blocks tag/publication preparation unless SOURCE and
  // PACKAGE both PASS. Uses --source-gate-json/--package-gate-json (test-only
  // overrides) to inject pre-baked stage JSON instead of spawning the real
  // (heavy) source-gate.js/package-gate.js — those are covered by their own
  // CLI test files.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const CLI = path.join(ROOT, 'scripts', 'release', 'publish-gate.js');

  function withStageFiles(stages, callback) {
    const roots = [];
    try {
      const files = stages.map((stage) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publish-gate-'));
        roots.push(root);
        const file = path.join(root, 'stage.json');
        fs.writeFileSync(file, JSON.stringify(stage));
        return file;
      });
      return callback(files);
    } finally {
      for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    }
  }

  function passStage() {
    return { verdict: 'PASS', commands: [], environment: 'test', artifacts: [], failureReasons: [] };
  }

  function failStage(reason) {
    return { verdict: 'FAIL', commands: [], environment: 'test', artifacts: [], failureReasons: [reason] };
  }

  function mkPublishRepo() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publish-gate-repo-')));
    const releaseDir = path.join(root, 'scripts', 'release');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'source-gate.js'), [
      '#!/usr/bin/env node',
      "const pass = process.env.DHPK_RELEASE_TARGET_BRANCH === 'main';",
      'const stage = { verdict: pass ? \'PASS\' : \'FAIL\', commands: [], environment: \'test\', artifacts: [], failureReasons: pass ? [] : [\'missing publish target context\'] };',
      'console.log(JSON.stringify(stage));',
      'process.exit(pass ? 0 : 1);',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(releaseDir, 'package-gate.js'), [
      '#!/usr/bin/env node',
      "console.log(JSON.stringify({ verdict: 'PASS', commands: [], environment: 'test', artifacts: [], failureReasons: [] }));",
      '',
    ].join('\n'));
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    spawnSync('git', ['checkout', '-q', '-b', 'main'], { cwd: root });
    spawnSync('git', ['tag', 'baseline-v1'], { cwd: root });
    return root;
  }

  function gitState(root) {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    const tags = spawnSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(head.status, 0, head.stderr);
    assert.strictEqual(tags.status, 0, tags.stderr);
    return { head: head.stdout.trim(), tags: tags.stdout.trim() };
  }

  test('allows publication when SOURCE and PACKAGE both PASS', () => {
    withStageFiles([passStage(), passStage()], ([sourceFile, packageFile]) => {
      const res = spawnSync('node', [
        CLI, '--version', '1.0.0',
        '--source-gate-json', sourceFile,
        '--package-gate-json', packageFile,
      ], { encoding: 'utf8' });
      assert.strictEqual(res.status, 0, res.stderr);
      const evidence = JSON.parse(res.stdout);
      assert.strictEqual(evidence.overall, 'PUBLISHED_PENDING');
      assert.strictEqual(evidence.stages.CONSUMER.verdict, 'PENDING');
    });
  });

  test('passes target branch context without mutating refs or publishing', () => {
    const source = fs.readFileSync(CLI, 'utf8');
    assert.ok(!source.includes('git tag'), 'publish-gate must never create a tag itself');
    assert.ok(!source.includes('git push'), 'publish-gate must never push anything itself');
    assert.ok(!source.includes('gh pr merge') && !source.includes('pr merge'), 'publish-gate must never merge a PR itself');

    const repo = mkPublishRepo();
    try {
      const before = gitState(repo);
      const res = spawnSync('node', [CLI, '--version', '1.0.0', '--repo-root', repo], { encoding: 'utf8' });
      assert.strictEqual(res.status, 0, res.stderr);
      const evidence = JSON.parse(res.stdout);
      assert.strictEqual(evidence.stages.SOURCE.verdict, 'PASS');
      assert.strictEqual(evidence.stages.PACKAGE.verdict, 'PASS');
      assert.deepStrictEqual(gitState(repo), before);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('blocks publication when PACKAGE fails, even though SOURCE passes', () => {
    withStageFiles([passStage(), failStage('staged package missing declared asset')], ([sourceFile, packageFile]) => {
      const res = spawnSync('node', [
        CLI, '--version', '1.0.0',
        '--source-gate-json', sourceFile,
        '--package-gate-json', packageFile,
      ], { encoding: 'utf8' });
      assert.notStrictEqual(res.status, 0);
      const evidence = JSON.parse(res.stdout);
      assert.strictEqual(evidence.overall, 'BLOCKED');
      assert.strictEqual(evidence.stages.SOURCE.verdict, 'PASS');
      assert.strictEqual(evidence.stages.PACKAGE.verdict, 'FAIL');
    });
  });

  test('blocks publication when SOURCE fails', () => {
    withStageFiles([failStage('tests/run-all.js failed'), passStage()], ([sourceFile, packageFile]) => {
      const res = spawnSync('node', [
        CLI, '--version', '1.0.0',
        '--source-gate-json', sourceFile,
        '--package-gate-json', packageFile,
      ], { encoding: 'utf8' });
      assert.notStrictEqual(res.status, 0);
      const evidence = JSON.parse(res.stdout);
      assert.strictEqual(evidence.overall, 'BLOCKED');
    });
  });
}

run('gate-runner');
