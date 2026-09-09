'use strict';

// Canonical reviewer prompts must teach the optional migration-observation
// companion contract without changing ordinary reviewer behavior.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.resolve(__dirname, '..');
const REVIEWER_FILES = [
  'agents/code-reviewer.md',
  'agents/database-reviewer.md',
  'agents/security-reviewer.md',
  'agents/frontend-reviewer.md',
  'agents/doc-reviewer.md',
  'agents/migration-reviewer.md',
  'modules/library-author/agents/polyfill-reviewer.md',
];

const readReviewer = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const INLINE_COMPANION = [
  /Structured Review Gate Companion/,
  /only when the dispatch request explicitly contains .*Review Gate opt-in.*envelope/i,
  /ordinary invocation.*no companion/i,
  /same stem.*\.result\.json/i,
  /dhpk\.claude-review-result\.v1/,
  /requestDigest/,
  /reviewResult/,
  /dhpk\.reviewer-contract\.v2/,
  /artifact.*(?:sha256|digest).*identity/is,
  /command.*(?:sha256|digest).*outcome/is,
  /digest-only/i,
  /raw logs.*prompts.*secrets/is,
  /does not alter Review Gate obligation\s+status.*obligation status remains orchestrator-owned/is,
  /structured JSON.*directly|directly.*structured JSON/is,
];

function isPointerCompanion(text) {
  return /docs\/contracts\/reviewer-contract\.md/.test(text)
    && /Structured (migration )?companion/i.test(text)
    && /Review Gate opt-in/i.test(text)
    && /ordinary invocation.*no companion/i.test(text);
}

function isInlineCompanion(text) {
  return INLINE_COMPANION.every((pattern) => pattern.test(text));
}

function teachesCompanion(text) {
  return isPointerCompanion(text) || isInlineCompanion(text);
}

test('canonical reviewer prompts define the opt-in structured companion contract', () => {
  const findings = [];
  for (const relative of REVIEWER_FILES) {
    const text = readReviewer(relative);
    if (!teachesCompanion(text)) {
      findings.push(`${relative}: neither companion pointer nor inline companion contract`);
    }
  }
  assert.deepStrictEqual(findings, [], findings.join('\n'));
});

test('the companion contract covers every Review Gate reviewer lane exactly once', () => {
  const findings = [];
  for (const relative of REVIEWER_FILES) {
    const text = readReviewer(relative);
    if (!teachesCompanion(text)) {
      findings.push(`${relative}: neither companion pointer nor inline companion contract`);
      continue;
    }
    const headingCount = (text.match(/^## Structured Review Gate Companion$/gm) || []).length;
    if (headingCount > 1) {
      findings.push(`${relative}: companion taught ${headingCount} times`);
    }
    if (!isPointerCompanion(text) && headingCount !== 1) {
      findings.push(`${relative}: inline companion must keep the Structured Review Gate Companion heading`);
    }
  }
  assert.deepStrictEqual(findings, [], findings.join('\n'));
});

test('canonical prompts advertise exact command outcomes and keep CHANGES_REQUIRED semantic-only', () => {
  const expectedOutcomes = [
    'PASS',
    'FAIL',
    'NOT_RUN',
    'NOT_CONFIGURED',
    'SKIP_INCOMPATIBLE',
    'BLOCKED',
    'UNAVAILABLE',
  ];
  const findings = [];
  for (const relative of REVIEWER_FILES) {
    const text = readReviewer(relative);
    if (isPointerCompanion(text)) {
      const contract = readReviewer('docs/contracts/reviewer-contract.md');
      for (const name of expectedOutcomes) {
        if (!contract.includes(name)) {
          findings.push(`${relative}: contract SSOT missing command outcome ${name}`);
        }
      }
      if (!/CHANGES_REQUIRED[\s\S]{0,160}reviewResult\.semanticVerdict|reviewResult\.semanticVerdict[\s\S]{0,160}CHANGES_REQUIRED/i.test(text)
        && !/CHANGES_REQUIRED[\s\S]{0,160}reviewResult\.semanticVerdict|reviewResult\.semanticVerdict[\s\S]{0,160}CHANGES_REQUIRED/i.test(contract)) {
        findings.push(`${relative}: CHANGES_REQUIRED is not identified as reviewResult.semanticVerdict-only`);
      }
      continue;
    }
    const heading = text.indexOf('## Structured Review Gate Companion');
    const nextHeading = text.indexOf('\n## ', heading + 1);
    const section = text.slice(heading, nextHeading === -1 ? text.length : nextHeading);
    const outcome = section.match(/"outcome"\s*:\s*"([^"]+)"/);
    if (!outcome) {
      findings.push(`${relative}: missing command.outcome example`);
      continue;
    }
    const advertised = outcome[1].split('|').map((value) => value.trim());
    if (JSON.stringify(advertised) !== JSON.stringify(expectedOutcomes)) {
      findings.push(`${relative}: command.outcome vocabulary ${JSON.stringify(advertised)}`);
    }
    const commandBlock = section.match(/"command"\s*:\s*\{([\s\S]*?)\n\s*\}/);
    if (commandBlock && commandBlock[1].includes('CHANGES_REQUIRED')) {
      findings.push(`${relative}: command.outcome includes semantic CHANGES_REQUIRED`);
    }
    if (!/CHANGES_REQUIRED[\s\S]{0,120}reviewResult\.semanticVerdict|reviewResult\.semanticVerdict[\s\S]{0,120}CHANGES_REQUIRED/i.test(section)) {
      findings.push(`${relative}: CHANGES_REQUIRED is not identified as reviewResult.semanticVerdict-only`);
    }
  }
  assert.deepStrictEqual(findings, [], findings.join('\n'));
});

run('reviewer-companion-contract');
