'use strict';

// Reference-integrity guard test. Proves the checker both (a) passes clean on
// the real repo tree — every dangling ref found by the harness-consistency-audit
// is fixed — and (b) actually catches the defect classes it exists to prevent
// (dangling @rules refs, unresolvable /dhpk: refs, dangling ${CLAUDE_PLUGIN_ROOT}
// paths, and predecessor-brand strings). The RED-capable assertions stand in for
// running against the pre-fix tree.

const { scanRepo, scanText } = require('../scripts/ci/validate-references');
const { test, run, assert } = require('./_lib/tinytest');

// (1) GREEN on the real tree.
test('real tree has zero reference-integrity findings', () => {
  const findings = scanRepo();
  const detail = findings
    .map((f) => `  [check ${f.check}] ${f.file}: ${f.detail}`)
    .join('\n');
  assert.strictEqual(findings.length, 0, `expected 0 findings, got ${findings.length}:\n${detail}`);
});

// (2) RED-capable: each check flags its defect class on synthetic input.
function checksHit(text) {
  return new Set(scanText('synthetic/fixture.md', text).map((f) => f.check));
}

test('check 1 flags a dangling @rules ref', () => {
  assert.ok(checksHit('see @rules/nonexistent-rule.md for details').has(1));
});

test('check 2 flags an unresolvable /dhpk command ref', () => {
  assert.ok(checksHit('run /dhpk:totally-not-a-command now').has(2));
});

test('check 3 flags a dangling ${CLAUDE_PLUGIN_ROOT} path ref', () => {
  assert.ok(checksHit('exec ${CLAUDE_PLUGIN_ROOT}/scripts/does-not-exist.sh').has(3));
});

test('check 4 flags a predecessor-brand string', () => {
  assert.ok(checksHit('glob ~/.claude/plugins/**/sd0x-dev-flow/rules/x.md').has(4));
});

test('check 5 flags a bare execution-policy.md reference without the plugin-root fallback', () => {
  assert.ok(
    checksHit('... see .claude/rules/execution-policy.md for the gate ...').has(5)
  );
});

test('check 5 does not flag a dual-path fallback block', () => {
  const text = 'project .claude/rules/execution-policy.md if present, else ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md';
  assert.ok(!checksHit(text).has(5));
});

// (2b) The four execution-bundle self-locating files (rules/execution-policy.md
// and its 3 skill mirrors) use the POLICY_BUNDLE_ROOT derivation and explicitly
// forbid a fallback chain, so check 5's dual-path requirement does not apply to
// them — but reintroducing the old ${CLAUDE_PLUGIN_ROOT} fallback phrase into one
// of them is itself a contract regression and must still be flagged.
const BUNDLE_FILES = [
  'rules/execution-policy.md',
  'skills/dhpk-opsx-apply-goal/references/execution-bundle/rules/execution-policy.md',
  'skills/flow-drive/references/execution-bundle/rules/execution-policy.md',
  'skills/flow-guide/references/execution-bundle/rules/execution-policy.md',
];

for (const bundleFile of BUNDLE_FILES) {
  test(`check 5 does not require dual-path fallback in ${bundleFile}`, () => {
    const text = [
      'Resolve its real path, then derive POLICY_BUNDLE_ROOT as the real parent',
      'of that file\'s containing rules directory. Do not infer the base from',
      'an active Skill, environment variable, checkout search, or fallback chain.',
      '',
      '> Project overrides: projects that adopt this policy should keep their own',
      '> short .claude/rules/execution-policy.md (or CLAUDE.md section) that only',
      '> encodes deltas.',
    ].join('\n');
    const findings = scanText(bundleFile, text);
    assert.ok(!findings.some((f) => f.check === 5), `unexpected check 5 finding for ${bundleFile}`);
  });

  test(`check 5 flags reintroduced legacy fallback wording in ${bundleFile}`, () => {
    const text = [
      'Resolve its real path, then derive POLICY_BUNDLE_ROOT as the real parent',
      'of that file\'s containing rules directory. Do not infer the base from',
      'an active Skill, environment variable, checkout search, or fallback chain.',
      '',
      '> Project overrides: project .claude/rules/execution-policy.md if present,',
      '> else ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md.',
    ].join('\n');
    const findings = scanText(bundleFile, text);
    assert.ok(findings.some((f) => f.check === 5), `expected check 5 finding for ${bundleFile}`);
  });
}

// (3) No false positives on legitimate / intentional refs.
test('resolvable and intentional refs are not flagged', () => {
  const text = [
    'rule @rules/execution-policy.md',                       // resolves to rules/
    'consumer override @rules/dev-workflow-project.md',      // *-project.md convention
    'command /dhpk:install-rules',                           // resolves to commands/
    'path ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md',  // resolves
    'placeholder ${CLAUDE_PLUGIN_ROOT}/rules/<file>.md',     // placeholder, skipped
  ].join('\n');
  const findings = scanText('synthetic/clean.md', text);
  const detail = findings.map((f) => `  [check ${f.check}] ${f.detail}`).join('\n');
  assert.strictEqual(findings.length, 0, `expected 0 findings, got:\n${detail}`);
});

run('reference-integrity');
