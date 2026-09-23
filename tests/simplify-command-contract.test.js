'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const COMMAND = path.join(ROOT, 'commands', 'simplify.md');
const REFACTOR_CLEANER = path.join(ROOT, 'agents', 'refactor-cleaner.md');
const SKILL = path.join(ROOT, 'skills', 'code-simplify', 'SKILL.md');

function commandText() {
  return fs.readFileSync(COMMAND, 'utf8');
}

// The command is a thin front door; the cleanup procedure lives in the
// canonical `$code-simplify` Skill, so behavior contracts are asserted there.
function skillText() {
  return fs.readFileSync(SKILL, 'utf8');
}

function withoutFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
}

test('simplify command forwards unchanged to the canonical Skill without duplicating the procedure', () => {
  const body = commandText();

  assert.match(body, /\$code-simplify/);
  assert.match(body, /\$ARGUMENTS` unchanged/);
  assert.match(body, /allowed-tools:.*\bBash\b/);
  assert.doesNotMatch(body, /git merge-base|### Reuse|\| Reuse \|/);
});

test('simplify defaults to the current diff and preserves explicit target overrides', () => {
  const body = skillText();

  assert.match(body, /explicit target always wins/i);
  assert.match(body, /gh pr diff "\$ARGUMENTS"/);
  assert.match(body, /git merge-base <target> <base>/);
  assert.match(body, /git diff HEAD -- "\$ARGUMENTS"/);
  assert.match(body, /file\/directory: review its full contents/i);
  assert.match(body, /never fall back to the current branch for an\s+invalid explicit target/i);
  assert.match(body, /git diff @\{upstream\}\.\.\.HEAD/);
  assert.match(body, /git diff main\.\.\.HEAD/);
  assert.match(body, /git diff HEAD~1/);
  assert.match(body, /git diff HEAD/);
  assert.match(body, /range is empty/i);
});

test('simplify dispatches four independent cleanup angles concurrently', () => {
  const body = skillText();

  assert.match(body, /four independent workers concurrently/i);
  assert.match(body, /exactly one angle each/i);
  for (const angle of ['Reuse', 'Simplification', 'Efficiency', 'Altitude']) {
    assert.match(body, new RegExp(`^\\s*\\| ${angle} \\|`, 'm'));
  }
  assert.match(body, /`file`.*`line`.*summary.*concrete cost/is);
});

test('simplify degrades honestly and applies only behavior-preserving findings', () => {
  const body = skillText();

  assert.match(body, /fan-out is unavailable/i);
  assert.match(body, /nested/i);
  assert.match(body, /missing angles inline/i);
  assert.match(body, /degraded:/);
  assert.match(body, /single-pass review, not\s+the four-worker fan-out/is);
  assert.match(body, /Deduplicate findings at the same line or mechanism/i);
  assert.match(body, /change intended behavior/i);
  assert.match(body, /out-of-scope files/i);
  assert.match(body, /false\s+positives/i);
});

test('simplify preserves test gates, heavy-cleanup escalation, and deletion safety', () => {
  const body = skillText();
  const cleaner = fs.readFileSync(REFACTOR_CLEANER, 'utf8');

  assert.match(body, /allowed-tools:.*\bBash\b/);
  assert.doesNotMatch(body, /Bash\(TEST_ENV=unit npx jest/);
  assert.match(body, /exact baseline test command/i);
  assert.match(body, /800 lines/i);
  assert.match(body, /cross-file/i);
  assert.match(body, /dead-code sweep/i);
  assert.match(body, /registered `worker` or `architect` roles/);
  assert.match(body, /Never\s+substitute an unregistered role/i);
  assert.match(cleaner, /Delete only with proof/i);
  assert.match(cleaner, /dynamic-dispatch.*reflection.*DI/i);
  assert.match(cleaner, /deprecation path/i);
  assert.match(cleaner, /small batches/i);
});

test('simplify reports execution mode, applied and skipped findings, and both test results', () => {
  const body = skillText();

  assert.match(body, /Execution Mode/);
  assert.match(body, /### Applied/);
  assert.match(body, /### Skipped/);
  assert.match(body, /Baseline:/);
  assert.match(body, /Final:/);
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
    // Cursor projections rewrite repository-relative links to canonical URLs.
    const projected = fs.readFileSync(path.join(ROOT, relative), 'utf8')
      .replaceAll('](https://github.com/hmj1026/dhpk/blob/main/', '](../');
    assert.strictEqual(withoutFrontmatter(projected), canonicalBody, `${relative} body drifted`);
  }
  for (const relative of claudeCopies) {
    const projected = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.strictEqual(projected, canonical, `${relative} drifted`);
  }
});

run('simplify-command-contract');
