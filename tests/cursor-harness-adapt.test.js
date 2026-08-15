'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  cursorAgentModel,
  cursorDocumentDestinationName,
  rewriteCursorHarnessBody,
  rewriteCursorSupportingAssetBody,
  retainsClaudePluginRoot,
  retainsCodexSupportRoot,
} = require('../scripts/lib/cursor-harness-adapt');

const PLUGIN_ROOT_TOKEN = '${' + 'CLAUDE_PLUGIN_ROOT}';

test('cursorAgentModel maps doc roles to Composer and every other role to Grok', () => {
  assert.strictEqual(cursorAgentModel('doc-reviewer.md'), 'composer-2.5-fast');
  assert.strictEqual(cursorAgentModel('docs-lookup'), 'composer-2.5-fast');
  assert.strictEqual(cursorAgentModel('doc-updater.md'), 'composer-2.5-fast');
  assert.strictEqual(cursorAgentModel('code-reviewer.md'), 'cursor-grok-4.6-high');
  assert.strictEqual(cursorAgentModel('fast-worker'), 'cursor-grok-4.6-high');
});

test('cursorDocumentDestinationName only rewrites rules to .mdc', () => {
  assert.strictEqual(cursorDocumentDestinationName('rules', 'prefer-const.md'), 'prefer-const.mdc');
  assert.strictEqual(cursorDocumentDestinationName('agents', 'reviewer.md'), 'reviewer.md');
  assert.strictEqual(cursorDocumentDestinationName('commands', 'review.md'), 'review.md');
});

test('rewriteCursorHarnessBody maps plugin-root paths onto the Cursor tree', () => {
  const rewritten = rewriteCursorHarnessBody([
    'Load ' + PLUGIN_ROOT_TOKEN + '/agent-traps/_common/prompt-defense.md',
    'Policy ' + PLUGIN_ROOT_TOKEN + '/rules/execution-policy.md',
    'Economics ' + PLUGIN_ROOT_TOKEN + '/rules/model-economics.md',
    'Peer ' + PLUGIN_ROOT_TOKEN + '/agents/reviewer.md',
    'Contracts ' + PLUGIN_ROOT_TOKEN + '/docs/contracts/output.md',
    'Bare leftover ' + PLUGIN_ROOT_TOKEN,
  ].join('\n'));
  assert.match(rewritten, /\.cursor\/dhpk\/agent-traps\/_common\/prompt-defense\.md/);
  assert.match(rewritten, /\.cursor\/dhpk\/policies\/execution-policy\.md/);
  assert.match(rewritten, /\.cursor\/rules\/model-economics\.mdc/);
  assert.match(rewritten, /\.cursor\/agents\/reviewer\.md/);
  assert.match(rewritten, /\.cursor\/dhpk\/contracts\/output\.md/);
  assert.match(rewritten, /Bare leftover \.cursor\/dhpk/);
  assert.ok(!rewritten.includes(PLUGIN_ROOT_TOKEN));
});

test('rewriteCursorSupportingAssetBody rewrites Codex support roots', () => {
  const rewritten = rewriteCursorSupportingAssetBody(
    'Read .codex/dhpk/agent-traps/_common/loader.md and ' + PLUGIN_ROOT_TOKEN + '/manifests/x.json',
  );
  assert.match(rewritten, /\.cursor\/dhpk\/agent-traps\/_common\/loader\.md/);
  assert.match(rewritten, /\.cursor\/dhpk\/manifests\/x\.json/);
  assert.ok(!rewritten.includes('.codex/dhpk'));
  assert.ok(!rewritten.includes(PLUGIN_ROOT_TOKEN));
});

test('retention helpers detect leftover Claude and Codex roots', () => {
  assert.strictEqual(retainsClaudePluginRoot('ok .cursor/dhpk'), false);
  assert.strictEqual(retainsClaudePluginRoot('Load ' + PLUGIN_ROOT_TOKEN + '/rules/x.md'), true);
  assert.strictEqual(retainsCodexSupportRoot('ok .cursor/dhpk'), false);
  assert.strictEqual(retainsCodexSupportRoot('Read .codex/dhpk/policies/x.md'), true);
});

run('cursor-harness-adapt');
