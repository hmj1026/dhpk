'use strict';

// Exercise dispatch-telemetry-report against synthetic session logs only.
// Every id, timestamp, model and sentinel string below is fabricated; no real
// session log, prompt, or project name is read or committed.
const fs = require('node:fs');
const { makeTempDir } = require('./_lib/temp-dir');
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
  return makeTempDir('dhpk-telemetry-');
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

// Fixed usage fixture for #1331: every token class present, cache writes split
// across the 5-minute and 1-hour TTLs. Prices are the declared table's.
const CACHE_FIXTURE_USAGE = Object.freeze({
  input_tokens: 1000,
  output_tokens: 2000,
  cache_read_input_tokens: 1000000,
  cache_creation_input_tokens: 300000,
  cache_creation: { ephemeral_5m_input_tokens: 200000, ephemeral_1h_input_tokens: 100000 },
});

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
}

test('cost includes input, output, cache read and both cache-write TTLs at their own rates', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [{ id: 'c1', agentType: 'Explore', records: [
      assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-opus-5-5', effort: 'medium', usage: CACHE_FIXTURE_USAGE }),
    ] }],
  });
  const report = buildReport({ root, agentsDir });
  const entry = findAgent(report, 'Explore', 'claude-opus-5-5', 'medium');
  assert.strictEqual(entry.usage.cacheReadTokens, 1000000);
  assert.strictEqual(entry.usage.cacheCreationTokens, 300000);
  assert.strictEqual(entry.usage.cacheWrite5mTokens, 200000);
  assert.strictEqual(entry.usage.cacheWrite1hTokens, 100000);
  const b = entry.estimatedCostBreakdown;
  near(b.input, 0.004, 'input'); // 1000 * $4/M
  near(b.output, 0.04, 'output'); // 2000 * $20/M
  near(b.cacheRead, 0.2, 'cacheRead'); // 1,000,000 * $0.20/M
  near(b.cacheWrite5m, 1.0, 'cacheWrite5m'); // 200,000 * $5/M
  near(b.cacheWrite1h, 0.8, 'cacheWrite1h'); // 100,000 * $8/M
  near(b.total, 2.044, 'total');
  near(entry.estimatedCost, 2.044, 'estimatedCost');
  assert.strictEqual(report.pricing.basis, 'input+output+cacheRead+cacheWrite5m+cacheWrite1h');
});

test('haiku long-prompt rate applies when cache reads push the prompt over the threshold', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [{ id: 'h1', agentType: 'Explore', records: [
      assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-haiku-5-5', effort: 'low', usage: {
        input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 150000, cache_creation_input_tokens: 0,
      } }),
    ] }],
  });
  const b = findAgent(buildReport({ root, agentsDir }), 'Explore', 'claude-haiku-5-5', 'low').estimatedCostBreakdown;
  near(b.input, 0.0005, 'input'); // 1000 * $0.50/M
  near(b.cacheRead, 0.0075, 'cacheRead'); // 150,000 * $0.05/M
  near(b.output, 0.0025, 'output'); // 1000 * $2.50/M
  near(b.total, 0.0105, 'total');
});

test('cache writes without a TTL breakdown are priced as 5-minute writes', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [{ id: 'w1', agentType: 'fast-worker', records: [
      assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium', usage: {
        input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 400000,
      } }),
    ] }],
  });
  const entry = findAgent(buildReport({ root, agentsDir }), 'fast-worker', 'claude-sonnet-5-5', 'medium');
  assert.strictEqual(entry.usage.cacheWrite5mTokens, 400000);
  assert.strictEqual(entry.usage.cacheWrite1hTokens, 0);
  near(entry.estimatedCostBreakdown.cacheWrite5m, 1.0, 'cacheWrite5m'); // 400,000 * $2.50/M
  near(entry.estimatedCostBreakdown.cacheWrite1h, 0, 'cacheWrite1h');
});

test('report cost totals sum priced groups and count unpriced groups instead of treating them as 0', () => {
  const root = mkdtemp();
  const agentsDir = makeAgentsDir();
  makeSession(root, {
    dispatches: [
      { id: 't1', agentType: 'Explore', records: [
        assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-opus-5-5', effort: 'medium', usage: CACHE_FIXTURE_USAGE }),
      ] },
      { id: 't2', agentType: 'Explore', records: [
        assistant({ ts: '2026-11-05T02:00:00Z', model: 'claude-unpriced-9-9', effort: 'medium', usage: CACHE_FIXTURE_USAGE }),
      ] },
    ],
  });
  const report = buildReport({ root, agentsDir });
  const t = report.costTotals;
  near(t.input, 0.004, 'input');
  near(t.output, 0.04, 'output');
  near(t.cacheRead, 0.2, 'cacheRead');
  near(t.cacheWrite5m, 1.0, 'cacheWrite5m');
  near(t.cacheWrite1h, 0.8, 'cacheWrite1h');
  near(t.total, 2.044, 'total');
  assert.strictEqual(t.unpricedGroups, 1);
  assert.strictEqual(findAgent(report, 'Explore', 'claude-unpriced-9-9', 'medium').estimatedCostBreakdown, 'unknown');

  const text = cli(['--root', root, '--agents-dir', agentsDir]);
  assert.strictEqual(text.status, 0, text.stderr);
  assert.match(text.stdout, /input\+output\+cacheRead\+cacheWrite5m\+cacheWrite1h/);
  assert.match(text.stdout, /cache read \$0\.2000/);
  assert.match(text.stdout, /estimated cost total \$2\.0440/);
  assert.match(text.stdout, /1 unpriced group/);
});

// ---- #1335: --host and repeatable --merge --------------------------------

const MERGE_WINDOW = ['--since', '2026-11-05T00:00Z', '--until', '2026-11-06T00:00Z'];
const LONG_PROMPT_A = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 150000, cache_creation_input_tokens: 0 };
const LONG_PROMPT_B = { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 220000, cache_creation_input_tokens: 0 };

function skillTrigger(ts, name) {
  return {
    type: 'assistant',
    timestamp: ts,
    message: { id: `sk-${ts}`, content: [{ type: 'tool_use', id: `sk-${ts}`, name: 'Skill', input: { skill: name } }] },
  };
}

function hostRoot(which) {
  const root = mkdtemp();
  if (which === 'a') {
    makeSession(root, {
      dispatches: [
        { id: 'a1', agentType: 'architect', records: [assistant({ ts: '2026-11-05T01:00:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
        { id: 'a2', agentType: 'architect', callEffort: 'low', records: [
          assistant({ ts: '2026-11-05T02:00:00Z', model: 'claude-fable-5-1', effort: 'low', usage: { input_tokens: 2000, output_tokens: 100 } }),
        ] },
        { id: 'dup1', agentType: 'dhpk:architect', callModel: 'opus', callEffort: 'high', records: [
          assistant({ ts: '2026-11-05T03:00:00Z', model: 'claude-opus-5-5', effort: 'high' }),
        ] },
        { id: 'h1', agentType: 'Explore', records: [assistant({ ts: '2026-11-05T04:00:00Z', model: 'claude-haiku-5-5', effort: 'low', usage: LONG_PROMPT_A })] },
        { id: 'u1', agentType: 'Explore', records: [assistant({ ts: '2026-11-05T05:00:00Z', model: 'claude-unpriced-9-9', effort: 'medium' })] },
        { id: 'gp1', agentType: 'general-purpose', trigger: skillTrigger('2026-11-05T06:00:00Z', 'fake-skill'), records: [
          assistant({ ts: '2026-11-05T06:10:00Z', model: 'claude-haiku-5-5', effort: 'medium', tools: ['Read', 'Edit'] }),
        ] },
        { id: 'gp2', agentType: 'general-purpose', records: [
          assistant({ ts: '2026-11-05T07:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium', tools: ['Read'] }),
        ] },
      ],
    });
    // A corrupt meta so that skipped.total is non-zero on this host.
    fs.writeFileSync(path.join(root, '-fake-project-a', 'session-0001', 'subagents', 'agent-bad.meta.json'), '{broken');
  } else {
    makeSession(root, {
      dispatches: [
        { id: 'b1', agentType: 'architect', records: [assistant({ ts: '2026-11-05T01:30:00Z', model: 'claude-fable-5-1', effort: 'low' })] },
        { id: 'dup1', agentType: 'dhpk:architect', callModel: 'opus', records: [
          assistant({ ts: '2026-11-05T03:30:00Z', model: 'claude-opus-5-5', effort: 'high' }),
        ] },
        { id: 'h1', agentType: 'Explore', records: [assistant({ ts: '2026-11-05T04:30:00Z', model: 'claude-haiku-5-5', effort: 'low', usage: LONG_PROMPT_B })] },
        { id: 'gp1', agentType: 'general-purpose', trigger: { type: 'user', timestamp: '2026-11-05T06:00:00Z', message: { role: 'user', content: '<command-name>/fake-command</command-name>' } }, records: [
          assistant({ ts: '2026-11-05T06:10:00Z', model: 'claude-haiku-5-5', effort: 'medium', tools: ['Write'] }),
        ] },
        { id: 'gp2', agentType: 'general-purpose', records: [
          assistant({ ts: '2026-11-05T07:00:00Z', model: 'claude-sonnet-5-5', effort: 'medium', tools: ['Bash'] }),
        ] },
      ],
    });
  }
  return root;
}

function hostJson(host, which, agentsDir, extraArgs = []) {
  const r = cli(['--root', hostRoot(which), '--agents-dir', agentsDir, '--json', ...(host ? ['--host', host] : []), ...MERGE_WINDOW, ...extraArgs], { TZ: 'UTC' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

let inputDir = null;
let inputSeq = 0;
function writeInput(value) {
  if (!inputDir) inputDir = mkdtemp();
  inputSeq += 1;
  const file = path.join(inputDir, `host-${inputSeq}.json`);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function mergeCli(inputs, extraArgs = []) {
  const files = inputs.map(writeInput);
  return cli([...files.flatMap((f) => ['--merge', f]), ...extraArgs], { TZ: 'UTC' });
}

function mergedJson(inputs) {
  const r = mergeCli(inputs, ['--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function twoHosts() {
  const agentsDir = makeAgentsDir();
  return [hostJson('host-a', 'a', agentsDir), hostJson('host-b', 'b', agentsDir)];
}

test('single-host --json --host includes schemaVersion, host, and a sha256 declaredTiersDigest without paths', () => {
  const agentsDir = makeAgentsDir();
  const report = hostJson('host-a', 'a', agentsDir);
  assert.strictEqual(report.schemaVersion, 1);
  assert.strictEqual(report.host, 'host-a');
  assert.match(report.declaredTiersDigest, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(report).includes(agentsDir), 'agents dir path leaked');
  assert.strictEqual(hostJson('host-b', 'b', agentsDir).declaredTiersDigest, report.declaredTiersDigest);
  const other = path.join(mkdtemp(), 'agents');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'architect.md'), '---\nname: architect\nmodel: opus\neffort: low\n---\nbody\n');
  assert.notStrictEqual(hostJson('host-a', 'a', other).declaredTiersDigest, report.declaredTiersDigest);
  assert.strictEqual(hostJson(null, 'a', agentsDir).host, null);
  assert.strictEqual(cli(['--root', mkdtemp(), '--host', 'bad/host']).status, 64);
  assert.strictEqual(cli(['--root', mkdtemp(), '--host']).status, 64);
});

test('two-host merge sums byAgent, costTotals, callOverrides, skipped, noDeclaredTier and generalPurpose with nested maps', () => {
  const [a, b] = twoHosts();
  const m = mergedJson([a, b]);
  assert.strictEqual(m.schemaVersion, 1);
  assert.deepStrictEqual(m.window, a.window);
  assert.deepStrictEqual(m.pricing, a.pricing);

  const arch = findAgent(m, 'architect', 'claude-fable-5-1', 'low');
  assert.strictEqual(arch.count, 3);
  assert.strictEqual(arch.usage.inputTokens, 4000);
  assert.strictEqual(arch.usage.outputTokens, 1100);
  near(arch.estimatedCost, 0.095, 'architect cost'); // 0.035 + 0.025 on host-a, 0.035 on host-b
  near(arch.estimatedCostBreakdown.input, 0.04, 'architect input cost');
  near(arch.estimatedCostBreakdown.total, 0.095, 'architect breakdown total');

  // Every merged group is the field-wise sum of the same group on each host.
  const sumKeys = (rows, pick) => rows.reduce((acc, row) => {
    for (const [k, v] of Object.entries(pick(row))) acc[k] = (acc[k] || 0) + v;
    return acc;
  }, {});
  for (const group of m.byAgent) {
    const rows = [a, b].map((r) => findAgent(r, group.agentType, group.model, group.effort)).filter(Boolean);
    assert.strictEqual(group.count, rows.reduce((n, r) => n + r.count, 0));
    assert.deepStrictEqual(group.usage, sumKeys(rows, (r) => r.usage));
    if (group.estimatedCost === 'unknown') continue;
    near(group.estimatedCost, rows.reduce((n, r) => n + r.estimatedCost, 0), `${group.agentType} cost`);
    for (const [k, v] of Object.entries(sumKeys(rows, (r) => r.estimatedCostBreakdown))) {
      near(group.estimatedCostBreakdown[k], v, `${group.agentType} ${k}`);
    }
  }
  assert.strictEqual(m.byAgent.length, 6);
  assert.strictEqual(m.byAgent.reduce((n, g) => n + g.count, 0), 12);

  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'total']) {
    near(m.costTotals[key], a.costTotals[key] + b.costTotals[key], `costTotals.${key}`);
  }
  assert.strictEqual(m.costTotals.unpricedGroups, 1, 'recounted on merged groups');
  assert.deepStrictEqual(m.callOverrides, { total: 12, withModel: 2, withEffort: 2 });
  assert.strictEqual(m.noDeclaredTier, a.noDeclaredTier + b.noDeclaredTier);
  assert.strictEqual(m.noDeclaredTier, 7);
  assert.deepStrictEqual(m.skipped, sumKeys([a, b], (r) => r.skipped));
  assert.strictEqual(m.skipped.corruptJson, 1);
  assert.strictEqual(m.skipped.total, 1);

  const gp = m.generalPurpose;
  assert.strictEqual(gp.total, 4);
  assert.deepStrictEqual(gp.buckets, { edits: 2, commandsOnly: 1, readOnly: 1 });
  assert.deepStrictEqual(gp.byModel, { 'claude-haiku-5-5': 2, 'claude-sonnet-5-5': 2 });
  assert.deepStrictEqual(gp.byTrigger, { 'skill:fake-skill': 2, 'command:/fake-command': 2 });
  assert.strictEqual(gp.haikuEdits, 2);
});

test('merge never recomputes cost: the Haiku long-prompt group equals the sum of the host costs', () => {
  const [a, b] = twoHosts();
  const m = mergedJson([a, b]);
  const haiku = findAgent(m, 'Explore', 'claude-haiku-5-5', 'low');
  assert.strictEqual(haiku.count, 2);
  near(haiku.estimatedCost, 0.0105 + 0.01325, 'haiku merged cost'); // each host priced at the long-prompt rate
  assert.ok(haiku.estimatedCost > 0.01, 'a base-rate recompute from the merged tokens would be ~0.0048');
  near(haiku.estimatedCostBreakdown.cacheRead, 0.0075 + 0.011, 'haiku cache read');
  near(haiku.estimatedCostBreakdown.output, 0.0025 + 0.00125, 'haiku output');
});

test('unknown cost stays unknown: one unknown contributor makes the merged group unknown and unpricedGroups is recounted', () => {
  const [a, b] = twoHosts();
  const forced = JSON.parse(JSON.stringify(b));
  const haiku = findAgent(forced, 'Explore', 'claude-haiku-5-5', 'low');
  haiku.estimatedCost = null;
  haiku.estimatedCostBreakdown = 'unknown';
  const m = mergedJson([a, forced]);
  const merged = findAgent(m, 'Explore', 'claude-haiku-5-5', 'low');
  assert.strictEqual(merged.count, 2);
  assert.strictEqual(merged.estimatedCost, 'unknown');
  assert.strictEqual(merged.estimatedCostBreakdown, 'unknown');
  assert.strictEqual(findAgent(m, 'Explore', 'claude-unpriced-9-9', 'medium').estimatedCost, 'unknown');
  assert.strictEqual(m.costTotals.unpricedGroups, 2);
  const text = mergeCli([a, forced]);
  assert.strictEqual(text.status, 0, text.stderr);
  assert.match(text.stdout, /2 unpriced groups/);
});

test('merge rejects inputs whose since, until, timezone, or pricing differ (exit 1)', () => {
  const agentsDir = makeAgentsDir();
  const a = hostJson('host-a', 'a', agentsDir);
  const b = hostJson('host-b', 'b', agentsDir);
  assert.strictEqual(mergeCli([a, b]).status, 0);

  const differentSince = hostJson('host-b', 'b', agentsDir, ['--since', '2026-11-05T00:00:01Z']);
  const since = mergeCli([a, differentSince]);
  assert.strictEqual(since.status, 1);
  assert.match(since.stderr, /since/);

  const differentUntil = hostJson('host-b', 'b', agentsDir, ['--until', '2026-11-06T00:00:01Z']);
  const until = mergeCli([a, differentUntil]);
  assert.strictEqual(until.status, 1);
  assert.match(until.stderr, /until/);

  const zone = mergeCli([a, { ...b, window: { ...b.window, timezone: 'Asia/Taipei' } }]);
  assert.strictEqual(zone.status, 1);
  assert.match(zone.stderr, /timezone/);

  const pricing = mergeCli([a, { ...b, pricing: { ...b.pricing, verifiedOn: '2026-01-01' } }]);
  assert.strictEqual(pricing.status, 1);
  assert.match(pricing.stderr, /pricing/);
  const nestedPrice = JSON.parse(JSON.stringify(b));
  nestedPrice.pricing.models['claude-haiku-5-5'].longPrompt.threshold = 1;
  assert.strictEqual(mergeCli([a, nestedPrice]).status, 1, 'nested price differences count');
});

test('merge rejects an input without schemaVersion or host, or with an unreadable file', () => {
  const [a, b] = twoHosts();
  const { schemaVersion, ...noVersion } = b;
  const version = mergeCli([a, noVersion]);
  assert.strictEqual(version.status, 1);
  assert.match(version.stderr, /schemaVersion/);
  assert.strictEqual(mergeCli([a, { ...b, schemaVersion: 2 }]).status, 1);

  const { host, ...noHost } = b;
  const missing = mergeCli([a, noHost]);
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /host/);
  assert.strictEqual(mergeCli([a, { ...b, host: null }]).status, 1, 'a report made without --host cannot merge');
  assert.strictEqual(mergeCli([a, { ...b, host: '' }]).status, 1);
  assert.strictEqual(mergeCli([a, { ...b, host: '/home/someone/secret' }]).status, 1);

  assert.strictEqual(mergeCli([a, '{not json']).status, 1);
  assert.strictEqual(mergeCli([a, '[]']).status, 1);
  assert.strictEqual(cli(['--merge', path.join(inputDir, 'does-not-exist.json')]).status, 1);
  assert.strictEqual(mergeCli([a, { ...b, skipped: { total: 'x' } }]).status, 1, 'non-numeric counters are rejected');
});

test('merge rejects duplicate host labels', () => {
  const [a, b] = twoHosts();
  const dup = mergeCli([a, { ...b, host: a.host }]);
  assert.strictEqual(dup.status, 1);
  assert.match(dup.stderr, /host/);
  assert.strictEqual(mergeCli([a, a]).status, 1);
});

test('--merge combined with --root, --since, --until, --project or --agents-dir is a usage error (exit 64)', () => {
  const [a, b] = twoHosts();
  const files = [a, b].map(writeInput).flatMap((f) => ['--merge', f]);
  for (const flag of [['--root', mkdtemp()], ['--since', '2026-11-05'], ['--until', '2026-11-06'], ['--project', 'x'], ['--agents-dir', mkdtemp()]]) {
    const r = cli([...files, ...flag]);
    assert.strictEqual(r.status, 64, `${flag[0]}: ${r.stderr}`);
    assert.match(r.stderr, /--merge/);
  }
  assert.strictEqual(cli(['--merge']).status, 64);
  assert.strictEqual(cli([...files, '--json']).status, 0);
});

test('merged mismatches keep their host because agentId is only unique per host', () => {
  const [a, b] = twoHosts();
  const m = mergedJson([a, b]);
  assert.strictEqual(m.mismatches.length, 2);
  assert.deepStrictEqual(m.mismatches.map((x) => [x.host, x.agentId, x.agentType]), [
    ['host-a', 'dup1', 'dhpk:architect'],
    ['host-b', 'dup1', 'dhpk:architect'],
  ]);
  for (const x of m.mismatches) {
    assert.deepStrictEqual(x.fields.slice().sort(), ['effort', 'model']);
    assert.strictEqual(x.actualModel, 'claude-opus-5-5');
  }
  assert.strictEqual(m.mismatches[0].callEffort, 'high');
  assert.strictEqual(m.mismatches[1].callEffort, null);
  const text = mergeCli([a, b]);
  assert.match(text.stdout, /host-a dhpk:architect dup1: declared/);
  assert.match(text.stdout, /host-b dhpk:architect dup1: declared/);
});

test('merge reports sources and marks declaredTiers consistent or mixed from the digests', () => {
  const agentsDir = makeAgentsDir();
  const a = hostJson('host-a', 'a', agentsDir);
  const b = hostJson('host-b', 'b', agentsDir);
  const same = mergedJson([a, b]);
  assert.strictEqual(same.declaredTiers, 'consistent');
  assert.deepStrictEqual(same.sources, [
    { host: 'host-a', declaredTiersDigest: a.declaredTiersDigest, skippedTotal: 1 },
    { host: 'host-b', declaredTiersDigest: b.declaredTiersDigest, skippedTotal: 0 },
  ]);

  const otherAgents = path.join(mkdtemp(), 'agents');
  fs.mkdirSync(otherAgents);
  fs.writeFileSync(path.join(otherAgents, 'architect.md'), '---\nname: architect\nmodel: opus\neffort: low\n---\nbody\n');
  const c = hostJson('host-c', 'b', otherAgents);
  assert.notStrictEqual(c.declaredTiersDigest, a.declaredTiersDigest);
  const mixed = mergedJson([a, c]);
  assert.strictEqual(mixed.declaredTiers, 'mixed', 'still merges');
  assert.strictEqual(mixed.byAgent.reduce((n, g) => n + g.count, 0), 12);
  assert.deepStrictEqual(mixed.sources.map((s) => s.declaredTiersDigest), [a.declaredTiersDigest, c.declaredTiersDigest]);

  const text = mergeCli([a, c]);
  assert.strictEqual(text.status, 0, text.stderr);
  const lines = text.stdout.split('\n').filter((l) => l.startsWith('sources:'));
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /host-a/);
  assert.match(lines[0], /host-c/);
  assert.match(lines[0], /mixed/);
  assert.match(text.stdout, /dispatch telemetry/);
  assert.match(text.stdout, /agentType x model@effort/);
});

test('a single-input merge works and re-uses the text and JSON renderers', () => {
  const [a] = twoHosts();
  const text = mergeCli([a]);
  assert.strictEqual(text.status, 0, text.stderr);
  assert.match(text.stdout, /^sources: host-a/m);
  const m = mergedJson([a]);
  assert.deepStrictEqual(m.byAgent.map((g) => g.count), a.byAgent.map((g) => g.count));
  assert.strictEqual(m.callOverrides.total, a.callOverrides.total);
  // A merged report is not itself a mergeable host report.
  assert.strictEqual(mergeCli([m, a]).status, 1);
});

test('single-host and merged output contain neither host filesystem paths nor os.hostname()', () => {
  const sentinel = 'SENTINEL-HOSTNAME-DO-NOT-LEAK';
  const preload = path.join(mkdtemp(), 'hostname-preload.js');
  fs.writeFileSync(preload, `require('node:os').hostname = () => '${sentinel}';\n`);
  const env = { NODE_OPTIONS: `--require ${preload}`, TZ: 'UTC' };
  const agentsDir = makeAgentsDir();
  const rootA = hostRoot('a');
  const rootB = hostRoot('b');
  const outputs = [];
  const files = [];
  for (const [host, root] of [['host-a', rootA], ['host-b', rootB]]) {
    for (const extra of [['--json'], []]) {
      const r = cli(['--root', root, '--agents-dir', agentsDir, '--host', host, ...MERGE_WINDOW, ...extra], env);
      assert.strictEqual(r.status, 0, r.stderr);
      outputs.push(r.stdout, r.stderr);
    }
    const json = cli(['--root', root, '--agents-dir', agentsDir, '--host', host, '--json', ...MERGE_WINDOW], env);
    files.push(writeInput(json.stdout));
  }
  const merged = [[], ['--json']].map((extra) => cli([...files.flatMap((f) => ['--merge', f]), ...extra], env));
  for (const r of merged) {
    assert.strictEqual(r.status, 0, r.stderr);
    outputs.push(r.stdout, r.stderr);
  }
  const failed = cli(['--merge', files[0], '--merge', files[0]], env);
  assert.strictEqual(failed.status, 1);
  outputs.push(failed.stdout, failed.stderr);
  for (const out of outputs) {
    assert.ok(!out.includes(sentinel), 'os.hostname() leaked');
    for (const forbidden of [rootA, rootB, agentsDir, inputDir, __dirname, ROOT]) {
      assert.ok(!out.includes(forbidden), `path leaked: ${forbidden}`);
    }
    assert.ok(!out.includes(PROMPT_SENTINEL) && !out.includes(DESCRIPTION_SENTINEL));
  }
});

run('dispatch-telemetry-report');
