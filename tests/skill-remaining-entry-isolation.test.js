'use strict';

// Raw-directory RED coverage for the remaining public runtime entries.  Every
// command runs from a relocated physical Skill and a disposable fixture
// project; provider, GitHub, curl, Git, jq, and ripgrep boundaries are either
// denied or explicitly delegated to fixture-local data.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  SOURCES,
  registerRemainingFixtures,
  runRemainingEntryFixture,
} = require('./_lib/skill-remaining-entry-fixtures');

const ROOT = path.join(__dirname, '..');
const FIXTURES = registerRemainingFixtures();

const EXPECTED_ENTRIES = Object.freeze({
  'remaining-ios-iconify-generate': ['ios-icon-gen', 'scripts/iconify_gen.sh'],
  'remaining-ios-swift-list': ['ios-icon-gen', 'scripts/generate_icons.swift'],
  'remaining-code-trace-analyze-function-calls': ['code-trace', 'scripts/diagnose/analyze-function-calls.sh'],
  'remaining-code-trace-check-tools-unavailable': ['code-trace', 'scripts/diagnose/check-tools.sh'],
  'remaining-code-trace-find-polluter-multi-file': ['code-trace', 'scripts/diagnose/find-polluter.sh'],
  'remaining-code-trace-generate-flow-diagram': ['code-trace', 'scripts/diagnose/generate-flow-diagram.sh'],
  'remaining-code-trace-search-database-queries': ['code-trace', 'scripts/diagnose/search-database-queries.sh'],
  'remaining-code-trace-trace-data-flow': ['code-trace', 'scripts/diagnose/trace-data-flow.sh'],
  'remaining-deploy-list-generate': ['deploy-list', 'scripts/deploy-list.sh'],
  'remaining-deploy-list-check-golden': ['deploy-list', 'scripts/check-golden.sh'],
  'remaining-feature-verify-api-success': ['feature-verify', 'scripts/api-exec.sh'],
  'remaining-feature-verify-api-transport-failure': ['feature-verify', 'scripts/api-exec.sh'],
  'remaining-feature-verify-health-retry-success': ['feature-verify', 'scripts/health-probe.sh'],
  'remaining-feature-verify-health-retry-exhausted': ['feature-verify', 'scripts/health-probe.sh'],
  'remaining-session-usage-audit-report': ['session-usage-audit', 'scripts/session-usage-audit.js'],
  'remaining-session-usage-audit-issue-approval': ['session-usage-audit', 'scripts/session-usage-audit.js'],
  'remaining-session-usage-audit-no-ambient-package-root': ['session-usage-audit', 'scripts/session-usage-audit.js'],
  'remaining-harness-govern-inventory': ['harness-govern', 'scripts/harness-inventory.sh'],
  'remaining-harness-govern-scenarios-not-run': ['harness-govern', 'scripts/harness-scenarios.sh'],
  'remaining-harness-govern-test-not-run': ['harness-govern', 'scripts/test-harness.sh'],
  'remaining-harness-govern-sync-self-test': ['harness-govern', 'scripts/multi_ai_sync.py'],
  'remaining-change-verdict-unrelated-squash-warning': ['change-verdict', 'scripts/check-unrelated-changes.sh'],
  'remaining-change-verdict-unrelated-merge-skip': ['change-verdict', 'scripts/check-unrelated-changes.sh'],
  'remaining-change-verdict-review-cli-stub': ['change-verdict', 'scripts/review-cli.sh'],
  'remaining-skill-scope-scan': ['skill-scope', 'scripts/scan.sh'],
  'remaining-skill-scope-lint': ['skill-scope', 'scripts/skill-lint.js'],
  'remaining-skill-scope-quick-diff': ['skill-scope', 'scripts/quick-diff.sh'],
  'remaining-skill-scope-save-results': ['skill-scope', 'scripts/save-results.sh'],
  'remaining-skill-forge-scan-skills': ['skill-forge', 'scripts/scan-skills.sh'],
  'remaining-skill-forge-scan-rules': ['skill-forge', 'scripts/scan-rules.sh'],
  'remaining-flow-guide-pre-route-local-table': ['flow-guide', 'scripts/pre-route.sh'],
});

function ignored(name) {
  return name === '.git' || name === '.cache' || name === '__pycache__' || name.endsWith('.pyc');
}

function fingerprint(root) {
  const visit = (filePath) => {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) throw new Error(`canonical source is symlinked: ${filePath}`);
    const hash = crypto.createHash('sha256');
    if (stat.isDirectory()) {
      hash.update('dir\0');
      for (const name of fs.readdirSync(filePath).sort()) {
        if (ignored(name)) continue;
        hash.update(name);
        hash.update('\0');
        hash.update(visit(path.join(filePath, name)));
        hash.update('\0');
      }
    } else if (stat.isFile()) {
      hash.update('file\0');
      hash.update(fs.readFileSync(filePath));
    } else {
      throw new Error(`canonical source contains non-regular resource: ${filePath}`);
    }
    return hash.digest('hex');
  };
  return visit(root);
}

const SOURCE_DIGESTS = new Map(Object.entries(SOURCES).map(([id, skill]) => {
  const source = path.join(ROOT, 'skills', skill);
  assert.strictEqual(fs.realpathSync(source), path.resolve(source), `${id} source must be physical`);
  return [id, fingerprint(source)];
}));

test('remaining-entry registry exposes exactly one fixture mapping per public entry', () => {
  assert.deepStrictEqual(Object.keys(FIXTURES).sort(), Object.keys(EXPECTED_ENTRIES).sort());
  for (const [id, [skill, entry]] of Object.entries(EXPECTED_ENTRIES)) {
    const fixture = FIXTURES[id];
    assert.ok(fixture, `missing fixture ${id}`);
    assert.strictEqual(fixture.skill, skill, `${id} Skill mismatch`);
    assert.strictEqual(fixture.entry, entry, `${id} entry must remain Skill-relative`);
    assert.ok(Number.isInteger(fixture.expected.status), `${id} expected status is required`);
    assert.ok(
      (Array.isArray(fixture.expected.output) && fixture.expected.output.length > 0)
      || typeof fixture.expected.stdout === 'string'
      || typeof fixture.expected.stderr === 'string',
      `${id} expected output evidence is required`,
    );
  }
});

function assertSourcesUnchanged() {
  for (const [id, expected] of SOURCE_DIGESTS) {
    assert.strictEqual(fingerprint(path.join(ROOT, 'skills', SOURCES[id])), expected, `canonical ${id} source changed during fixture execution`);
  }
}

for (const id of Object.keys(EXPECTED_ENTRIES)) {
  test(`isolated remaining-entry fixture ${id}`, () => {
    const evidence = runRemainingEntryFixture(id);
    assert.strictEqual(evidence.fixtureId, id);
    assert.strictEqual(evidence.evidenceKind, 'fixture');
    assert.strictEqual(evidence.hostStatus, 'NOT_RUN');
    assertSourcesUnchanged();
  });
}

test('canonical Skill sources remain unchanged after remaining-entry relocations', () => {
  assertSourcesUnchanged();
});

run('skill-remaining-entry-isolation');
