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
} = require('../scripts/lib/route-result');

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
  assert.deepStrictEqual(context, {
    routeOnly: true,
    codex: true,
    plan: { enabled: true, model: 'sol', effort: 'medium' },
    worker: 'auto',
    reasoner: { enabled: true, backend: 'codex', model: 'terra', effort: 'high' },
    architect: true,
    openSpec: true,
    cleanedQuery: 'implement the feature',
  });
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.plan));
  assert.throws(() => { context.worker = 'claude'; }, TypeError);
});

test('route result carries context and has a stable terminal shape', () => {
  const result = createRouteResult({
    status: 'MATCH',
    skill: 'dhpk:dhpk-opsx-apply-goal',
    label: 'unattended OpenSpec goal session',
    context: parseInvocationContext(['--worker=claude', 'run it']),
  });
  assert.deepStrictEqual(Object.keys(result), ['status', 'skill', 'label', 'context']);
  assert.strictEqual(result.status, 'MATCH');
  assert.ok(Object.isFrozen(result));
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
