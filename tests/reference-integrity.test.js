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
