'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

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

function validate(tmp) {
  return spawnSync('node', [path.join(tmp, 'scripts', 'ci', 'validate-skills.js')], { encoding: 'utf8' });
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

run('validate-skills-size');
