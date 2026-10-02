'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  nonEmptyString,
  reviewEvidence,
  reviewFile,
  reviewObject,
} = require('../scripts/lib/marketplace-review-paths');

function withRepo(callback) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-marketplace-review-paths-'));
  const root = path.join(tmp, 'repo');
  try {
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'a.test.js'), 'test');
    fs.writeFileSync(path.join(root, 'docs', 'note.md'), 'doc');
    fs.writeFileSync(path.join(tmp, 'outside.md'), 'outside');
    callback({ tmp, root });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('nonEmptyString accepts only non-blank strings', () => {
  assert.strictEqual(nonEmptyString('x'), true);
  for (const value of ['', '  ', null, undefined, 1, {}]) assert.strictEqual(nonEmptyString(value), false);
});

test('reviewObject rejects non-objects and reports each unexpected key', () => {
  for (const value of [null, [], 'x', 3]) {
    const errors = [];
    assert.strictEqual(reviewObject(errors, value, ['a'], 'p'), false);
    assert.deepStrictEqual(errors, ['p must be an object']);
  }
  const errors = [];
  assert.strictEqual(reviewObject(errors, { a: 1, b: 2, c: 3 }, ['a'], 'p'), true);
  assert.deepStrictEqual(errors, ['p.b is not allowed', 'p.c is not allowed']);
});

test('reviewFile accepts a contained file and rejects unsafe, missing, directory and escaping paths', () => {
  withRepo(({ tmp, root }) => {
    const ok = [];
    assert.strictEqual(reviewFile(ok, 'docs/note.md', 'p', root), fs.realpathSync(path.join(root, 'docs', 'note.md')));
    assert.deepStrictEqual(ok, []);
    for (const value of ['', '../outside.md', '/etc/passwd', 'C:/x', 'docs\\note.md', 'docs/*.md',
      'docs//note.md', './docs/note.md', 'docs/../docs/note.md']) {
      const errors = [];
      assert.strictEqual(reviewFile(errors, value, 'p', root), false, value);
      assert.match(errors[0], /unsafe repository file path/);
    }
    const missing = [];
    assert.strictEqual(reviewFile(missing, 'docs/missing.md', 'p', root), false);
    assert.match(missing[0], /cannot resolve repository file 'docs\/missing.md': ENOENT/);
    const directory = [];
    assert.strictEqual(reviewFile(directory, 'docs', 'p', root), false);
    assert.match(directory[0], /must resolve to a contained repository file/);
    fs.symlinkSync(path.join(tmp, 'outside.md'), path.join(root, 'docs', 'escape.md'));
    const escape = [];
    assert.strictEqual(reviewFile(escape, 'docs/escape.md', 'p', root), false);
    assert.match(escape[0], /must resolve to a contained repository file/);
  });
});

test('reviewEvidence requires PASS and, for tests, a real file under tests/', () => {
  withRepo(({ root }) => {
    const ok = [];
    reviewEvidence(ok, { source: 'tests/a.test.js', status: 'PASS' }, 'e', root, { test: true });
    reviewEvidence(ok, { source: 'docs/note.md', status: 'PASS' }, 'e', root);
    assert.deepStrictEqual(ok, []);

    const status = [];
    reviewEvidence(status, { source: 'docs/note.md', status: 'NOT_RUN' }, 'e', root);
    assert.deepStrictEqual(status, ['e.status must be PASS']);

    const extra = [];
    reviewEvidence(extra, { source: 'docs/note.md', status: 'PASS', note: 1 }, 'e', root);
    assert.deepStrictEqual(extra, ['e.note is not allowed']);

    const notTest = [];
    reviewEvidence(notTest, { source: 'docs/note.md', status: 'PASS' }, 'e', root, { test: true });
    assert.deepStrictEqual(notTest, ['e.source must identify evidence under tests/']);

    fs.symlinkSync(path.join(root, 'docs', 'note.md'), path.join(root, 'tests', 'disguised.test.js'));
    const disguised = [];
    reviewEvidence(disguised, { source: 'tests/disguised.test.js', status: 'PASS' }, 'e', root, { test: true });
    assert.deepStrictEqual(disguised, ['e.source must identify evidence under tests/']);

    const notObject = [];
    reviewEvidence(notObject, null, 'e', root);
    assert.deepStrictEqual(notObject, ['e must be an object']);
  });
});

run('marketplace-review-paths');
