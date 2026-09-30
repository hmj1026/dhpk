'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { parseArgs, namespaceFor } = require('../scripts/release/parallel-consumer-probes');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'parallel-consumer-probes.js');

test('parallel consumer coordinator requires canonical surfaces and bounds concurrency', () => {
  const args = parseArgs([
    '--repo-root', '/tmp/dhpk',
    '--surfaces', 'claude-core,codex-sync',
    '--concurrency', '99',
    '--timeout-ms', '1000',
    '--task-id', 'release-test',
    '--attempt-id', 'attempt-test',
  ]);
  assert.strictEqual(args.concurrency, 7);
  assert.strictEqual(args.timeoutMs, 1000);
  assert.match(namespaceFor(args, 'claude-core', 0), /^dhpk-release-probe-release-test-attempt-test-claude-core-0$/);
  assert.throws(() => parseArgs(['--repo-root', '/tmp/dhpk', '--surfaces', 'unknown']), /canonical/);
});

test('coordinator runs isolated child probes and reports each surface result', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parallel-probe-coordinator-'));
  const preload = path.join(root, 'probe-harness.js');
  const surfaces = ['claude-core', 'codex-sync'];
  const originalNodeOptions = process.env.NODE_OPTIONS || '';
  const hostPaths = {
    home: path.join(root, 'host-home'),
    profile: path.join(root, 'host-profile'),
    codex: path.join(root, 'host-codex'),
    cursor: path.join(root, 'host-cursor'),
    agy: path.join(root, 'host-agy'),
  };

  fs.writeFileSync(preload, [
    "'use strict';",
    "const Module = require('node:module');",
    "const fs = require('node:fs');",
    'const cli = process.env.DHPK_PARALLEL_PROBE_CLI;',
    'const originalLoad = Module._load;',
    'Module._load = function loadWithControlledConsumerProbe(request, parent, isMain) {',
    "  if (request === '../lib/harness' && parent && parent.filename === cli) {",
    '    return {',
    '      runConsumerProbe(repoRoot, { surface }) {',
    '        return {',
    "          outcome: 'PASS',",
    '          probeEnvironment: {',
    '            repoRoot, surface,',
    '            namespace: process.env.DHPK_HARNESS_PROBE_NAMESPACE,',
    '            receiptRoot: process.env.DHPK_HARNESS_RECEIPT_ROOT,',
    '            receiptRootExists: fs.existsSync(process.env.DHPK_HARNESS_RECEIPT_ROOT),',
    '            taskId: process.env.DHPK_HARNESS_PROBE_TASK_ID,',
    '            attemptId: process.env.DHPK_HARNESS_PROBE_ATTEMPT_ID,',
    '            home: process.env.HOME,',
    '            homeExists: fs.existsSync(process.env.HOME),',
    '            userProfile: process.env.USERPROFILE,',
    '            xdgConfig: process.env.XDG_CONFIG_HOME,',
    '            xdgData: process.env.XDG_DATA_HOME,',
    '            xdgCache: process.env.XDG_CACHE_HOME,',
    '            codexHome: process.env.CODEX_HOME,',
    '            hostCodexHome: process.env.DHPK_CONSUMER_PROBE_HOST_CODEX_HOME,',
    '            cursorHostHome: process.env.DHPK_CURSOR_HOST_HOME,',
    '            agyHostHome: process.env.DHPK_AGY_HOST_HOME,',
    '          },',
    '        };',
    '      },',
    '    };',
    '  }',
    '  return originalLoad.call(this, request, parent, isMain);',
    '};',
    '',
  ].join('\n'));

  try {
    const res = spawnSync(process.execPath, [
      CLI,
      '--repo-root', root,
      '--surfaces', surfaces.join(','),
      '--concurrency', '2',
      '--timeout-ms', '3000',
      '--task-id', 'issue-660',
      '--attempt-id', 'attempt-a1',
    ], {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        NODE_OPTIONS: `${originalNodeOptions} --require "${preload}"`.trim(),
        DHPK_PARALLEL_PROBE_CLI: CLI,
        HOME: hostPaths.home,
        USERPROFILE: hostPaths.profile,
        CODEX_HOME: hostPaths.codex,
        DHPK_CURSOR_HOST_HOME: hostPaths.cursor,
        DHPK_AGY_HOST_HOME: hostPaths.agy,
      },
    });
    assert.strictEqual(res.status, 0, res.stderr);

    const batch = JSON.parse(res.stdout);
    assert.strictEqual(batch.schema, 'dhpk.release-consumer-probe-batch.v1');
    assert.strictEqual(batch.concurrency, 2);
    assert.strictEqual(batch.timeoutMs, 3000);
    assert.deepStrictEqual(batch.surfaces, surfaces);
    assert.strictEqual(batch.results.length, surfaces.length);

    const bySurface = new Map(batch.results.map((result) => [result.surface, result]));
    assert.deepStrictEqual([...bySurface.keys()].sort(), [...surfaces].sort());
    const namespaces = new Set();
    for (const surface of surfaces) {
      const result = bySurface.get(surface);
      const env = result.execution.probeEnvironment;
      assert.strictEqual(result.execution.outcome, 'PASS');
      assert.strictEqual(result.diagnostic, null);
      assert.match(result.namespace, new RegExp(`^dhpk-release-probe-issue-660-attempt-a1-${surface}-\\d+$`));
      assert.strictEqual(env.repoRoot, root);
      assert.strictEqual(env.surface, surface);
      assert.strictEqual(env.namespace, result.namespace);
      assert.strictEqual(env.taskId, 'issue-660');
      assert.strictEqual(env.attemptId, 'attempt-a1');
      assert.ok(env.receiptRoot.includes(`${path.sep}${result.namespace}${path.sep}receipts`));
      assert.ok(env.home.includes(`${path.sep}${result.namespace}${path.sep}home`));
      assert.strictEqual(env.homeExists, true, 'private worker home must exist while the child runs');
      assert.strictEqual(env.receiptRootExists, true, 'private receipt root must exist while the child runs');
      assert.strictEqual(env.userProfile, env.home);
      assert.ok(env.xdgConfig.startsWith(env.home));
      assert.ok(env.xdgData.startsWith(env.home));
      assert.ok(env.xdgCache.startsWith(env.home));
      assert.ok(env.codexHome.startsWith(env.home));
      assert.strictEqual(env.hostCodexHome, hostPaths.codex);
      assert.strictEqual(env.cursorHostHome, hostPaths.cursor);
      assert.strictEqual(env.agyHostHome, hostPaths.agy);
      assert.ok(!fs.existsSync(env.home), 'private worker home must be removed after aggregation');
      assert.ok(!fs.existsSync(env.receiptRoot), 'private receipt root must be removed after aggregation');
      namespaces.add(result.namespace);
    }
    assert.strictEqual(namespaces.size, surfaces.length, 'each surface must receive a distinct namespace');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});



// Consolidated source suite: release-probe-batch (tests/release-probe-batch.test.js).
{
  const { mapWithConcurrency, normalizeConcurrency } = require('../scripts/lib/release-probe-batch');

  test('bounded probe batch preserves order and caps live workers', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency(['a', 'b', 'c', 'd', 'e'], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value === 'a' ? 12 : 4));
      active -= 1;
      return value.toUpperCase();
    });
    assert.deepStrictEqual(result, ['A', 'B', 'C', 'D', 'E']);
    assert.strictEqual(peak, 2);
  });

  test('bounded probe concurrency is clamped to the configured maximum', () => {
    assert.strictEqual(normalizeConcurrency(99, { maximum: 4 }), 4);
    assert.throws(() => normalizeConcurrency(0), /positive integer/);
  });
}

run('parallel-consumer-probes');
