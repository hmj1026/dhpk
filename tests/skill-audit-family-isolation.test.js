'use strict';

// Raw-directory behavior tests for the audit-family Skill cutover. The source
// roots are canonical Skills; withIsolatedSkill relocates them into a fresh
// project and denies conventional external tools. A missing Skill-local entry
// is reported explicitly so a repository-root fallback cannot satisfy RED.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerAuditFamilyFixtures } = require('./_lib/skill-audit-family-fixtures');

const ROOT = path.join(__dirname, '..');
const FIXTURES = registerAuditFamilyFixtures();

function plantHostileParent(context) {
  const parent = path.dirname(context.skillDir);
  fs.mkdirSync(path.join(parent, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(parent, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'hostile-parent-plugin' }),
  );
  fs.mkdirSync(path.join(parent, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(parent, 'scripts', 'lib', 'utils.js'),
    'throw new Error("HOSTILE_PARENT_UTILS_LOADED");\n',
  );
}

function runAuditFixture(id) {
  const fixture = FIXTURES[id];
  assert.ok(fixture, `unknown audit-family fixture: ${id}`);
  const source = path.join(ROOT, 'skills', fixture.skill);
  return withIsolatedSkill({ source, stubs: fixture.stubs }, (context) => {
    fixture.prepare(context);
    if (fixture.hostileParent) plantHostileParent(context);
    try {
      const result = context.run(fixture.entry, fixture.args, {
        env: fixture.env ? fixture.env(context) : {},
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

function runAuditFixturePair(id) {
  const fixture = FIXTURES[id];
  assert.ok(fixture, `unknown audit-family fixture: ${id}`);
  assert.ok(Array.isArray(fixture.cachedArgs), `${id} must define a cache-hit invocation`);
  const source = path.join(ROOT, 'skills', fixture.skill);
  return withIsolatedSkill({ source, stubs: fixture.stubs }, (context) => {
    fixture.prepare(context);
    try {
      const options = { env: fixture.env ? fixture.env(context) : {} };
      const first = context.run(fixture.entry, fixture.args, options);
      fixture.assert(first, context);
      const second = context.run(fixture.entry, fixture.cachedArgs, options);
      fixture.assert(second, context);
      assert.strictEqual(typeof fixture.assertPair, 'function', `${id} must assert cache artifacts`);
      fixture.assertPair(first, second, context);
      return second;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        assert.fail(`skill-local runner entry is missing: ${fixture.skill}/${fixture.entry}`);
      }
      throw error;
    }
  });
}

test('audit-family fixture registry exposes all local runner contracts', () => {
  const ids = Object.keys(FIXTURES).sort();
  assert.deepStrictEqual(ids, [
    'audit-change-verdict-clean',
    'audit-change-verdict-unsupported-source',
    'audit-harness-invalid-scope',
    'audit-harness-json-scorecard',
    'audit-project-audit-empty',
    'audit-project-audit-healthy',
    'audit-repo-intake-cached',
    'audit-repo-intake-delta',
    'audit-repo-intake-delta-no-git',
    'audit-repo-intake-scan',
    'audit-repo-intake-scan-no-git',
  ]);
  const expectedEntries = {
    'audit-harness-json-scorecard': 'scripts/harness-audit.js',
    'audit-harness-invalid-scope': 'scripts/harness-audit.js',
    'audit-change-verdict-clean': 'scripts/risk-analyze.js',
    'audit-change-verdict-unsupported-source': 'scripts/risk-analyze.js',
    'audit-project-audit-empty': 'scripts/audit.js',
    'audit-project-audit-healthy': 'scripts/audit.js',
    'audit-repo-intake-cached': 'scripts/intake_cached.js',
    'audit-repo-intake-scan': 'scripts/scan_repo.js',
    'audit-repo-intake-scan-no-git': 'scripts/scan_repo.js',
    'audit-repo-intake-delta': 'scripts/scan_delta.js',
    'audit-repo-intake-delta-no-git': 'scripts/scan_delta.js',
  };
  for (const [id, fixture] of Object.entries(FIXTURES)) {
    assert.strictEqual(fixture.entry, expectedEntries[id], id);
    assert.ok(Number.isInteger(fixture.expected.status), id);
    assert.ok(Array.isArray(fixture.expected.output) && fixture.expected.output.length > 0, id);
    assert.ok(fixture.expected.output.every((fragment) => typeof fragment === 'string' && fragment.length > 0), id);
    assert.strictEqual(fixture.evidenceKind, 'fixture', id);
  }
});

test('harness-audit Skill emits a JSON scorecard for a consumer project', () => {
  runAuditFixture('audit-harness-json-scorecard');
});

test('harness-audit Skill reports invalid scope as a failure', () => {
  runAuditFixture('audit-harness-invalid-scope');
});

test('change-verdict Skill emits a passing low-risk JSON result for a clean tree', () => {
  runAuditFixture('audit-change-verdict-clean');
});

test('change-verdict Skill emits inconclusive JSON for an unsupported source file', () => {
  runAuditFixture('audit-change-verdict-unsupported-source');
});

test('dhpk-project-audit Skill emits a healthy scorecard with twelve checks', () => {
  runAuditFixture('audit-project-audit-healthy');
});

test('dhpk-project-audit qualifies the update-docs action for an empty project', () => {
  runAuditFixture('audit-project-audit-empty');
});

test('dhpk-repo-intake scan emits its structured inventory with git evidence', () => {
  runAuditFixture('audit-repo-intake-scan');
});

test('dhpk-repo-intake scan reports a deterministic no-git fallback', () => {
  runAuditFixture('audit-repo-intake-scan-no-git');
});

test('dhpk-repo-intake cached mode publishes artifacts and reuses a stable full result', () => {
  runAuditFixturePair('audit-repo-intake-cached');
});

test('dhpk-repo-intake delta reports changed files in JSON', () => {
  runAuditFixture('audit-repo-intake-delta');
});

test('dhpk-repo-intake delta reports git unavailability as full-scan evidence', () => {
  runAuditFixture('audit-repo-intake-delta-no-git');
});

run('skill-audit-family-isolation');
