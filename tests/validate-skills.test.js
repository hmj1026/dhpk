'use strict';

// Behavioral guard for scripts/ci/validate-skills.js: recursive SKILL.md
// discovery (including category containers), empty-file / orphan-directory
// failures, and the missing-name / literal-block-scalar warnings.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-skills-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

function writeSkill(tmp, name, content) {
  const dir = path.join(tmp, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

function runValidator(tmp, extraArgs = []) {
  const res = spawnSync(
    'node',
    [path.join(tmp, 'scripts', 'ci', 'validate-skills.js'), ...extraArgs],
    { encoding: 'utf8' }
  );
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('real repo skills/ pass validation', () => {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-skills.js')], {
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, `expected real repo to pass, got:\n${res.stdout}${res.stderr}`);
});

test('no skills/ directory — exits 0 (skip)', () => {
  const tmp = makeTempRepo();
  try {
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /skipping/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an empty SKILL.md fails', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'blank', '   \n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /empty file/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a skills/ subdir with no SKILL.md and no nested skill fails (orphan)', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'skills', 'orphan', 'notes'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'skills', 'orphan', 'notes', 'readme.md'), 'x\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /no SKILL\.md and no nested skills/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a category container with a nested skill passes (no orphan finding)', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, path.join('container', 'nested'), '---\nname: nested\n---\nbody\n');
    const { status } = runValidator(tmp);
    assert.strictEqual(status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKILL.md frontmatter missing name warns but does not fail (non-strict)', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'noname', '---\ndescription: does a thing\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /frontmatter missing 'name'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKILL.md frontmatter missing name fails under --strict', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'noname', '---\ndescription: does a thing\n---\nbody\n');
    const { status } = runValidator(tmp, ['--strict']);
    assert.strictEqual(status, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a literal block-scalar description warns', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'blockscalar', '---\nname: blockscalar\ndescription: |\n  line one\n  line two\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /description uses literal block scalar/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a well-formed skill passes with no findings', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'ok', '---\nname: ok\ndescription: does a thing\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0, out);
    assert.doesNotMatch(out, /WARN|ERROR/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-skills');
