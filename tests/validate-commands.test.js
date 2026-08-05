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

test('canonical commands expose the consolidated modes and legacy aliases only forward', () => {
  const read = (name) => fs.readFileSync(path.join(ROOT, 'commands', name), 'utf8');
  const codexReview = read('codex-review.md');
  assert.match(codexReview, /--scope diff\|branch\|doc\|security\|tests/);
  assert.match(codexReview, /--depth fast\|full/);
  assert.match(read('precommit.md'), /--fast/);
  assert.match(read('do.md'), /--route-only/);
  assert.match(read('setup.md'), /--install hooks\|rules\|scripts\|all/);
  assert.match(codexReview, /--coverage/);
  assert.match(codexReview, /--spec/);

  for (const name of [
    'codex-review-fast.md', 'codex-review-branch.md', 'codex-review-doc.md',
    'codex-security.md', 'codex-test-review.md', 'precommit-fast.md',
    'create-dev.md', 'install-hooks.md', 'install-rules.md', 'install-scripts.md',
    'check-coverage.md', 'review-spec.md', 'codex-test-gen.md',
  ]) {
    const body = read(name);
    assert.match(body, /Deprecated.*forward/i, `${name} must state its forwarding deprecation`);
    assert.ok(body.split('\n').length <= 28, `${name} must remain a thin forwarding alias`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'commands', 'zh-tw.md')), 'zh-tw must be retired');
});

test('review and prompt skills state the Task 4 evidence and scope boundaries', () => {
  const prompt = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-prompt-optimize', 'SKILL.md'), 'utf8');
  assert.match(prompt, /verified live sources/i);
  assert.match(prompt, /lookup date/i);
  assert.ok(!prompt.includes('per-model calibration table'));

  const review = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-change-review', 'SKILL.md'), 'utf8');
  assert.match(review, /doc\|security\|tests/);
  assert.match(review, /dedicated reviewer.*preferred/i);
});

run('validate-commands');
