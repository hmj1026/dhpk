'use strict';

// Regression contracts for the opsx handoff/reference and deterministic route
// boundary. These fixtures deliberately exercise legacy names, natural-language
// handoffs, optional providers, and immutable invocation context.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  buildReferenceRegistry,
  resolveReference,
  extractNaturalLanguageReferences,
} = require('../scripts/lib/reference-registry');
const {
  parseInvocationContext,
  createRouteResult,
} = require('../skills/flow-drive/scripts/route-result');

const ROOT = path.join(__dirname, '..');

test('canonical opsx references resolve and legacy aliases resolve to one target', () => {
  const registry = buildReferenceRegistry(ROOT);
  assert.strictEqual(resolveReference(registry, 'dhpk-opsx-load-context').canonical, 'dhpk-opsx-load-context');
  assert.strictEqual(resolveReference(registry, 'opsx-load-context').canonical, 'dhpk-opsx-load-context');
  assert.strictEqual(resolveReference(registry, 'opsx-post-obs').canonical, 'dhpk-opsx-post-observation');
  assert.strictEqual(resolveReference(registry, 'compact-save'), null);
});

test('natural-language handoff extraction records line and optional capability state', () => {
  const registry = buildReferenceRegistry(ROOT);
  const refs = extractNaturalLanguageReferences(
    'Invoke the `dhpk-opsx-load-context` skill.\n' +
    'Use `opsx-post-obs` when the optional provider is installed.\n' +
    'Run `compact-save` only when the optional capability is available.\n'
  );
  assert.deepStrictEqual(refs.map((ref) => ref.name), [
    'dhpk-opsx-load-context',
    'opsx-post-obs',
    'compact-save',
  ]);
  assert.strictEqual(resolveReference(registry, refs[1].name).canonical, 'dhpk-opsx-post-observation');
  assert.strictEqual(refs[2].optional, true);
  assert.strictEqual(refs[0].line, 1);
});

test('unresolved natural-language handoff is a validation finding unless optional', () => {
  const { scanText } = require('../scripts/ci/validate-references');
  const missing = scanText('fixture.md', 'Invoke `missing-opsx-skill` now.');
  assert.ok(missing.some((finding) => finding.check === 6), JSON.stringify(missing));
  const optional = scanText('fixture.md', 'Use `missing-opsx-skill` only when the optional capability is available.');
  assert.ok(!optional.some((finding) => finding.check === 6), JSON.stringify(optional));
});

test('route parser emits one immutable normalized invocation context', () => {
  const context = parseInvocationContext([
    '--route-only', '--codex', '--architect', '--plan=sol:medium', '--worker=auto', '--reasoner=codex:terra:high',
    '--openspec', 'implement', 'the', 'feature',
  ]);
  assert.strictEqual(context.schema, 'dhpk.route-result.v2');
  assert.strictEqual(context.options.routeOnly, true);
  assert.strictEqual(context.options.codexPeer, false);
  assert.strictEqual(context.options.architect, true);
  assert.strictEqual(context.options.openSpec, true);
  assert.strictEqual(context.options.executeExplicit, false);
  assert.deepStrictEqual(context.options.plan, { enabled: true, model: 'sol', effort: 'medium' });
  assert.deepStrictEqual(context.options.worker, { requested: 'auto', value: 'auto', valid: true });
  assert.deepStrictEqual(context.options.reasoner, {
    enabled: true, backend: 'codex', model: 'terra', effort: 'high', valid: true,
  });
  assert.strictEqual(context.cleanedQuery, 'implement the feature');
  assert.strictEqual(context.target, null);
  assert.strictEqual(context.disposition, 'route-only');
  assert.ok(context.diagnostics.some((d) => d.code === 'DEPRECATED_CODEX_FLAG'));
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.options));
  assert.ok(Object.isFrozen(context.options.plan));
  assert.throws(() => { context.options.worker = 'claude'; }, TypeError);
});

test('route result carries context and has a stable terminal shape', () => {
  const result = createRouteResult({
    host: 'claude',
    argv: ['--worker=claude', 'run it'],
  });
  assert.deepStrictEqual(Object.keys(result), [
    'schema', 'host', 'cleanedQuery', 'options', 'target',
    'availability', 'backendSelection', 'diagnostics', 'disposition',
  ]);
  assert.strictEqual(result.schema, 'dhpk.route-result.v2');
  assert.strictEqual(result.options.worker.requested, 'claude');
  assert.ok(Object.isFrozen(result));
});

test('v2 skill-local parser nested options (skip while package absent; see flow-drive)', () => {
  const skillParser = path.join(ROOT, 'skills', 'flow-drive', 'scripts', 'route-result.js');
  if (!fs.existsSync(skillParser)) return;
  const skillMod = require(skillParser);
  const parsed = skillMod.parseInvocationContext(['--execute-explicit', '--codex', 'task']);
  assert.ok(parsed.options, 'v2 parser must nest flags under options');
  assert.strictEqual(parsed.options.executeExplicit, true);
  assert.strictEqual(parsed.options.codexPeer, false);
  assert.strictEqual(parsed.cleanedQuery, 'task');
  assert.strictEqual(parsed.target, null);
  assert.strictEqual(parsed.disposition, 'blocked');
  assert.ok(parsed.diagnostics.some((d) => d.code === 'DEPRECATED_CODEX_FLAG'));
});

test('opsx resume contract keeps uncommitted files and optional gates explicit', () => {
  const command = fs.readFileSync(path.join(ROOT, 'commands', 'opsx-apply-resume.md'), 'utf8');
  assert.match(command, /live worktree/i);
  assert.match(command, /commit.*optional|optional.*commit/i);
  assert.match(command, /memory.*optional|optional.*memory/i);
  assert.match(command, /precommit.*optional|optional.*precommit/i);
  assert.match(command, /does not.*(revert|delete).*uncommitted|uncommitted.*(preserved|remain)/i);
  assert.match(command, /compact.*optional|optional.*compact/i);
});

run('reference-route-policy');
