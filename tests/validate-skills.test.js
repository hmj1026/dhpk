'use strict';

// Behavioral guard for scripts/ci/validate-skills.js: recursive SKILL.md
// discovery, metadata findings, hard and warning size limits, and shrink-only
// allowlist boundaries.

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

test('an unknown top-level frontmatter key fails', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'unknown-key', '---\nname: unknown-key\ndescription: does a thing\norigin: legacy\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /unknown frontmatter key\(s\): origin/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the agent tools key fails on a skill', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'agent-tools', '---\nname: agent-tools\ndescription: does a thing\ntools: Read\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /unknown frontmatter key\(s\): tools/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


// Consolidated from tests/validate-skills-size.test.js; test registrations remain isolated in this lexical block.
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  function repo() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-size-'));
    fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'skills'), { recursive: true });
    return tmp;
  }

  function skill(tmp, rel, lines) {
    const file = path.join(tmp, rel, 'SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${Array.from({ length: lines }, (_, i) => i ? 'x' : '---').join('\n')}\n`);
  }

  function config(tmp, seed, allowed) {
    fs.writeFileSync(path.join(tmp, 'scripts', 'ci', 'skill-size-allowlist.json'), JSON.stringify({ seed, allowed }));
  }

  function validate(tmp, args = []) {
    return spawnSync('node', [path.join(tmp, 'scripts', 'ci', 'validate-skills.js'), ...args], { encoding: 'utf8' });
  }

  test('warns above 150 lines and fails an unallowlisted file above 250', () => {
    const tmp = repo();
    try {
      skill(tmp, 'skills/warn', 151);
      let res = validate(tmp);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.match(res.stderr, /151 lines.*warning budget 150/);
      skill(tmp, 'skills/fail', 251);
      res = validate(tmp);
      assert.strictEqual(res.status, 1);
      assert.match(res.stderr, /251 lines.*hard budget 250/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test('allows only seeded exceptions at or below their shrink-only baseline', () => {
    const tmp = repo();
    try {
      skill(tmp, 'skills/legacy', 260);
      config(tmp, { 'skills/legacy/SKILL.md': 260 }, ['skills/legacy/SKILL.md']);
      assert.strictEqual(validate(tmp).status, 0);
      skill(tmp, 'skills/legacy', 261);
      const grown = validate(tmp);
      assert.strictEqual(grown.status, 1);
      assert.match(grown.stderr, /exceeds grandfathered baseline 260/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test('fails allowlist growth and a delisted file regression', () => {
    const tmp = repo();
    try {
      skill(tmp, 'skills/new-exception', 251);
      config(tmp, {}, ['skills/new-exception/SKILL.md']);
      assert.match(validate(tmp).stderr, /not present in fixed seed/);
      config(tmp, { 'skills/new-exception/SKILL.md': 251 }, []);
      const delisted = validate(tmp);
      assert.strictEqual(delisted.status, 1);
      assert.match(delisted.stderr, /hard budget 250/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test('discovers module-owned skills as well as top-level skills', () => {
    const tmp = repo();
    try {
      skill(tmp, 'modules/php/skills/large', 251);
      const res = validate(tmp);
      assert.strictEqual(res.status, 1);
      assert.match(res.stderr, /modules\/php\/skills\/large\/SKILL.md/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test('counts the final logical line when SKILL.md has no trailing newline', () => {
    const tmp = repo();
    try {
      const file = path.join(tmp, 'skills', 'unterminated', 'SKILL.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Array.from({ length: 251 }, (_, i) => i ? 'x' : '---').join('\n'));
      const res = validate(tmp);
      assert.strictEqual(res.status, 1);
      assert.match(res.stderr, /251 lines.*hard budget 250/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test('strict mode accepts the 150-line boundary and rejects warning-budget overflow', () => {
    const tmp = repo();
    try {
      skill(tmp, 'skills/boundary', 150);
      const boundary = validate(tmp, ['--strict']);
      assert.strictEqual(boundary.status, 0, boundary.stderr);

      skill(tmp, 'skills/boundary', 151);
      const overflow = validate(tmp, ['--strict']);
      assert.strictEqual(overflow.status, 1);
      assert.match(overflow.stderr, /ERROR \[skills\].*151 lines.*warning budget 150/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
}

run('validate-skills');
