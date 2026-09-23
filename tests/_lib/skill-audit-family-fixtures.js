'use strict';

// Stable authoring-test registry for the audit-family raw-directory cutover.
// Each fixture names the Skill-local entry that must execute after relocation;
// the test harness never falls back to a repository-root script.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');

let registered = false;

function writeFile(context, relative, contents) {
  const target = path.join(context.projectDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function prepareConsumerProject(context) {
  writeFile(context, 'package.json', JSON.stringify({
    name: 'audit-family-fixture',
    version: '1.0.0',
    dependencies: { 'fixture-dependency': '1.0.0' },
    scripts: {
      start: 'node src/index.js',
      dev: 'node src/index.js',
      build: 'node src/index.js',
      test: 'node tests/index.test.js',
      lint: 'node src/index.js',
      typecheck: 'node src/index.js',
      audit: 'node scripts/audit.js',
    },
  }, null, 2));
  writeFile(context, 'README.md', [
    '# Audit family fixture',
    '',
    'A disposable project used by the relocated audit runners.',
    '',
    '## Install',
    '',
    'Install steps are represented without invoking a package manager.',
    '',
    '## Usage',
    '',
    'The fixture has deterministic source and test markers.',
    '',
    '## API',
    '',
    'The API is intentionally small and local.',
    '',
    '## Verification',
    '',
    'Every report is checked for literal semantic fields.',
    '',
    '## Notes',
    '',
    'No network or host repository state is used.',
    '',
    'Additional fixture documentation keeps the audit scorecard readable.',
    'The runner receives this project through an isolated working directory.',
    'The project is disposable and is removed after each test.',
    'Tool calls are either deterministic stubs or denied by the harness.',
    'The expected reports preserve the script-owned output schema.',
    'This line makes the README long enough for the quality check.',
    'The next line is another stable fixture detail.',
    'A final detail keeps the fixture independent of the host checkout.',
  ].join('\n') + '\n');
  writeFile(context, 'LICENSE', 'Fixture license\n');
  writeFile(context, '.gitignore', '.env\nnode_modules/\n');
  writeFile(context, '.env.example', 'FIXTURE=1\n');
  writeFile(context, '.github/workflows/ci.yml', 'name: fixture\njobs: {}\n');
  writeFile(context, 'package-lock.json', '{"name":"audit-family-fixture","lockfileVersion":3}\n');
  writeFile(context, 'src/index.js', 'module.exports = 1;\n');
  writeFile(context, 'tests/index.test.js', 'require("../src/index");\n');
  writeFile(context, 'AGENTS.md', '# Fixture instructions\n');
  writeFile(context, '.mcp.json', '{}\n');
}

function prepareEmptyProject() {
  // Argument validation and unavailable-tool fallbacks do not need project
  // files. Keeping this setup empty proves those paths do not read the host.
}

function makeGitStub(mode) {
  return {
    body: [
      `const mode=${JSON.stringify(mode)};`,
      "const a=process.argv.slice(1);",
      "if(a[0]==='rev-parse'&&a[1]==='--show-toplevel')process.stdout.write(process.cwd());",
      "else if(a[0]==='rev-parse'&&(a[1]==='--verify'||a[1]==='--short'))process.stdout.write('fixture-head');",
      "else if(a[0]==='rev-parse'&&a[1]==='HEAD'&&mode==='cached')process.stdout.write('fixture-head');",
      "else if(a[0]==='rev-parse'&&a[1]==='--abbrev-ref'&&mode==='cached')process.stdout.write('fixture-branch');",
      "else if(a[0]==='branch'&&a[1]==='--show-current')process.stdout.write('fixture-branch');",
      "else if(a[0]==='config')process.stdout.write('https://example.invalid/audit-family.git');",
      "else if(a[0]==='ls-files'&&(mode==='intake-success'||mode==='cached'))process.stdout.write('README.md\\npackage.json\\nsrc/index.js\\ntests/index.test.js\\n');",
      "else if(a[0]==='diff'&&mode==='unsupported'){",
      "  if(a.includes('--name-status'))process.stdout.write('A\\tsrc/new.py\\n');",
      "  else if(a.includes('--numstat'))process.stdout.write('1\\t0\\tsrc/new.py\\n');",
      "  else if(a.includes('--no-color'))process.stdout.write('diff --git a/src/new.py b/src/new.py\\n@@ -0,0 +1 @@\\n+print(\\\"fixture\\\")\\n');",
      "}",
      "else if(a[0]==='diff'&&mode==='delta-success')process.stdout.write('M\\tsrc/index.js\\n');",
      'process.exitCode=0;',
    ].join(''),
  };
}

function makeUnavailableGitStub() {
  return { status: 127, stderr: 'UNAVAILABLE: fixture git is intentionally denied\\n' };
}

function assertCachedArtifacts(first, second, context) {
  assert.strictEqual(first.stdout, second.stdout, 'cache hit must preserve the full scanner output');
  const files = [];
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full, relative);
      else if (entry.isFile()) files.push({ relative, full });
    }
  }
  visit(context.cacheDir);
  const latestMd = files.find(({ relative }) => path.basename(relative) === 'latest.md');
  const fullJson = files.find(({ relative }) => path.basename(relative) === 'full.top10.json');
  assert.ok(latestMd, 'fresh intake must publish latest.md');
  assert.ok(fullJson, 'fresh intake must retain the full commit JSON artifact');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(fullJson.full, 'utf8')), JSON.parse(second.stdout));

  // latest.json and LATEST.json are distinct on a case-sensitive filesystem,
  // but the production paths intentionally remain unchanged and collide on
  // case-insensitive filesystems.  Resolve metadata through its documented
  // explicit path instead of requiring readdir() to expose an uppercase
  // directory entry.
  const repoCacheDir = path.dirname(path.dirname(path.dirname(fullJson.full)));
  const latestInfoPath = path.join(repoCacheDir, 'LATEST.json');
  assert.ok(fs.existsSync(latestInfoPath), 'cache metadata must have its explicit LATEST.json path');
  assert.strictEqual(JSON.parse(fs.readFileSync(latestInfoPath, 'utf8')).mode, 'full-cache-hit');

  const probe = path.join(context.cacheDir, `case-probe-${process.pid}-${Date.now()}`);
  const upperProbe = probe.toUpperCase();
  fs.writeFileSync(probe, 'case probe\n');
  const caseInsensitive = fs.existsSync(upperProbe);
  fs.rmSync(probe, { force: true });
  if (!caseInsensitive) {
    const latestJsonPath = path.join(repoCacheDir, 'latest.json');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(latestJsonPath, 'utf8')), JSON.parse(second.stdout));
  }
}

function outputText(result) {
  return `${String(result.stdout || '')}\n${String(result.stderr || '')}`;
}

function parseJson(result, id) {
  try {
    return JSON.parse(String(result.stdout || ''));
  } catch (error) {
    assert.fail(`${id} did not emit JSON: ${error.message}\n${outputText(result)}`);
  }
}

function jsonDefinition(definition, validate) {
  const expected = { ...definition.expected };
  if (!Array.isArray(expected.output) || expected.output.length === 0
    || expected.output.some((fragment) => typeof fragment !== 'string' || fragment.length === 0)) {
    throw new Error(`fixture ${definition.id} requires non-empty output fragments`);
  }
  return {
    ...definition,
    expected,
    assert(result) {
      assert.strictEqual(result.status, expected.status, `${definition.id}: ${outputText(result)}`);
      const text = outputText(result);
      for (const fragment of expected.output) {
        assert.ok(text.includes(fragment), `${definition.id} output is missing: ${fragment}\n${text}`);
      }
      validate(parseJson(result, definition.id), result);
    },
  };
}

function textDefinition(definition) {
  const expected = { ...definition.expected };
  if (!Array.isArray(expected.output) || expected.output.length === 0
    || expected.output.some((fragment) => typeof fragment !== 'string' || fragment.length === 0)) {
    throw new Error(`fixture ${definition.id} requires non-empty output fragments`);
  }
  return {
    ...definition,
    expected,
    assert(result) {
      assert.strictEqual(result.status, expected.status, `${definition.id}: ${outputText(result)}`);
      const text = outputText(result);
      for (const fragment of expected.output) {
        assert.ok(text.includes(fragment), `${definition.id} output is missing: ${fragment}\n${text}`);
      }
    },
  };
}

function registerAuditFamilyFixtures() {
  if (registered) return getFixtures();

  const fixtures = [
    jsonDefinition({
      id: 'audit-harness-json-scorecard',
      skill: 'harness-audit',
      entry: 'scripts/harness-audit.js',
      args: ['repo', '--format', 'json'],
      prepare: prepareConsumerProject,
      stubs: {},
      expected: {
        status: 0,
        output: ['"target_mode": "consumer"', '"overall_score":', '"categories": {', '"checks": ['],
      },
    }, (report) => {
      assert.strictEqual(report.scope, 'repo');
      assert.strictEqual(report.target_mode, 'consumer');
      assert.ok(Number.isInteger(report.overall_score));
      assert.ok(Number.isInteger(report.max_score));
      assert.ok(Array.isArray(report.checks) && report.checks.length > 0);
      assert.ok(report.categories && typeof report.categories === 'object');
    }),
    textDefinition({
      id: 'audit-harness-invalid-scope',
      skill: 'harness-audit',
      entry: 'scripts/harness-audit.js',
      args: ['--scope', 'not-a-scope', '--format', 'json'],
      prepare: prepareEmptyProject,
      stubs: {},
      expected: {
        status: 1,
        output: ['Invalid scope: not-a-scope'],
      },
    }),
    jsonDefinition({
      id: 'audit-change-verdict-clean',
      skill: 'change-verdict',
      entry: 'scripts/risk-analyze.js',
      args: ['--mode', 'fast'],
      prepare: prepareConsumerProject,
      stubs: { git: makeGitStub('clean') },
      expected: {
        status: 0,
        output: ['"overall_score": 0', '"risk_level": "Low"', '"gate": "PASS"'],
      },
      hostileParent: true,
    }, (report) => {
      assert.strictEqual(report.overall_score, 0);
      assert.strictEqual(report.risk_level, 'Low');
      assert.strictEqual(report.gate, 'PASS');
      assert.ok(report.dimensions && report.dimensions.breaking_surface);
    }),
    jsonDefinition({
      id: 'audit-change-verdict-unsupported-source',
      skill: 'change-verdict',
      entry: 'scripts/risk-analyze.js',
      args: ['--mode', 'fast'],
      prepare: prepareConsumerProject,
      stubs: { git: makeGitStub('unsupported') },
      expected: {
        status: 1,
        output: ['"inconclusive": true', '"risk_level": "Inconclusive"', 'src/new.py'],
      },
    }, (report) => {
      assert.strictEqual(report.inconclusive, true);
      assert.strictEqual(report.risk_level, 'Inconclusive');
      assert.strictEqual(report.gate, 'REVIEW');
      assert.ok(report.unsupported_files.includes('src/new.py'));
    }),
    jsonDefinition({
      id: 'audit-project-audit-healthy',
      skill: 'dhpk-project-audit',
      entry: 'scripts/audit.js',
      args: ['--dir', '.'],
      prepare: prepareConsumerProject,
      stubs: {},
      expected: {
        status: 0,
        output: ['"overall_score":', '"status": "Healthy"', '"dimensions": {', '"findings": {'],
      },
    }, (report) => {
      assert.strictEqual(report.status, 'Healthy');
      assert.ok(Number.isInteger(report.overall_score));
      assert.strictEqual(report.checks.length, 12);
      assert.ok(report.dimensions && report.findings && Array.isArray(report.next_actions));
    }),
    jsonDefinition({
      id: 'audit-project-audit-empty',
      skill: 'dhpk-project-audit',
      entry: 'scripts/audit.js',
      args: ['--dir', '.'],
      prepare: prepareEmptyProject,
      stubs: {},
      expected: {
        status: 2,
        output: ['"status": "Blocked"', '"/dhpk:update-docs"'],
      },
    }, (report) => {
      assert.strictEqual(report.status, 'Blocked');
      assert.ok(report.next_actions.some((action) => action.command === '/dhpk:update-docs'));
      assert.ok(!report.next_actions.some((action) => action.command === '/update-docs'));
    }),
    jsonDefinition({
      id: 'audit-repo-intake-scan',
      skill: 'dhpk-repo-intake',
      entry: 'scripts/scan_repo.js',
      args: ['--format', 'json', '--top', '10'],
      prepare: prepareConsumerProject,
      stubs: { git: makeGitStub('intake-success') },
      expected: {
        status: 0,
        output: ['"schemaVersion": 2', '"hasGit": true', '"entrypoints": [', '"testRunner":'],
      },
    }, (report) => {
      assert.strictEqual(report.schemaVersion, 2);
      assert.strictEqual(report.hasGit, true);
      assert.ok(Array.isArray(report.entrypoints));
      assert.deepStrictEqual(Object.keys(report.tests).sort(), ['e2e', 'integration', 'other', 'unit']);
      assert.ok(report.tests.other.includes('tests/index.test.js'));
      assert.ok(Array.isArray(report.buildFiles));
    }),
    jsonDefinition({
      id: 'audit-repo-intake-scan-no-git',
      skill: 'dhpk-repo-intake',
      entry: 'scripts/scan_repo.js',
      args: ['--format', 'json', '--top', '10'],
      prepare: prepareConsumerProject,
      stubs: { git: makeUnavailableGitStub() },
      expected: {
        status: 0,
        output: ['"schemaVersion": 2', '"hasGit": false', '"docs": ['],
      },
    }, (report) => {
      assert.strictEqual(report.schemaVersion, 2);
      assert.strictEqual(report.hasGit, false);
      assert.ok(Array.isArray(report.docs));
      assert.ok(Array.isArray(report.entrypoints));
      assert.deepStrictEqual(Object.keys(report.tests).sort(), ['e2e', 'integration', 'other', 'unit']);
      assert.ok(report.tests.other.includes('tests/index.test.js'));
    }),
    jsonDefinition({
      id: 'audit-repo-intake-cached',
      skill: 'dhpk-repo-intake',
      entry: 'scripts/intake_cached.js',
      args: ['--mode', 'full', '--format', 'json', '--top', '10'],
      cachedArgs: ['--mode', 'auto', '--format', 'json', '--top', '10'],
      prepare: prepareConsumerProject,
      env: (context) => ({ CLAUDE_REPO_INTAKE_CACHE_DIR: context.cacheDir }),
      stubs: { git: makeGitStub('cached') },
      expected: {
        status: 0,
        output: ['"schemaVersion": 2', '"hasGit": true', '"packageManager"'],
      },
    }, (report) => {
      assert.strictEqual(report.schemaVersion, 2);
      assert.strictEqual(report.hasGit, true);
      assert.ok(typeof report.packageManager === 'string');
    }),
    jsonDefinition({
      id: 'audit-repo-intake-delta',
      skill: 'dhpk-repo-intake',
      entry: 'scripts/scan_delta.js',
      args: ['--base', 'HEAD', '--format', 'json'],
      prepare: prepareConsumerProject,
      stubs: { git: makeGitStub('delta-success') },
      expected: {
        status: 0,
        output: ['"shouldRunFull": false', '"changedFiles": {', 'src/index.js'],
      },
    }, (report) => {
      assert.strictEqual(report.shouldRunFull, false);
      assert.ok(report.changedFiles.modified.includes('src/index.js'));
      assert.ok(Array.isArray(report.reasons));
    }),
    jsonDefinition({
      id: 'audit-repo-intake-delta-no-git',
      skill: 'dhpk-repo-intake',
      entry: 'scripts/scan_delta.js',
      args: ['--base', 'HEAD', '--format', 'json'],
      prepare: prepareEmptyProject,
      stubs: { git: makeUnavailableGitStub() },
      expected: {
        status: 0,
        output: ['"shouldRunFull": true', '"git-diff-failed"', '"changedFiles": {'],
      },
    }, (report) => {
      assert.strictEqual(report.shouldRunFull, true);
      assert.deepStrictEqual(report.reasons, ['git-diff-failed']);
      assert.strictEqual(report.changedFiles.added.length, 0);
    }),
  ];

  const cached = fixtures.find((fixture) => fixture.id === 'audit-repo-intake-cached');
  cached.assertPair = assertCachedArtifacts;

  for (const fixture of fixtures) registerFixture(fixture);
  registered = true;
  return getFixtures();
}

module.exports = { registerAuditFamilyFixtures };
