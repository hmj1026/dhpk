'use strict';

// Task 4 RED coverage.  Each test describes an observable defect contract and
// is intentionally run before the corresponding implementation change.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writeFile(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
}

function initRepo() {
  const repo = tempDir('dhpk-task4-repo-');
  assert.strictEqual(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
  spawnSync('git', ['config', 'user.email', 'task4@example.test'], { cwd: repo });
  spawnSync('git', ['config', 'user.name', 'Task 4'], { cwd: repo });
  return repo;
}

test('next-step analyzer uses the exported resolveFeature API and emits JSON', () => {
  const repo = initRepo();
  try {
    const script = path.join(ROOT, 'skills', 'flow-guide', 'scripts', 'analyze.js');
    const res = spawnSync('node', [script, '--json'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PLUGIN_ROOT: ROOT },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const output = JSON.parse(res.stdout);
    assert.strictEqual(output.version, 2);
    assert.ok(output.feature_context);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('stocktake scan records only files named SKILL.md', () => {
  const globalDir = tempDir('dhpk-task4-global-skills-');
  const projectDir = tempDir('dhpk-task4-project-skills-');
  try {
    writeFile(path.join(globalDir, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: alpha\n---\n');
    writeFile(path.join(globalDir, 'alpha', 'README.md'), '# supporting documentation\n');
    writeFile(path.join(globalDir, 'alpha', 'references', 'notes.md'), '# reference\n');
    writeFile(path.join(projectDir, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: beta\n---\n');
    writeFile(path.join(projectDir, 'beta', 'guide.md'), '# guide\n');
    const script = path.join(ROOT, 'skills', 'skill-scope', 'scripts', 'scan.sh');
    const res = spawnSync('bash', [script], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        SKILL_STOCKTAKE_GLOBAL_DIR: globalDir,
        SKILL_STOCKTAKE_PROJECT_DIR: projectDir,
        SKILL_STOCKTAKE_OBSERVATIONS: path.join(projectDir, 'observations.jsonl'),
      },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const output = JSON.parse(res.stdout);
    assert.deepStrictEqual(output.skills.map((skill) => skill.name).sort(), ['alpha', 'beta']);
    assert.ok(output.skills.every((skill) => skill.path.endsWith('/SKILL.md')));
  } finally {
    fs.rmSync(globalDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('stocktake quick diff records only files named SKILL.md', () => {
  const skillsDir = tempDir('dhpk-task4-quick-skills-');
  const results = path.join(skillsDir, 'results.json');
  try {
    const skillFile = path.join(skillsDir, 'alpha', 'SKILL.md');
    writeFile(skillFile, '---\nname: alpha\ndescription: alpha\n---\n');
    writeFile(path.join(skillsDir, 'alpha', 'references', 'notes.md'), '# reference\n');
    fs.mkdirSync(path.join(skillsDir, 'project'), { recursive: true });
    writeFile(results, JSON.stringify({ evaluated_at: '2000-01-01T00:00:00Z', skills: [] }));
    const script = path.join(ROOT, 'skills', 'skill-scope', 'scripts', 'quick-diff.sh');
    const res = spawnSync('bash', [script, results], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        SKILL_STOCKTAKE_GLOBAL_DIR: skillsDir,
        SKILL_STOCKTAKE_PROJECT_DIR: path.join(skillsDir, 'project'),
      },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const output = JSON.parse(res.stdout);
    assert.deepStrictEqual(output.map((entry) => entry.path), [skillFile]);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test('release runner propagates a failed workflow through gh run watch --exit-status', () => {
  const repo = initRepo();
  const bin = path.join(repo, 'bin');
  const log = path.join(repo, 'calls.log');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(repo, 'scripts', 'release'), { recursive: true });
  writeFile(path.join(repo, 'scripts', 'release', 'package-gate.js'), '// package gate fixture\n');
  writeFile(path.join(bin, 'git'), '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\nif [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then printf "merge-commit-sha\\n"; fi\nif [ "$1" = "rev-list" ]; then printf "merge-commit-sha parent-a parent-b\\n"; fi\n', 0o755);
  writeFile(path.join(bin, 'node'), '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$CALL_LOG"\nexit 0\n', 0o755);
  writeFile(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n\nif [ "$1 $2" = "pr list" ]; then printf "merge-commit-sha\\n"; fi\nif [ "$1 $2" = "run list" ]; then printf "run-123\\n"; fi\nif [ "$1 $2" = "run watch" ]; then exit 1; fi\n', 0o755);
  try {
    const script = path.join(ROOT, 'skills', 'release-creator', 'scripts', 'release-runner.sh');
    const res = spawnSync('bash', [script, 'publish', '1.2.3', 'develop', 'main', 'v', 'release.yml'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log, DHPK_RELEASE_POLL_INTERVAL: '0' },
    });
    assert.notStrictEqual(res.status, 0);
    const calls = fs.readFileSync(log, 'utf8');
    assert.ok(calls.includes('gh run watch run-123 --exit-status'), calls);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('risk assessment reports inconclusive for an unsupported source language', () => {
  const repo = initRepo();
  try {
    writeFile(path.join(repo, 'README.md'), '# baseline\n');
    spawnSync('git', ['add', 'README.md'], { cwd: repo });
    assert.strictEqual(spawnSync('git', ['commit', '-qm', 'baseline'], { cwd: repo }).status, 0);
    writeFile(path.join(repo, 'src', 'lib.rs'), 'pub fn answer() -> i32 { 42 }\n');
    const script = path.join(ROOT, 'skills', 'change-verdict', 'scripts', 'risk-analyze.js');
    const res = spawnSync('node', [script, '--json'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PLUGIN_ROOT: ROOT },
    });
    assert.notStrictEqual(res.status, 0);
    const output = JSON.parse(res.stdout);
    assert.strictEqual(output.inconclusive, true);
    assert.match(output.reason, /unsupported|adapter|classification/i);
    assert.notStrictEqual(output.risk_level, 'Low');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('risk assessment classifies omitted source extensions by path, not by Low fallback', () => {
  const script = path.join(ROOT, 'skills', 'change-verdict', 'scripts', 'risk-analyze.js');
  const runFixture = (file, content) => {
    const repo = initRepo();
    try {
      writeFile(path.join(repo, 'README.md'), '# baseline\n');
      spawnSync('git', ['add', 'README.md'], { cwd: repo });
      assert.strictEqual(spawnSync('git', ['commit', '-qm', 'baseline'], { cwd: repo }).status, 0);
      writeFile(path.join(repo, file), content);
      return spawnSync('node', [script, '--json'], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, PLUGIN_ROOT: ROOT },
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  };

  for (const [file, content] of [
    ['src/Answer.fs', 'module Answer\nlet answer = 42\n'],
    ['src/Answer.unknown', 'answer = 42\n'],
  ]) {
    const res = runFixture(file, content);
    assert.notStrictEqual(res.status, 0, `${file} should require review`);
    const output = JSON.parse(res.stdout);
    assert.strictEqual(output.inconclusive, true, file);
    assert.match(output.reason, /unsupported|adapter|classification/i, file);
  }

  for (const [file, content] of [
    ['docs/guide.unknown', 'documentation\n'],
    ['assets/data.unknown', 'asset payload\n'],
  ]) {
    const res = runFixture(file, content);
    assert.strictEqual(res.status, 0, `${file}: ${res.stderr}`);
    const output = JSON.parse(res.stdout);
    assert.strictEqual(output.inconclusive, undefined, file);
    assert.strictEqual(output.risk_level, 'Low', file);
  }
});

test('codex CLI review passes hostile values as literal arguments without eval', () => {
  const repo = initRepo();
  const bin = path.join(repo, 'bin');
  const argsFile = path.join(repo, 'codex-args.log');
  const sideEffect = path.join(repo, 'side-effect');
  fs.mkdirSync(bin);
  try {
    writeFile(path.join(repo, 'tracked.txt'), 'before\n');
    spawnSync('git', ['add', 'tracked.txt'], { cwd: repo });
    assert.strictEqual(spawnSync('git', ['commit', '-qm', 'baseline'], { cwd: repo }).status, 0);
    writeFile(path.join(repo, 'tracked.txt'), 'after\n');
    writeFile(path.join(bin, 'codex'), '#!/bin/sh\nprintf "<%s>\\n" "$@" > "$CODEX_ARGS"\ncat >/dev/null\n', 0o755);
    const title = `$(touch ${sideEffect})`;
    const prompt = `$(touch ${sideEffect})`;
    const script = path.join(ROOT, 'skills', 'change-verdict', 'scripts', 'review-cli.sh');
    const res = spawnSync('bash', [script, '--backend', 'cli', '--title', title, '--prompt', prompt], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_ARGS: argsFile },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(sideEffect), 'hostile command substitution executed');
    const args = fs.readFileSync(argsFile, 'utf8');
    assert.ok(args.includes(`<${title}>`), args);
    assert.ok(args.includes('<--title>'), args);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('opsx context guidance resolves only its local extractor or reports unresolved', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-opsx-load-context', 'SKILL.md'), 'utf8');
  const resolution = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-opsx-load-context', 'references', 'extractor-resolution.md'), 'utf8');
  assert.match(skill, /references\/extractor-resolution\.md/);
  assert.match(resolution, /own `scripts\/` directory; never search a parent checkout, ambient plugin root/);
  assert.match(resolution, /CONTEXT_SOURCE=unresolved/);
  assert.match(resolution, /continue to Tier 2 rather than/);
  assert.doesNotMatch(skill, /bash \.claude\/scripts\/opsx-apply-resume\/extract-compact\.sh/);
});

test('pr hygiene does not infer squash from the current HEAD message', () => {
  const repo = initRepo();
  try {
    writeFile(path.join(repo, 'README.md'), '# branch\n');
    spawnSync('git', ['add', 'README.md'], { cwd: repo });
    assert.strictEqual(spawnSync('git', ['commit', '-qm', 'Squash merge of #42'], { cwd: repo }).status, 0);
    const script = path.join(ROOT, 'skills', 'change-verdict', 'scripts', 'check-unrelated-changes.sh');
    const res = spawnSync('bash', [script, '42'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /^\[skip\] not a squash merge/m);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('live guidance does not reference removed hook scripts', () => {
  const files = [
    path.join(ROOT, 'commands', 'install-hooks.md'),
    path.join(ROOT, 'skills', 'harness-govern', 'SKILL.md'),
    path.join(ROOT, 'skills', 'harness-govern', 'references', 'plugin-sync.md'),
    path.join(ROOT, 'skills', 'dhpk-project-setup', 'references', 'install-hooks-scripts.md'),
    path.join(ROOT, 'skills', 'dhpk-project-setup', 'references', 'env-config-phase.md'),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /post-edit-format\.sh|post-tool-review-state\.sh|stop-guard\.sh/, file);
  }
});

test('prompt optimization points to dated live documentation verification without volatile model pins', () => {
  const root = path.join(ROOT, 'skills', 'dhpk-prompt-optimize');
  const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const guides = fs.readFileSync(path.join(root, 'references', 'model-guides.md'), 'utf8');
  assert.match(skill, /Context7/i);
  assert.match(skill, /official.*documentation|official.*docs/i);
  assert.match(skill, /allowed-tools:[^\n]*mcp__context7__resolve-library-id/i);
  assert.match(skill, /allowed-tools:[^\n]*mcp__context7__query-docs/i);
  assert.match(skill, /allowed-tools:[^\n]*WebFetch/i);
  assert.match(skill, /allowed-tools:[^\n]*WebSearch/i);
  assert.match(skill, /2026-08-05|dated/i);
  assert.doesNotMatch(guides, /Sonnet 5|Opus 4\.8|Fable 5|Mythos 5/);
});

// Consolidated source suite: task4-consolidation.
{

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  function sectionBody(source, heading) {
    const lines = source.split(/\r?\n/);
    const start = lines.findIndex((line) => heading.test(line));
    assert.notStrictEqual(start, -1, `missing section ${heading}`);
    const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
    return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
  }

  function introduction(source) {
    const lines = source.split(/\r?\n/);
    const end = lines.findIndex((line) => /^## /.test(line));
    assert.notStrictEqual(end, -1, 'missing first section');
    return lines.slice(0, end).join('\n');
  }

  test('code tracing exposes explore, diagnose, history, and tool selection modes', () => {
    const skill = read('skills/code-trace/SKILL.md');
    const modes = sectionBody(skill, /^## Modes$/);
    for (const mode of ['explore', 'diagnose', 'history', 'select-tool']) {
      assert.match(modes, new RegExp(`\\x60${mode}\\x60`, 'i'), mode);
    }
  });

  test('change verdict exposes all read-only modes', () => {
    const skill = read('skills/change-verdict/SKILL.md');
    const modes = sectionBody(skill, /^## Modes$/);
    const readOnlyProtocol = sectionBody(skill, /^## Shared read-only protocol$/);
    for (const mode of ['code', 'pr', 'security', 'tests', 'docs', 'risk']) {
      assert.match(modes, new RegExp(`\\x60${mode}\\x60`, 'i'), mode);
    }
    assert.match(readOnlyProtocol, /read-only|read only/i);
  });

  test('change verdict shell permissions are scoped to read-only helpers', () => {
    const skill = read('skills/change-verdict/SKILL.md');
    for (const broadGrant of ['Bash(git:*)', 'Bash(node:*)', 'Bash(gh:*)', 'Bash(bash:*)']) {
      assert.doesNotMatch(skill, new RegExp(broadGrant.replace(/[()*]/g, '\\$&')), broadGrant);
    }
    assert.match(skill, /Bash\(git diff:\*\)/);
    assert.match(skill, /Bash\(node skills\/change-verdict\/scripts\/risk-analyze\.js:\*\)/);
    assert.match(skill, /Bash\(bash skills\/change-verdict\/scripts\/check-unrelated-changes\.sh:\*\)/);
  });

  test('module design uses caller leverage, deletion, seam, adapter, glossary, and ADR tests', () => {
    const skill = read('skills/dhpk-module-design/SKILL.md');
    const boundaryTests = sectionBody(skill, /^## Boundary tests\b/);
    const languageAndScenarios = sectionBody(skill, /^## Language and scenarios$/);
    const decisionsAndOutput = sectionBody(skill, /^## Decisions and output$/);
    for (const phrase of [
      'caller leverage', 'deletion test', 'interface-as-test-surface',
      'one hypothetical adapter', 'two real adapters',
    ]) assert.match(boundaryTests, new RegExp(phrase, 'i'), phrase);
    for (const phrase of ['active glossary', 'ambiguous-term', 'edge-case']) {
      assert.match(languageAndScenarios, new RegExp(phrase, 'i'), phrase);
    }
    for (const phrase of ['surprising', 'hard-to-reverse']) {
      assert.match(decisionsAndOutput, new RegExp(phrase, 'i'), phrase);
    }
    assert.doesNotMatch(skill, /Clean Architecture|Auth0|Supabase|Redux|Zustand/);
  });

  test('TDD workflow covers seams, tracer bullets, slicing, and tautological tests', () => {
    const skill = read('skills/tdd-workflow/SKILL.md');
    const standardMode = sectionBody(skill, /^## Standard TDD mode$/);
    const tautologicalTests = sectionBody(skill, /^## Tautological tests considered harmful$/);
    const workflowContract = `${standardMode}\n${tautologicalTests}`;
    for (const phrase of ['public seams', 'independent expected values', 'vertical tracer bullets', 'horizontal slicing', 'tautological', 'implementation-coupled']) {
      assert.match(workflowContract, new RegExp(phrase, 'i'), phrase);
    }
    assert.match(standardMode, /RED.*GREEN.*refactor/is);
  });

  test('TDD test guidance owns oracle, discrimination, ownership, and rejection rules', () => {
    const guide = read('skills/tdd-workflow/tests.md');
    for (const heading of ['Independent Oracles', 'Discriminating Tests', 'One Contract, One Owner', 'Rejection Checklist']) {
      assert.match(guide, new RegExp(`^## ${heading}$`, 'm'), heading);
    }
    for (const phrase of ['controlled mutation', 'fail-closed negative path', 'constants of the\\s+module under test']) {
      assert.match(guide, new RegExp(phrase, 'i'), phrase);
    }
    const skill = read('skills/tdd-workflow/SKILL.md');
    const tautology = skill.split(/^## Tautological tests considered harmful$/m)[1].split(/^## /m)[0];
    assert.match(tautology, /\[tests\.md\]\(tests\.md\)/);
    assert.doesNotMatch(tautology, /helper on both sides/i, 'rules stay in tests.md, not restated in SKILL.md');
  });

  test('root-cause workflow starts with a symptom-specific red loop and ranked falsifiable hypotheses', () => {
    const skill = read('skills/code-trace/SKILL.md');
    const diagnosis = sectionBody(skill, /^## `diagnose`$/);
    assert.match(diagnosis, /symptom into a minimal red-capable reproduction or probe/i);
    assert.match(
      diagnosis,
      /Clarify\s*→\s*Gather evidence\s*→\s*Trace and confirm\s*→\s*Design the fix\s*→\s*Preserve knowledge/,
    );
    assert.match(diagnosis, /ranked, falsifiable hypotheses/i);
    assert.match(diagnosis, /smallest confirming check/i);
  });

  test('skill audits account for cost, checkability, branches, and sediment pruning', () => {
    const skillContracts = [
      {
        name: 'skill-scope',
        source: read('skills/skill-scope/SKILL.md'),
        sections: [
          /^## Mode selection$/,
          /^## Workflow$/,
          /^## Verification$/,
        ],
      },
    ];
    for (const { name, source, sections } of skillContracts) {
      const selected = [introduction(source), ...sections.map((heading) => sectionBody(source, heading))].join('\n');
      assert.match(selected, /invocation.*cost|context.*cost/i, `${name} cost`);
      assert.match(selected, /checkable|machine-check|completion/i, `${name} completion`);
      assert.match(selected, /branch|conditional|progressive disclosure/i, `${name} branch`);
      assert.match(selected, /no-op|duplication|sediment|prun/i, `${name} pruning`);
    }
  });
}


run('task4-defects');
