'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const COMMAND = path.join(ROOT, 'commands', 'simplify.md');
const REFACTOR_CLEANER = path.join(ROOT, 'agents', 'refactor-cleaner.md');

function commandText() {
  return fs.readFileSync(COMMAND, 'utf8');
}

function withoutFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
}

test('simplify defaults to the current diff and preserves explicit target overrides', () => {
  const body = commandText();

  assert.match(body, /\$ARGUMENTS.*override|override.*\$ARGUMENTS/is);
  assert.match(body, /gh pr diff.*\$ARGUMENTS/is);
  assert.match(body, /git merge-base.*\$ARGUMENTS/is);
  assert.match(body, /git diff.*--.*\$ARGUMENTS/is);
  assert.match(body, /file or directory.*full contents|full contents.*file or directory/is);
  assert.match(body, /git diff @\{upstream\}\.\.\.HEAD/);
  assert.match(body, /git diff main\.\.\.HEAD/);
  assert.match(body, /git diff HEAD~1/);
  assert.match(body, /git diff HEAD/);
  assert.match(body, /range diff is empty|range is empty/i);
});

test('simplify dispatches four independent cleanup angles concurrently', () => {
  const body = commandText();

  assert.match(body, /4 independent.*agents/is);
  assert.match(body, /single\s+(?:Agent\s+)?(?:message|call)/i);
  assert.match(body, /concurrent|parallel/i);
  for (const angle of ['Reuse', 'Simplification', 'Efficiency', 'Altitude']) {
    assert.match(body, new RegExp(`^### ${angle}$`, 'm'));
  }
  assert.match(body, /`file`.*`line`.*`summary`.*concrete cost/is);
});

test('simplify degrades honestly and applies only behavior-preserving findings', () => {
  const body = commandText();

  assert.match(body, /Agent.*unavailable|unavailable.*Agent/is);
  assert.match(body, /nest(?:ed|ing)/i);
  assert.match(body, /all four angles/i);
  assert.match(body, /degraded:/);
  assert.match(body, /single-pass.*not.*4-agent fan-out/is);
  assert.match(body, /dedup.*same line or\s+mechanism/is);
  assert.match(body, /change intended behavior/i);
  assert.match(body, /well outside.*reviewed\s+(?:diff|scope)/is);
  assert.match(body, /false positive/i);
});

test('simplify preserves test gates, heavy-cleanup escalation, and deletion safety', () => {
  const body = commandText();
  const cleaner = fs.readFileSync(REFACTOR_CLEANER, 'utf8');

  assert.match(body, /allowed-tools:.*\bBash\b/);
  assert.doesNotMatch(body, /Bash\(TEST_ENV=unit npx jest/);
  assert.match(body, /baseline test command/i);
  assert.match(body, /800 lines/i);
  assert.match(body, /cross-file/i);
  assert.match(body, /dead-code sweep/i);
  assert.match(body, /refactor-cleaner/);
  assert.match(cleaner, /Delete only with proof/i);
  assert.match(cleaner, /dynamic-dispatch.*reflection.*DI/i);
  assert.match(cleaner, /deprecation path/i);
  assert.match(cleaner, /small batches/i);
});

test('simplify reports execution mode, applied and skipped findings, and both test results', () => {
  const body = commandText();

  assert.match(body, /Execution Mode/);
  assert.match(body, /Applied/);
  assert.match(body, /Skipped/);
  assert.match(body, /Baseline/);
  assert.match(body, /Final/);
});

test('simplify command is synchronized across Cursor and generated Claude surfaces', () => {
  const canonical = commandText();
  const canonicalBody = withoutFrontmatter(canonical);
  const cursorCopies = [
    'cursor/commands/simplify.md',
    'plugins/dhpk-cursor/commands/simplify.md',
  ];
  const claudeCopies = [
    'generated/claude-marketplace/package/commands/simplify.md',
    'generated/claude-profiles/full/package/commands/simplify.md',
    'generated/claude-profiles/compat-v1/package/commands/simplify.md',
  ];

  for (const relative of cursorCopies) {
    const projected = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.strictEqual(withoutFrontmatter(projected), canonicalBody, `${relative} body drifted`);
  }
  for (const relative of claudeCopies) {
    const projected = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.strictEqual(projected, canonical, `${relative} drifted`);
  }
});

run('simplify-command-contract');
