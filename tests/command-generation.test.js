'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { run: dispositions } = require('../scripts/ci/gen-command-skill-dispositions');
const { run: forwarders } = require('../scripts/ci/gen-command-forwarders');

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

test('command forwarders have deterministic bytes and detect hand edits', () => fixture(ctx => {
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 0, ctx.messages.join(''));
  const file = path.join(ctx.root, 'commands/inspect.md');
  const expected = "---\ndescription: 'Inspect the target'\nargument-hint: '<target>'\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\n\nLoad `skills/fixture/SKILL.md` and follow the owning Skill with `$ARGUMENTS`.\nKeep its argument contract, authority boundary, verification, and output.\n";
  assert.strictEqual(fs.readFileSync(file, 'utf8'), expected);
  assert.strictEqual(ctx.invoke(forwarders, '--check').status, 0);
  fs.appendFileSync(file, '\nmanual edit\n');
  assert.strictEqual(ctx.invoke(forwarders, '--check').status, 1);
  assert.match(ctx.messages.join(''), /commands\/inspect.md/);
}));

test('explicit-only generated commands retain the Host invocation lock', () => fixture(ctx => {
  ctx.put('skills/fixture/SKILL.md', '---\nname: fixture\ndescription: Explicit task\nmetadata:\n  dhpk-invocation-class: explicit-only\n---\n');
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 0);
  const bytes = fs.readFileSync(path.join(ctx.root, 'commands/inspect.md'), 'utf8');
  assert.strictEqual(bytes, "---\ndescription: 'Explicit task'\nargument-hint: '<target>'\ndisable-model-invocation: true\nmetadata:\n  dhpk-invocation-class: explicit-only\n---\n\nLoad `skills/fixture/SKILL.md` and follow the owning Skill with `$ARGUMENTS`.\nKeep its argument contract, authority boundary, verification, and output.\n");
}));

test('existing folded Skill descriptions generate a valid compact forwarder', () => fixture(ctx => {
  ctx.put('skills/fixture/SKILL.md', '---\nname: fixture\ndescription: >\n  Inspect the selected\n  target safely\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\n');
  const result = ctx.invoke(forwarders, '--write');
  assert.strictEqual(result.status, 0, ctx.messages.join(''));
  assert.ok(fs.readFileSync(path.join(ctx.root, 'commands/inspect.md'), 'utf8').includes("description: 'Inspect the selected target safely'"));
}));

test('removed declarations retire only unchanged receipt-owned forwarders', () => fixture(ctx => {
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 0);
  ctx.put('commands/host-only.md', 'unowned Host command\n');
  ctx.put('skills/fixture/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [] }));
  assert.strictEqual(ctx.invoke(dispositions, '--write').status, 0);
  assert.strictEqual(ctx.invoke(forwarders, '--check').status, 1);
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 0, ctx.messages.join(''));
  assert.strictEqual(fs.existsSync(path.join(ctx.root, 'commands/inspect.md')), false);
  assert.strictEqual(fs.readFileSync(path.join(ctx.root, 'commands/host-only.md'), 'utf8'), 'unowned Host command\n');
  assert.strictEqual(ctx.invoke(forwarders, '--check').status, 0);
}));

test('modified stale forwarders and their receipt survive failed cleanup', () => fixture(ctx => {
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 0);
  const ledger = path.join(ctx.root, 'manifests/command-forwarder-copies.json');
  const before = fs.readFileSync(ledger, 'utf8');
  fs.appendFileSync(path.join(ctx.root, 'commands/inspect.md'), '\nconsumer edit\n');
  ctx.put('skills/fixture/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [] }));
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 1);
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), before);
  assert.ok(fs.readFileSync(path.join(ctx.root, 'commands/inspect.md'), 'utf8').endsWith('consumer edit\n'));
}));

test('forwarder ownership rejects traversal entries and symlink cleanup before mutations', () => fixture(ctx => {
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 0);
  const ledger = path.join(ctx.root, 'manifests/command-forwarder-copies.json');
  const before = fs.readFileSync(ledger, 'utf8');
  const malformed = JSON.parse(before);
  malformed.files['../outside.md'] = '0'.repeat(64);
  fs.writeFileSync(ledger, JSON.stringify(malformed));
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 1);
  fs.writeFileSync(ledger, before);
  ctx.put('skills/fixture/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [] }));
  const command = path.join(ctx.root, 'commands/inspect.md');
  fs.renameSync(command, path.join(ctx.root, 'outside.md'));
  fs.symlinkSync('../outside.md', command);
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 1);
  assert.ok(fs.lstatSync(command).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), before);
}));

test('forwarder-specific grants stay distinct from broader owner tools and dispositions', () => fixture(ctx => {
  ctx.put('skills/fixture/SKILL.md', '---\nname: fixture\ndescription: Inspect target\nallowed-tools: Read, Write, Edit, Bash\n---\n');
  ctx.put('skills/fixture/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [{ ...ctx.declaration, allowed_tools: 'Read, Grep, Glob, Edit' }] }));
  assert.strictEqual(ctx.invoke(forwarders, '--write').status, 0);
  assert.ok(fs.readFileSync(path.join(ctx.root, 'commands/inspect.md'), 'utf8').includes("allowed-tools: 'Read, Grep, Glob, Edit'"));
  assert.strictEqual(ctx.invoke(dispositions, '--write').status, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ctx.root, 'manifests/command-skill-dispositions.json'))).commands[0].allowed_tools, undefined);
  ctx.put('skills/fixture/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [{ ...ctx.declaration, allowed_tools: 'Read' }] }));
  assert.strictEqual(ctx.invoke(forwarders, '--check').status, 1);
}));

test('forwarder grants reject empty or multiline declarations', () => fixture(ctx => {
  for (const allowed_tools of ['', 'Read\nWrite', 42]) {
    ctx.put('skills/fixture/distribution.yaml', JSON.stringify({ schema: 'dhpk.skill-distribution.v1', commands: [{ ...ctx.declaration, allowed_tools }] }));
    assert.strictEqual(ctx.invoke(forwarders, '--write').status, 1);
  }
}));

test('legacy setup and document front-door grants retain exact declared bytes', () => {
  const root = path.join(__dirname, '..');
  for (const [id, grant] of [
    ['setup', 'Read, Grep, Glob, Bash(bash:*), Bash(node:*), Bash(git rev-parse:*), Bash(ls:*), Bash(mkdir:*), Bash(cp:*), Bash(chmod:*), Skill, AskUserQuestion'],
    ['doc-refactor', 'Read, Grep, Glob, Edit'],
    ['update-docs', 'Read, Write, Edit, Grep, Glob, Bash(bash:*), Bash(cx:*), Bash(git:*), Bash(ls:*), Bash(node:*)'],
  ]) assert.ok(fs.readFileSync(path.join(root, `commands/${id}.md`), 'utf8').includes(`allowed-tools: '${grant}'`), id);
});

run('command-generation');
