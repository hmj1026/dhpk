'use strict';

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.resolve(__dirname, '..');

// Every registered Host Adapter (GLOSSARY, ADR-0009) exposes compile,
// materialize, and verify.  Entries name the exported functions per adapter.
const HOST_ADAPTERS = [
  { id: 'agent-plugin', module: 'scripts/lib/agent-plugin-package.js', compile: 'compileAgentPluginPackage', materialize: 'materializeAgentPluginPackage', verify: 'verifyAgentPluginPackage' },
  { id: 'cursor-plugin', module: 'scripts/lib/cursor-plugin-package.js', compile: 'compileCursorPackage', materialize: 'materializeCursorPackage', verify: 'verifyCursorPackage' },
  { id: 'codex-native', module: 'scripts/lib/codex-native-package.js', compile: 'compileNativePackage', materialize: 'materializeNativePackage', verify: 'verifyNativePackage' },
  { id: 'agy-plugin', module: 'scripts/lib/agy-plugin-package.js', compile: 'compileAgyPluginPackage', materialize: 'materializeAgyPluginPackage', verify: 'verifyAgyPluginPackage' },
  { id: 'cursor-sync', module: 'scripts/lib/cursor-sync-package.js', compile: 'compileCursorSyncProjection', materialize: 'materializeCursorSyncTree', verify: 'verifyCursorSyncTree' },
  { id: 'claude-marketplace', module: 'scripts/ci/gen-claude-marketplace-package.js', compile: 'compileClaudeMarketplacePackage', materialize: 'materialize', verify: 'verifyClaudeMarketplacePackage' },
  { id: 'claude-capability-bundle', module: 'scripts/lib/claude-capability-bundle.js', compile: 'compileClaudeCapabilityBundle', materialize: 'materializeClaudeCapabilityBundle', verify: 'verifyClaudeCapabilityBundle' },
  // The Claude Host Adapter is a pair: claude-projection-adapter.js is pure
  // (compile/verify, writes nothing; Claude's canonical tree is the source) and
  // claude-capability-bundle.js (entry above) is its store-backed materializer.
  { id: 'claude-projection (compile, verify)', module: 'scripts/lib/claude-projection-adapter.js', compile: 'compileClaudeProjection', verify: 'verifyClaudeProjection' },
];

for (const adapter of HOST_ADAPTERS) {
  test(`host adapter contract: ${adapter.id} exposes its contract operations`, () => {
    const exported = require(path.join(ROOT, adapter.module));
    for (const operation of ['compile', 'materialize', 'verify'].filter((name) => adapter[name])) {
      assert.strictEqual(typeof exported[adapter[operation]], 'function',
        `${adapter.id}: ${adapter.module} must export ${operation} as ${adapter[operation]}()`);
    }
  });
}

run('host-adapter-contract');
