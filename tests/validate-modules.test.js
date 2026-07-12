'use strict';

// Behavioral guard for scripts/ci/validate-modules.js: module.yaml structural
// checks (name matches directory, requires[] resolves) and the softer
// warnings (version/description/triggers, provides.skills resolution).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-modules-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

function writeModule(tmp, id, yaml) {
  const dir = path.join(tmp, 'modules', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'module.yaml'), yaml);
}

function runValidator(tmp, extraArgs = []) {
  const res = spawnSync(
    'node',
    [path.join(tmp, 'scripts', 'ci', 'validate-modules.js'), ...extraArgs],
    { encoding: 'utf8' }
  );
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('real repo modules/ pass validation', () => {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-modules.js')], {
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, `expected real repo to pass, got:\n${res.stdout}${res.stderr}`);
});

test('no modules/ directory — exits 0 (skip)', () => {
  const tmp = makeTempRepo();
  try {
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /skipping/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('module directory missing module.yaml fails', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'modules', 'ghost'), { recursive: true });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /missing module\.yaml/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('name mismatched with directory fails', () => {
  const tmp = makeTempRepo();
  try {
    writeModule(tmp, 'foo', 'name: bar\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /name 'bar' != directory 'foo'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('requires[] pointing at a non-existent module fails', () => {
  const tmp = makeTempRepo();
  try {
    writeModule(
      tmp,
      'foo',
      "name: foo\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\nrequires: [nonexistent-module]\n"
    );
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /requires non-existent module 'nonexistent-module'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('requires[] pointing at an existing module passes', () => {
  const tmp = makeTempRepo();
  try {
    writeModule(tmp, 'base', 'name: base\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\n');
    writeModule(
      tmp,
      'foo',
      'name: foo\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\nrequires: [base]\n'
    );
    const { status } = runValidator(tmp);
    assert.strictEqual(status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing version/description warn but do not fail (non-strict)', () => {
  const tmp = makeTempRepo();
  try {
    writeModule(tmp, 'foo', 'name: foo\ntriggers:\n  - x\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /missing 'version'/);
    assert.match(out, /missing 'description'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing version/description fail under --strict', () => {
  const tmp = makeTempRepo();
  try {
    writeModule(tmp, 'foo', 'name: foo\ntriggers:\n  - x\n');
    const { status } = runValidator(tmp, ['--strict']);
    assert.strictEqual(status, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('provides.skills entry with no resolvable SKILL.md warns', () => {
  const tmp = makeTempRepo();
  try {
    writeModule(
      tmp,
      'foo',
      'name: foo\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\nprovides:\n  skills: [nonexistent-skill]\n'
    );
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /provides skill 'nonexistent-skill' but no SKILL\.md found/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('module with no triggers and no provided skills warns (no-op module)', () => {
  const tmp = makeTempRepo();
  try {
    writeModule(tmp, 'foo', 'name: foo\nversion: 1.0.0\ndescription: x\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /no 'triggers' and no provided skills/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-modules');
