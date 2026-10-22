'use strict';

// Same-name command forwarders may only grant an allowed-tools token the
// matching skill already lists. A different command id is not compared.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test, run, assert } = require('./_lib/tinytest');
const { commandToolSubsetFindings } = require('../scripts/ci/validate-commands');

const ROOT = path.join(__dirname, '..');
const NO_GRANT = ['flow-drive', 'opsx-apply-resume', 'create-pr', 'git-worktree', 'precommit', 'ui-ux-verify', 'merge-prep', 'pr-summary'];

function withFixture(files, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-commands-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function commandFile(allowedTools) {
  const tools = allowedTools === undefined ? '' : `allowed-tools: ${allowedTools}\n`;
  return `---\ndescription: 'Check a target'\n${tools}---\n\nbody\n`;
}

function skillFile(name, allowedTools) {
  const tools = allowedTools === undefined ? '' : `allowed-tools: ${allowedTools}\n`;
  return `---\nname: ${name}\ndescription: 'Check a target'\n${tools}---\n\nbody\n`;
}

test('a command grant wider than its same-name skill fails', () => {
  withFixture({
    'commands/demo.md': commandFile('Bash'),
    'skills/demo/SKILL.md': skillFile('demo', 'Bash(git:*)'),
  }, (root) => {
    const findings = commandToolSubsetFindings(root);
    assert.ok(findings.some((line) => line.includes('commands/demo.md') && line.includes('Bash')), findings.join('\n'));
  });

  withFixture({
    'commands/demo.md': commandFile('Read'),
    'skills/demo/SKILL.md': skillFile('demo'),
  }, (root) => {
    const findings = commandToolSubsetFindings(root);
    assert.ok(findings.some((line) => line.includes('commands/demo.md')), findings.join('\n'));
  });
});

test('a quoted command grant that is a subset of the skill passes', () => {
  withFixture({
    'commands/demo.md': commandFile("'Read,  Grep'"),
    'skills/demo/SKILL.md': skillFile('demo', '"Read, Grep, Glob"'),
  }, (root) => {
    assert.deepStrictEqual(commandToolSubsetFindings(root), []);
  });
});

test('same-name command and skill with no allowed-tools pass', () => {
  withFixture({
    'commands/demo.md': commandFile(),
    'skills/demo/SKILL.md': skillFile('demo'),
  }, (root) => {
    assert.deepStrictEqual(commandToolSubsetFindings(root), []);
  });
});

test('a command with no allowed-tools key passes when the skill lists tools', () => {
  withFixture({
    'commands/demo.md': commandFile(),
    'skills/demo/SKILL.md': skillFile('demo', "'Read, Grep, Glob'"),
  }, (root) => {
    assert.deepStrictEqual(commandToolSubsetFindings(root), []);
  });
});

test('unrestricted Bash is not a subset of patterned Bash', () => {
  withFixture({
    'commands/demo.md': commandFile("'Bash'"),
    'skills/demo/SKILL.md': skillFile('demo', "'Bash(git:*)'"),
  }, (root) => {
    const findings = commandToolSubsetFindings(root);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /Bash/);
    assert.doesNotMatch(findings[0], /Bash\(git:\*\) is outside/);
  });
});

test('a different command id is not compared with another skill grant', () => {
  withFixture({
    'commands/inspect.md': commandFile("'Bash'"),
    'skills/fixture/SKILL.md': skillFile('fixture', "'Bash(git:*)'"),
  }, (root) => {
    assert.deepStrictEqual(commandToolSubsetFindings(root), []);
  });
});

test('INDEX.md is not checked even when a skill directory shares that name', () => {
  withFixture({
    'commands/INDEX.md': commandFile('Bash'),
    'skills/INDEX/SKILL.md': skillFile('INDEX'),
  }, (root) => {
    assert.deepStrictEqual(commandToolSubsetFindings(root), []);
  });
});

test('the real repo same-name command grants stay inside the skill grant', () => {
  const flowGuide = fs.readFileSync(path.join(ROOT, 'commands/flow-guide.md'), 'utf8');
  assert.match(flowGuide, /^allowed-tools: 'Read, Grep, Glob, Skill, Agent'$/m);
  const skillLine = fs.readFileSync(path.join(ROOT, 'skills/flow-guide/SKILL.md'), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('allowed-tools:'));
  for (const token of ['Read', 'Grep', 'Glob', 'Skill', 'Agent']) {
    assert.ok(skillLine && skillLine.includes(token), token);
  }
  for (const id of NO_GRANT) {
    const text = fs.readFileSync(path.join(ROOT, 'commands', `${id}.md`), 'utf8');
    assert.equal(text.split('\n').some((line) => line.startsWith('allowed-tools:')), false, id);
  }
  assert.match(
    fs.readFileSync(path.join(ROOT, 'commands/project-brief.md'), 'utf8'),
    /^allowed-tools: 'Read, Grep, Glob, Write'$/m
  );
  assert.deepStrictEqual(commandToolSubsetFindings(ROOT), []);
});

run('validate-commands');
