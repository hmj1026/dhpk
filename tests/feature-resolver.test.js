'use strict';

// Unit coverage for scripts/lib/feature-resolver.js — the pure resolver module
// itself (as opposed to resolve-feature-cli.test.js / resolve-feature.test.js,
// which cover the CLI/bash wrappers). Exercises isValidSlug, classifyDoc, and
// resolveFeature's doc-inventory / canonical-doc scan directly against a
// scratch docs/features/<key>/ tree (via opts.cwd), no git required.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { resolveFeature, isValidSlug, classifyDoc } = require('../scripts/lib/feature-resolver');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'feature-resolver-')));
}

test('isValidSlug accepts lowercase-alnum-dash slugs and rejects traversal/dotfiles', () => {
  assert.ok(isValidSlug('my-feat_1.2'));
  assert.ok(!isValidSlug('../etc'));
  assert.ok(!isValidSlug('.hidden'));
  assert.ok(!isValidSlug('a/b'));
  assert.ok(!isValidSlug(''));
});

test('classifyDoc recognizes numbered tech-spec as high-confidence canonical', () => {
  const d = classifyDoc('2-tech-spec.md');
  assert.strictEqual(d.type, 'tech-spec');
  assert.strictEqual(d.role, 'tech_spec');
  assert.strictEqual(d.namespace, 'lifecycle');
  assert.strictEqual(d.confidence, 'high');
});

test('classifyDoc treats an unrecognized ad-hoc filename as low confidence, no role', () => {
  const d = classifyDoc('notes.md');
  assert.strictEqual(d.namespace, 'ad-hoc');
  assert.strictEqual(d.role, null);
  assert.strictEqual(d.confidence, 'low');
});

test('resolveFeature: explicit --feature key scans docs dir and reports canonical docs', () => {
  const tmp = mkTmp();
  try {
    const featDir = path.join(tmp, 'docs', 'features', 'my-feat');
    fs.mkdirSync(featDir, { recursive: true });
    fs.writeFileSync(path.join(featDir, '1-requirements.md'), '# req');
    fs.writeFileSync(path.join(featDir, '2-tech-spec.md'), '# spec');
    fs.mkdirSync(path.join(featDir, 'requests'), { recursive: true });
    fs.writeFileSync(path.join(featDir, 'requests', 'ticket-1.md'), '# ticket');

    const result = resolveFeature({ feature: 'my-feat', cwd: tmp });
    assert.strictEqual(result.key, 'my-feat');
    assert.strictEqual(result.source, 'explicit');
    assert.strictEqual(result.confidence, 'high');
    assert.strictEqual(result.has_tech_spec, true);
    assert.strictEqual(result.has_requirements, true);
    assert.strictEqual(result.has_requests, true);
    assert.strictEqual(result.canonical_docs.tech_spec.file, '2-tech-spec.md');
    assert.strictEqual(result.doc_inventory.length, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveFeature: invalid explicit slug + no other signal falls through to empty Gate:Need-Human result', () => {
  const tmp = mkTmp();
  try {
    const result = resolveFeature({ feature: '../bad', cwd: tmp });
    assert.strictEqual(result.key, null);
    assert.strictEqual(result.source, null);
    assert.deepStrictEqual(result.doc_inventory, []);
    assert.strictEqual(result.has_tech_spec, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('feature-resolver');
