'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { environmentOptions, main, shouldReport } = require('../scripts/dispatch-config-report');

function captureStdout(action) {
  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (value) => { output += value; return true; };
  try {
    return { result: action(), output };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test('config report only emits for explicit non-default dispatch settings', () => {
  assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'auto' }), false);
  assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }), true);
  assert.deepStrictEqual(environmentOptions({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }), {
    worker_target: 'codex-cli/sol5.6:high',
  });
  const defaults = captureStdout(() => main({}));
  assert.strictEqual(defaults.result, 0);
  assert.strictEqual(defaults.output, '');
});

test('config report is bounded JSON and reports invalid values without failing startup', () => {
  const explicit = captureStdout(() => main({
    CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high',
  }));
  assert.strictEqual(explicit.result, 0);
  assert.ok(explicit.output.endsWith('\n'));
  const lines = explicit.output.slice(0, -1).split(/\r?\n/u);
  assert.strictEqual(lines.length, 1);
  const report = JSON.parse(lines[0]);
  assert.strictEqual(report.schema, 'dhpk.dispatch.config-report.v1');
  assert.strictEqual(report.status.catalog_support, 'NOT_RUN');

  const invalid = captureStdout(() => main({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'bare-model' }));
  assert.strictEqual(invalid.result, 0);
  const invalidReport = JSON.parse(invalid.output);
  assert.strictEqual(invalidReport.schema, 'dhpk.dispatch.config-report.v1');
  assert.ok(invalidReport.diagnostics.some((entry) => entry.field === 'worker_target'));
});

run('dispatch-config-report');
