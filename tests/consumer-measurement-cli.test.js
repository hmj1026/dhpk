'use strict';

// The consumer CLI must keep context/discovery research separate from normal
// installation acceptance. These probes run in a child process with only
// stub Host commands, so the suite cannot start a real model workflow.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'consumer-gate.js');
const RESEARCH_MODULE = path.join(ROOT, 'scripts', 'lib', 'marketplace-runtime-acceptance.js');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const HOST_COMMANDS = ['agy', 'claude', 'codex', 'cursor-agent'];

function writeEvaluatorProbe(directory) {
  const probe = path.join(directory, 'evaluator-probe.js');
  fs.writeFileSync(probe, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const Module = require('node:module');",
    'const instrumented = new WeakSet();',
    'const load = Module._load;',
    'Module._load = function (request, parent, isMain) {',
    '  const value = load.apply(this, arguments);',
    '  let resolved;',
    '  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) { return value; }',
    '  if (resolved !== process.env.DHPK_RESEARCH_MODULE_PATH',
    "    || !value || typeof value.evaluateMarketplaceRuntimeAcceptance !== 'function' || instrumented.has(value)) return value;",
    '  instrumented.add(value);',
    '  const evaluate = value.evaluateMarketplaceRuntimeAcceptance;',
    '  value.evaluateMarketplaceRuntimeAcceptance = function () {',
    "    fs.appendFileSync(process.env.DHPK_RESEARCH_CALL_LOG, 'called\\n');",
    '    return evaluate.apply(this, arguments);',
    '  };',
    '  return value;',
    '};',
  ].join('\n'), { mode: 0o600 });
  return probe;
}

function writeHostStub(directory, command) {
  const stub = path.join(directory, command);
  fs.writeFileSync(stub, [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'fs.appendFileSync(process.env.DHPK_HOST_CALL_LOG, `${JSON.stringify({ command: path.basename(process.argv[1]), args: process.argv.slice(2) })}\\n`);',
    'process.stdout.write(`${path.basename(process.argv[1])} 1.0.0\\n`);',
  ].join('\n'), { mode: 0o755 });
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8').trim();
  return content ? content.split('\n') : [];
}

test('ordinary selected consumer acceptance does not run context research or a Host workflow', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-measurement-cli-'));
  const bin = path.join(temporaryDirectory, 'bin');
  fs.mkdirSync(bin);
  const evaluatorLog = path.join(temporaryDirectory, 'evaluator.log');
  const hostCallLog = path.join(temporaryDirectory, 'host-calls.jsonl');
  const evaluatorProbe = writeEvaluatorProbe(temporaryDirectory);
  HOST_COMMANDS.forEach((command) => writeHostStub(bin, command));

  try {
    const nodePath = path.dirname(process.execPath);
    const result = spawnSync(process.execPath, [
      CLI,
      '--version', VERSION,
      '--repo-root', ROOT,
      '--surface', 'codex-sync',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [bin, nodePath, '/usr/bin', '/bin'].join(path.delimiter),
        CI: 'true',
        DHPK_CONSUMER_PROBE_EXECUTE: '1',
        DHPK_HOST_CALL_LOG: hostCallLog,
        DHPK_RESEARCH_CALL_LOG: evaluatorLog,
        DHPK_RESEARCH_MODULE_PATH: RESEARCH_MODULE,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${evaluatorProbe}`].filter(Boolean).join(' '),
      },
    });

    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.acceptance.verdict, 'PASS');
    assert.deepStrictEqual(report.acceptance.requiredChecks.map((check) => [check.id, check.status]), [
      ['install.codex-sync', 'PASS'],
    ]);

    const codex = report.surfaceResults.find((entry) => entry.surface === 'codex-sync');
    assert.ok(codex, 'the selected Codex installation result is present');
    assert.strictEqual(codex.runtimeEvidence.status, 'NOT_RUN');
    assert.notStrictEqual(codex.runtimeVerified, true);
    assert.ok([...report.acceptance.requiredChecks, ...report.acceptance.excludedChecks]
      .every((check) => check.kind !== 'research'));
    assert.deepStrictEqual(readLines(evaluatorLog), []);

    const hostCalls = readLines(hostCallLog).map((line) => JSON.parse(line));
    const allowedNonInferenceCalls = hostCalls.filter((call) => (
      ['--version', '--help'].includes(call.args[0])
      || (call.command === 'codex' && JSON.stringify(call.args) === JSON.stringify(['plugin', 'list', '--json']))
    ));
    assert.deepStrictEqual(hostCalls, allowedNonInferenceCalls, `unexpected Host/model calls: ${JSON.stringify(hostCalls)}`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

run('consumer-measurement-cli');
