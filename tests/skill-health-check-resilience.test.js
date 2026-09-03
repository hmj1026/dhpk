'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'skill-scope', 'scripts', 'skill-lint.js');
const lint = require(SCRIPT);

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function validSkill(name, extra = '') {
  return [
    '---',
    `name: ${name}`,
    `description: "Use when: checking ${name}. Not for: unrelated work. Output: a health report."`,
    '---',
    '',
    `# ${name}`,
    '',
    '## When NOT to Use',
    '',
    '- For unrelated work.',
    '',
    '## Output',
    '',
    '- Health report.',
    '',
    '## Verification',
    '',
    '- Run the check.',
    '',
    extra,
  ].join('\n');
}

function runLint({ skills, agents, commands, json = true }) {
  const args = [
    SCRIPT,
    '--skills-dir', skills,
    '--agents-dir', agents,
    '--commands-dir', commands,
    '--fix-hint',
  ];
  if (json) args.push('--json');
  return spawnSync('node', args, { encoding: 'utf8', cwd: ROOT, timeout: 15000 });
}

test('qualified cross-skill references are accepted in the CLI contract', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-qualified-'));
  try {
    const skills = path.join(tmp, 'skills');
    const agents = path.join(tmp, 'agents');
    const commands = path.join(tmp, 'commands');
    write(path.join(skills, 'other-skill', 'references', 'rules.md'), '# Rules\n');
    write(path.join(skills, 'other-skill', 'SKILL.md'), [
      '---',
      'name: other-skill',
      'description: "Trigger: resolve domain references. Avoid: generic health checks. Report: a resolved rule."',
      '---',
      '',
      '# Reference Skill',
      '',
      '## When NOT to Use',
      '',
      '- For generic health checks.',
      '',
      '## Output',
      '',
      '- A resolved rule.',
      '',
      '## Verification',
      '',
      '- Confirm rules.md.',
      '',
      'rules.md',
    ].join('\n'));
    write(path.join(skills, 'probe', 'SKILL.md'), validSkill('probe', [
      'Read `${CLAUDE_PLUGIN_ROOT}/skills/other-skill/references/rules.md`.',
      'Read `@skills/other-skill/references/rules.md`.',
    ].join('\n')));
    const result = runLint({ skills, agents, commands });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(!result.stdout.includes(tmp), 'capability skips must not leak host paths');
    const report = JSON.parse(result.stdout);
    assert.deepStrictEqual(
      report.findings.filter((finding) => finding.check === 'cross-skill-ref-path'),
      [],
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('malformed entries produce deterministic P1 findings with safe fix hints', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-malformed-'));
  try {
    const skills = path.join(tmp, 'skills');
    const agents = path.join(tmp, 'agents');
    const commands = path.join(tmp, 'commands');
    write(path.join(skills, 'healthy', 'SKILL.md'), validSkill('healthy'));
    write(path.join(skills, 'invalid-skill', 'SKILL.md'), '# missing frontmatter\n');
    fs.mkdirSync(path.join(skills, 'broken-skill'), { recursive: true });
    fs.symlinkSync('missing-skill.md', path.join(skills, 'broken-skill', 'SKILL.md'));
    fs.mkdirSync(agents, { recursive: true });
    fs.symlinkSync('missing-agent.md', path.join(agents, 'broken-agent.md'));
    fs.mkdirSync(path.join(tmp, 'agent-directory-target'));
    fs.symlinkSync(path.join(tmp, 'agent-directory-target'), path.join(agents, 'unreadable-agent.md'));
    write(path.join(agents, 'invalid-agent.md'), '# missing frontmatter\n');
    write(path.join(commands, 'invalid-command.md'), '# missing frontmatter\n');

    const first = runLint({ skills, agents, commands });
    const second = runLint({ skills, agents, commands });
    const markdown = runLint({ skills, agents, commands, json: false });
    assert.strictEqual(first.status, 2, `${first.stdout}\n${first.stderr}`);
    assert.strictEqual(second.status, 2, `${second.stdout}\n${second.stderr}`);
    assert.strictEqual(first.stdout, second.stdout, 'malformed findings must be deterministic');
    assert.strictEqual(first.stderr, '', first.stderr);
    assert.strictEqual(markdown.status, 2, `${markdown.stdout}\n${markdown.stderr}`);
    assert.ok(markdown.stdout.includes('# Skill Health Check Report'), markdown.stdout);
    assert.ok(!markdown.stderr.includes('Error:'), markdown.stderr);
    assert.ok(!markdown.stdout.includes(tmp), 'markdown findings must not leak host paths');
    assert.ok(!first.stdout.includes(tmp), 'JSON findings must not leak host paths');

    const report = JSON.parse(first.stdout);
    const malformed = report.findings.filter((finding) => /(?:entry|frontmatter)/.test(finding.check));
    assert.ok(malformed.length >= 5, JSON.stringify(report, null, 2));
    for (const finding of malformed) {
      assert.strictEqual(finding.severity, 'P1', JSON.stringify(finding));
      assert.ok(finding.fix, JSON.stringify(finding));
    }
    assert.ok(malformed.some((finding) => /broken-agent\.md/.test(finding.message)), JSON.stringify(report, null, 2));
    assert.ok(malformed.some((finding) => /unreadable-agent\.md/.test(finding.message)), JSON.stringify(report, null, 2));
    assert.ok(malformed.some((finding) => /invalid-command\.md/.test(finding.message)), JSON.stringify(report, null, 2));
    const invalidSkill = malformed.find((finding) => finding.skill === 'invalid-skill' && finding.check === 'frontmatter');
    assert.ok(invalidSkill, JSON.stringify(report, null, 2));
    assert.strictEqual(invalidSkill.path, 'invalid-skill/SKILL.md', JSON.stringify(invalidSkill));
    assert.ok(malformed.some((finding) => finding.path === 'broken-skill/SKILL.md'), JSON.stringify(report, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('empty When NOT to Use sections are a deterministic P1', () => {
  const finding = lint.checkWhenNotSection('## When NOT to Use\n\n');
  assert.strictEqual(finding.pass, false, JSON.stringify(finding));
  assert.strictEqual(finding.severity, 'P1');
  assert.match(finding.message, /empty/i);
  assert.ok(finding.fix);
});

test('nested subsections remain part of a non-use section', () => {
  const finding = lint.checkWhenNotSection(
    '## When NOT to Use\n\n### Alternatives\n- @skills/dhpk-tdd-workflow\n\n## Output\n- evidence\n',
    ['dhpk-tdd-workflow'],
  );
  assert.deepStrictEqual(finding, { pass: true });
});

test('unresolvable neighboring route tokens are a deterministic P1', () => {
  const finding = lint.checkWhenNotSection(
    '## When NOT to Use\n\n- Use `dhpk-missing-neighbor` instead.\n',
    ['probe', 'dhpk-real-neighbor'],
  );
  assert.strictEqual(finding.pass, false, JSON.stringify(finding));
  assert.strictEqual(finding.severity, 'P1');
  assert.match(finding.message, /dhpk-missing-neighbor/);
  assert.ok(finding.fix);
});

test('full lint preserves the stale-route skill path in its P1 finding', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-route-'));
  try {
    const skills = path.join(tmp, 'skills');
    const agents = path.join(tmp, 'agents');
    const commands = path.join(tmp, 'commands');
    write(path.join(skills, 'healthy', 'SKILL.md'), validSkill('healthy'));
    write(path.join(skills, 'stale-route', 'SKILL.md'), validSkill('stale-route')
      .replace('- For unrelated work.', '- Use `dhpk-missing-neighbor` instead.'));
    const result = runLint({ skills, agents, commands });
    assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    const finding = report.findings.find((item) => item.skill === 'stale-route' && item.check === 'when-not');
    assert.ok(finding, JSON.stringify(report, null, 2));
    assert.strictEqual(finding.severity, 'P1');
    assert.strictEqual(finding.path, 'stale-route/SKILL.md');
    assert.match(finding.message, /dhpk-missing-neighbor/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('canonical source tree has zero P1 findings while P2 advisories remain visible', () => {
  const result = spawnSync('node', [SCRIPT, '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.stats.p1, 0, JSON.stringify(report, null, 2));
  assert.ok(report.stats.p2 > 0, JSON.stringify(report, null, 2));
});

run('skill-health-check-resilience');
