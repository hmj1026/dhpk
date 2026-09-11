'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { environmentOptions, main, shouldReport } = require('../scripts/dispatch-config-report');

test('config report only emits for explicit non-default dispatch settings', () => {
  assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'auto' }), false);
  assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }), true);
  assert.deepStrictEqual(environmentOptions({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }), {
    worker_target: 'codex-cli/sol5.6:high',
  });
});

test('config report is bounded JSON and reports invalid values without failing startup', () => {
  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (value) => { output += value; return true; };
  try {
    assert.strictEqual(main({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'bare-model' }), 0);
  } finally {
    process.stdout.write = originalWrite;
  }
  const report = JSON.parse(output);
  assert.strictEqual(report.schema, 'dhpk.dispatch.config-report.v1');
  assert.strictEqual(report.status.catalog_support, 'NOT_RUN');
  assert.ok(report.diagnostics.some((entry) => entry.field === 'worker_target'));
});

run('dispatch-config-report');
