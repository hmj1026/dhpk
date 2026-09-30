'use strict';

// RED contracts for Skill-local routing and independent command/Skill
// discovery.  Every fixture lives under a disposable physical temp root so
// the linter cannot pass by reading the repository's sibling Skills.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'skill-scope', 'scripts', 'skill-lint.js');
const lint = require(SCRIPT);

function physicalTemp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function remove(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeFile(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function validBody(extra = '') {
  return [
    '## When NOT to Use',
    '',
    '- Use a different route for unrelated work.',
    '',
    '## Output',
    '',
    '- A linter report.',
    '',
    '## Verification',
    '',
    '- Run the focused check.',
    extra,
  ].join('\n');
}

function writeSkill(root, name, body, { references = {}, scripts = {} } = {}) {
  const skillRoot = path.join(root, 'skills', name);
  fs.mkdirSync(skillRoot, { recursive: true });
  writeFile(skillRoot, 'SKILL.md', [
    '---',
    `name: ${name}`,
    'description: "Use when: checking Skill routing. Not for: unrelated work. Output: a report."',
    '---',
    '',
    body,
  ].join('\n'));
  for (const [relative, content] of Object.entries(references)) {
    writeFile(skillRoot, path.join('references', relative), content);
  }
  for (const [relative, content] of Object.entries(scripts)) {
    const target = writeFile(skillRoot, path.join('scripts', relative), content);
    fs.chmodSync(target, 0o755);
  }
  return skillRoot;
}

function finding(result, check) {
  const match = result.findings.find((entry) => entry.check === check);
  assert.ok(match, `expected ${check} finding`);
  return match;
}

function runLintCli(root) {
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--skills-dir', path.join(root, 'skills'),
    '--agents-dir', path.join(root, 'agents'),
    '--commands-dir', path.join(root, 'commands'),
    '--json',
  ], { encoding: 'utf8' });
  assert.ifError(result.error);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`skill-lint JSON output was invalid: ${error.message}\n${result.stdout}`);
  }
  return { result, report };
}

test('Skills without optional references or scripts directories remain valid', () => {
  const root = physicalTemp('dhpk skill health optional dirs-');
  try {
    const result = lint.lintSkill(
      'optional-skill',
      writeSkill(root, 'optional-skill', validBody()),
      ['optional-skill'],
    );

    assert.strictEqual(finding(result, 'references-routing').pass, true);
    assert.strictEqual(finding(result, 'scripts-contract').pass, true);
  } finally {
    remove(root);
  }
});

test('reachable indirect Markdown references do not need direct SKILL routing entries', () => {
  const root = physicalTemp('dhpk skill health indirect refs-');
  try {
    const result = lint.lintSkill(
      'indirect-references',
      writeSkill(root, 'indirect-references', validBody(
        '\nRead `references/guide.md` for the procedure.\n',
      ), {
        references: {
          'guide.md': 'Continue with [the detailed procedure](indirect.md).\n',
          'indirect.md': 'The reachable indirect procedure.\n',
        },
      }),
      ['indirect-references'],
    );

    assert.strictEqual(finding(result, 'references-routing').pass, true);
  } finally {
    remove(root);
  }
});

test('an imported internal helper need not be a public SKILL entry', () => {
  const root = physicalTemp('dhpk skill health imported helper-');
  try {
    const result = lint.lintSkill(
      'imported-helper',
      writeSkill(root, 'imported-helper', validBody(
        '\nRun `scripts/public.js` to produce the report.\n',
      ), {
        scripts: {
          'public.js': "const helper = require('./internal-helper.js');\nmodule.exports = helper;\n",
          'internal-helper.js': 'module.exports = () => "report";\n',
        },
      }),
      ['imported-helper'],
    );

    assert.strictEqual(finding(result, 'scripts-contract').pass, true);
  } finally {
    remove(root);
  }
});

test('a script documented only in a reachable reference is a public entry', () => {
  const root = physicalTemp('dhpk skill health reference-documented script-');
  try {
    const result = lint.lintSkill(
      'reference-script',
      writeSkill(root, 'reference-script', validBody('\nRead `references/procedure.md` first.\n'), {
        references: { 'procedure.md': 'Run `bash scripts/detect.sh` before saving.\n' },
        scripts: { 'detect.sh': '#!/usr/bin/env bash\necho detected\n' },
      }),
      ['reference-script'],
    );
    assert.strictEqual(finding(result, 'scripts-contract').pass, true, finding(result, 'scripts-contract').message);
  } finally {
    remove(root);
  }
});

test('helpers loaded by path, quoted module name, or Python package import are internal helpers', () => {
  const root = physicalTemp('dhpk skill health dynamic helpers-');
  try {
    const result = lint.lintSkill(
      'dynamic-helpers',
      writeSkill(root, 'dynamic-helpers', validBody('\nRun `scripts/run.sh`, `scripts/analyze.js`, and `scripts/sync.py`.\n'), {
        scripts: {
          'run.sh': '#!/usr/bin/env bash\n. "$(dirname "$0")/lib/portable.sh"\npython3 "$(dirname "$0")/transport/send.py"\n',
          'lib/portable.sh': 'portable() { :; }\n',
          'transport/send.py': 'print("sent")\n',
          'analyze.js': "const { load } = require('./_lib/loader');\nmodule.exports = load('runner-utils');\n",
          '_lib/loader.js': 'module.exports = { load: (name) => name };\n',
          '_lib/runner-utils.js': 'module.exports = {};\n',
          'sync.py': 'from sync_lib.cli import main\nmain()\n',
          'sync_lib/__init__.py': '',
          'sync_lib/cli.py': 'from .utils import helper\ndef main():\n    helper()\n',
          'sync_lib/utils.py': 'def helper():\n    pass\n',
        },
      }),
      ['dynamic-helpers'],
    );
    assert.strictEqual(finding(result, 'scripts-contract').pass, true, finding(result, 'scripts-contract').message);
  } finally {
    remove(root);
  }
});

test('an undocumented script with no caller evidence is still reported', () => {
  const root = physicalTemp('dhpk skill health orphan script-');
  try {
    const result = lint.lintSkill(
      'orphan-script',
      writeSkill(root, 'orphan-script', validBody('\nRun `scripts/public.js`.\n'), {
        scripts: { 'public.js': 'module.exports = 1;\n', 'orphan.js': 'module.exports = 2;\n' },
      }),
      ['orphan-script'],
    );
    const scripts = finding(result, 'scripts-contract');
    assert.strictEqual(scripts.pass, false);
    assert.match(scripts.message, /orphan\.js/);
  } finally {
    remove(root);
  }
});

test('a documented reference directory routes the files beneath it', () => {
  const root = physicalTemp('dhpk skill health reference dir-');
  try {
    const routed = lint.lintSkill(
      'reference-dir',
      writeSkill(root, 'reference-dir', validBody('\nMode prompts live under `references/modes/`.\n'), {
        references: { 'modes/fast.md': 'fast\n', 'modes/full.md': 'full\n', 'loose.md': 'unrouted\n' },
      }),
      ['reference-dir'],
    );
    const refs = finding(routed, 'references-routing');
    assert.strictEqual(refs.pass, false, 'files outside the documented directory remain unrouted');
    assert.match(refs.message, /references\/loose\.md/);
    assert.doesNotMatch(refs.message, /modes\//);
  } finally {
    remove(root);
  }
});

test('a Markdown link that normalizes outside the Skill boundary is rejected, not silently dropped', () => {
  const root = physicalTemp('dhpk skill health markdown escape-');
  try {
    writeFile(root, 'outside.md', 'ambient content the Skill does not own\n');
    const result = lint.lintSkill(
      'markdown-escape',
      writeSkill(root, 'markdown-escape', validBody(
        '\nRead `references/guide.md` for the procedure.\n',
      ), {
        references: {
          'guide.md': 'See [the outside file](../../outside.md) for background.\n',
        },
      }),
      ['markdown-escape'],
    );
    const crossSkill = finding(result, 'cross-skill-ref-path');

    assert.strictEqual(crossSkill.pass, false);
    assert.match(crossSkill.message, /outside\.md|escapes/i);
  } finally {
    remove(root);
  }
});

test('a required local reference fails when it is absent and no sibling supplies it', () => {
  const root = physicalTemp('dhpk skill health missing local ref-');
  try {
    const result = lint.lintSkill(
      'missing-local-reference',
      writeSkill(root, 'missing-local-reference', validBody(
        '\nRead `references/required-local-only-9f8d.md` before continuing.\n',
      )),
      ['missing-local-reference'],
    );
    const crossSkill = finding(result, 'cross-skill-ref-path');

    assert.strictEqual(crossSkill.pass, false);
    assert.match(crossSkill.message, /required-local-only-9f8d\.md/);
  } finally {
    remove(root);
  }
});

test('a cross-Skill reference through a symlink is rejected', () => {
  const root = physicalTemp('dhpk skill health symlink ref-');
  try {
    writeSkill(root, 'provider', validBody());
    writeSkill(root, 'consumer', validBody(
      '\nRead `@skills/provider/references/secret.md` when needed.\n',
    ));
    const outside = writeFile(root, 'outside/secret.md', 'outside content\n');
    const link = path.join(root, 'skills', 'provider', 'references', 'secret.md');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link);

    const { report } = runLintCli(root);
    const crossSkill = report.findings.find(
      (entry) => entry.skill === 'consumer' && entry.check === 'cross-skill-ref-path',
    );

    assert.ok(crossSkill, 'expected the linter to reject the symlinked target');
    assert.match(crossSkill.message, /secret\.md|symlink|physical/i);
  } finally {
    remove(root);
  }
});

test('an explicit cross-Skill reference that escapes its parent is rejected', () => {
  const root = physicalTemp('dhpk skill health escaped ref-');
  try {
    writeSkill(root, 'provider', validBody());
    writeSkill(root, 'consumer', validBody(
      '\nRead `@skills/provider/references/../../outside.md` when needed.\n',
    ));

    const { report } = runLintCli(root);
    const crossSkill = report.findings.find(
      (entry) => entry.skill === 'consumer' && entry.check === 'cross-skill-ref-path',
    );

    assert.ok(crossSkill, 'expected the linter to reject the escaped target');
    assert.match(crossSkill.message, /outside\.md|escapes|missing/i);
  } finally {
    remove(root);
  }
});

test('an independent Skill and command do not require a pairing counterpart', () => {
  const root = physicalTemp('dhpk skill health independent pair-');
  try {
    const commands = path.join(root, 'commands');
    fs.mkdirSync(commands, { recursive: true });
    writeFile(commands, 'standalone-command.md', '# Standalone command\n');

    const findings = lint.detectOrphans(
      ['standalone-skill'],
      ['standalone-command.md'],
      commands,
    );

    assert.deepStrictEqual(findings, []);
  } finally {
    remove(root);
  }
});

test('an explicit command reference to a missing Skill remains detectable', () => {
  const root = physicalTemp('dhpk skill health broken target-');
  try {
    const commands = path.join(root, 'commands');
    fs.mkdirSync(commands, { recursive: true });
    writeFile(
      commands,
      'broken-command.md',
      'Run `@skills/missing-explicit-skill/SKILL.md` for this operation.\n',
    );

    const findings = lint.detectOrphans(
      [],
      ['broken-command.md'],
      commands,
    );

    assert.ok(
      findings.some((entry) => /missing-explicit-skill/.test(entry.message)),
      'expected an explicit missing Skill target finding',
    );
  } finally {
    remove(root);
  }
});

// Consolidated suite block: skill-health-check-lint.
{
  test('missing agents directory returns capability skips for agent checks', () => {
    const root = physicalTemp('dhpk-skill-health-check-');
    try {
      writeSkill(root, 'probe', validBody());
      const skillResults = lint.findSkillDirs(path.join(root, 'skills'))
        .map((dir) => lint.lintSkill(path.basename(dir), dir));
      const invalidRefs = lint.detectInvalidAgentRefs(skillResults, path.join(root, 'missing-agents'));
      const toolsSyntax = lint.detectAgentToolsSyntax(path.join(root, 'missing-agents'));

      assert.deepStrictEqual(invalidRefs.findings, []);
      assert.deepStrictEqual(toolsSyntax.findings, []);
      assert.deepStrictEqual(invalidRefs.skipped.map((skip) => skip.check), ['agent-ref-validity']);
      assert.deepStrictEqual(toolsSyntax.skipped.map((skip) => skip.check), ['agent-tools-syntax']);
    } finally {
      remove(root);
    }
  });

  test('command files exclude non-invocable markdown docs', () => {
    const root = physicalTemp('dhpk-skill-health-commands-');
    try {
      const commands = path.join(root, 'commands');
      fs.mkdirSync(commands);
      writeFile(root, 'commands/INDEX.md', '# Index\n');
      writeFile(root, 'commands/README.md', '# Read me\n');
      writeFile(root, 'commands/smart-commit.md', '# Smart commit\n');

      const result = lint.commandFilesForDir(commands);
      assert.deepStrictEqual(result, { commandFiles: ['smart-commit.md'], skipped: false });
    } finally {
      remove(root);
    }
  });

  test('independent commands and Skills do not require pairing', () => {
    const root = physicalTemp('dhpk-skill-health-pairing-');
    try {
      const commands = path.join(root, 'commands');
      fs.mkdirSync(commands);
      writeFile(root, 'commands/smart-commit.md', 'Follow the `git-smart-commit` skill workflow.\n');
      writeFile(root, 'commands/create-dev.md', 'This is the explicit entry point to `dhpk:dhpk-adaptive-dev-workflow`.\n');

      const findings = lint.detectOrphans(
        ['git-smart-commit', 'dhpk-adaptive-dev-workflow', 'unpaired-skill'],
        ['smart-commit.md', 'create-dev.md'],
        commands,
      );

      assert.deepStrictEqual(findings, []);
    } finally {
      remove(root);
    }
  });
}

// Consolidated suite block: skill-health-check-resilience.
{
  const writeResilienceFile = (root, relative, content) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  };

  function validResilienceSkill(
    name,
    extra = '',
    description = `Use when: checking ${name}. Not for: unrelated work. Output: a health report.`,
  ) {
    return [
      '---',
      `name: ${name}`,
      `description: "${description}"`,
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

  function runLintWithFixHint({ skills, agents, commands, json = true }) {
    const args = [
      SCRIPT,
      '--skills-dir', skills,
      '--agents-dir', agents,
      '--commands-dir', commands,
      '--fix-hint',
    ];
    if (json) args.push('--json');
    return spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT, timeout: 15000 });
  }

  test('qualified cross-skill references are accepted in the CLI contract', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-qualified-'));
    try {
      const skills = path.join(root, 'skills');
      const agents = path.join(root, 'agents');
      const commands = path.join(root, 'commands');
      writeResilienceFile(root, 'skills/other-skill/references/rules.md', '# Rules\n');
      writeResilienceFile(root, 'skills/other-skill/SKILL.md', [
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
      writeResilienceFile(root, 'skills/probe/SKILL.md', validResilienceSkill('probe', [
        'Read `${CLAUDE_PLUGIN_ROOT}/skills/other-skill/references/rules.md`.',
        'Read `@skills/other-skill/references/rules.md`.',
      ].join('\n')));
      const result = runLintWithFixHint({ skills, agents, commands });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.ok(!result.stdout.includes(root), 'capability skips must not leak host paths');
      const report = JSON.parse(result.stdout);
      assert.deepStrictEqual(
        report.findings.filter((finding) => finding.check === 'cross-skill-ref-path'),
        [],
      );
    } finally {
      remove(root);
    }
  });

  test('malformed entries produce deterministic P1 findings with safe fix hints', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-malformed-'));
    try {
      const skills = path.join(root, 'skills');
      const agents = path.join(root, 'agents');
      const commands = path.join(root, 'commands');
      writeResilienceFile(root, 'skills/healthy/SKILL.md', validResilienceSkill('healthy'));
      writeResilienceFile(root, 'skills/invalid-skill/SKILL.md', '# missing frontmatter\n');
      fs.mkdirSync(path.join(skills, 'broken-skill'), { recursive: true });
      fs.symlinkSync('missing-skill.md', path.join(skills, 'broken-skill', 'SKILL.md'));
      fs.mkdirSync(agents, { recursive: true });
      fs.symlinkSync('missing-agent.md', path.join(agents, 'broken-agent.md'));
      fs.mkdirSync(path.join(root, 'agent-directory-target'));
      fs.symlinkSync(path.join(root, 'agent-directory-target'), path.join(agents, 'unreadable-agent.md'));
      writeResilienceFile(root, 'agents/invalid-agent.md', '# missing frontmatter\n');
      writeResilienceFile(root, 'commands/invalid-command.md', '# missing frontmatter\n');

      const first = runLintWithFixHint({ skills, agents, commands });
      const second = runLintWithFixHint({ skills, agents, commands });
      const markdown = runLintWithFixHint({ skills, agents, commands, json: false });
      assert.strictEqual(first.status, 2, `${first.stdout}\n${first.stderr}`);
      assert.strictEqual(second.status, 2, `${second.stdout}\n${second.stderr}`);
      assert.strictEqual(first.stdout, second.stdout, 'malformed findings must be deterministic');
      assert.strictEqual(first.stderr, '', first.stderr);
      assert.strictEqual(markdown.status, 2, `${markdown.stdout}\n${markdown.stderr}`);
      assert.ok(markdown.stdout.includes('# Skill Health Check Report'), markdown.stdout);
      assert.ok(!markdown.stderr.includes('Error:'), markdown.stderr);
      assert.ok(!markdown.stdout.includes(root), 'markdown findings must not leak host paths');
      assert.ok(!first.stdout.includes(root), 'JSON findings must not leak host paths');

      const report = JSON.parse(first.stdout);
      const malformed = report.findings.filter((finding) => /(?:entry|frontmatter)/.test(finding.check));
      const expectedMalformed = [
        ['invalid-skill/SKILL.md', 'frontmatter', 'Add YAML frontmatter with name and description'],
        ['broken-skill/SKILL.md', 'skill-entry', 'Restore the symlink target or remove broken-skill/SKILL.md'],
        ['broken-agent.md', 'agent-entry', 'Restore the symlink target or remove broken-agent.md'],
        ['unreadable-agent.md', 'agent-entry', 'Restore read access to unreadable-agent.md or remove it'],
        ['invalid-agent.md', 'agent-frontmatter', 'Add the required frontmatter fields to invalid-agent.md'],
        ['invalid-command.md', 'command-frontmatter', 'Add the required frontmatter fields to invalid-command.md'],
      ];
      for (const [expectedPath, expectedCheck, expectedFix] of expectedMalformed) {
        const finding = malformed.find((item) => item.path === expectedPath && item.check === expectedCheck);
        assert.ok(finding, `missing ${expectedCheck} finding for ${expectedPath}: ${JSON.stringify(report, null, 2)}`);
        assert.strictEqual(finding.severity, 'P1', JSON.stringify(finding));
        assert.strictEqual(finding.fix, expectedFix, JSON.stringify(finding));
        assert.ok(!finding.fix.includes(root), `fix hint leaked the host path: ${JSON.stringify(finding)}`);
      }
    } finally {
      remove(root);
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
      '## When NOT to Use\n\n### Alternatives\n- @skills/tdd-workflow\n\n## Output\n- evidence\n',
      ['tdd-workflow'],
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-route-'));
    try {
      const skills = path.join(root, 'skills');
      const agents = path.join(root, 'agents');
      const commands = path.join(root, 'commands');
      writeResilienceFile(root, 'skills/healthy/SKILL.md', validResilienceSkill('healthy'));
      writeResilienceFile(root, 'skills/stale-route/SKILL.md', validResilienceSkill('stale-route')
        .replace('- For unrelated work.', '- Use `dhpk-missing-neighbor` instead.'));
      const result = runLintWithFixHint({ skills, agents, commands });
      assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout);
      const finding = report.findings.find((item) => item.skill === 'stale-route' && item.check === 'when-not');
      assert.ok(finding, JSON.stringify(report, null, 2));
      assert.strictEqual(finding.severity, 'P1');
      assert.strictEqual(finding.path, 'stale-route/SKILL.md');
      assert.match(finding.message, /dhpk-missing-neighbor/);
    } finally {
      remove(root);
    }
  });

  test('canonical source tree has zero P1 findings while P2 advisories remain visible', () => {
    const canonical = spawnSync(process.execPath, [SCRIPT, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.ifError(canonical.error);
    const canonicalReport = JSON.parse(canonical.stdout);
    assert.strictEqual(canonicalReport.stats.p1, 0, JSON.stringify(canonicalReport, null, 2));

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-health-p2-'));
    try {
      const skills = path.join(root, 'skills');
      const agents = path.join(root, 'agents');
      const commands = path.join(root, 'commands');
      const overlappingDescription = 'Use when: checking shared skill health. Not for: unrelated work. Output: a health report.';
      writeResilienceFile(root, 'skills/probe-one/SKILL.md', validResilienceSkill('probe-one', '', overlappingDescription));
      writeResilienceFile(root, 'skills/probe-two/SKILL.md', validResilienceSkill('probe-two', '', overlappingDescription));
      fs.mkdirSync(agents, { recursive: true });
      fs.mkdirSync(commands, { recursive: true });

      const result = runLintWithFixHint({ skills, agents, commands });
      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.stats.p1, 0, JSON.stringify(report, null, 2));
      assert.ok(report.stats.p2 > 0, JSON.stringify(report, null, 2));
      const overlap = report.findings.find((finding) => finding.check === 'description-overlap');
      assert.ok(overlap, JSON.stringify(report, null, 2));
      assert.strictEqual(overlap.severity, 'P2', JSON.stringify(overlap));
      assert.strictEqual(overlap.fix, 'Differentiate descriptions with distinct routing cues');
    } finally {
      remove(root);
    }
  });
}

run('skill-health-self-containment');
