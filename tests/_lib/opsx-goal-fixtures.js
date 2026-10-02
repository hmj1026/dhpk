'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'opsx-goal');
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'skills', 'dhpk-opsx-apply-goal', 'references', 'goal-templates.md');
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');

const fencedAfter = (marker) => {
  const start = TEMPLATE.indexOf(marker);
  if (start < 0) throw new Error(`goal template marker not found: ${marker}`);
  const match = TEMPLATE.slice(start).match(/```\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`goal template fenced block not found after: ${marker}`);
  return match[1];
};

const DISPATCH_TRUE_FENCE = fencedAfter('**`DISPATCH_ON=true`');
const DISPATCH_FALSE_FENCE = fencedAfter('**`DISPATCH_ON=false`');

const PART_1 = fencedAfter('## Part 1 (always)');
const PART_2 = fencedAfter('## Part 2 (always');

const FIXED_CORE = [DISPATCH_TRUE_FENCE, PART_1, PART_2];
const FIXED_CORE_NO_DISPATCH = [DISPATCH_FALSE_FENCE, PART_1, PART_2];

const STOP_LIMITS = fencedAfter('## Part 4 (always').replace(
  /\nOR stop after <MAX_DURATION> wall-clock elapsed: write the same\n\.resume-note\.md \(state, next step, remaining tasks\), end the session/,
  '\n',
);

const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));

const composeGoal = (fixture) => {
  const core = fixture.dispatch_on === false ? FIXED_CORE_NO_DISPATCH : FIXED_CORE;
  const fastWorkerClause = fixture.fast_worker_clause
    || 'dhpk:fast-worker selected; fallback dhpk:agy-fast-worker → dhpk:fast-worker';
  const parts = core.map((part) => part
    .replaceAll('<CHANGE_ID>', fixture.change_id || 'fixture-change')
    .replaceAll('<TASK_DIGEST>', fixture.task_digest || 'T'.repeat(200))
    // A realistic Bash-quoted relocated root keeps the byte budget honest.
    .replaceAll('<SKILL_ROOT_Q>', '/Users/example/.claude/plugins/cache/dhpk/dhpk/0.62.4/skills/dhpk-opsx-apply-goal')
    .replaceAll('<FAST_WORKER_CLAUSE>', fastWorkerClause)
    .replaceAll('<E2E_ROSTER_CLAUSE>', fixture.has_e2e === true ? 'RED/E2E Playwright → dhpk:e2e-runner; ' : ''));

  const verification = [];
  if (fixture.test_command) {
    if (fixture.coverage_threshold !== undefined && fixture.coverage_threshold !== null) {
      verification.push(`COVERAGE: ${fixture.test_command} --coverage output shows 0 failures AND total coverage ≥ ${fixture.coverage_threshold}%.`);
    } else {
      verification.push(`TEST: ${fixture.test_command} output shows 0 failures.`);
    }
  }
  if (fixture.build_command) verification.push(`BUILD: ${fixture.build_command} output shows 0 errors.`);
  if (fixture.lint_command) verification.push(`LINT: ${fixture.lint_command} output shows 0 errors.`);
  if (fixture.smoke === true) {
    verification.push('SMOKE: read-only runtime probe via dhpk:smoke-tester; require first-line Verdict: PASS and one pasted observed output line, or paste the failing launch command and output.');
  }
  parts.push(...verification);
  if (fixture.padding_bytes) parts.push('x'.repeat(fixture.padding_bytes));
  parts.push(STOP_LIMITS
    .replaceAll('<CHANGE_ID>', fixture.change_id || 'fixture-change')
    .replaceAll('<TURN_BUDGET>', String(fixture.turn_budget || 40)));
  return parts.join(',\n');
};

const measureBytes = (goal) => {
  const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-goal-bytes-')), 'goal.txt');
  fs.writeFileSync(scratch, goal, 'utf8');
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

module.exports = {
  FIXED_CORE,
  FIXED_CORE_NO_DISPATCH,
  DISPATCH_TRUE_FENCE,
  DISPATCH_FALSE_FENCE,
  composeGoal,
  generateFixture,
  measureBytes,
  readFixture,
};
