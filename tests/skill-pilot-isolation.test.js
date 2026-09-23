'use strict';

// Raw-directory pilot coverage. The source roots are canonical Skills, while
// each run is relocated by withIsolatedSkill into a disposable project and all
// conventional tools are stubbed. The old repository runner paths are never a
// fallback: until the Skill-local entries exist, each case fails explicitly at
// the missing entry boundary.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerPilotFixtures } = require('./_lib/skill-pilot-fixtures');

const ROOT = path.join(__dirname, '..');
const FIXTURES = registerPilotFixtures();

function gitStub() {
  return {
    body: [
      "const a=process.argv.slice(1);",
      "if(a[0]==='rev-parse'&&a[1]==='--show-toplevel')process.stdout.write(process.cwd());",
      "else if(a[0]==='rev-parse'&&a[1]==='--short')process.stdout.write('fixture123');",
      "else if(a[0]==='rev-parse'&&a[1]==='HEAD')process.stdout.write('fixture-head');",
      "else if(a[0]==='config')process.stdout.write('https://example.invalid/pilot.git');",
      "else if(a[0]==='status')process.stdout.write('## pilot-fixture');",
      'process.exitCode=0;',
    ].join(''),
  };
}

function npmStub() {
  return {
    body: [
      "const fs=require('fs');",
      "const a=process.argv.slice(1);",
      "const i=a.indexOf('run');",
      "const task=i>=0?a[i+1]:'';",
      "if(process.env.PILOT_TOOL_LOG)fs.appendFileSync(process.env.PILOT_TOOL_LOG,task+' '+JSON.stringify(a)+'\\n');",
      "process.stdout.write(task+' fixture ran\\n');",
      "const failures=(process.env.PILOT_FAIL_TASKS||'').split(',').filter(Boolean);",
      "if(failures.includes(task)){process.stderr.write('fixture failure '+task+'\\n');process.exitCode=Number(process.env.PILOT_FAIL_CODE||7);}else process.exitCode=0;",
    ].join(''),
  };
}

function prepareProject(context, scripts, args) {
  fs.writeFileSync(path.join(context.projectDir, 'package.json'), JSON.stringify({
    name: 'pilot-fixture',
    scripts,
  }, null, 2));
  if (args.includes('integration/example.js')) {
    fs.mkdirSync(path.join(context.projectDir, 'integration'), { recursive: true });
    fs.writeFileSync(path.join(context.projectDir, 'integration', 'example.js'), 'fixture integration\n');
  }
  if (args.includes('e2e/example.js')) {
    fs.mkdirSync(path.join(context.projectDir, 'e2e'), { recursive: true });
    fs.writeFileSync(path.join(context.projectDir, 'e2e', 'example.js'), 'fixture e2e\n');
  }
}

function runPilot(id) {
  const fixture = FIXTURES[id];
  assert.ok(fixture, `unknown pilot fixture: ${id}`);
  const source = path.join(ROOT, 'skills', fixture.skill);
  const stubs = { git: gitStub() };
  if (!fixture.unavailablePackageTool) stubs.npm = npmStub();
  return withIsolatedSkill({ source, stubs }, (context) => {
    prepareProject(context, fixture.projectScripts, fixture.args);
    try {
      const result = context.run(fixture.entry, fixture.args, {
        env: { ...(fixture.env || {}) },
      });
      fixture.assert(result, context);
      return result;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        assert.fail(`skill-local runner entry is missing: ${fixture.skill}/${fixture.entry}`);
      }
      throw error;
    }
  });
}

test('pilot fixture registry exposes stable IDs with semantic runner expectations', () => {
  const ids = Object.keys(FIXTURES).sort();
  assert.deepStrictEqual(ids, [
    'pilot-precommit-fast-success',
    'pilot-precommit-first-step-failure',
    'pilot-precommit-full-success',
    'pilot-precommit-package-tool-unavailable',
    'pilot-repo-verify-fast-success',
    'pilot-repo-verify-first-step-failure',
    'pilot-repo-verify-full-forwarding',
    'pilot-repo-verify-package-tool-unavailable',
  ]);
  for (const fixture of Object.values(FIXTURES)) {
    assert.ok(fixture.entry.startsWith('scripts/'), fixture.id);
    assert.strictEqual(fixture.expected.status, 0, fixture.id);
    assert.ok(fixture.expected.steps && Object.keys(fixture.expected.steps).length > 0, fixture.id);
    assert.strictEqual(fixture.evidenceKind, 'fixture', fixture.id);
  }
});

test('precommit Skill fast mode reports semantic success for lint and unit steps', () => {
  runPilot('pilot-precommit-fast-success');
});

test('precommit Skill full mode reports semantic success including build', () => {
  runPilot('pilot-precommit-full-success');
});

test('precommit Skill reports the first failing step and continues evidence collection', () => {
  runPilot('pilot-precommit-first-step-failure');
});

test('precommit Skill reports an unavailable package tool as non-pass evidence', () => {
  runPilot('pilot-precommit-package-tool-unavailable');
});

test('repo-verify Skill fast mode reports semantic success for lint and unit steps', () => {
  runPilot('pilot-repo-verify-fast-success');
});

test('repo-verify Skill full mode forwards integration and e2e arguments', () => {
  runPilot('pilot-repo-verify-full-forwarding');
});

test('repo-verify Skill reports the first failing step without changing CLI status', () => {
  runPilot('pilot-repo-verify-first-step-failure');
});

test('repo-verify Skill reports an unavailable package tool as non-pass evidence', () => {
  runPilot('pilot-repo-verify-package-tool-unavailable');
});

run('skill-pilot-isolation');
