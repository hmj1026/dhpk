'use strict';

// Behavioral guard for scripts/ci/validate-commands.js: every commands/*.md
// needs frontmatter with a non-empty 'description'; INDEX.md is exempt.
// Runs the real script (ROOT is __dirname-relative, so we spawn a copy of
// scripts/ + commands/ inside a temp dir rather than pass a path argument).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-commands-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

function writeCommand(tmp, name, content) {
  const dir = path.join(tmp, 'commands');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

function runValidator(tmp) {
  const res = spawnSync('node', [path.join(tmp, 'scripts', 'ci', 'validate-commands.js')], {
    encoding: 'utf8',
  });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('real repo commands/ pass validation', () => {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-commands.js')], {
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, `expected real repo to pass, got:\n${res.stdout}${res.stderr}`);
});

test('no commands/ directory — exits 0 (skip)', () => {
  const tmp = makeTempRepo();
  try {
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /skipping/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a command file with no frontmatter fails', () => {
  const tmp = makeTempRepo();
  try {
    writeCommand(tmp, 'broken.md', '# no frontmatter here\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /missing frontmatter/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a command file with empty description fails', () => {
  const tmp = makeTempRepo();
  try {
    writeCommand(tmp, 'empty-desc.md', "---\ndescription: ''\n---\nbody\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /missing\/empty 'description'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('duplicate frontmatter keys fail', () => {
  const tmp = makeTempRepo();
  try {
    writeCommand(tmp, 'dupe.md', '---\ndescription: a\ndescription: b\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /duplicate frontmatter keys/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('INDEX.md is skipped even when malformed', () => {
  const tmp = makeTempRepo();
  try {
    writeCommand(tmp, 'INDEX.md', '# no frontmatter, should be ignored\n');
    writeCommand(tmp, 'valid.md', "---\ndescription: does a thing\n---\nbody\n");
    const { status } = runValidator(tmp);
    assert.strictEqual(status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a well-formed command file passes', () => {
  const tmp = makeTempRepo();
  try {
    writeCommand(tmp, 'valid.md', "---\ndescription: does a thing\n---\nbody\n");
    const { status } = runValidator(tmp);
    assert.strictEqual(status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-commands');
