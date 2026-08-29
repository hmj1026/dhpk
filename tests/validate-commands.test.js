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

test('route-only and setup installation have deterministic executable contracts', () => {
  const doSkill = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-do', 'SKILL.md'), 'utf8');
  const setup = fs.readFileSync(path.join(ROOT, 'commands', 'setup.md'), 'utf8');
  assert.match(doSkill, /--route-only/);
  assert.match(doSkill, /strip/i);
  assert.match(doSkill, /must not invoke the target Skill|not invoke the target/i);
  assert.match(setup, /scripts\/setup\/install-assets\.sh/);
  assert.match(setup, /--source.*--target.*--dry-run.*--force/is);
  assert.match(setup, /Bash\(bash:\*\).*Bash\(mkdir:\*\).*Bash\(cp:\*\).*Bash\(chmod:\*\)/);
});

test('invocation inventory reflects retired zh-tw and consolidated forwarding aliases', () => {
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'tests', 'fixtures', 'invocation-inventory-baseline.json'), 'utf8'
  ));
  const commandNames = inventory.commands.map((entry) => entry.name);
  assert.strictEqual(inventory.counts.commands, 44);
  assert.ok(!commandNames.includes('zh-tw'));
  for (const name of ['create-dev', 'install-hooks', 'install-rules', 'install-scripts', 'precommit-fast']) {
    const command = fs.readFileSync(path.join(ROOT, 'commands', `${name}.md`), 'utf8');
    assert.match(command, /dhpk-invocation-class:\s*explicit-only/);
  }
});

// v1 GREEN contract (tests above): frontmatter validation, forwarding aliases,
// current fat /dhpk:do --route-only workflow, invocation inventory counts.
// v2 RED contract (this test): thin pointer adapter. See also
// tests/dhpk-do-portable.test.js [3.1]. Failing this case fails the whole file
// until task 3.1.

test('/dhpk:do is a ≤28-line canonical-pointer adapter (RED until 3.1)', () => {
  const body = fs.readFileSync(path.join(ROOT, 'commands', 'do.md'), 'utf8');
  const lineCount = body.split('\n').length;
  assert.ok(lineCount <= 28, `/dhpk:do must be a ≤28-line adapter, got ${lineCount} lines`);
  assert.match(body, /@skills\/dhpk-do\/SKILL\.md/);
  assert.match(body, /\$ARGUMENTS/);
  assert.match(body, /host\s*=\s*claude/);
  assert.ok(!/## Step 0/.test(body), 'adapter must not keep an independent workflow');
  assert.ok(!/Common targets:/.test(body), 'adapter must not duplicate the target catalog');
  assert.ok(!/Implementation dispatch/.test(body), 'adapter must not copy the dispatch table');
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
