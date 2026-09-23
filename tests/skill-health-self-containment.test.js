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

test('two scripts sharing a basename in different subdirectories are not both documented by one mention', () => {
  const root = physicalTemp('dhpk skill health duplicate basename-');
  try {
    const result = lint.lintSkill(
      'duplicate-basename',
      writeSkill(root, 'duplicate-basename', validBody(
        '\nRun `run.js` to produce the report.\n',
      ), {
        scripts: {
          'a/run.js': '#!/usr/bin/env node\n',
          'b/run.js': '#!/usr/bin/env node\n',
        },
      }),
      ['duplicate-basename'],
    );
    const scriptsContract = finding(result, 'scripts-contract');

    assert.strictEqual(scriptsContract.pass, false);
    assert.match(scriptsContract.message, /run\.js/);
  } finally {
    remove(root);
  }
});

test('a symlinked script under scripts/ is not accepted as a documented public entry', () => {
  const root = physicalTemp('dhpk skill health symlinked script-');
  try {
    const skillRoot = writeSkill(root, 'symlinked-script', validBody(
      '\nRun `scripts/public.js` to produce the report.\n',
    ));
    const real = writeFile(root, 'outside-scripts/public.js', '#!/usr/bin/env node\n');
    const link = path.join(skillRoot, 'scripts', 'public.js');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link);

    const result = lint.lintSkill('symlinked-script', skillRoot, ['symlinked-script']);
    const scriptsContract = finding(result, 'scripts-contract');

    assert.strictEqual(scriptsContract.pass, false);
    assert.match(scriptsContract.message, /public\.js/);
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

run('skill-health-self-containment');
