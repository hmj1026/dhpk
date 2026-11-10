#!/usr/bin/env node
'use strict';

// Read-only report over local Claude Code session logs: which model@effort each
// subAgent dispatch actually ran on, what it cost, and where that differs from
// the agent definition frontmatter. Part of #1295 Phase 0 (issue #1296).
//
//   node scripts/dispatch-telemetry-report.js [--root DIR] [--since T] [--until T]
//        [--project SUBSTR] [--agents-dir DIR] [--json]
//
// Log layout read (never written):
//   <root>/<project>/<session>.jsonl                      parent transcript
//   <root>/<project>/<session>/subagents/agent-<id>.meta.json
//   <root>/<project>/<session>/subagents/agent-<id>.jsonl  subAgent transcript
//
// Time window semantics (--since / --until):
//   * `YYYY-MM-DD` is a calendar day in the LOCAL timezone of the process
//     (set TZ to change it). --since is the start of that day; --until is the
//     whole day, i.e. the window ends before the next local midnight.
//   * A datetime without an offset (`YYYY-MM-DDTHH:mm[:ss]`) is local time.
//   * A datetime with `Z` or `+HH:MM` is an absolute instant, independent of TZ.
//   * --since is inclusive; a datetime --until is inclusive of that instant.
//   * A dispatch is placed by the timestamp of its first transcript entry; an
//     `Agent` call is placed by the timestamp of its tool_use entry.
//
// The report never prints prompt text, descriptions, or file contents: only
// agent types, model ids, efforts, skill/command names, counts and tokens.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Single declared price table, USD per million tokens (input/output only; cache
// token classes are reported in usage but excluded from the estimate). Models
// not listed here are reported as "unknown", never as 0.
const PRICE_TABLE = Object.freeze({
  verifiedOn: '2026-11-10',
  currency: 'USD',
  unit: 'per-million-tokens',
  basis: 'input+output',
  source: 'rules/model-economics.md; claude-fable-5-2 from the 2026-11-10 alias change',
  models: Object.freeze({
    'claude-fable-5-1': Object.freeze({ input: 10, output: 50 }),
    'claude-fable-5-2': Object.freeze({ input: 8, output: 40 }),
    'claude-opus-5-5': Object.freeze({ input: 4, output: 20 }),
    'claude-sonnet-5-5': Object.freeze({ input: 2, output: 10 }),
    'claude-haiku-5-5': Object.freeze({
      input: 0.1,
      output: 0.5,
      // Prompts above the threshold bill at the long-prompt rate.
      longPrompt: Object.freeze({ threshold: 100000, input: 0.5, output: 2.5 }),
    }),
  }),
});

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ABSOLUTE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBound(value, kind) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (DATE_ONLY.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    if (Number.isNaN(day.getTime()) || day.getMonth() !== m - 1) throw new Error(`invalid --${kind} value "${text}"`);
    if (kind === 'since') return day.getTime();
    return new Date(y, m - 1, d + 1).getTime(); // exclusive end: next local midnight
  }
  if (LOCAL_DATETIME.test(text) || ABSOLUTE_DATETIME.test(text)) {
    const ms = new Date(text).getTime();
    if (Number.isNaN(ms)) throw new Error(`invalid --${kind} value "${text}"`);
    return kind === 'since' ? ms : ms + 1; // inclusive instant
  }
  throw new Error(`invalid --${kind} value "${text}": use YYYY-MM-DD, local YYYY-MM-DDTHH:mm[:ss], or an ISO time with Z/offset`);
}

function readFrontmatter(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    fields[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
  }
  return fields;
}

function loadDeclaredTiers(agentsDir) {
  const tiers = new Map();
  let names = [];
  try {
    names = fs.readdirSync(agentsDir).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return tiers;
  }
  for (const name of names) {
    const fields = readFrontmatter(path.join(agentsDir, name));
    if (!fields) continue;
    const agent = fields.name || name.replace(/\.md$/, '');
    const model = fields.model && fields.model !== 'inherit' ? fields.model : null;
    const effort = fields.effort || null;
    if (model || effort) tiers.set(agent, { model, effort });
  }
  return tiers;
}

function declaredFor(tiers, agentType) {
  if (tiers.has(agentType)) return tiers.get(agentType);
  const bare = agentType.includes(':') ? agentType.slice(agentType.lastIndexOf(':') + 1) : agentType;
  return tiers.get(bare) || null;
}

function modelMatches(declared, actual) {
  const d = declared.toLowerCase();
  const a = String(actual).toLowerCase();
  return a === d || a.includes(d);
}

// Streaming writes the same message more than once; the last copy is final.
function readJsonl(file, skipped) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const records = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      skipped.corruptJson += 1;
    }
  }
  return records;
}

function toolUses(record) {
  const content = record && record.message && record.message.content;
  if (record.type !== 'assistant' || !Array.isArray(content)) return [];
  return content.filter((c) => isRecord(c) && c.type === 'tool_use');
}

function commandNameOf(record) {
  if (record.type !== 'user' || !record.message) return null;
  const content = record.message.content;
  const texts = typeof content === 'string'
    ? [content]
    : (Array.isArray(content) ? content.filter((c) => isRecord(c) && c.type === 'text').map((c) => c.text) : []);
  for (const text of texts) {
    const match = /<command-name>\s*([^<\s]+)\s*<\/command-name>/.exec(String(text));
    if (match) return match[1];
  }
  return null;
}

// Parent transcript: every Agent call, plus the skill/command started most
// recently before it (file order), keyed by tool_use id.
function indexParent(records) {
  const calls = new Map();
  let trigger = 'unknown';
  for (const record of records) {
    const command = commandNameOf(record);
    if (command) trigger = `command:${command.startsWith('/') ? command : `/${command}`}`;
    for (const use of toolUses(record)) {
      if (use.name === 'Skill' && isRecord(use.input) && typeof use.input.skill === 'string') {
        trigger = `skill:${use.input.skill}`;
      } else if (use.name === 'Agent' && isRecord(use.input)) {
        calls.set(use.id, {
          id: use.id,
          ts: Date.parse(record.timestamp),
          subagentType: use.input.subagent_type,
          model: typeof use.input.model === 'string' && use.input.model ? use.input.model : null,
          effort: typeof use.input.effort === 'string' && use.input.effort ? use.input.effort : null,
          trigger,
        });
      }
    }
  }
  return calls;
}

function priceUsage(model, turns) {
  const price = PRICE_TABLE.models[model];
  if (!price) return null;
  let usd = 0;
  for (const turn of turns) {
    const long = price.longPrompt
      && turn.promptTokens > price.longPrompt.threshold ? price.longPrompt : price;
    usd += (turn.input * long.input + turn.output * long.output) / 1e6;
  }
  return usd;
}

function summariseTranscript(records) {
  const byMessage = new Map();
  const order = [];
  let firstTs = null;
  const tools = new Set();
  for (const record of records) {
    const ts = Date.parse(record.timestamp);
    if (!Number.isNaN(ts) && (firstTs === null || ts < firstTs)) firstTs = ts;
    if (record.type !== 'assistant' || !isRecord(record.message)) continue;
    for (const use of toolUses(record)) tools.add(use.name);
    const key = record.message.id || `${order.length}`;
    if (!byMessage.has(key)) order.push(key);
    byMessage.set(key, record);
  }
  const turns = [];
  let model = null;
  let effort = null;
  for (const key of order) {
    const record = byMessage.get(key);
    const usage = isRecord(record.message.usage) ? record.message.usage : {};
    const input = Number(usage.input_tokens) || 0;
    const cacheRead = Number(usage.cache_read_input_tokens) || 0;
    const cacheCreate = Number(usage.cache_creation_input_tokens) || 0;
    turns.push({
      input,
      output: Number(usage.output_tokens) || 0,
      cacheRead,
      cacheCreate,
      promptTokens: input + cacheRead + cacheCreate,
    });
    if (model === null && typeof record.message.model === 'string') model = record.message.model;
    if (effort === null && typeof record.effort === 'string' && record.effort) effort = record.effort;
  }
  return { firstTs, tools, turns, model, effort };
}

function bucketOf(tools) {
  for (const tool of tools) if (EDIT_TOOLS.has(tool)) return 'edits';
  for (const tool of tools) if (COMMAND_TOOLS.has(tool)) return 'commandsOnly';
  return 'readOnly';
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

function buildReport(options = {}) {
  const root = options.root || path.join(os.homedir(), '.claude', 'projects');
  const agentsDir = options.agentsDir || path.join(__dirname, '..', 'agents');
  const since = parseBound(options.since, 'since');
  const until = parseBound(options.until, 'until');
  const inWindow = (ms) => {
    if (since === null && until === null) return true;
    if (ms === null || ms === undefined || Number.isNaN(ms)) return false;
    return (since === null || ms >= since) && (until === null || ms < until);
  };
  const skipped = { missingRoot: 0, corruptJson: 0, missingTranscript: 0, undated: 0, total: 0 };
  const groups = new Map();
  const mismatches = [];
  const callOverrides = { total: 0, withModel: 0, withEffort: 0 };
  const gp = {
    total: 0,
    buckets: { edits: 0, commandsOnly: 0, readOnly: 0 },
    byModel: {},
    byTrigger: {},
    haikuEdits: 0,
  };
  let noDeclaredTier = 0;
  const tiers = loadDeclaredTiers(agentsDir);

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    skipped.missingRoot = 1;
  } else {
    const filter = options.project ? String(options.project) : '';
    for (const project of listDirs(root).filter((p) => filter === '' || p.includes(filter))) {
      const projectDir = path.join(root, project);
      const sessions = new Set();
      for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) sessions.add(entry.name.slice(0, -'.jsonl'.length));
        if (entry.isDirectory()) sessions.add(entry.name);
      }
      for (const session of [...sessions].sort()) {
        const parentFile = path.join(projectDir, `${session}.jsonl`);
        const parentRecords = fs.existsSync(parentFile) ? readJsonl(parentFile, skipped) : null;
        const calls = parentRecords ? indexParent(parentRecords) : new Map();
        for (const call of calls.values()) {
          if (!inWindow(call.ts)) continue;
          callOverrides.total += 1;
          if (call.model) callOverrides.withModel += 1;
          if (call.effort) callOverrides.withEffort += 1;
        }

        const subDir = path.join(projectDir, session, 'subagents');
        let files = [];
        try {
          files = fs.readdirSync(subDir).filter((n) => n.endsWith('.meta.json')).sort();
        } catch {
          continue;
        }
        for (const metaName of files) {
          const agentId = metaName.slice('agent-'.length, -'.meta.json'.length);
          let meta;
          try {
            meta = JSON.parse(fs.readFileSync(path.join(subDir, metaName), 'utf8'));
            if (!isRecord(meta) || typeof meta.agentType !== 'string') throw new Error('invalid meta');
          } catch {
            skipped.corruptJson += 1;
            continue;
          }
          const records = readJsonl(path.join(subDir, metaName.replace(/\.meta\.json$/, '.jsonl')), skipped);
          if (records === null) {
            skipped.missingTranscript += 1;
            continue;
          }
          const summary = summariseTranscript(records);
          if (!inWindow(summary.firstTs)) {
            if (summary.firstTs === null && (since !== null || until !== null)) skipped.undated += 1;
            continue;
          }
          if (summary.model === null) {
            skipped.missingTranscript += 1; // no assistant turn: actual model cannot be determined
            continue;
          }
          const call = calls.get(meta.toolUseId) || null;
          const callModel = (typeof meta.model === 'string' && meta.model) || (call && call.model) || null;
          const callEffort = (call && call.effort) || null;
          const key = `${meta.agentType}\u0000${summary.model}\u0000${summary.effort}`;
          if (!groups.has(key)) {
            groups.set(key, {
              agentType: meta.agentType,
              model: summary.model,
              effort: summary.effort,
              count: 0,
              usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
              turns: [],
            });
          }
          const group = groups.get(key);
          group.count += 1;
          for (const turn of summary.turns) {
            group.usage.inputTokens += turn.input;
            group.usage.outputTokens += turn.output;
            group.usage.cacheReadTokens += turn.cacheRead;
            group.usage.cacheCreationTokens += turn.cacheCreate;
            group.turns.push(turn);
          }

          const declared = declaredFor(tiers, meta.agentType);
          if (!declared) {
            noDeclaredTier += 1;
          } else {
            const fields = [];
            if (declared.model && !modelMatches(declared.model, summary.model)) fields.push('model');
            if (declared.effort && summary.effort && declared.effort !== summary.effort) fields.push('effort');
            if (fields.length > 0) {
              mismatches.push({
                agentType: meta.agentType,
                agentId,
                fields,
                declaredModel: declared.model,
                declaredEffort: declared.effort,
                actualModel: summary.model,
                actualEffort: summary.effort,
                callModel,
                callEffort,
              });
            }
          }

          if (meta.agentType === 'general-purpose') {
            const bucket = bucketOf(summary.tools);
            gp.total += 1;
            gp.buckets[bucket] += 1;
            gp.byModel[summary.model] = (gp.byModel[summary.model] || 0) + 1;
            const trigger = call ? call.trigger : 'unknown';
            gp.byTrigger[trigger] = (gp.byTrigger[trigger] || 0) + 1;
            if (bucket === 'edits' && /haiku/i.test(summary.model)) gp.haikuEdits += 1;
          }
        }
      }
    }
  }
  skipped.total = skipped.missingRoot + skipped.corruptJson + skipped.missingTranscript + skipped.undated;

  const byAgent = [...groups.values()]
    .map(({ turns, ...group }) => {
      const cost = priceUsage(group.model, turns);
      return { ...group, estimatedCost: cost === null ? 'unknown' : Number(cost.toFixed(6)) };
    })
    .sort((a, b) => b.count - a.count
      || a.agentType.localeCompare(b.agentType)
      || a.model.localeCompare(b.model)
      || String(a.effort).localeCompare(String(b.effort)));
  mismatches.sort((a, b) => a.agentType.localeCompare(b.agentType) || a.agentId.localeCompare(b.agentId));

  return {
    window: {
      since: options.since || null,
      until: options.until || null,
      timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    pricing: { ...PRICE_TABLE, models: PRICE_TABLE.models },
    byAgent,
    callOverrides,
    mismatches,
    noDeclaredTier,
    generalPurpose: gp,
    skipped,
  };
}

function formatText(report) {
  const lines = [];
  const w = report.window;
  lines.push(`dispatch telemetry (since ${w.since || '-'} until ${w.until || '-'}, tz ${w.timezone})`);
  lines.push('');
  lines.push('agentType x model@effort: count, tokens (in/out), estimated cost');
  if (report.byAgent.length === 0) lines.push('  (no dispatches)');
  for (const e of report.byAgent) {
    const cost = e.estimatedCost === 'unknown' ? 'unknown' : `$${e.estimatedCost.toFixed(4)}`;
    lines.push(`  ${e.agentType}  ${e.model}@${e.effort || 'default'}  x${e.count}  ${e.usage.inputTokens}/${e.usage.outputTokens}  ${cost}`);
  }
  lines.push(`  price table verified ${report.pricing.verifiedOn} (${report.pricing.basis}); unlisted models are "unknown"`);
  lines.push('');
  const o = report.callOverrides;
  lines.push(`Agent calls: ${o.total} total, ${o.withModel} with model, ${o.withEffort} with effort`);
  lines.push('');
  lines.push(`mismatches vs agent frontmatter: ${report.mismatches.length} (${report.noDeclaredTier} dispatches have no declared tier)`);
  for (const m of report.mismatches) {
    lines.push(`  ${m.agentType} ${m.agentId}: declared ${m.declaredModel || '-'}@${m.declaredEffort || '-'} actual ${m.actualModel}@${m.actualEffort || 'default'} [${m.fields.join(',')}]${m.callModel || m.callEffort ? ` call=${m.callModel || '-'}@${m.callEffort || '-'}` : ''}`);
  }
  lines.push('');
  const g = report.generalPurpose;
  lines.push(`general-purpose: ${g.total} dispatches; edits ${g.buckets.edits}, commands-only ${g.buckets.commandsOnly}, read-only ${g.buckets.readOnly}; haiku edits ${g.haikuEdits}`);
  lines.push(`  models: ${Object.entries(g.byModel).map(([k, v]) => `${k} x${v}`).join(', ') || '-'}`);
  lines.push(`  triggers: ${Object.entries(g.byTrigger).map(([k, v]) => `${k} x${v}`).join(', ') || '-'}`);
  lines.push('');
  const s = report.skipped;
  lines.push(`skipped: ${s.total} (missing root ${s.missingRoot}, corrupt JSON ${s.corruptJson}, missing transcript ${s.missingTranscript}, undated ${s.undated})`);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = {};
  const valued = { '--root': 'root', '--since': 'since', '--until': 'until', '--project': 'project', '--agents-dir': 'agentsDir' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (Object.prototype.hasOwnProperty.call(valued, arg)) {
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      options[valued[arg]] = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let options;
  let report;
  try {
    options = parseArgs(argv);
    report = buildReport(options);
  } catch (error) {
    stderr.write(`dispatch-telemetry-report: ${error.message}\n`);
    return 2;
  }
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
  return 0;
}

module.exports = Object.freeze({ PRICE_TABLE, buildReport, formatText, main, parseArgs, parseBound });

if (require.main === module) process.exitCode = main();
