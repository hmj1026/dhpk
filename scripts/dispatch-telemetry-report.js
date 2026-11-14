#!/usr/bin/env node
'use strict';

// Read-only report over local Claude Code session logs: which model@effort each
// subAgent dispatch actually ran on, what it cost, and where that differs from
// the agent definition frontmatter. Part of #1295 Phase 0 (issue #1296).
//
//   node scripts/dispatch-telemetry-report.js [--root DIR] [--since T] [--until T]
//        [--project SUBSTR] [--agents-dir DIR] [--host LABEL] [--json]
//   node scripts/dispatch-telemetry-report.js --merge FILE [--merge FILE ...] [--json]
//
// Multi-host merge (#1335): transcripts never leave a host. Each host runs the
// report with `--json --host LABEL` (pass absolute times with a zone, e.g.
// `--since 2026-11-12T07:33Z`, so every host reports the same window) and the
// per-host JSON files are combined with repeatable `--merge FILE`.
//   * --host LABEL names the host in the JSON (`host`). It must match
//     ^[A-Za-z0-9._@:-]{1,64}$; os.hostname() is never read. Without --host the
//     JSON carries `host: null` and cannot be merged. A report also carries
//     `schemaVersion: 2` and `declaredTiersDigest`, the sha256 of the sorted
//     declared tiers (agent, model, effort) loaded from --agents-dir; no path.
//   * --merge cannot be combined with --root, --since, --until, --project or
//     --agents-dir (usage error, exit 64); --host and --json are accepted, and
//     --host is ignored because a merged report has no single host.
//   * Rejected with exit 1: an input that is unreadable, not a JSON object, or
//     lacks schemaVersion 2 or a valid host; a repeated host; differing
//     window.since, window.until, window.timezone, or pricing (compared deeply).
//   * byAgent groups by agentType+model+effort and sums count, every usage
//     field, estimatedCost and each estimatedCostBreakdown field. Cost is never
//     recomputed (the JSON has no per-turn data, and the Haiku long-prompt rate
//     depends on single-turn size); one unknown contributor makes the merged
//     group "unknown". costTotals.unpricedGroups is recounted on merged groups.
//     costTotals (other fields), callOverrides, skipped, noDeclaredTier and every
//     generalPurpose counter (buckets, byModel, byTrigger included) are summed.
//   * Every input must be structurally complete, else exit 1: `window` owns
//     since, until and timezone (string or null); costTotals and every priced
//     byAgent estimatedCostBreakdown carry finite input, output, cacheRead,
//     cacheWrite5m, cacheWrite1h and total; every byAgent group carries finite
//     values for all six usage fields. Error messages never echo input key names.
//   * Merged costTotals and byAgent costs sum each host's already-rounded (6 dp)
//     values, so a merged total can differ from a single-host total by at most
//     hosts x 5e-7.
//   * Every mismatch gains `host` (agentId is unique only per host); only the
//     known mismatch fields are kept, any other key is dropped.
//   * Output adds `sources[]` ({host, declaredTiersDigest, skippedTotal}, in
//     input order) and `declaredTiers`: "consistent" when every digest is equal,
//     "mixed" when they differ (the merge still happens). Text output adds one
//     `sources:` line.
//
// Oversized dispatches (#1336): a dispatch is flagged when its assistant turn
// count (de-duplicated by message id) exceeds 120 or its peak prompt proxy
// (largest input + cache read + cache write of any turn with usage; not the
// context window) exceeds 200000 tokens. A turn whose message.usage is missing
// or lacks any of those three numeric fields counts in `usageMissingTurns`;
// such a dispatch has `complete: false` and is listed even below the thresholds,
// so missing measurement never reads as 0. `peakPromptTokens` is null when no
// turn was measured, and a lower bound when the dispatch is incomplete. The `oversized` section carries
// `thresholds`, `metric` (a constant string naming the measure) and `dispatches`
// ({agentType, agentId, model, effort, turns, peakPromptTokens, reasons,
// complete, usageMissingTurns}, reasons from `turns`/`context`, possibly empty),
// sorted by peak desc. --merge requires the section on every input, refuses
// differing thresholds or metric, requires complete to equal usageMissingTurns 0
// (a null peak only when incomplete), and adds
// `host`. Text output adds an `oversized dispatches` line plus one line per
// dispatch, with ` UNKNOWN: N turn(s) without usage` when incomplete.
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
// Mismatch & escalation rules (#1412):
//   * A declared model matches when the actual id equals it or contains it as a
//     whole `-`/`:`/`.`/`_`/`@`-separated token (declared `opus` matches
//     `claude-opus-5-5`, not `claude-opusplus-1`). The effort comparison is
//     skipped when the actual effort is null (the log did not record one), so an
//     unrecorded effort is never a mismatch.
//   * For agents with declared frontmatter tiers: deviating fields explained by
//     an explicit call-time upgrade (call param present, matches actual, and
//     higher rank than declared) are recorded in `escalations` instead of
//     `mismatches`, with per-session counts flagging > 2 escalations/session
//     (rule 7). Unoverridden or non-upgrade deviations remain in `mismatches`.
//   * Built-in agents without frontmatter count in `noDeclaredTier`. When
//     called without `model`, `Explore` (haiku), `Plan` (opus), and
//     `general-purpose` (sonnet for edits, haiku otherwise) are checked against
//     those rules and deviations are recorded in `mismatches`.
//
// Trigger source: the most recent `Skill` tool_use, or a user record written by
// the harness for a slash command, before the Agent call. A command record
// counts only when its message content is a plain string that starts with
// `<command-message>` or `<command-name>` (the harness's own invocation format)
// and is not marked isMeta; `<command-name>` text embedded later in an ordinary
// prompt or in tool results is ignored. A meta without a toolUseId, or whose
// parent call is not found, has trigger `unknown`. For `general-purpose`,
// triggers from built-in Claude Code slash commands (such as `/simplify`) are
// separated into `generalPurpose.builtinCommand`, while all other triggers stay
// in `generalPurpose.roleCandidates`.
//
// Names taken from logs (agentType, model, effort, skill, command) must match
// ^[A-Za-z0-9:_./@-]{1,80}$; anything else is reported as `other`.
//
// The report never prints prompt text, descriptions, or file contents: only
// agent types, model ids, efforts, skill/command names, counts and tokens.
//
// Cost estimate (#1331): every turn is priced per token class at the declared
// per-model rate: input, output, cache read, 5-minute cache write and 1-hour
// cache write. Cache writes are split by usage.cache_creation
// (ephemeral_1h_input_tokens / ephemeral_5m_input_tokens); a write without
// that breakdown, or the part the breakdown does not cover, is priced as a
// 5-minute write (the default TTL). The Haiku long-prompt rate applies when a
// turn's prompt (input + cache read + cache write) exceeds the threshold.
// Not modelled: the inference_geo 1.1x multiplier, fast mode, and batch pricing.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { sha256Hex } = require('./lib/content-fingerprint');

// Single declared price table, USD per million tokens, one rate per token
// class. Cache read is not a fixed multiple of input: 0.025x on Fable 5.1/5.2,
// 0.05x on Opus 5.5 and Sonnet 5.5, 0.1x on Haiku 5.5. Cache writes are 1.25x
// (5-minute TTL) and 2x (1-hour TTL) of input. Models not listed here are
// reported as "unknown", never as 0.
const PRICE_TABLE = Object.freeze({
  verifiedOn: '2026-11-12',
  currency: 'USD',
  unit: 'per-million-tokens',
  basis: 'input+output+cacheRead+cacheWrite5m+cacheWrite1h',
  source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  models: Object.freeze({
    'claude-fable-5-1': Object.freeze({ input: 10, output: 50, cacheRead: 0.25, cacheWrite5m: 12.5, cacheWrite1h: 20 }),
    'claude-fable-5-2': Object.freeze({ input: 8, output: 40, cacheRead: 0.2, cacheWrite5m: 10, cacheWrite1h: 16 }),
    'claude-opus-5-5': Object.freeze({ input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 }),
    'claude-sonnet-5-5': Object.freeze({ input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, cacheWrite1h: 4 }),
    'claude-haiku-5-5': Object.freeze({
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite5m: 0.125,
      cacheWrite1h: 0.2,
      // Prompts above the threshold (cache read and write included) bill at
      // the long-prompt rate.
      longPrompt: Object.freeze({
        threshold: 100000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite5m: 0.625, cacheWrite1h: 1,
      }),
    }),
  }),
});

const COST_CLASSES = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']);
const COST_KEYS = Object.freeze([...COST_CLASSES, 'total']);
const USAGE_FIELDS = Object.freeze([
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'cacheWrite5mTokens', 'cacheWrite1hTokens',
]);
const MISMATCH_TEXT_FIELDS = Object.freeze([
  'declaredModel', 'declaredEffort', 'actualModel', 'actualEffort', 'callModel', 'callEffort',
]);
const MODEL_RANK = Object.freeze({ haiku: 1, sonnet: 2, opus: 3, fable: 4 });
const EFFORT_RANK = Object.freeze({ low: 1, medium: 2, high: 3, xhigh: 4, max: 5 });
const ESCALATION_CAP_PER_SESSION = 2;
const ESCALATION_FIELDS = Object.freeze(['model', 'effort']);
const BUILTIN_COMMANDS = new Set([
  'add-dir', 'batch', 'bug', 'clear', 'compact', 'config', 'context', 'cost',
  'doctor', 'effort', 'exit', 'export', 'fast', 'help', 'hooks', 'ide',
  'init', 'insights', 'login', 'logout', 'loop', 'mcp', 'memory', 'model',
  'permissions', 'plugin', 'pr-comments', 'release-notes', 'reload-plugins',
  'reload-skills', 'rename', 'resume', 'review', 'rewind', 'sandbox',
  'security-review', 'simplify', 'stats', 'status', 'tasks', 'terminal-setup',
  'theme', 'todos', 'upgrade', 'usage', 'vim',
]);

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ABSOLUTE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const SAFE_NAME = /^[A-Za-z0-9:_./@-]{1,80}$/;
const CHUNK_BYTES = 64 * 1024;

const SCHEMA_VERSION = 2;
const OVERSIZE_TURNS = 120;
const OVERSIZE_PROMPT_TOKENS = 200000;
const OVERSIZE_METRIC = 'peak per-message input + cache read + cache creation tokens (prompt proxy, not the context window)';
const USAGE_PROMPT_FIELDS = Object.freeze(['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']);
const OVERSIZE_REASONS = Object.freeze(['turns', 'context']);
const HOST_LABEL = /^[A-Za-z0-9._@:-]{1,64}$/;

class UsageError extends Error {}
class MergeError extends Error {}

function parseHost(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !HOST_LABEL.test(value)) {
    throw new UsageError('invalid --host value: use 1-64 characters from A-Z a-z 0-9 . _ @ : -');
  }
  return value;
}

// sha256 over the sorted declared tiers only; the agents directory path and
// file names never enter the digest or the output.
function declaredTiersDigest(tiers) {
  const rows = [...tiers.entries()]
    .map(([agent, tier]) => [agent, tier.model, tier.effort])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(JSON.stringify(rows));
}

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

function modelTierRank(model) {
  if (typeof model !== 'string' || !model) return null;
  for (const token of model.toLowerCase().split(/[-:._@/]/)) {
    if (hasOwn(MODEL_RANK, token)) return MODEL_RANK[token];
  }
  return null;
}

function effortRank(effort) {
  if (typeof effort !== 'string' || !effort) return null;
  const key = effort.toLowerCase();
  return hasOwn(EFFORT_RANK, key) ? EFFORT_RANK[key] : null;
}

function builtinExpectedModel(agentType, bucket) {
  if (agentType === 'Explore') return 'haiku';
  if (agentType === 'Plan') return 'opus';
  if (agentType === 'general-purpose') return bucket === 'edits' ? 'sonnet' : 'haiku';
  return null;
}

function isBuiltinCommandTrigger(trigger) {
  if (typeof trigger !== 'string' || !trigger.startsWith('command:/')) return false;
  return BUILTIN_COMMANDS.has(trigger.slice('command:/'.length));
}

function emptyGpGroup() {
  return { total: 0, buckets: { edits: 0, commandsOnly: 0, readOnly: 0 }, byModel: {}, byTrigger: {} };
}

function classifyDispatchDeviation({
  session, agentType, agentId, declared, model, effort, callModel, callEffort, bucket,
}) {
  if (!declared) {
    if (callModel) return { noDeclared: true, mismatch: null, escalation: null };
    const expectedModel = builtinExpectedModel(agentType, bucket);
    if (!expectedModel || modelMatches(expectedModel, model)) {
      return { noDeclared: true, mismatch: null, escalation: null };
    }
    return {
      noDeclared: true,
      mismatch: {
        agentType,
        agentId,
        fields: ['model'],
        declaredModel: expectedModel,
        declaredEffort: null,
        actualModel: model,
        actualEffort: effort,
        callModel: null,
        callEffort,
      },
      escalation: null,
    };
  }

  const modelDiff = Boolean(declared.model && !modelMatches(declared.model, model));
  const effortDiff = Boolean(declared.effort && effort && declared.effort !== effort);
  if (!modelDiff && !effortDiff) return { noDeclared: false, mismatch: null, escalation: null };

  const callModelRank = modelTierRank(callModel);
  const declaredModelRank = modelTierRank(declared.model);
  const modelUpgrade = Boolean(
    modelDiff && callModel && modelMatches(callModel, model)
    && callModelRank !== null && declaredModelRank !== null && callModelRank > declaredModelRank,
  );

  const callEffortRank = effortRank(callEffort);
  const declaredEffortRank = effortRank(declared.effort);
  const effortUpgrade = Boolean(
    effortDiff && callEffort && callEffort === effort
    && callEffortRank !== null && declaredEffortRank !== null && callEffortRank > declaredEffortRank,
  );

  const mismatchFields = [];
  if (modelDiff && !modelUpgrade) mismatchFields.push('model');
  if (effortDiff && !effortUpgrade) mismatchFields.push('effort');

  const escalationFields = [];
  if (modelUpgrade) escalationFields.push('model');
  if (effortUpgrade) escalationFields.push('effort');

  const base = {
    agentType,
    agentId,
    declaredModel: declared.model,
    declaredEffort: declared.effort,
    actualModel: model,
    actualEffort: effort,
    callModel,
    callEffort,
  };
  return {
    noDeclared: false,
    mismatch: mismatchFields.length > 0 ? { ...base, fields: mismatchFields } : null,
    escalation: escalationFields.length > 0 ? { session, ...base, fields: escalationFields } : null,
  };
}

function summarizeEscalations(dispatches, capPerSession, byHost = false) {
  const counts = new Map();
  for (const entry of dispatches) {
    const key = byHost ? JSON.stringify([entry.host, entry.session]) : entry.session;
    if (!counts.has(key)) {
      counts.set(key, byHost
        ? { host: entry.host, session: entry.session, count: 0 }
        : { session: entry.session, count: 0 });
    }
    counts.get(key).count += 1;
  }
  const bySession = [...counts.values()]
    .map((row) => ({ ...row, overCap: row.count > capPerSession }))
    .sort((a, b) => b.count - a.count
      || a.session.localeCompare(b.session)
      || (byHost ? a.host.localeCompare(b.host) : 0));
  return {
    capPerSession,
    dispatches,
    bySession,
    overCapSessions: bySession.filter((row) => row.overCap),
  };
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

// Returns the cost per token class plus the total, or null for an unpriced model.
function priceUsage(model, turns) {
  const price = PRICE_TABLE.models[model];
  if (!price) return null;
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, total: 0 };
  for (const turn of turns) {
    const rate = price.longPrompt
      && turn.promptTokens > price.longPrompt.threshold ? price.longPrompt : price;
    for (const cls of COST_CLASSES) cost[cls] += (turn[cls] * rate[cls]) / 1e6;
  }
  for (const cls of COST_CLASSES) cost.total += cost[cls];
  return cost;
}

function roundCost(cost) {
  const out = {};
  for (const [key, value] of Object.entries(cost)) out[key] = Number(value.toFixed(6));
  return out;
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
    const hasUsage = USAGE_PROMPT_FIELDS.every((field) => isFiniteNumber(usage[field]));
    const input = Number(usage.input_tokens) || 0;
    const cacheRead = Number(usage.cache_read_input_tokens) || 0;
    const cacheCreate = Number(usage.cache_creation_input_tokens) || 0;
    const ttl = isRecord(usage.cache_creation) ? usage.cache_creation : {};
    const cacheWrite1h = Math.min(Math.max(Number(ttl.ephemeral_1h_input_tokens) || 0, 0), cacheCreate);
    const key = typeof record.message.id === 'string' ? record.message.id : `#${sequence}`;
    sequence += 1;
    byMessage.set(key, {
      model: typeof record.message.model === 'string' ? record.message.model : null,
      effort: typeof record.effort === 'string' && record.effort ? record.effort : null,
      input,
      output: Number(usage.output_tokens) || 0,
      cacheRead,
      cacheCreate,
      cacheWrite5m: cacheCreate - cacheWrite1h,
      cacheWrite1h,
      promptTokens: input + cacheRead + cacheCreate,
      hasUsage,
    });
  });
  const turns = [...byMessage.values()];
  const model = (turns.find((t) => t.model !== null) || {}).model || null;
  const effort = (turns.find((t) => t.effort !== null) || {}).effort || null;
  const usageMissingTurns = turns.filter((t) => !t.hasUsage).length;
  return { error, firstTs, tools, turns, model, effort, usageMissingTurns };
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
  const host = parseHost(options.host);
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
  const escalationDispatches = [];
  const oversized = [];
  const callOverrides = { total: 0, withModel: 0, withEffort: 0 };
  const gp = {
    ...emptyGpGroup(),
    haikuEdits: 0,
    builtinCommand: emptyGpGroup(),
    roleCandidates: emptyGpGroup(),
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
          const measured = summary.turns.filter((turn) => turn.hasUsage);
          const peakPromptTokens = measured.length === 0
            ? null
            : measured.reduce((max, turn) => Math.max(max, turn.promptTokens), 0);
          const { usageMissingTurns } = summary;
          const complete = usageMissingTurns === 0;
          const reasons = [];
          if (summary.turns.length > OVERSIZE_TURNS) reasons.push('turns');
          if (peakPromptTokens !== null && peakPromptTokens > OVERSIZE_PROMPT_TOKENS) reasons.push('context');
          if (reasons.length > 0 || !complete) {
            oversized.push({
              agentType, agentId, model, effort, turns: summary.turns.length, peakPromptTokens, reasons, complete, usageMissingTurns,
            });
          }
          const key = `${agentType}\u0000${model}\u0000${effort}`;
          if (!groups.has(key)) {
            groups.set(key, {
              agentType,
              model,
              effort,
              count: 0,
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                cacheWrite5mTokens: 0,
                cacheWrite1hTokens: 0,
              },
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
            group.usage.cacheWrite5mTokens += turn.cacheWrite5m;
            group.usage.cacheWrite1hTokens += turn.cacheWrite1h;
            group.turns.push(turn);
          }

          const gpBucket = agentType === 'general-purpose' ? bucketOf(summary.tools) : null;
          const declared = declaredFor(tiers, agentType);
          const deviation = classifyDispatchDeviation({
            session: safeName(session),
            agentType,
            agentId,
            declared,
            model,
            effort,
            callModel,
            callEffort,
            bucket: gpBucket,
          });
          if (deviation.noDeclared) noDeclaredTier += 1;
          if (deviation.mismatch) mismatches.push(deviation.mismatch);
          if (deviation.escalation) escalationDispatches.push(deviation.escalation);

          if (agentType === 'general-purpose') {
            const trigger = call ? call.trigger : 'unknown';
            const sub = isBuiltinCommandTrigger(trigger) ? gp.builtinCommand : gp.roleCandidates;
            for (const target of [gp, sub]) {
              target.total += 1;
              target.buckets[gpBucket] += 1;
              target.byModel[model] = (target.byModel[model] || 0) + 1;
              target.byTrigger[trigger] = (target.byTrigger[trigger] || 0) + 1;
            }
            if (gpBucket === 'edits' && /haiku/i.test(model)) gp.haikuEdits += 1;
          }
        }
      }
    }
  }
  skipped.total = skipped.missingRoot + skipped.corruptJson + skipped.missingTranscript
    + skipped.noAssistantTurn + skipped.missingParent + skipped.unreadable + skipped.undated;

  const costSums = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, total: 0 };
  let unpricedGroups = 0;
  const byAgent = [...groups.values()]
    .map(({ turns, ...group }) => {
      const cost = priceUsage(group.model, turns);
      if (cost === null) {
        unpricedGroups += 1;
        return { ...group, estimatedCost: 'unknown', estimatedCostBreakdown: 'unknown' };
      }
      for (const key of Object.keys(costSums)) costSums[key] += cost[key];
      const rounded = roundCost(cost);
      return { ...group, estimatedCost: rounded.total, estimatedCostBreakdown: rounded };
    })
    .sort((a, b) => b.count - a.count
      || a.agentType.localeCompare(b.agentType)
      || a.model.localeCompare(b.model)
      || String(a.effort).localeCompare(String(b.effort)));
  mismatches.sort((a, b) => a.agentType.localeCompare(b.agentType) || a.agentId.localeCompare(b.agentId));
  escalationDispatches.sort((a, b) => a.session.localeCompare(b.session)
    || a.agentType.localeCompare(b.agentType)
    || a.agentId.localeCompare(b.agentId));
  oversized.sort((a, b) => peakOrder(b) - peakOrder(a)
    || a.agentType.localeCompare(b.agentType)
    || a.agentId.localeCompare(b.agentId));

  return {
    schemaVersion: SCHEMA_VERSION,
    host,
    declaredTiersDigest: declaredTiersDigest(tiers),
    window: {
      since: options.since || null,
      until: options.until || null,
      timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    pricing: { ...PRICE_TABLE, models: PRICE_TABLE.models },
    byAgent,
    costTotals: { ...roundCost(costSums), unpricedGroups },
    callOverrides,
    mismatches,
    escalations: summarizeEscalations(escalationDispatches, ESCALATION_CAP_PER_SESSION, false),
    noDeclaredTier,
    generalPurpose: gp,
    oversized: {
      thresholds: { turns: OVERSIZE_TURNS, promptTokens: OVERSIZE_PROMPT_TOKENS },
      metric: OVERSIZE_METRIC,
      dispatches: oversized,
    },
    skipped,
  };
}

// Sort key for oversized entries: an unmeasured peak (null) sorts last.
function peakOrder(entry) {
  return entry.peakPromptTokens === null ? -1 : entry.peakPromptTokens;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// Key order never changes the comparison: window and pricing are compared as
// their canonical JSON.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Adds every numeric leaf of `source` into `target`, recursing into nested
// maps (generalPurpose.byModel, ...). Anything but a finite number is rejected,
// so a malformed input fails the merge instead of becoming NaN or 0. Messages
// carry only `label`, never an input key name.
function addCounters(target, source, label) {
  if (!isRecord(source)) throw new MergeError(`${label} must be an object`);
  for (const key of Object.keys(source)) {
    if (key === '__proto__') throw new MergeError(`${label} has an invalid key`);
    const value = source[key];
    if (isRecord(value)) {
      if (!hasOwn(target, key)) target[key] = {};
      if (!isRecord(target[key])) throw new MergeError(`${label} mixes numbers and objects`);
      addCounters(target[key], value, label);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      if (hasOwn(target, key) && typeof target[key] !== 'number') throw new MergeError(`${label} mixes numbers and objects`);
      target[key] = (hasOwn(target, key) ? target[key] : 0) + value;
    } else {
      throw new MergeError(`${label} has an invalid value`);
    }
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function zeros(keys) {
  const out = {};
  for (const key of keys) out[key] = 0;
  return out;
}

// Reads exactly `keys` from `source` (each must be an own finite number) and
// adds them into `target`; any other key in `source` is ignored.
function addKnown(target, source, keys, label) {
  if (!isRecord(source)) throw new MergeError(`${label} must be an object`);
  for (const key of keys) {
    if (!hasOwn(source, key) || !isFiniteNumber(source[key])) throw new MergeError(`${label} is missing a numeric field`);
  }
  for (const key of keys) target[key] += source[key];
}

function requireSection(input, key, label) {
  if (!isRecord(input[key])) throw new MergeError(`${label}: "${key}" must be an object`);
  return input[key];
}

function isUnknownCost(group) {
  const bare = (value) => value === 'unknown' || value === null;
  return bare(group.estimatedCost) || bare(group.estimatedCostBreakdown);
}

function copyMismatchTextFields(entry) {
  const out = {};
  for (const f of MISMATCH_TEXT_FIELDS) out[f] = hasOwn(entry, f) ? entry[f] : null;
  return out;
}

// Combines per-host `--json` reports (see the header). Throws MergeError for an
// input that cannot be merged; cost is summed, never recomputed.
function mergeReports(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new MergeError('no reports to merge');
  const hosts = new Set();
  inputs.forEach((input, index) => {
    const label = `--merge input #${index + 1}`;
    if (!isRecord(input)) throw new MergeError(`${label}: not a JSON object`);
    if (input.schemaVersion !== SCHEMA_VERSION) {
      throw new MergeError(`${label}: missing or unsupported schemaVersion (expected ${SCHEMA_VERSION})`);
    }
    if (typeof input.host !== 'string' || !HOST_LABEL.test(input.host)) {
      throw new MergeError(`${label}: missing or invalid host (run the report with --host LABEL)`);
    }
    if (hosts.has(input.host)) throw new MergeError(`${label}: host "${input.host}" appears more than once`);
    hosts.add(input.host);
    for (const key of ['window', 'pricing', 'costTotals', 'callOverrides', 'skipped', 'generalPurpose']) requireSection(input, key, label);
    for (const subKey of ['builtinCommand', 'roleCandidates']) {
      const sub = requireSection(input.generalPurpose, subKey, `${label}: generalPurpose`);
      if (!isFiniteNumber(sub.total)) throw new MergeError(`${label}: generalPurpose.${subKey} must carry numeric total`);
      for (const nested of ['buckets', 'byModel', 'byTrigger']) {
        requireSection(sub, nested, `${label}: generalPurpose.${subKey}`);
      }
    }
    for (const field of ['since', 'until', 'timezone']) {
      if (!hasOwn(input.window, field) || (input.window[field] !== null && typeof input.window[field] !== 'string')) {
        throw new MergeError(`${label}: window must carry since, until and timezone as string or null`);
      }
    }
    requireSection(input, 'escalations', label);
    const esc = input.escalations;
    if (!Number.isInteger(esc.capPerSession) || esc.capPerSession < 1
      || !Array.isArray(esc.dispatches) || !Array.isArray(esc.bySession) || !Array.isArray(esc.overCapSessions)) {
      throw new MergeError(`${label}: escalations must carry integer capPerSession and dispatches, bySession, overCapSessions arrays`);
    }
    requireSection(input, 'oversized', label);
    const { thresholds } = input.oversized;
    if (!isRecord(thresholds) || !isFiniteNumber(thresholds.turns) || !isFiniteNumber(thresholds.promptTokens)
      || typeof input.oversized.metric !== 'string' || !Array.isArray(input.oversized.dispatches)) {
      throw new MergeError(`${label}: oversized must carry numeric thresholds, a metric string and a dispatches array`);
    }
    if (!Array.isArray(input.byAgent) || !Array.isArray(input.mismatches)) {
      throw new MergeError(`${label}: byAgent and mismatches must be arrays`);
    }
    if (typeof input.noDeclaredTier !== 'number' || !Number.isFinite(input.noDeclaredTier)) {
      throw new MergeError(`${label}: noDeclaredTier must be a number`);
    }
  });

  const first = inputs[0];
  for (const field of ['since', 'until', 'timezone']) {
    const expected = stableStringify(first.window[field]);
    if (inputs.some((input) => stableStringify(input.window[field]) !== expected)) {
      throw new MergeError(`window.${field} differs across inputs`);
    }
  }
  const pricing = stableStringify(first.pricing);
  if (inputs.some((input) => stableStringify(input.pricing) !== pricing)) {
    throw new MergeError('pricing differs across inputs');
  }

  if (inputs.some((input) => input.escalations.capPerSession !== first.escalations.capPerSession)) {
    throw new MergeError('escalations capPerSession differs across inputs');
  }

  for (const field of ['turns', 'promptTokens']) {
    if (inputs.some((input) => input.oversized.thresholds[field] !== first.oversized.thresholds[field])) {
      throw new MergeError('oversized thresholds differ across inputs');
    }
  }

  if (inputs.some((input) => input.oversized.metric !== first.oversized.metric)) {
    throw new MergeError('oversized metric differs across inputs');
  }

  const groups = new Map();
  const costTotals = zeros(COST_KEYS);
  const callOverrides = { total: 0, withModel: 0, withEffort: 0 };
  const skipped = {
    missingRoot: 0, corruptJson: 0, missingTranscript: 0, noAssistantTurn: 0, missingParent: 0, unreadable: 0, undated: 0, total: 0,
  };
  const generalPurpose = {
    ...emptyGpGroup(),
    haikuEdits: 0,
    builtinCommand: emptyGpGroup(),
    roleCandidates: emptyGpGroup(),
  };
  const mismatches = [];
  const escalationDispatches = [];
  const oversized = [];
  let noDeclaredTier = 0;
  const sources = [];

  inputs.forEach((input, index) => {
    const label = `--merge input #${index + 1}`;
    addKnown(costTotals, input.costTotals, COST_KEYS, `${label} costTotals`);
    addCounters(callOverrides, input.callOverrides, `${label} callOverrides`);
    addCounters(skipped, input.skipped, `${label} skipped`);
    addCounters(generalPurpose, input.generalPurpose, `${label} generalPurpose`);
    noDeclaredTier += input.noDeclaredTier;
    if (typeof input.skipped.total !== 'number') throw new MergeError(`${label}: skipped.total must be a number`);
    sources.push({
      host: input.host,
      declaredTiersDigest: typeof input.declaredTiersDigest === 'string' ? input.declaredTiersDigest : null,
      skippedTotal: input.skipped.total,
    });

    for (const group of input.byAgent) {
      if (!isRecord(group) || typeof group.agentType !== 'string' || typeof group.model !== 'string'
        || (group.effort !== null && typeof group.effort !== 'string')
        || typeof group.count !== 'number' || !Number.isFinite(group.count)) {
        throw new MergeError(`${label}: malformed byAgent entry`);
      }
      const key = JSON.stringify([group.agentType, group.model, group.effort]);
      if (!groups.has(key)) {
        groups.set(key, {
          agentType: group.agentType,
          model: group.model,
          effort: group.effort,
          count: 0,
          usage: zeros(USAGE_FIELDS),
          cost: 0,
          breakdown: zeros(COST_KEYS),
          unknown: false,
        });
      }
      const merged = groups.get(key);
      merged.count += group.count;
      addKnown(merged.usage, group.usage, USAGE_FIELDS, `${label} byAgent usage`);
      if (isUnknownCost(group)) {
        merged.unknown = true;
      } else {
        if (typeof group.estimatedCost !== 'number' || !Number.isFinite(group.estimatedCost)) {
          throw new MergeError(`${label}: malformed byAgent estimatedCost`);
        }
        merged.cost += group.estimatedCost;
        addKnown(merged.breakdown, group.estimatedCostBreakdown, COST_KEYS, `${label} byAgent estimatedCostBreakdown`);
      }
    }

    for (const mismatch of input.mismatches) {
      if (!isRecord(mismatch) || typeof mismatch.agentType !== 'string' || typeof mismatch.agentId !== 'string'
        || !Array.isArray(mismatch.fields) || mismatch.fields.some((f) => typeof f !== 'string')
        || MISMATCH_TEXT_FIELDS.some((f) => hasOwn(mismatch, f) && mismatch[f] !== null && typeof mismatch[f] !== 'string')) {
        throw new MergeError(`${label}: malformed mismatch entry`);
      }
      mismatches.push({
        agentType: mismatch.agentType,
        agentId: mismatch.agentId,
        fields: [...mismatch.fields],
        ...copyMismatchTextFields(mismatch),
        host: input.host,
      });
    }

    const sessionCounts = new Map();
    for (const entry of input.escalations.dispatches) {
      if (!isRecord(entry) || typeof entry.session !== 'string'
        || typeof entry.agentType !== 'string' || typeof entry.agentId !== 'string'
        || !Array.isArray(entry.fields) || entry.fields.length === 0
        || entry.fields.some((f) => !ESCALATION_FIELDS.includes(f))
        || MISMATCH_TEXT_FIELDS.some((f) => hasOwn(entry, f) && entry[f] !== null && typeof entry[f] !== 'string')) {
        throw new MergeError(`${label}: malformed escalation entry`);
      }
      sessionCounts.set(entry.session, (sessionCounts.get(entry.session) || 0) + 1);
      escalationDispatches.push({
        session: entry.session,
        agentType: entry.agentType,
        agentId: entry.agentId,
        fields: [...entry.fields],
        ...copyMismatchTextFields(entry),
        host: input.host,
      });
    }
    const seenSessions = new Set();
    const expectedOverCap = new Map();
    for (const row of input.escalations.bySession) {
      if (!isRecord(row) || typeof row.session !== 'string'
        || seenSessions.has(row.session)
        || !Number.isInteger(row.count) || row.count < 1
        || row.count !== sessionCounts.get(row.session)
        || typeof row.overCap !== 'boolean'
        || row.overCap !== (row.count > input.escalations.capPerSession)) {
        throw new MergeError(`${label}: malformed escalation bySession entry`);
      }
      seenSessions.add(row.session);
      if (row.overCap) expectedOverCap.set(row.session, row.count);
    }
    if (seenSessions.size !== sessionCounts.size) {
      throw new MergeError(`${label}: escalation bySession does not match dispatches`);
    }
    const seenOverCap = new Set();
    for (const row of input.escalations.overCapSessions) {
      if (!isRecord(row) || typeof row.session !== 'string'
        || seenOverCap.has(row.session)
        || !Number.isInteger(row.count) || row.count < 1
        || row.overCap !== true
        || row.count <= input.escalations.capPerSession
        || row.count !== expectedOverCap.get(row.session)) {
        throw new MergeError(`${label}: malformed escalation overCapSessions entry`);
      }
      seenOverCap.add(row.session);
    }
    if (seenOverCap.size !== expectedOverCap.size) {
      throw new MergeError(`${label}: escalation overCapSessions does not match bySession`);
    }

    for (const entry of input.oversized.dispatches) {
      if (!isRecord(entry) || typeof entry.agentType !== 'string' || typeof entry.agentId !== 'string'
        || typeof entry.model !== 'string' || (entry.effort !== null && typeof entry.effort !== 'string')
        || !isFiniteNumber(entry.turns) || entry.turns < 0
        || (entry.peakPromptTokens === null ? entry.complete !== false
          : !isFiniteNumber(entry.peakPromptTokens) || entry.peakPromptTokens < 0)
        || typeof entry.complete !== 'boolean'
        || !Number.isInteger(entry.usageMissingTurns) || entry.usageMissingTurns < 0
        || entry.complete !== (entry.usageMissingTurns === 0)
        || !Array.isArray(entry.reasons) || entry.reasons.some((r) => !OVERSIZE_REASONS.includes(r))) {
        throw new MergeError(`${label}: malformed oversized entry`);
      }
      oversized.push({
        agentType: entry.agentType,
        agentId: entry.agentId,
        model: entry.model,
        effort: entry.effort,
        turns: entry.turns,
        peakPromptTokens: entry.peakPromptTokens,
        reasons: [...entry.reasons],
        complete: entry.complete,
        usageMissingTurns: entry.usageMissingTurns,
        host: input.host,
      });
    }
  });

  let unpriced = 0;
  const byAgent = [...groups.values()]
    .map((g) => {
      const base = { agentType: g.agentType, model: g.model, effort: g.effort, count: g.count, usage: g.usage };
      if (g.unknown) {
        unpriced += 1;
        return { ...base, estimatedCost: 'unknown', estimatedCostBreakdown: 'unknown' };
      }
      return { ...base, estimatedCost: Number(g.cost.toFixed(6)), estimatedCostBreakdown: roundCost(g.breakdown) };
    })
    .sort((a, b) => b.count - a.count
      || a.agentType.localeCompare(b.agentType)
      || a.model.localeCompare(b.model)
      || String(a.effort).localeCompare(String(b.effort)));
  mismatches.sort((a, b) => String(a.agentType).localeCompare(String(b.agentType))
    || String(a.agentId).localeCompare(String(b.agentId))
    || a.host.localeCompare(b.host));
  escalationDispatches.sort((a, b) => a.session.localeCompare(b.session)
    || a.agentType.localeCompare(b.agentType)
    || a.agentId.localeCompare(b.agentId)
    || a.host.localeCompare(b.host));
  oversized.sort((a, b) => peakOrder(b) - peakOrder(a)
    || a.agentType.localeCompare(b.agentType)
    || a.agentId.localeCompare(b.agentId)
    || a.host.localeCompare(b.host));

  const digests = new Set(sources.map((s) => s.declaredTiersDigest));
  return {
    schemaVersion: SCHEMA_VERSION,
    sources,
    declaredTiers: digests.size > 1 ? 'mixed' : 'consistent',
    window: { since: first.window.since, until: first.window.until, timezone: first.window.timezone },
    pricing: first.pricing,
    byAgent,
    costTotals: { ...roundCost(costTotals), unpricedGroups: unpriced },
    callOverrides,
    mismatches,
    escalations: summarizeEscalations(escalationDispatches, first.escalations.capPerSession, true),
    noDeclaredTier,
    generalPurpose,
    oversized: { thresholds: { ...first.oversized.thresholds }, metric: first.oversized.metric, dispatches: oversized },
    skipped,
  };
}

function readMergeInput(file, index) {
  const label = `--merge input #${index + 1}`;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new MergeError(`${label}: cannot be read (${(error && error.code) || 'error'})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MergeError(`${label}: not valid JSON`);
  }
}

function buildMergedReport(files) {
  return mergeReports(files.map(readMergeInput));
}

function formatCost(cost) {
  if (cost === 'unknown') return 'unknown';
  const usd = (value) => `$${value.toFixed(4)}`;
  return `${usd(cost.total)} (input ${usd(cost.input)}, output ${usd(cost.output)}, cache read ${usd(cost.cacheRead)}, cache write 5m ${usd(cost.cacheWrite5m)}, 1h ${usd(cost.cacheWrite1h)})`;
}

function formatCountMap(map) {
  return Object.entries(map).map(([k, v]) => `${k} x${v}`).join(', ') || '-';
}

function formatDeviationLine(entry, prefix = '') {
  const host = entry.host ? `${entry.host} ` : '';
  const call = entry.callModel || entry.callEffort ? ` call=${entry.callModel || '-'}@${entry.callEffort || '-'}` : '';
  return `  ${host}${prefix}${entry.agentType} ${entry.agentId}: declared ${entry.declaredModel || '-'}@${entry.declaredEffort || '-'} actual ${entry.actualModel}@${entry.actualEffort || 'default'} [${entry.fields.join(',')}]${call}`;
}

function formatGpSubGroup(lines, label, sub) {
  lines.push(`  ${label}: ${sub.total} dispatches; edits ${sub.buckets.edits}, commands-only ${sub.buckets.commandsOnly}, read-only ${sub.buckets.readOnly}`);
  lines.push(`    models: ${formatCountMap(sub.byModel)}`);
  lines.push(`    triggers: ${formatCountMap(sub.byTrigger)}`);
}

function formatText(report) {
  const lines = [];
  const w = report.window;
  lines.push(`dispatch telemetry (since ${w.since || '-'} until ${w.until || '-'}, tz ${w.timezone})`);
  if (Array.isArray(report.sources)) {
    lines.push(`sources: ${report.sources.map((src) => `${src.host} (skipped ${src.skippedTotal})`).join(', ')}; declared tiers ${report.declaredTiers}`);
  }
  lines.push('');
  lines.push('agentType x model@effort: count, tokens (in/out/cache read/cache write), estimated cost');
  if (report.byAgent.length === 0) lines.push('  (no dispatches)');
  for (const e of report.byAgent) {
    const u = e.usage;
    lines.push(`  ${e.agentType}  ${e.model}@${e.effort || 'default'}  x${e.count}  ${u.inputTokens}/${u.outputTokens}/${u.cacheReadTokens}/${u.cacheCreationTokens}  ${formatCost(e.estimatedCostBreakdown)}`);
  }
  const t = report.costTotals;
  lines.push(`  estimated cost total ${formatCost(t)}; ${t.unpricedGroups} unpriced group${t.unpricedGroups === 1 ? '' : 's'}`);
  lines.push(`  price table verified ${report.pricing.verifiedOn} (${report.pricing.basis}); unlisted models are "unknown"`);
  lines.push('');
  const o = report.callOverrides;
  lines.push(`Agent calls: ${o.total} total, ${o.withModel} with model, ${o.withEffort} with effort`);
  lines.push('');
  lines.push(`mismatches vs role defaults & built-in rules: ${report.mismatches.length} (${report.noDeclaredTier} dispatches have no declared tier)`);
  for (const m of report.mismatches) lines.push(formatDeviationLine(m));
  lines.push('');
  const esc = report.escalations;
  lines.push(`escalations (explicit call upgrades; cap ${esc.capPerSession}/session): ${esc.dispatches.length} dispatch${esc.dispatches.length === 1 ? '' : 'es'}, ${esc.bySession.length} session${esc.bySession.length === 1 ? '' : 's'}, ${esc.overCapSessions.length} over cap (>${esc.capPerSession})`);
  for (const s of esc.bySession) {
    lines.push(`  session ${s.host ? `${s.host} ` : ''}${s.session}: ${s.count} escalation${s.count === 1 ? '' : 's'}${s.overCap ? ` [OVER CAP >${esc.capPerSession}]` : ''}`);
  }
  for (const e of esc.dispatches) lines.push(formatDeviationLine(e, `${e.session} `));
  lines.push('');
  const g = report.generalPurpose;
  lines.push(`general-purpose: ${g.total} dispatches; edits ${g.buckets.edits}, commands-only ${g.buckets.commandsOnly}, read-only ${g.buckets.readOnly}; haiku edits ${g.haikuEdits}`);
  lines.push(`  models: ${formatCountMap(g.byModel)}`);
  lines.push(`  triggers: ${formatCountMap(g.byTrigger)}`);
  formatGpSubGroup(lines, 'built-in command triggers', g.builtinCommand);
  formatGpSubGroup(lines, 'role-candidate triggers', g.roleCandidates);
  lines.push('');
  const ov = report.oversized;
  lines.push(`oversized dispatches (>${ov.thresholds.turns} turns or >${Math.round(ov.thresholds.promptTokens / 1000)}k prompt tokens; prompt proxy): ${ov.dispatches.length}`);
  for (const d of ov.dispatches) {
    lines.push(`  ${d.host ? `${d.host} ` : ''}${d.agentType} ${d.agentId}: turns ${d.turns}, peak ${d.peakPromptTokens === null ? 'UNKNOWN' : `${Math.round(d.peakPromptTokens / 1000)}k`} [${d.reasons.join(',') || '-'}]${d.complete ? '' : ` UNKNOWN: ${d.usageMissingTurns} turn(s) without usage`}`);
  }
  lines.push('');
  const s = report.skipped;
  lines.push(`skipped: ${s.total} (missing root ${s.missingRoot}, corrupt JSON ${s.corruptJson}, missing transcript ${s.missingTranscript}, no assistant turn ${s.noAssistantTurn}, missing parent ${s.missingParent}, unreadable ${s.unreadable}, undated ${s.undated})`);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = {};
  const valued = { '--root': 'root', '--since': 'since', '--until': 'until', '--project': 'project', '--agents-dir': 'agentsDir', '--host': 'host' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--merge') {
      if (i + 1 >= argv.length) throw new UsageError('--merge requires a value');
      options.merge = [...(options.merge || []), argv[i + 1]];
      i += 1;
    } else if (Object.prototype.hasOwnProperty.call(valued, arg)) {
      if (i + 1 >= argv.length) throw new UsageError(`${arg} requires a value`);
      options[valued[arg]] = argv[i + 1];
      i += 1;
    } else {
      throw new UsageError(`unknown argument "${arg}"`);
    }
  }
  if (options.merge) {
    const clash = ['root', 'since', 'until', 'project', 'agentsDir'].find((key) => options[key] !== undefined);
    if (clash) {
      const flag = Object.keys(valued).find((name) => valued[name] === clash);
      throw new UsageError(`--merge cannot be combined with ${flag}`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let options;
  let report;
  let output;
  try {
    options = parseArgs(argv);
    report = options.merge ? buildMergedReport(options.merge) : buildReport(options);
    output = options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report);
  } catch (error) {
    const message = String((error && error.message) || 'unexpected error').split('\n')[0];
    stderr.write(`dispatch-telemetry-report: ${message}\n`);
    return error instanceof UsageError ? 64 : 1;
  }
  stdout.write(output);
  return 0;
}

module.exports = Object.freeze({
  PRICE_TABLE, UsageError, MergeError, buildMergedReport, buildReport, formatText, main, mergeReports, modelMatches, parseArgs, parseBound,
});

if (require.main === module) process.exitCode = main();
