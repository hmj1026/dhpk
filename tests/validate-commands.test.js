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

test('canonical commands retire the approved aliases and retain supported adapters', () => {
  const read = (name) => fs.readFileSync(path.join(ROOT, 'commands', name), 'utf8');
  assert.match(read('precommit.md'), /--fast/);
  assert.match(read('setup.md'), /--install hooks\|rules\|scripts\|all/);

  for (const name of [
    'check-skill.md', 'create-dev.md', 'do.md', 'codex-review.md',
    'codex-review-fast.md', 'codex-review-branch.md', 'codex-review-doc.md',
    'codex-security.md', 'codex-test-review.md', 'review-spec.md',
  ]) assert.ok(!fs.existsSync(path.join(ROOT, 'commands', name)), `${name} must be retired without an alias`);

  for (const name of [
    'precommit-fast.md', 'install-hooks.md', 'install-rules.md',
    'install-scripts.md', 'check-coverage.md', 'codex-test-gen.md',
  ]) {
    const body = read(name);
    assert.match(body, /Deprecated.*forward/i, `${name} must state its forwarding deprecation`);
    assert.ok(body.split('\n').length <= 28, `${name} must remain a thin forwarding alias`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'commands', 'zh-tw.md')), 'zh-tw must be retired');
});

test('flow-drive routing and setup installation have deterministic executable contracts', () => {
  const doSkill = fs.readFileSync(path.join(ROOT, 'skills', 'flow-drive', 'SKILL.md'), 'utf8');
  const setup = fs.readFileSync(path.join(ROOT, 'commands', 'setup.md'), 'utf8');
  assert.match(doSkill, /--route-only/);
  assert.match(doSkill, /without invoking the target|not an implementation/i);
  assert.match(setup, /scripts\/setup\/install-assets\.sh/);
  assert.match(setup, /--source.*--target.*--dry-run.*--force/is);
  assert.match(setup, /Bash\(bash:\*\).*Bash\(mkdir:\*\).*Bash\(cp:\*\).*Bash\(chmod:\*\)/);
});

test('invocation inventory baseline distinguishes retired aliases from retained forwarding aliases', () => {
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'tests', 'fixtures', 'invocation-inventory-baseline.json'), 'utf8'
  ));
  const commandNames = inventory.commands.map((entry) => entry.name);
  assert.strictEqual(inventory.counts.commands, 44);
  assert.ok(!commandNames.includes('zh-tw'));
  for (const name of ['install-hooks', 'install-rules', 'install-scripts', 'precommit-fast']) {
    const command = fs.readFileSync(path.join(ROOT, 'commands', `${name}.md`), 'utf8');
    assert.match(command, /dhpk-invocation-class:\s*explicit-only/);
  }
});

// v1 GREEN contract (tests above): frontmatter validation, forwarding aliases,
// current fat /dhpk:do --route-only workflow, invocation inventory counts.
// v2 RED contract (this test): thin pointer adapter. See also
// tests/dhpk-do-portable.test.js [3.1]. Failing this case fails the whole file
// until task 3.1.

test('retired /dhpk:do command has no forwarding adapter', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'commands', 'do.md')));
  const body = fs.readFileSync(path.join(ROOT, 'skills', 'flow-drive', 'SKILL.md'), 'utf8');
  assert.match(body, /route/);
  assert.match(body, /implement/);
});

test('review and prompt skills state the Task 4 evidence and scope boundaries', () => {
  const prompt = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-prompt-optimize', 'SKILL.md'), 'utf8');
  assert.match(prompt, /verified live sources/i);
  assert.match(prompt, /lookup date/i);
  assert.ok(!prompt.includes('per-model calibration table'));

  const review = fs.readFileSync(path.join(ROOT, 'skills', 'change-verdict', 'SKILL.md'), 'utf8');
  assert.match(review, /docs/);
  assert.match(review, /security/);
  assert.match(review, /tests/);
  assert.match(review, /read-only|read only/i);
});

run('validate-commands');
