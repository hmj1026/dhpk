'use strict';

// Behavioral guard for scripts/ci/validate-invocation-policy.js — covers the
// scenarios in openspec/changes/clarify-dhpk-skill-invocation-policy specs/
// skill-invocation-policy/spec.md: missing/unknown class, the dotted
// top-level substitute, user-invocable:false rejection, and command/skill
// pairing agreement.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-invocation-policy-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

function writeSkill(tmp, name, content, base = 'skills') {
  const dir = path.join(tmp, base, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

function writeModuleSkill(tmp, moduleName, skillName, content) {
  const dir = path.join(tmp, 'modules', moduleName, 'skills', skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

function writeCommand(tmp, name, content) {
  const dir = path.join(tmp, 'commands');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

function runValidator(tmp) {
  const res = spawnSync('node', [path.join(tmp, 'scripts', 'ci', 'validate-invocation-policy.js')], {
    encoding: 'utf8',
  });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

const classified = (name, cls) =>
  `---\nname: ${name}\ndescription: a skill\nmetadata:\n  dhpk-invocation-class: ${cls}\n---\nbody\n`;

test('real repo passes invocation-policy validation', () => {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-invocation-policy.js')], {
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, `expected real repo to pass, got:\n${res.stdout}${res.stderr}`);
});

test('a skill missing metadata.dhpk-invocation-class fails', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'unclassified', '---\nname: unclassified\ndescription: no class\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /missing metadata\.dhpk-invocation-class/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an optional-module skill missing its class fails just like a root skill', () => {
  const tmp = makeTempRepo();
  try {
    writeModuleSkill(tmp, 'some-module', 'module-skill', '---\nname: module-skill\ndescription: x\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /missing metadata\.dhpk-invocation-class/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an unknown class value fails', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'weird', classified('weird', 'sometimes'));
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /unknown metadata\.dhpk-invocation-class value 'sometimes'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a dotted top-level key substitute fails with the entry path', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'dotted', '---\nname: dotted\ndescription: x\nmetadata.dhpk-invocation-class: explicit-only\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /dotted top-level 'metadata\.dhpk-invocation-class' key/);
    assert.match(out, /skills\/dotted\/SKILL\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("'user-invocable: false' is rejected even for an implicit-eligible skill", () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'hidden', '---\nname: hidden\ndescription: x\nuser-invocable: false\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\nbody\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /'user-invocable: false' is rejected/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an unpaired command owns its own class', () => {
  const tmp = makeTempRepo();
  try {
    writeCommand(tmp, 'standalone.md', "---\ndescription: does a thing\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\nbody\n");
    const { status } = runValidator(tmp);
    assert.strictEqual(status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an unpaired command missing its class fails', () => {
  const tmp = makeTempRepo();
  try {
    writeCommand(tmp, 'standalone.md', "---\ndescription: does a thing\n---\nbody\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /unpaired command missing metadata\.dhpk-invocation-class/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a paired command that disagrees with its skill class fails', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'shared-name', classified('shared-name', 'explicit-only'));
    writeCommand(tmp, 'shared-name.md', "---\ndescription: does a thing\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\nbody\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /paired command declares 'implicit-eligible' but its skill .* is 'explicit-only'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a paired command that declares an unknown class value on itself fails', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'shared-name', classified('shared-name', 'explicit-only'));
    writeCommand(tmp, 'shared-name.md', "---\ndescription: does a thing\nmetadata:\n  dhpk-invocation-class: sometimes\n---\nbody\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /unknown metadata\.dhpk-invocation-class value 'sometimes'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a paired command that inherits (declares nothing) passes', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'shared-name', classified('shared-name', 'explicit-only'));
    writeCommand(tmp, 'shared-name.md', '---\ndescription: does a thing\n---\nbody\n');
    const { status } = runValidator(tmp);
    assert.strictEqual(status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Core contract: missing/unknown class, dotted substitute,
// user-invocable:false, unpaired/paired command agreement, and the canonical
// flow-drive package's explicit-only model-invocation boundary.

test('canonical flow-drive skill is present, explicit-only, and model-invocation disabled', () => {
  const skillPath = path.join(ROOT, 'skills', 'flow-drive', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), 'skills/flow-drive/SKILL.md must exist');
  const body = fs.readFileSync(skillPath, 'utf8');
  assert.match(body, /disable-model-invocation:\s*true/);
  assert.match(body, /dhpk-invocation-class:\s*explicit-only/);
});

test('a well-formed explicit-only and implicit-eligible skill both pass', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'a', classified('a', 'explicit-only'));
    writeSkill(tmp, 'b', classified('b', 'implicit-eligible'));
    const { status } = runValidator(tmp);
    assert.strictEqual(status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a Codex MCP skill grant is rejected after MCP retirement', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'new-mcp', "---\nname: dhpk-new-mcp\ndescription: new\nallowed-tools: 'Read, mcp__codex__codex'\nmetadata:\n  dhpk-invocation-class: explicit-only\n---\nbody\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /mcp__codex__\* grants are retired and forbidden/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a Codex MCP command grant is rejected after MCP retirement', () => {
  const tmp = makeTempRepo();
  try {
    writeCommand(tmp, 'new-mcp.md', "---\ndescription: new command\nallowed-tools: 'Read, mcp__codex__codex'\nmetadata:\n  dhpk-invocation-class: explicit-only\n---\nbody\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /mcp__codex__\* grants are retired and forbidden/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a non-MCP Codex command is governed by its declared invocation class', () => {
  const tmp = makeTempRepo();
  writeCommand(tmp, 'codex-security.md', "---\ndescription: frozen forwarding alias\nmetadata:\n  dhpk-invocation-class: explicit-only\n---\nbody\n");
  const commandPath = path.join(tmp, 'commands', 'codex-security.md');
  try {
    const original = fs.readFileSync(commandPath, 'utf8');
    fs.writeFileSync(commandPath, original.replace(
      'dhpk-invocation-class: explicit-only',
      'dhpk-invocation-class: implicit-eligible',
    ));
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0, out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a formerly frozen Codex MCP skill is rejected regardless of invocation class', () => {
  const tmp = makeTempRepo();
  try {
    writeSkill(tmp, 'dhpk-codex-architect', "---\nname: dhpk-codex-architect\ndescription: architecture\nallowed-tools: 'mcp__codex__codex'\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\nbody\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /mcp__codex__\* grants are retired and forbidden/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-invocation-policy');
