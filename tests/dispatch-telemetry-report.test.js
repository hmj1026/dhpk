'use strict';

// Exercise dispatch-telemetry-report against synthetic session logs only.
// Every id, timestamp, model and sentinel string below is fabricated; no real
// session log, prompt, or project name is read or committed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'dispatch-telemetry-report.js');
const { buildReport, modelMatches, PRICE_TABLE } = require(SCRIPT);

const PROMPT_SENTINEL = 'SENTINEL-PROMPT-BODY-DO-NOT-LEAK';
const DESCRIPTION_SENTINEL = 'SENTINEL-DESCRIPTION-DO-NOT-LEAK';

function mkdtemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-telemetry-'));
}

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`);
}

function assistant({ ts, model, effort, usage, tools = [], id }) {
  return {
    type: 'assistant',
    timestamp: ts,
    effort,
    requestedModel: model,
    message: {
      id: id || `msg-${ts}`,
      model,
      usage: usage || { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      content: tools.map((name, i) => ({ type: 'tool_use', id: `tu-${ts}-${i}`, name, input: { x: PROMPT_SENTINEL } })),
    },
  };
}

function makeAgentsDir() {
  const dir = path.join(mkdtemp(), 'agents');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'architect.md'), '---\nname: architect\nmodel: fable\neffort: low\n---\nbody\n');
  fs.writeFileSync(path.join(dir, 'fast-worker.md'), '---\nname: fast-worker\nmodel: sonnet\neffort: medium\n---\nbody\n');
  return dir;
}

// One session with the given dispatches. Each dispatch:
// { id, agentType, isBuiltIn, callModel, callEffort, records, trigger, toolUseId }
function makeSession(root, { project = '-fake-project-a', session = 'session-0001', dispatches = [], parentExtra = [], skipParent = false }) {
  const parent = [];
  for (const d of dispatches) {
    if (d.trigger) parent.push(d.trigger);
    const input = { subagent_type: d.agentType, description: DESCRIPTION_SENTINEL, prompt: PROMPT_SENTINEL };
    if (d.callModel) input.model = d.callModel;
    if (d.callEffort) input.effort = d.callEffort;
    parent.push({
      type: 'assistant',
      timestamp: d.callTs || d.records[0].timestamp,
      message: { id: `pm-${d.id}`, content: [{ type: 'tool_use', id: `toolu-${d.id}`, name: 'Agent', input }] },
    });
    const subDir = path.join(root, project, session, 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, `agent-${d.id}.meta.json`), JSON.stringify({
      agentType: d.agentType,
      isBuiltIn: Boolean(d.isBuiltIn),
      description: DESCRIPTION_SENTINEL,
      ...(d.noToolUseId ? {} : { toolUseId: `toolu-${d.id}` }),
      ...(d.callModel ? { model: d.callModel } : {}),
    }));
    if (!d.noTranscript) writeJsonl(path.join(subDir, `agent-${d.id}.jsonl`), d.records);
  }
  if (!skipParent) writeJsonl(path.join(root, project, `${session}.jsonl`), [...parent, ...parentExtra]);
}

function cli(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function findAgent(report, agentType, model, effort) {
  return report.byAgent.find((e) => e.agentType === agentType && e.model === model && e.effort === effort);
}

test('normal dispatch: counts agentType x model@effort, sums tokens, prices from the declared table', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [
      { id: 'a1', agentType: 'architect', records: [
        assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' }),
        assistant({ ts: '2026-11-05T01:01:00Z', model: 'claude-fable-5-1', effort: 'low', usage: { input_tokens: 2000, output_tokens: 100 } }),
      ] },
      { id: 'a2', agentType: 'architect', records: [
        assistant({ ts: '2026-11-05T02:00:00Z', model: 'claude-fable-5-1', effort: 'low' }),
      ] },
    ],
  });
  const report = buildReport({ root, agentsDir });
  const entry = findAgent(report, 'architect', 'claude-fable-5-1', 'low');
  assert.ok(entry, 'architect fable@low group present');
  assert.strictEqual(entry.count, 2);
  assert.strictEqual(entry.usage.inputTokens, 4000);
  assert.strictEqual(entry.usage.outputTokens, 1100);
  // 4000 in * $10/M + 1100 out * $50/M = 0.04 + 0.055
  assert.ok(Math.abs(entry.estimatedCost - 0.095) < 1e-9, `cost ${entry.estimatedCost}`);
  assert.deepStrictEqual(report.mismatches, []);
  assert.strictEqual(report.skipped.total, 0);
  assert.match(PRICE_TABLE.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
});

test('call-time model and effort override are counted and reported as mismatches against frontmatter', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [
      { id: 'o1', agentType: 'dhpk:architect', callModel: 'opus', callEffort: 'high', records: [
        assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-opus-5-5', effort: 'high' }),
      ] },
      { id: 'o2', agentType: 'dhpk:fast-worker', records: [
        assistant({ ts: '2026-11-05T01:10:00Z', model: 'claude-sonnet-5-5', effort: 'medium' }),
      ] },
      { id: 'o3', agentType: 'dhpk:fast-worker', callModel: 'haiku', records: [
        assistant({ ts: '2026-11-05T01:20:00Z', model: 'claude-haiku-5-5', effort: 'medium' }),
      ] },
    ],
  });
  const report = buildReport({ root, agentsDir });
  assert.deepStrictEqual(report.callOverrides, { total: 3, withModel: 2, withEffort: 1 });
  assert.strictEqual(report.mismatches.length, 2);
  const arch = report.mismatches.find((m) => m.agentType === 'dhpk:architect');
  assert.strictEqual(arch.declaredModel, 'fable');
  assert.strictEqual(arch.declaredEffort, 'low');
  assert.strictEqual(arch.actualModel, 'claude-opus-5-5');
  assert.strictEqual(arch.actualEffort, 'high');
  assert.deepStrictEqual(arch.fields.sort(), ['effort', 'model']);
  assert.strictEqual(arch.callModel, 'opus');
  assert.strictEqual(arch.callEffort, 'high');
  const worker = report.mismatches.find((m) => m.agentType === 'dhpk:fast-worker');
  assert.deepStrictEqual(worker.fields, ['model']);
});

test('built-in agent without frontmatter is "no declared tier", never a mismatch; unpriced model is "unknown", not 0', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [
      { id: 'e1', agentType: 'Explore', isBuiltIn: true, records: [
        assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-unpriced-9-9', effort: 'medium' }),
      ] },
    ],
  });
  const report = buildReport({ root, agentsDir });
  assert.deepStrictEqual(report.mismatches, []);
  assert.strictEqual(report.noDeclaredTier, 1);
  const entry = findAgent(report, 'Explore', 'claude-unpriced-9-9', 'medium');
  assert.strictEqual(entry.estimatedCost, 'unknown');
  const text = cli(['--root', root, '--agents-dir', agentsDir]).stdout;
  assert.match(text, /unknown/);
});

test('corrupt JSON, missing transcript, and missing root are counted as skipped and do not abort', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [
      { id: 'g1', agentType: 'architect', records: [
        assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' }),
        '{not json',
      ] },
      { id: 'g2', agentType: 'architect', noTranscript: true, records: [
        assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' }),
      ] },
    ],
  });
  const subDir = path.join(root, '-fake-project-a', 'session-0001', 'subagents');
  fs.writeFileSync(path.join(subDir, 'agent-g3.meta.json'), '{broken');
  const report = buildReport({ root, agentsDir });
  assert.strictEqual(findAgent(report, 'architect', 'claude-fable-5-1', 'low').count, 1);
  assert.strictEqual(report.skipped.missingTranscript, 1);
  assert.strictEqual(report.skipped.corruptJson, 2);
  assert.strictEqual(report.skipped.missingRoot, 0);
  assert.strictEqual(report.skipped.total, 3);

  const absent = buildReport({ root: path.join(root, 'does-not-exist'), agentsDir });
  assert.strictEqual(absent.skipped.missingRoot, 1);
  assert.strictEqual(absent.skipped.total, 1);
  assert.deepStrictEqual(absent.byAgent, []);
  const text = cli(['--root', path.join(root, 'does-not-exist'), '--agents-dir', agentsDir]);
  assert.strictEqual(text.status, 0);
  assert.match(text.stdout, /skipped/i);
});

test('time window: date-only bounds are local-timezone days, until is inclusive of the whole day', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  // 2026-11-03T16:30Z is 2026-11-04 00:30 in UTC+8 but still 2026-11-03 in UTC.
  makeSession(root, {
    dispatches: [
      { id: 't1', agentType: 'architect', records: [assistant({ ts: '2026-11-03T16:30:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
    ],
  });
  const count = (env, args) => {
    const r = cli(['--root', root, '--agents-dir', agentsDir, '--json', ...args], env);
    assert.strictEqual(r.status, 0, r.stderr);
    const entry = JSON.parse(r.stdout).byAgent.find((e) => e.agentType === 'architect');
    return entry ? entry.count : 0;
  };
  assert.strictEqual(count({ TZ: 'Asia/Taipei' }, ['--since', '2026-11-04', '--until', '2026-11-04']), 1);
  assert.strictEqual(count({ TZ: 'UTC' }, ['--since', '2026-11-04', '--until', '2026-11-04']), 0);
  assert.strictEqual(count({ TZ: 'UTC' }, ['--since', '2026-11-03', '--until', '2026-11-03']), 1);
  // Explicit offsets and Z are absolute and ignore TZ.
  assert.strictEqual(count({ TZ: 'America/Los_Angeles' }, ['--since', '2026-11-04T00:00:00+08:00', '--until', '2026-11-04T23:59:59+08:00']), 1);
  assert.strictEqual(count({ TZ: 'Asia/Taipei' }, ['--since', '2026-11-03T16:30:01Z']), 0);
});

test('time window: since is inclusive, datetime until is inclusive, next day midnight is excluded', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [
      { id: 'b1', agentType: 'architect', records: [assistant({ ts: '2026-11-05T00:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
      { id: 'b2', agentType: 'architect', records: [assistant({ ts: '2026-11-06T00:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
    ],
  });
  const n = (since, until) => {
    const report = buildReport({ root, agentsDir, since, until });
    const entry = report.byAgent.find((e) => e.agentType === 'architect');
    return entry ? entry.count : 0;
  };
  assert.strictEqual(n('2026-11-05T00:00:00Z', '2026-11-05T00:00:00Z'), 1);
  assert.strictEqual(n('2026-11-05T00:00:01Z', undefined), 1);
  assert.strictEqual(n('2026-11-05T00:00:00Z', '2026-11-05T23:59:59Z'), 1);
  assert.strictEqual(n('2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z'), 2);
  assert.throws(() => buildReport({ root, agentsDir, since: 'not-a-date' }), /since/);
});

test('callOverrides honour the time window and project filter', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    project: '-fake-project-a',
    dispatches: [
      { id: 'p1', agentType: 'architect', callEffort: 'low', records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
    ],
  });
  makeSession(root, {
    project: '-fake-project-b',
    dispatches: [
      { id: 'p2', agentType: 'architect', records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
      { id: 'p3', agentType: 'architect', records: [assistant({ ts: '2026-12-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
    ],
  });
  const all = buildReport({ root, agentsDir, until: '2026-11-30T00:00:00Z' });
  assert.deepStrictEqual(all.callOverrides, { total: 2, withModel: 0, withEffort: 1 });
  const onlyB = buildReport({ root, agentsDir, project: 'project-b', until: '2026-11-30T00:00:00Z' });
  assert.deepStrictEqual(onlyB.callOverrides, { total: 1, withModel: 0, withEffort: 0 });
});

test('general-purpose: deterministic tool buckets, actual model, trigger source, haikuEdits', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  const skill = (ts, name) => ({
    type: 'assistant',
    timestamp: ts,
    message: { id: `sk-${ts}`, content: [{ type: 'tool_use', id: `sk-${ts}`, name: 'Skill', input: { skill: name } }] },
  });
  const command = (ts, name) => ({
    type: 'user',
    timestamp: ts,
    message: { role: 'user', content: `<command-name>${name}</command-name> ${PROMPT_SENTINEL}` },
  });
  makeSession(root, {
    dispatches: [
      { id: 'gp1', agentType: 'general-purpose', isBuiltIn: true, trigger: skill('2026-11-05T00:50:00Z', 'fake-skill'), records: [
        assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-haiku-5-5', effort: 'medium', tools: ['Read', 'Edit'] }),
      ] },
      { id: 'gp2', agentType: 'general-purpose', isBuiltIn: true, trigger: command('2026-11-05T01:50:00Z', '/fake-command'), records: [
        assistant({ ts: '2026-11-05T02:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium', tools: ['Read', 'Bash'] }),
      ] },
      { id: 'gp3', agentType: 'general-purpose', isBuiltIn: true, records: [
        assistant({ ts: '2026-11-05T03:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium', tools: ['Grep', 'Read'] }),
      ] },
      { id: 'gp4', agentType: 'general-purpose', isBuiltIn: true, records: [
        assistant({ ts: '2026-11-05T04:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium', tools: ['Write'] }),
      ] },
    ],
  });
  // A session that never started a skill or command: trigger is not determinable.
  makeSession(root, {
    session: 'session-0002',
    dispatches: [
      { id: 'gp5', agentType: 'general-purpose', isBuiltIn: true, records: [
        assistant({ ts: '2026-11-05T05:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium', tools: ['Read'] }),
      ] },
    ],
  });
  const gp = buildReport({ root, agentsDir }).generalPurpose;
  assert.strictEqual(gp.total, 5);
  assert.deepStrictEqual(gp.buckets, { edits: 2, commandsOnly: 1, readOnly: 2 });
  assert.deepStrictEqual(gp.byModel, { 'claude-haiku-5-5': 1, 'claude-sonnet-5-5': 4 });
  assert.strictEqual(gp.haikuEdits, 1);
  assert.strictEqual(gp.byTrigger['skill:fake-skill'], 1);
  // The most recently started skill/command before the call wins, so gp3 and gp4 inherit the command.
  assert.strictEqual(gp.byTrigger['command:/fake-command'], 3);
  assert.strictEqual(gp.byTrigger.unknown, 1);
});

test('--json output is valid JSON with the documented shape and never leaks prompt or description text', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [
      { id: 'j1', agentType: 'dhpk:architect', callModel: 'opus', records: [
        assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-opus-5-5', effort: 'low', tools: ['Read'] }),
      ] },
    ],
  });
  const json = cli(['--root', root, '--agents-dir', agentsDir, '--json']);
  assert.strictEqual(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  for (const key of ['byAgent', 'callOverrides', 'mismatches', 'generalPurpose', 'skipped']) {
    assert.ok(Object.prototype.hasOwnProperty.call(report, key), `missing ${key}`);
  }
  for (const key of ['agentType', 'model', 'effort', 'count', 'usage', 'estimatedCost']) {
    assert.ok(Object.prototype.hasOwnProperty.call(report.byAgent[0], key), `byAgent missing ${key}`);
  }
  for (const key of ['buckets', 'byTrigger', 'haikuEdits']) {
    assert.ok(Object.prototype.hasOwnProperty.call(report.generalPurpose, key), `generalPurpose missing ${key}`);
  }
  const text = cli(['--root', root, '--agents-dir', agentsDir]);
  assert.strictEqual(text.status, 0, text.stderr);
  for (const out of [json.stdout, text.stdout, text.stderr]) {
    assert.ok(!out.includes(PROMPT_SENTINEL), 'prompt leaked');
    assert.ok(!out.includes(DESCRIPTION_SENTINEL), 'description leaked');
  }
  assert.match(text.stdout, /claude-opus-5-5@low/);
});

test('invalid CLI arguments exit 64 with a descriptive message', () => {
  const r = cli(['--since', 'garbage']);
  assert.strictEqual(r.status, 64);
  assert.match(r.stderr, /since/);
});

test('streaming reader: lines larger than a read chunk with multibyte text are parsed intact', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  const big = assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' });
  big.padding = '漢字🙂'.repeat(60000); // ~600 KB on one line, crosses many 64 KB chunks
  makeSession(root, { dispatches: [{ id: 'big1', agentType: 'architect', records: [big] }] });
  const report = buildReport({ root, agentsDir });
  assert.strictEqual(findAgent(report, 'architect', 'claude-fable-5-1', 'low').count, 1);
  assert.strictEqual(report.skipped.total, 0);
});

test('files whose mtime is older than --since are not opened', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [
      { id: 'm1', agentType: 'architect', records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
      { id: 'm2', agentType: 'architect', records: [assistant({ ts: '2026-11-05T02:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
    ],
  });
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(path.join(root, '-fake-project-a', 'session-0001', 'subagents', 'agent-m2.jsonl'), old, old);
  const report = buildReport({ root, agentsDir, since: '2026-11-01' });
  assert.strictEqual(findAgent(report, 'architect', 'claude-fable-5-1', 'low').count, 1);
  assert.strictEqual(report.skipped.total, 0, 'mtime pruning is not a skip');
  assert.strictEqual(findAgent(buildReport({ root, agentsDir }), 'architect', 'claude-fable-5-1', 'low').count, 2);
});

test('skipped is never silent: missingParent, unreadable, undated Agent calls, noAssistantTurn split from missingTranscript', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    session: 'session-noparent',
    skipParent: true,
    dispatches: [{ id: 'np1', agentType: 'architect', records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] }],
  });
  makeSession(root, {
    session: 'session-empty',
    dispatches: [
      { id: 'na1', agentType: 'architect', records: [{ type: 'user', timestamp: '2026-11-05T01:00:00Z', message: { role: 'user', content: 'x' } }] },
      { id: 'mt1', agentType: 'architect', noTranscript: true, records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
    ],
    parentExtra: [{
      type: 'assistant',
      timestamp: 'not-a-time',
      message: { id: 'pm-bad', content: [{ type: 'tool_use', id: 'toolu-bad', name: 'Agent', input: { subagent_type: 'architect' } }] },
    }],
  });
  const noWindow = buildReport({ root, agentsDir });
  assert.strictEqual(noWindow.skipped.missingParent, 1);
  assert.strictEqual(noWindow.skipped.noAssistantTurn, 1);
  assert.strictEqual(noWindow.skipped.missingTranscript, 1);
  assert.strictEqual(noWindow.skipped.undated, 0);
  assert.strictEqual(noWindow.callOverrides.total, 3, 'without a window the undated call is still an Agent call');
  const windowed = buildReport({ root, agentsDir, since: '2026-11-01' });
  assert.strictEqual(windowed.skipped.undated, 1);
  assert.strictEqual(windowed.callOverrides.total, 2);
  assert.strictEqual(windowed.skipped.total,
    windowed.skipped.missingParent + windowed.skipped.noAssistantTurn + windowed.skipped.missingTranscript + windowed.skipped.undated);
  assert.match(cli(['--root', root, '--agents-dir', agentsDir]).stdout, /missing parent 1/);
});

test('unreadable directories are counted, not treated as empty', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root ignores chmod
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [{ id: 'u1', agentType: 'architect', records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] }],
  });
  const subDir = path.join(root, '-fake-project-a', 'session-0001', 'subagents');
  fs.chmodSync(subDir, 0o000);
  try {
    const report = buildReport({ root, agentsDir });
    assert.strictEqual(report.skipped.unreadable, 1);
    assert.strictEqual(report.skipped.total, 1);
  } finally {
    fs.chmodSync(subDir, 0o755);
  }
});

test('names from logs are sanitized; trigger commands only come from harness invocation records', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  const userText = (ts, content, extra = {}) => ({ type: 'user', timestamp: ts, message: { role: 'user', content }, ...extra });
  const skill = (ts, name) => ({
    type: 'assistant',
    timestamp: ts,
    message: { id: `sk-${ts}`, content: [{ type: 'tool_use', id: `sk-${ts}`, name: 'Skill', input: { skill: name } }] },
  });
  makeSession(root, {
    session: 's-real',
    dispatches: [
      { id: 'r1', agentType: 'general-purpose', trigger: userText('2026-11-05T00:50:00Z', '<command-message>real</command-message>\n<command-name>/real-cmd</command-name>'),
        records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium' })] },
    ],
  });
  makeSession(root, {
    session: 's-pasted',
    dispatches: [
      { id: 'r2', agentType: 'general-purpose', trigger: userText('2026-11-05T00:50:00Z', `please look at this <command-name>/pasted</command-name> ${PROMPT_SENTINEL}`),
        records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium' })] },
    ],
  });
  makeSession(root, {
    session: 's-meta',
    dispatches: [
      { id: 'r3', agentType: 'general-purpose', trigger: userText('2026-11-05T00:50:00Z', '<command-name>/metaonly</command-name>', { isMeta: true }),
        records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium' })] },
    ],
  });
  makeSession(root, {
    session: 's-badskill',
    dispatches: [
      { id: 'r4', agentType: 'general-purpose', trigger: skill('2026-11-05T00:50:00Z', 'bad skill name with spaces'),
        records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium' })] },
    ],
  });
  makeSession(root, {
    session: 's-badnames',
    dispatches: [
      { id: 'r5', agentType: 'evil agent\nname', records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'model with space', effort: 'x'.repeat(200) })] },
    ],
  });
  const report = buildReport({ root, agentsDir });
  const triggers = report.generalPurpose.byTrigger;
  assert.strictEqual(triggers['command:/real-cmd'], 1);
  assert.strictEqual(triggers['skill:other'], 1);
  assert.strictEqual(triggers.unknown, 2, 'pasted and isMeta command text are ignored');
  assert.ok(!JSON.stringify(report).includes('pasted'));
  assert.ok(!JSON.stringify(report).includes('metaonly'));
  const entry = report.byAgent.find((e) => e.agentType === 'other');
  assert.ok(entry, 'unsafe agentType bucketed as other');
  assert.strictEqual(entry.model, 'other');
  assert.strictEqual(entry.effort, 'other');
  assert.strictEqual(entry.estimatedCost, 'unknown');
  assert.ok(!JSON.stringify(report).includes('evil'));
});

test('a meta without toolUseId is counted and its trigger is unknown', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [
      { id: 'nt1', agentType: 'general-purpose', noToolUseId: true,
        trigger: { type: 'assistant', timestamp: '2026-11-05T00:50:00Z', message: { id: 'sk', content: [{ type: 'tool_use', id: 'sk', name: 'Skill', input: { skill: 'fake-skill' } }] } },
        records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium', tools: ['Read'] })] },
    ],
  });
  const report = buildReport({ root, agentsDir });
  assert.strictEqual(findAgent(report, 'general-purpose', 'claude-sonnet-5-5', 'medium').count, 1);
  assert.strictEqual(report.generalPurpose.total, 1);
  assert.deepStrictEqual(report.generalPurpose.byTrigger, { unknown: 1 });
});

test('--since later than --until is a usage error (exit 64)', () => {
  const r = cli(['--since', '2026-11-05', '--until', '2026-11-04']);
  assert.strictEqual(r.status, 64);
  assert.match(r.stderr, /since/);
  assert.strictEqual(cli(['--root', mkdtemp(), '--since', '2026-11-05', '--until', '2026-11-05']).status, 0);
});

test('modelMatches compares whole tokens of the alias family, not substrings', () => {
  assert.strictEqual(modelMatches('opus', 'claude-opus-5-5'), true);
  assert.strictEqual(modelMatches('opus', 'claude-opusplus-1'), false);
  assert.strictEqual(modelMatches('opus', 'claude-fable-5-1'), false);
  assert.strictEqual(modelMatches('claude-opus-5-5', 'claude-opus-5-5'), true);
  assert.strictEqual(modelMatches('haiku', 'claude-3-haiku-20240307'), true);
  assert.strictEqual(modelMatches('sonnet', 'claude-sonnet-5-5'), true);
});

test('effort mismatch is ignored when the actual effort is null', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [{ id: 'ne1', agentType: 'architect', records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: undefined })] }],
  });
  const report = buildReport({ root, agentsDir });
  assert.deepStrictEqual(report.mismatches, []);
  assert.ok(findAgent(report, 'architect', 'claude-fable-5-1', null));
});

run('dispatch-telemetry-report');
