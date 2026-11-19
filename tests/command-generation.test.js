'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { run: dispositions } = require('../scripts/ci/gen-command-skill-dispositions');

function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-command-source-'));
  const put = (name, content) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  const declaration = { id: 'inspect', public_name: '/dhpk:inspect', argument_contract: '<target>', authority: 'read-only', disposition: 'thin-front-door' };
  put('skills/fixture/SKILL.md', '---\nname: fixture\ndescription: Inspect the target\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\n');
  put('skills/fixture/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [declaration] }));
  put('manifests/command-skill-dispositions.json', JSON.stringify({ schema: 'dhpk.command-skill-dispositions.v1', commands: [] }));
  const messages = [];
  const io = { write: value => messages.push(value) };
  const invoke = (generator, mode) => generator({ root, argv: [mode], stdout: io, stderr: io });
  try { callback({ root, put, declaration, invoke, messages }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('dispositions are directory-authored and aggregate-only owner/resource/argument edits fail', () => fixture(ctx => {
  assert.strictEqual(ctx.invoke(dispositions, '--write').status, 0, ctx.messages.join(''));
  const file = path.join(ctx.root, 'manifests/command-skill-dispositions.json');
  const accepted = fs.readFileSync(file, 'utf8');
  for (const [key, value] of [['skill_owner', 'other'], ['resource', 'skills/other/SKILL.md'], ['argument_contract', '--invented']]) {
    const drift = JSON.parse(accepted);
    drift.commands[0][key] = value;
    fs.writeFileSync(file, JSON.stringify(drift));
    assert.strictEqual(ctx.invoke(dispositions, '--check').status, 1);
    assert.match(ctx.messages.join(''), /inspect/);
  }
}));

test('duplicate command identity fails before any aggregate publication', () => fixture(ctx => {
  ctx.put('skills/other/SKILL.md', '---\nname: other\n---\n');
  ctx.put('skills/other/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [ctx.declaration] }));
  const file = path.join(ctx.root, 'manifests/command-skill-dispositions.json');
  const before = fs.readFileSync(file, 'utf8');
  assert.strictEqual(ctx.invoke(dispositions, '--write').status, 1);
  assert.match(ctx.messages.join(''), /duplicate.*inspect/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
}));

test('declared description and grant stay out of the disposition row', () => fixture(ctx => {
  ctx.put('skills/fixture/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [{ ...ctx.declaration, description: 'Alias of $fixture inspect; same contract.', allowed_tools: 'Read, Grep, Glob, Edit' }] }));
  assert.strictEqual(ctx.invoke(dispositions, '--write').status, 0, ctx.messages.join(''));
  const row = JSON.parse(fs.readFileSync(path.join(ctx.root, 'manifests/command-skill-dispositions.json'), 'utf8')).commands[0];
  assert.strictEqual(Object.prototype.hasOwnProperty.call(row, 'description'), false);
  assert.strictEqual(row.allowed_tools, undefined);
}));

test('command grants reject empty or multiline declarations', () => fixture(ctx => {
  for (const allowed_tools of ['', 'Read\nWrite', 42]) {
    ctx.put('skills/fixture/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [{ ...ctx.declaration, allowed_tools }] }));
    assert.strictEqual(ctx.invoke(dispositions, '--write').status, 1);
  }
}));

run('command-generation');
