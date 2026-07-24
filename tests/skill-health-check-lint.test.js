'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'skill-health-check', 'scripts', 'skill-lint.js');
const lint = require(SCRIPT);

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-check-'));
  fs.mkdirSync(path.join(tmp, 'skills', 'probe'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'skills', 'probe', 'SKILL.md'),
    [
      '---',
      'name: probe',
      'description: "Use when: probing. Not for: unrelated work. Output: result report."',
      '---',
      '',
      '# Probe Skill',
      '',
      '## When NOT to Use',
      '',
      '- For unrelated work.',
      '',
      '## Output',
      '',
      '- Result report.',
      '',
      '## Verification',
      '',
      '- Run the check.',
      '',
    ].join('\n')
  );
  return tmp;
}

test('missing agents directory returns capability skips for agent checks', () => {
  const tmp = fixture();
  try {
    const skillResults = lint.findSkillDirs(path.join(tmp, 'skills'))
      .map((dir) => lint.lintSkill(path.basename(dir), dir));
    const invalidRefs = lint.detectInvalidAgentRefs(skillResults, path.join(tmp, 'missing-agents'));
    const toolsSyntax = lint.detectAgentToolsSyntax(path.join(tmp, 'missing-agents'));

    assert.deepStrictEqual(invalidRefs.findings, []);
    assert.deepStrictEqual(toolsSyntax.findings, []);
    assert.deepStrictEqual(invalidRefs.skipped.map((skip) => skip.check), ['agent-ref-validity']);
    assert.deepStrictEqual(toolsSyntax.skipped.map((skip) => skip.check), ['agent-tools-syntax']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('command files exclude non-invocable markdown docs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-commands-'));
  try {
    const commands = path.join(tmp, 'commands');
    fs.mkdirSync(commands);
    fs.writeFileSync(path.join(commands, 'INDEX.md'), '# Index\n');
    fs.writeFileSync(path.join(commands, 'README.md'), '# Read me\n');
    fs.writeFileSync(path.join(commands, 'smart-commit.md'), '# Smart commit\n');

    const result = lint.commandFilesForDir(commands);
    assert.deepStrictEqual(result, { commandFiles: ['smart-commit.md'], skipped: false });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('command pairing recognizes documented skill-name wording', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-pairing-'));
  try {
    const commands = path.join(tmp, 'commands');
    fs.mkdirSync(commands);
    fs.writeFileSync(
      path.join(commands, 'smart-commit.md'),
      'Follow the `git-smart-commit` skill workflow.\n'
    );
    fs.writeFileSync(
      path.join(commands, 'create-dev.md'),
      'This is the explicit entry point to `dhpk:adaptive-dev-workflow`.\n'
    );

    const findings = lint.detectOrphans(
      ['git-smart-commit', 'adaptive-dev-workflow', 'unpaired-skill'],
      ['smart-commit.md', 'create-dev.md'],
      commands
    );

    assert.deepStrictEqual(
      findings.map((finding) => finding.message),
      ['Skill "unpaired-skill" has no command referencing it']
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('skill-health-check-lint');
