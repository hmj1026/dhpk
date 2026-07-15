'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'opsx-goal');
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'skills', 'opsx-apply-goal', 'references', 'goal-templates.md');
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');

const fencedAfter = (marker) => {
  const start = TEMPLATE.indexOf(marker);
  if (start < 0) throw new Error(`goal template marker not found: ${marker}`);
  const match = TEMPLATE.slice(start).match(/```\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`goal template fenced block not found after: ${marker}`);
  return match[1];
};

const FIXED_CORE = [
  fencedAfter('**`DISPATCH_ON=true`'),
  fencedAfter('## Part 1 (always)'),
  fencedAfter('## Part 2 (always'),
  fencedAfter('## Part 2b (always'),
];

const STOP_LIMITS = fencedAfter('## Part 4 (always').replace(
  /\nOR stop after <MAX_DURATION> wall-clock elapsed: write the same\n\.resume-note\.md \(state, next step, remaining tasks\), end the session/,
  '\n',
);

const GATE_TOKENS = {
  test: 'TEST: command result has 0 failures.',
  coverage: 'COVERAGE: configured threshold met.',
  build: 'BUILD: command result has 0 errors.',
  lint: 'LINT: command result has 0 errors.',
  smoke: 'SMOKE: Verdict: PASS plus one observed output line, or evidenced escape hatch.',
  review: 'REVIEW: applicable reviewers run once per wave; known findings are confirm-only.',
  artifact: 'ARTIFACT: edited files and fresh review artifact are listed.',
  verdict: 'VERDICT: unresolved reviewer verdicts are absent.',
  // Part 4 is the production TURN contract and is always appended below.
  turn: '',
};

const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));

const composeGoal = (fixture) => {
  const codexStatement = fixture.codex
    ? 'CODEX is ON for this session: apply execution-policy §In-flight doubt cycle and §CODEX=on high-stakes parallel peer path (including its session-end zero-dispatch self-check)'
    : 'CODEX is OFF for this session: at a contradiction-arbitration point where two agents\' conclusions directly conflict, announce "cross-model doubt skipped (CODEX=off)" per execution-policy §In-flight doubt cycle rather than performing a cross-model pass';
  const parts = FIXED_CORE.map((part) => part
    .replaceAll('<CHANGE_ID>', fixture.change_id || 'fixture-change')
    .replace('<CODEX_STATEMENT>', codexStatement));
  for (const gate of fixture.gates || []) {
    const contract = Object.prototype.hasOwnProperty.call(GATE_TOKENS, gate) ? GATE_TOKENS[gate] : `GATE: ${gate}.`;
    if (contract) parts.push(contract);
  }
  if (fixture.padding_bytes) parts.push('x'.repeat(fixture.padding_bytes));
  parts.push(STOP_LIMITS
    .replaceAll('<CHANGE_ID>', fixture.change_id || 'fixture-change')
    .replaceAll('<TURN_BUDGET>', String(fixture.turn_budget || 40)));
  return parts.join(',\n');
};

const measureBytes = (goal) => {
  const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-goal-bytes-')), 'goal.txt');
  fs.writeFileSync(scratch, `${goal}\n`, 'utf8');
  try {
    const result = spawnSync('wc', ['-c', scratch], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'wc -c failed');
    return Number(result.stdout.trim().split(/\s+/)[0]);
  } finally {
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
  }
};

const generateFixture = (fixture) => {
  const goal = composeGoal(fixture);
  const bytes = measureBytes(goal);
  if (bytes > 4000) {
    return { mode: 'blocked', bytes, goal: '', blockA: `Block A: Goal length ${bytes} UTF-8 bytes; no /goal output.` };
  }
  return { mode: 'full', bytes, goal, blockA: '' };
};

module.exports = { FIXED_CORE, GATE_TOKENS, composeGoal, generateFixture, measureBytes, readFixture };
