'use strict';

// RED-first tests for harness-facade-receipt-contract task 1.1.
// These tests exercise the public result/parser seam, not private helpers.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const harness = require('../scripts/lib/harness');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dhpk');

function invoke(args) {
  return spawnSync('bash', [CLI, 'harness', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('parses one supported phase and preserves the invocation context', () => {
  const parsed = harness.parseArgs(['preflight', '--json', '--task-id', 'task-1']);
  assert.deepStrictEqual(parsed, {
    phase: 'preflight',
    json: true,
    taskId: 'task-1',
  });
});

test('rejects unknown phases and options with usage status', () => {
  assert.throws(() => harness.parseArgs(['unknown']), /phase|usage|unknown/i);
  assert.throws(() => harness.parseArgs(['preflight', '--unknown']), /option|usage|unknown/i);
  assert.strictEqual(harness.exitCodeForOutcome('PASS'), 0);
  assert.strictEqual(harness.exitCodeForOutcome('FAIL'), 1);
  assert.strictEqual(harness.exitCodeForOutcome('NOT_RUN'), 2);
  assert.strictEqual(harness.exitCodeForOutcome('USAGE'), 64);
  assert.strictEqual(harness.exitCodeForOutcome('INTERNAL_ERROR'), 70);
});

test('requires an explicit surface for distribution adapter phases', () => {
  for (const phase of ['generate', 'validate', 'verify']) {
    assert.throws(() => harness.parseArgs([phase, '--json']), /surface|required/i);
  }
  assert.deepStrictEqual(harness.parseArgs(['generate', '--surface', 'agent-plugin']), {
    phase: 'generate',
    surface: 'agent-plugin',
  });
});

test('CLI exposes the harness help contract', () => {
  const result = invoke(['--help']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /preflight/);
  assert.match(result.stdout, /release/);
});

// Consolidated source suite: harness-docs.
{

  // Contract checks for the public harness documentation. The document is the
  // user-facing compatibility boundary; keep the assertions narrow so wording
  // can evolve without duplicating the implementation.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const DOC = path.join(ROOT, 'docs', 'harness-workflow.md');

  test('documents the stable facade phases, outcomes, exits, and receipt boundary', () => {
    assert.strictEqual(fs.existsSync(DOC), true);
    const content = fs.readFileSync(DOC, 'utf8');
    const phaseOrder = content.match(/Release-capable work follows this order:\s*```text\s*([^`]+)```/);
    assert.ok(phaseOrder, 'workflow must publish the ordered release phases');
    assert.deepStrictEqual(phaseOrder[1].trim().split(/\s*->\s*/), [
      'preflight', 'plan', 'generate', 'validate', 'test', 'probe', 'verify', 'release',
    ]);

    const rows = new Map([...content.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)]
      .map((match) => [match[1].replace(/`/g, '').trim(), match[3].trim()]));
    assert.strictEqual(rows.get('PASS, COMPLETE'), '0');
    assert.strictEqual(rows.get('FAIL'), '1');
    assert.strictEqual(
      rows.get('BLOCKED, NOT_RUN, NOT_CONFIGURED, SKIP_INCOMPATIBLE, UNAVAILABLE, NO_SHIP, PARTIAL, PUBLISHED_PENDING, PUBLISHED_UNHEALTHY, OVERRIDDEN'),
      '2',
    );
    assert.strictEqual(rows.get('invalid usage'), '64');
    assert.strictEqual(rows.get('unexpected harness error'), '70');
    assert.match(content, /dhpk\.harness\.receipt\.v1/);
    assert.match(content, /structural|package/i);
    assert.match(content, /runtime|consumer/i);
  });

  test('documentation links resolve to repository files', () => {
    const content = fs.readFileSync(DOC, 'utf8');
    const links = [...content.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
    const localMarkdownLinks = links.filter((link) =>
      !/^(?:https?:|mailto:)/.test(link) && /\.md$/i.test(link));
    assert.ok(localMarkdownLinks.length > 0, 'workflow documentation must include a local Markdown link');
    for (const link of links) {
      if (/^(?:https?:|mailto:)/.test(link)) continue;
      assert.strictEqual(fs.existsSync(path.resolve(path.dirname(DOC), link)), true, `broken link: ${link}`);
    }
  });
}


// Consolidated source suite: harness-release-aggregation.
{

  // RED-first tests for harness-facade-receipt-contract task 1.3.

  const { test, assert } = require('./_lib/tinytest');
  const harnessResult = require('../scripts/lib/harness-result');
  const harness = require('../scripts/lib/harness');

  const REQUIRED = [
    'claude-core',
    'codex-sync',
    'codex-native',
    'cursor-sync',
    'cursor-plugin',
    'agent-plugin',
    'agy-plugin',
  ];
  const REQUIRED_RUNTIME = [
    'claude-core',
    'codex-sync',
    'codex-native',
    'cursor-plugin',
    'agent-plugin',
    'agy-plugin',
  ];

  function all(status = 'PASS') {
    return REQUIRED.map((surface) => ({ surface, status }));
  }

  test('full-release aggregation requires exactly the seven canonical surfaces', () => {
    assert.deepStrictEqual(harnessResult.REQUIRED_SURFACES, REQUIRED);
    const result = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      surfaceResults: all(),
      fullRelease: true,
    });
    assert.strictEqual(result.outcome, 'COMPLETE');
    assert.strictEqual(harness.lifecyclePhaseForOutcome(result.outcome), 'COMPLETE');
  });

  test('unavailable and failed surfaces remain non-complete', () => {
    const pending = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      surfaceResults: all().map((entry) => entry.surface === 'cursor-plugin'
        ? { ...entry, status: 'UNAVAILABLE' }
        : entry),
      fullRelease: true,
    });
    assert.strictEqual(pending.outcome, 'PUBLISHED_PENDING');

    const unhealthy = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      surfaceResults: all().map((entry) => entry.surface === 'agy-plugin'
        ? { ...entry, status: 'FAIL' }
        : entry),
      fullRelease: true,
    });
    assert.strictEqual(unhealthy.outcome, 'PUBLISHED_UNHEALTHY');
  });

  test('full release ignores cursor-sync NOT_RUN for COMPLETE but retains its identity row', () => {
    const result = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      requiredRuntimeSurfaces: REQUIRED_RUNTIME,
      surfaceResults: all().map((entry) => entry.surface === 'cursor-sync'
        ? { ...entry, status: 'NOT_RUN' }
        : entry),
      fullRelease: true,
    });
    assert.strictEqual(result.outcome, 'COMPLETE');
    assert.deepStrictEqual(result.requiredRuntimeSurfaces, REQUIRED_RUNTIME);
    assert.deepStrictEqual(result.surfaceResults.map((entry) => entry.surface), REQUIRED);
  });

  test('full release keeps cursor-sync FAIL unhealthy even outside the runtime list', () => {
    const result = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      requiredRuntimeSurfaces: REQUIRED_RUNTIME,
      surfaceResults: all().map((entry) => entry.surface === 'cursor-sync'
        ? { ...entry, status: 'FAIL' }
        : entry),
      fullRelease: true,
    });
    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
  });

  test('full-release aggregation rejects a non-canonical required runtime subset', () => {
    assert.throws(() => harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      requiredRuntimeSurfaces: ['claude-core'],
      surfaceResults: all(),
      fullRelease: true,
    }), /runtime|required|canonical/i);
  });

  test('release execution invokes each required consumer probe and preserves its evidence', () => {
    const calls = [];
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => {
      calls.push({ root, surface: parsed.surface });
      return {
        outcome: parsed.surface === 'cursor-plugin' ? 'UNAVAILABLE' : 'PASS',
        surfaceResults: [{
          surface: parsed.surface,
          status: parsed.surface === 'cursor-plugin' ? 'UNAVAILABLE' : 'PASS',
          stage: 'CONSUMER',
          producer: 'fixture-probe',
        }],
      };
    });

    assert.deepStrictEqual(calls, REQUIRED.map((surface) => ({
      root: '/tmp/dhpk-release-fixture',
      surface,
    })));
    assert.strictEqual(result.outcome, 'PUBLISHED_PENDING');
    assert.deepStrictEqual(result.surfaceResults.map((entry) => entry.surface), REQUIRED);
    assert.ok(result.surfaceResults.every((entry) => entry.stage === 'CONSUMER'));
    assert.ok(result.surfaceResults.every((entry) => entry.producer === 'fixture-probe'));
  });

  test('release execution aggregates the explicit runtime list separately from identity rows', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, REQUIRED_RUNTIME, (root, parsed) => ({
      outcome: parsed.surface === 'cursor-sync' ? 'NOT_RUN' : 'PASS',
      surfaceResults: [{
        surface: parsed.surface,
        status: parsed.surface === 'cursor-sync' ? 'NOT_RUN' : 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }));
    assert.strictEqual(result.outcome, 'COMPLETE');
    assert.deepStrictEqual(result.requiredRuntimeSurfaces, REQUIRED_RUNTIME);
    assert.deepStrictEqual(result.surfaceResults.map((entry) => entry.surface), REQUIRED);
  });

  test('release execution carries the trusted artifact binding onto matching package rows', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, REQUIRED_RUNTIME, (root, parsed) => ({
      outcome: 'PASS',
      surfaceResults: [{
        surface: parsed.surface,
        status: 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }), {
      artifactManifest: {
        manifestFingerprint: 'sha256:' + 'a'.repeat(64),
        packages: [{ surface: 'codex-native', bindingFingerprint: 'sha256:' + 'b'.repeat(64) }],
      },
    });
    const native = result.surfaceResults.find((entry) => entry.surface === 'codex-native');
    assert.strictEqual(native.artifactBinding.bindingFingerprint, 'sha256:' + 'b'.repeat(64));
    assert.strictEqual(result.artifactManifestFingerprint, 'sha256:' + 'a'.repeat(64));
  });

  test('release execution rejects a non-canonical required runtime subset before COMPLETE', () => {
    assert.throws(() => harness.runReleaseProbes(
      '/tmp/dhpk-release-fixture',
      REQUIRED,
      ['claude-core'],
      (root, parsed) => ({
        outcome: 'PASS',
        surfaceResults: [{
          surface: parsed.surface,
          status: 'PASS',
          stage: 'CONSUMER',
          producer: 'fixture-probe',
        }],
      }),
    ), /runtime|required|canonical/i);
  });

  test('release execution fails closed when a probe emits malformed consumer evidence', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => ({
      surfaceResults: [{
        surface: parsed.surface,
        status: parsed.surface === 'cursor-plugin' ? 'UNKNOWN' : 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }));

    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
    const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
    assert.strictEqual(malformed.status, 'FAIL');
    assert.match(malformed.reasons.join('\n'), /invalid status/i);
  });

  test('release execution rejects foreign rows and conflicting producer outcomes', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => {
      if (parsed.surface !== 'cursor-plugin') {
        return {
          outcome: 'PASS',
          surfaceResults: [{
            surface: parsed.surface,
            status: 'PASS',
            stage: 'CONSUMER',
            producer: 'fixture-probe',
          }],
        };
      }
      return {
        outcome: 'FAIL',
        surfaceResults: [
          { surface: 'cursor-plugin', status: 'PASS', stage: 'CONSUMER', producer: 'fixture-probe' },
          { surface: 'agent-plugin', status: 'FAIL', stage: 'CONSUMER', producer: 'fixture-probe' },
        ],
      };
    });

    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
    const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
    assert.strictEqual(malformed.status, 'FAIL');
    assert.match(malformed.reasons.join('\n'), /exactly one|foreign|result/i);
  });

  test('release execution rejects missing top-level probe outcomes', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => ({
      surfaceResults: [{
        surface: parsed.surface,
        status: 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }));

    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
    const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
    assert.strictEqual(malformed.status, 'FAIL');
    assert.match(malformed.reasons.join('\n'), /outcome/i);
  });

  test('release execution rejects a conflicting top-level probe outcome', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => ({
      outcome: 'FAIL',
      surfaceResults: [{
        surface: parsed.surface,
        status: 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }));

    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
    const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
    assert.strictEqual(malformed.status, 'FAIL');
    assert.match(malformed.reasons.join('\n'), /disagrees|outcome/i);
  });

  test('missing or unknown required surfaces fail closed', () => {
    assert.throws(() => harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED.slice(0, -1),
      surfaceResults: all(),
      fullRelease: true,
    }), /required|surface|incomplete/i);
    assert.throws(() => harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: [...REQUIRED, 'unknown-surface'],
      surfaceResults: all(),
      fullRelease: true,
    }), /required|surface|unknown/i);
  });

  test('lifecycle phase and command outcome remain separate', () => {
    const result = harnessResult.createResult({ phase: 'verify', lifecyclePhase: 'RED', outcome: 'NOT_RUN' });
    assert.strictEqual(result.lifecyclePhase, 'RED');
    assert.strictEqual(result.outcome, 'NOT_RUN');
    assert.strictEqual(harnessResult.exitCodeForOutcome(result.outcome), 2);
  });
}


// Consolidated source suite: harness-surfaces.
{

  const { test, assert } = require('./_lib/tinytest');
  const { REQUIRED_SURFACES } = require('../scripts/lib/harness-surfaces');

  test('full-release surface identity has one canonical ordered list', () => {
    assert.deepStrictEqual(REQUIRED_SURFACES, [
      'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
      'cursor-plugin', 'agent-plugin', 'agy-plugin',
    ]);
    assert.strictEqual(Object.isFrozen(REQUIRED_SURFACES), true);
  });
}


// Consolidated source suite: harness-workflow-config.
{

  // RED-first guard for the migration boundary: CI/release invoke the public
  // facade while retaining the legacy distribution compatibility checks.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  function read(relative) {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
  }

  function jobBlock(workflow, id) {
    const start = workflow.indexOf('\n  ' + id + ':\n');
    assert.ok(start !== -1, 'ci.yml must define the ' + id + ' job');
    const rest = workflow.slice(start + 1);
    const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  }

  test('CI invokes the harness facade and keeps compatibility adapters', () => {
    const workflow = read('.github/workflows/ci.yml');
    assert.match(workflow, /bin\/dhpk harness/);
    assert.match(workflow, /bin\/dhpk distribution/);
  });

  test('CI separates preflight from a four-shard suite and keeps the aggregate required check', () => {
    const workflow = read('.github/workflows/ci.yml');
    const preflight = jobBlock(workflow, 'preflight');
    const tests = jobBlock(workflow, 'tests');
    const validate = jobBlock(workflow, 'validate');

    assert.match(preflight, /timeout-minutes:\s*10/);
    assert.doesNotMatch(preflight, /run-all\.js|run-bounded-node-test\.sh/);
    assert.match(tests, /timeout-minutes:\s*10/);
    assert.match(tests, /fail-fast:\s*false/);
    assert.match(tests, /shard:\s*\[\s*0,\s*1,\s*2,\s*3\s*\]/);
    assert.match(tests, /DHPK_TEST_JOBS:\s*['"]?4/);
    assert.match(tests, /DHPK_TEST_SOURCE_COMMIT:\s*\$\{\{\s*github\.sha\s*\}\}/);
    assert.match(tests, /DHPK_TEST_HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
    assert.match(tests, /DHPK_TEST_TIMING_FILE:\s*\$\{\{\s*runner\.temp\s*\}\}\/dhpk-test-timing\.json/);
    assert.match(tests, /run-bounded-node-test\.sh\s+node\s+tests\/run-all\.js\s+--shard-index\s+\$\{\{\s*matrix\.shard\s*\}\}\s+--shard-count\s+4/);

    assert.match(validate, /name: Validate harness assets/);
    assert.match(validate, /needs:\s*\[\s*preflight,\s*tests\s*\]/);
    assert.match(validate, /if:\s*always\(\)/);
    assert.match(validate, /needs\.preflight\.result/);
    assert.match(validate, /needs\.tests\.result/);
    assert.match(validate, /actions\/setup-node@[0-9a-f]{40}\s+#\s*v7\.0\.0/);
    assert.match(validate, /node-version:\s*['"]?24/);
    assert.match(validate, /node scripts\/ci\/verify-test-shards\.js[\s\S]*--count 4[\s\S]*--run-id[\s\S]*--run-attempt[\s\S]*--checkout-sha[\s\S]*--head-sha[\s\S]*--summary/);
    for (const shard of [0, 1, 2, 3]) {
      assert.match(validate, new RegExp('dhpk-test-timing-\\$\\{\\{\\s*github\\.run_id\\s*\\}\\}-\\$\\{\\{\\s*github\\.run_attempt\\s*\\}\\}-shard-' + shard));
      assert.match(
        validate,
        new RegExp('path:\\s*\\$\\{\\{\\s*runner\\.temp\\s*\\}\\}\\/dhpk-test-shards\\/dhpk-test-timing-\\$\\{\\{\\s*github\\.run_id\\s*\\}\\}-\\$\\{\\{\\s*github\\.run_attempt\\s*\\}\\}-shard-' + shard),
      );
    }
    assert.match(workflow, /CHANGELOG_ARGS=\(\)/);
    assert.match(workflow, /--diff-base\s+"origin\/\$BASE_REF"\s+--base-ref\s+"\$BASE_REF"/);
    assert.strictEqual(
      (workflow.match(/scripts\/ci\/validate-changelog-fragments\.js/g) || []).length,
      1,
      'PR coverage must be folded into the single changelog validator invocation'
    );
  });

  test('CI forwards bot authorship to the changelog coverage gate', () => {
    const workflow = read('.github/workflows/ci.yml');
    assert.match(workflow, /PR_AUTHOR_TYPE:\s*\$\{\{\s*github\.event\.pull_request\.user\.type\s*\}\}/);
    assert.match(workflow, /if \[ "\$PR_AUTHOR_TYPE" = "Bot" \]; then[\s\S]*?CHANGELOG_ARGS\+=\(--bot-authored\)/);
  });

  test('release invokes the harness facade for the full consumer surface plan', () => {
    const workflow = read('.github/workflows/release.yml');
    assert.match(workflow, /bin\/dhpk harness release/);
    assert.match(workflow, /surfaceResults/);
  });
}


run('harness-facade-contract');
