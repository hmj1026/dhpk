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
//   * --since later than or equal to the end of --until is a usage error (exit 64).
//   * With --since set, transcript files whose mtime is older than --since are
//     not opened: a file cannot contain entries newer than its last write.
//
// Skipped accounting (never silent): missingRoot, corruptJson (bad meta or JSONL
// line), missingTranscript (meta without its jsonl), noAssistantTurn (transcript
// with no assistant turn), missingParent (subagents without a parent session
// jsonl), unreadable (any non-ENOENT read/readdir error), undated (entry or
// Agent call without a usable timestamp while a window is set).
//
// Mismatch rules: a declared model matches when the actual id equals it or
// contains it as a whole `-`/`:`/`.`/`_`/`@`-separated token (declared `opus`
// matches `claude-opus-5-5`, not `claude-opusplus-1`). The effort comparison is
// skipped when the actual effort is null (the log did not record one), so an
// unrecorded effort is never a mismatch. Built-ins without frontmatter count as
// "no declared tier".
//
// Trigger source: the most recent `Skill` tool_use, or a user record written by
// the harness for a slash command, before the Agent call. A command record
// counts only when its message content is a plain string that starts with
// `<command-message>` or `<command-name>` (the harness's own invocation format)
// and is not marked isMeta; `<command-name>` text embedded later in an ordinary
// prompt or in tool results is ignored. A meta without a toolUseId, or whose
// parent call is not found, has trigger `unknown`.
//
// Names taken from logs (agentType, model, effort, skill, command) must match
// ^[A-Za-z0-9:_./@-]{1,80}$; anything else is reported as `other`.
//
// The report never prints prompt text, descriptions, or file contents: only
// agent types, model ids, efforts, skill/command names, counts and tokens.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

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

const SAFE_NAME = /^[A-Za-z0-9:_./@-]{1,80}$/;
const CHUNK_BYTES = 64 * 1024;

class UsageError extends Error {}

function safeName(value) {
  return typeof value === 'string' && SAFE_NAME.test(value) ? value : 'other';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBound(value, kind) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (DATE_ONLY.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    if (Number.isNaN(day.getTime()) || day.getMonth() !== m - 1) throw new UsageError(`invalid --${kind} value "${text}"`);
    if (kind === 'since') return day.getTime();
    return new Date(y, m - 1, d + 1).getTime(); // exclusive end: next local midnight
  }
  if (LOCAL_DATETIME.test(text) || ABSOLUTE_DATETIME.test(text)) {
    const ms = new Date(text).getTime();
    if (Number.isNaN(ms)) throw new UsageError(`invalid --${kind} value "${text}"`);
    return kind === 'since' ? ms : ms + 1; // inclusive instant
  }
  throw new UsageError(`invalid --${kind} value "${text}": use YYYY-MM-DD, local YYYY-MM-DDTHH:mm[:ss], or an ISO time with Z/offset`);
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
  const d = String(declared).toLowerCase();
  const a = String(actual).toLowerCase();
  if (a === d) return true;
  return a.split(/[-:._@/]/).includes(d);
}

// Reads a file in fixed-size chunks and calls onLine for every non-empty line,
// so a large transcript is never held in memory. Returns null on success or the
// fs error code (ENOENT, EACCES, ...) when the file could not be read.
function forEachLine(file, onLine) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch (error) {
    return (error && error.code) || 'EUNKNOWN';
  }
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    const decoder = new StringDecoder('utf8');
    let pending = '';
    for (;;) {
      const bytes = fs.readSync(fd, buffer, 0, CHUNK_BYTES, null);
      if (bytes === 0) break;
      pending += decoder.write(buffer.subarray(0, bytes));
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim() !== '') onLine(line);
        newline = pending.indexOf('\n');
      }
    }
    pending += decoder.end();
    if (pending.trim() !== '') onLine(pending);
    return null;
  } catch (error) {
    return (error && error.code) || 'EUNKNOWN';
  } finally {
    fs.closeSync(fd);
  }
}

function parseLine(line, skipped) {
  try {
    const parsed = JSON.parse(line);
    if (isRecord(parsed)) return parsed;
  } catch {
    // fall through to the counted skip
  }
  skipped.corruptJson += 1;
  return null;
}

function toolUses(record) {
  const content = record && record.message && record.message.content;
  if (record.type !== 'assistant' || !Array.isArray(content)) return [];
  return content.filter((c) => isRecord(c) && c.type === 'tool_use');
}

// Only the harness's own slash-command record qualifies: plain-string content
// that starts with <command-message> or <command-name>, not isMeta.
function commandNameOf(record) {
  if (record.type !== 'user' || record.isMeta === true || !isRecord(record.message)) return null;
  const content = record.message.content;
  if (typeof content !== 'string') return null;
  if (!/^\s*<command-(?:message|name)>/.test(content)) return null;
  const match = /<command-name>\s*([^<\s]+)\s*<\/command-name>/.exec(content);
  return match ? match[1] : null;
}

function scanParent(file, skipped) {
  const calls = new Map();
  let trigger = 'unknown';
  const error = forEachLine(file, (line) => {
    const record = parseLine(line, skipped);
    if (!record) return;
    const command = commandNameOf(record);
    if (command) {
      const bare = command.startsWith('/') ? command.slice(1) : command;
      trigger = `command:/${safeName(bare)}`;
    }
    for (const use of toolUses(record)) {
      if (use.name === 'Skill' && isRecord(use.input) && typeof use.input.skill === 'string') {
        trigger = `skill:${safeName(use.input.skill)}`;
      } else if (use.name === 'Agent' && isRecord(use.input) && typeof use.id === 'string') {
        calls.set(use.id, {
          ts: Date.parse(record.timestamp),
          model: typeof use.input.model === 'string' && use.input.model ? safeName(use.input.model) : null,
          effort: typeof use.input.effort === 'string' && use.input.effort ? safeName(use.input.effort) : null,
          trigger,
        });
      }
    }
  });
  return { calls, error };
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

// Streaming writes the same message more than once; the last copy is final.
function scanSubagent(file, skipped) {
  const byMessage = new Map();
  const tools = new Set();
  let firstTs = null;
  let sequence = 0;
  const error = forEachLine(file, (line) => {
    const record = parseLine(line, skipped);
    if (!record) return;
    const ts = Date.parse(record.timestamp);
    if (!Number.isNaN(ts) && (firstTs === null || ts < firstTs)) firstTs = ts;
    if (record.type !== 'assistant' || !isRecord(record.message)) return;
    for (const use of toolUses(record)) if (typeof use.name === 'string') tools.add(use.name);
    const usage = isRecord(record.message.usage) ? record.message.usage : {};
    const input = Number(usage.input_tokens) || 0;
    const cacheRead = Number(usage.cache_read_input_tokens) || 0;
    const cacheCreate = Number(usage.cache_creation_input_tokens) || 0;
    const key = typeof record.message.id === 'string' ? record.message.id : `#${sequence}`;
    sequence += 1;
    byMessage.set(key, {
      model: typeof record.message.model === 'string' ? record.message.model : null,
      effort: typeof record.effort === 'string' && record.effort ? record.effort : null,
      input,
      output: Number(usage.output_tokens) || 0,
      cacheRead,
      cacheCreate,
      promptTokens: input + cacheRead + cacheCreate,
    });
  });
  const turns = [...byMessage.values()];
  const model = (turns.find((t) => t.model !== null) || {}).model || null;
  const effort = (turns.find((t) => t.effort !== null) || {}).effort || null;
  return { error, firstTs, tools, turns, model, effort };
}

function bucketOf(tools) {
  for (const tool of tools) if (EDIT_TOOLS.has(tool)) return 'edits';
  for (const tool of tools) if (COMMAND_TOOLS.has(tool)) return 'commandsOnly';
  return 'readOnly';
}

function buildReport(options = {}) {
  const root = options.root || path.join(os.homedir(), '.claude', 'projects');
  const agentsDir = options.agentsDir || path.join(__dirname, '..', 'agents');
  const since = parseBound(options.since, 'since');
  const until = parseBound(options.until, 'until');
  if (since !== null && until !== null && since >= until) {
    throw new UsageError(`--since "${options.since}" is later than --until "${options.until}"`);
  }
  const windowed = since !== null || until !== null;
  const inWindow = (ms) => {
    if (!windowed) return true;
    if (ms === null || ms === undefined || Number.isNaN(ms)) return false;
    return (since === null || ms >= since) && (until === null || ms < until);
  };
  // A file last written before --since cannot hold an entry at or after it.
  const staleFile = (file) => {
    if (since === null) return false;
    try {
      return fs.statSync(file).mtimeMs < since;
    } catch {
      return false;
    }
  };
  const skipped = {
    missingRoot: 0,
    corruptJson: 0,
    missingTranscript: 0,
    noAssistantTurn: 0,
    missingParent: 0,
    unreadable: 0,
    undated: 0,
    total: 0,
  };
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

  const readDir = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      return { error: error && error.code };
    }
  };

  let rootStat = null;
  try {
    rootStat = fs.statSync(root);
  } catch (error) {
    if (error && error.code === 'ENOENT') skipped.missingRoot = 1;
    else skipped.unreadable += 1;
  }
  if (rootStat && !rootStat.isDirectory()) {
    rootStat = null;
    skipped.unreadable += 1;
  }

  if (rootStat) {
    const filter = options.project ? String(options.project) : '';
    const rootEntries = readDir(root);
    if (!Array.isArray(rootEntries)) skipped.unreadable += 1;
    const projects = (Array.isArray(rootEntries) ? rootEntries : [])
      .filter((e) => e.isDirectory() && (filter === '' || e.name.includes(filter)))
      .map((e) => e.name)
      .sort();
    for (const project of projects) {
      const projectDir = path.join(root, project);
      const entries = readDir(projectDir);
      if (!Array.isArray(entries)) {
        skipped.unreadable += 1;
        continue;
      }
      const sessions = new Set();
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) sessions.add(entry.name.slice(0, -'.jsonl'.length));
        if (entry.isDirectory()) sessions.add(entry.name);
      }
      for (const session of [...sessions].sort()) {
        const parentFile = path.join(projectDir, `${session}.jsonl`);
        let calls = new Map();
        let parentMissing = false;
        if (!staleFile(parentFile)) {
          const parsed = scanParent(parentFile, skipped);
          if (parsed.error === 'ENOENT') parentMissing = true;
          else if (parsed.error) skipped.unreadable += 1;
          calls = parsed.calls;
        }
        for (const call of calls.values()) {
          if (windowed && Number.isNaN(call.ts)) {
            skipped.undated += 1;
            continue;
          }
          if (!inWindow(call.ts)) continue;
          callOverrides.total += 1;
          if (call.model) callOverrides.withModel += 1;
          if (call.effort) callOverrides.withEffort += 1;
        }

        const subDir = path.join(projectDir, session, 'subagents');
        const subEntries = readDir(subDir);
        if (!Array.isArray(subEntries)) {
          if (subEntries.error !== 'ENOENT' && subEntries.error !== 'ENOTDIR') skipped.unreadable += 1;
          continue;
        }
        const files = subEntries.filter((e) => e.name.endsWith('.meta.json')).map((e) => e.name).sort();
        if (parentMissing && files.length > 0) skipped.missingParent += 1;
        for (const metaName of files) {
          const agentId = safeName(metaName.slice('agent-'.length, -'.meta.json'.length));
          let meta;
          try {
            meta = JSON.parse(fs.readFileSync(path.join(subDir, metaName), 'utf8'));
            if (!isRecord(meta) || typeof meta.agentType !== 'string') throw new SyntaxError('invalid meta');
          } catch (error) {
            if (error instanceof SyntaxError) skipped.corruptJson += 1;
            else skipped.unreadable += 1;
            continue;
          }
          const transcript = path.join(subDir, metaName.replace(/\.meta\.json$/, '.jsonl'));
          if (staleFile(transcript)) continue;
          const summary = scanSubagent(transcript, skipped);
          if (summary.error === 'ENOENT') {
            skipped.missingTranscript += 1;
            continue;
          }
          if (summary.error) {
            skipped.unreadable += 1;
            continue;
          }
          if (!inWindow(summary.firstTs)) {
            if (windowed && summary.firstTs === null) skipped.undated += 1;
            continue;
          }
          if (summary.model === null) {
            skipped.noAssistantTurn += 1;
            continue;
          }
          const agentType = safeName(meta.agentType);
          const model = safeName(summary.model);
          const effort = summary.effort === null ? null : safeName(summary.effort);
          const call = (typeof meta.toolUseId === 'string' && calls.get(meta.toolUseId)) || null;
          const callModel = (typeof meta.model === 'string' && meta.model ? safeName(meta.model) : null)
            || (call && call.model) || null;
          const callEffort = (call && call.effort) || null;
          const key = `${agentType}\u0000${model}\u0000${effort}`;
          if (!groups.has(key)) {
            groups.set(key, {
              agentType,
              model,
              effort,
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

          const declared = declaredFor(tiers, agentType);
          if (!declared) {
            noDeclaredTier += 1;
          } else {
            const fields = [];
            if (declared.model && !modelMatches(declared.model, model)) fields.push('model');
            if (declared.effort && effort && declared.effort !== effort) fields.push('effort');
            if (fields.length > 0) {
              mismatches.push({
                agentType,
                agentId,
                fields,
                declaredModel: declared.model,
                declaredEffort: declared.effort,
                actualModel: model,
                actualEffort: effort,
                callModel,
                callEffort,
              });
            }
          }

          if (agentType === 'general-purpose') {
            const bucket = bucketOf(summary.tools);
            gp.total += 1;
            gp.buckets[bucket] += 1;
            gp.byModel[model] = (gp.byModel[model] || 0) + 1;
            const trigger = call ? call.trigger : 'unknown';
            gp.byTrigger[trigger] = (gp.byTrigger[trigger] || 0) + 1;
            if (bucket === 'edits' && /haiku/i.test(model)) gp.haikuEdits += 1;
          }
        }
      }
    }
  }
  skipped.total = skipped.missingRoot + skipped.corruptJson + skipped.missingTranscript
    + skipped.noAssistantTurn + skipped.missingParent + skipped.unreadable + skipped.undated;

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
  lines.push(`skipped: ${s.total} (missing root ${s.missingRoot}, corrupt JSON ${s.corruptJson}, missing transcript ${s.missingTranscript}, no assistant turn ${s.noAssistantTurn}, missing parent ${s.missingParent}, unreadable ${s.unreadable}, undated ${s.undated})`);
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
      if (i + 1 >= argv.length) throw new UsageError(`${arg} requires a value`);
      options[valued[arg]] = argv[i + 1];
      i += 1;
    } else {
      throw new UsageError(`unknown argument "${arg}"`);
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
    return error instanceof UsageError ? 64 : 1;
  }
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
  return 0;
}

module.exports = Object.freeze({
  PRICE_TABLE, UsageError, buildReport, formatText, main, modelMatches, parseArgs, parseBound,
});

if (require.main === module) process.exitCode = main();
