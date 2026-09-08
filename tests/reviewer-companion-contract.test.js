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

test('canonical reviewer prompts define the opt-in structured companion contract', () => {
  const findings = [];
  for (const relative of REVIEWER_FILES) {
    const text = readReviewer(relative);
    const required = [
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
      /does not.*(?:clear|affect).*Sentinel.*clearance/is,
      /structured JSON.*directly|directly.*structured JSON/is,
    ];
    for (const pattern of required) {
      if (!pattern.test(text)) findings.push(`${relative}: missing ${pattern}`);
    }
  }
  assert.deepStrictEqual(findings, [], findings.join('\n'));
});

test('the companion contract covers every Sentinel reviewer lane exactly once', () => {
  const headings = REVIEWER_FILES.map((relative) => {
    const text = readReviewer(relative);
    return (text.match(/^## Structured Review Gate Companion$/gm) || []).length;
  });
  assert.deepStrictEqual(headings, REVIEWER_FILES.map(() => 1));
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
