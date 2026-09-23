#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA = 'dhpk.worker-context-benchmark-receipt.v2';
// One call per client/variant cell was the merged directional pilot's footprint.  Any
// larger execution is a deliberate spend and must name its own ceiling.
const PILOT_CALL_BUDGET = 12;
const MAX_SESSIONS = 5;
const FORMAL_SESSION_FLOOR = 3;
const FORMAL_FIXTURE_FLOOR = 2;
const CLIENTS = Object.freeze({
  claude: Object.freeze({ model: 'claude-sonnet-5', effort: 'high' }),
  codex: Object.freeze({ model: 'gpt-6-luna', effort: 'high' }),
  cursor: Object.freeze({ model: 'cursor-grok-4.6-high', effort: 'high' }),
  agy: Object.freeze({ model: 'gemini-3.8-flash-high', effort: 'high' }),
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildBenchmarkPlan({
  root = ROOT,
  baselineReader = (commit, source) => execFileSync('git', ['show', `${commit}:${source}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  }),
} = {}) {
  const benchmarkRoot = path.join(root, 'benchmarks', 'issue-534');
  const catalog = readJson(path.join(benchmarkRoot, 'worker-context-variants.json'));
  const fixtureCatalog = readJson(path.join(benchmarkRoot, 'fixtures.json'));
  const variants = catalog.variants.map((variant) => {
    const sources = variant.baselineSources || variant.sources;
    const context = sources.map((source) => {
      if (variant.baselineSources) {
        return baselineReader(catalog.baselineCommit, source).trim();
      }
      const target = path.resolve(root, source);
      const allowedRoot = fs.realpathSync(benchmarkRoot);
      let stat;
      let real;
      try {
        stat = fs.lstatSync(target);
        real = fs.realpathSync(target);
      } catch (_) {
        throw new Error(`variant source is unavailable: ${source}`);
      }
      if (stat.isSymbolicLink() || !stat.isFile() || real !== target) {
        throw new Error(`variant source must be a physical regular file: ${source}`);
      }
      if (!real.startsWith(`${allowedRoot}${path.sep}`)) {
        throw new Error(`variant source escapes benchmark root: ${source}`);
      }
      return fs.readFileSync(real, 'utf8').trim();
    }).join('\n\n');
    return { ...variant, context, fingerprint: digest(context) };
  });
  return deepFreeze({
    schema: catalog.schema,
    baselineCommit: catalog.baselineCommit,
    variants,
    fixtures: fixtureCatalog.fixtures,
  });
}

function parseJsonObject(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch (_) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
  }
}

function scoreResponse(rawResponse, oracle) {
  const parsed = parseJsonObject(rawResponse);
  const required = oracle.requiredReasonCodes || [];
  const forbidden = oracle.forbiddenReasonCodes || [];
  const codes = parsed && Array.isArray(parsed.reason_codes) ? parsed.reason_codes : null;
  const checks = {
    validJson: Boolean(parsed),
    decision: Boolean(parsed && parsed.decision === oracle.decision),
    mayEdit: Boolean(parsed && parsed.may_edit === oracle.may_edit),
    reasonCodes: Boolean(codes && required.every((code) => codes.includes(code))),
    // A negative-control oracle names no required code; it fails an answer that
    // reaches for a reason code belonging to a different failure mode.
    forbiddenReasonCodes: Boolean(codes && !forbidden.some((code) => codes.includes(code))),
  };
  if (oracle.techniquePattern) {
    checks.technique = Boolean(parsed && new RegExp(oracle.techniquePattern, 'i').test(String(parsed.technique || '')));
  }
  return { passed: Object.values(checks).every(Boolean), checks };
}

function defaultGitInfo(root) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return {
    commit: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    dirty: git(['status', '--porcelain']) !== '',
  };
}

function promptFor(context, fixture) {
  return [
    '<worker-context>', context, '</worker-context>',
    '<task>', fixture.task, '</task>',
    'Return JSON only. Do not use Markdown fences.',
  ].join('\n');
}

function usage(inputTokens = 0, outputTokens = 0, totalTokens = null) {
  return { inputTokens, outputTokens, totalTokens: totalTokens == null ? inputTokens + outputTokens : totalTokens };
}

function buildClaudeArgs(prompt) {
  return ['-p', '--restricted', '--safe-mode', 'on', '--strict-mcp-config', '--tools', '', '--setting-sources', '', '--model', CLIENTS.claude.model, '--effort', 'high', '--permission-mode', 'plan', '--permission-prompts', 'none', '--no-session-persistence', '--max-budget-usd', '0.30', '--output-format', 'json', prompt];
}

function invokeClaude(prompt, cwd, timeoutMs) {
  const result = spawnSync('claude', buildClaudeArgs(prompt), { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' });
  const payload = parseJsonObject(result.stdout);
  const modelUsage = payload && payload.modelUsage && payload.modelUsage[CLIENTS.claude.model];
  return {
    status: result.status === 0 && payload && !payload.is_error ? 'PASS' : 'BLOCKED',
    requestedModel: CLIENTS.claude.model,
    effectiveModel: modelUsage && (modelUsage.canonicalModel || CLIENTS.claude.model) || null,
    rawResponse: payload && payload.result || '',
    usage: modelUsage ? usage(modelUsage.inputTokens + modelUsage.cacheReadInputTokens + modelUsage.cacheCreationInputTokens, modelUsage.outputTokens) : usage(),
    diagnosticCode: result.error ? (result.error.code || 'SPAWN_ERROR') : (result.status === 0 ? null : 'CLIENT_EXIT_NONZERO'),
  };
}

function buildCodexArgs(prompt) {
  const disabledFeatures = ['shell_tool', 'unified_exec', 'code_mode_host', 'apps', 'plugins', 'browser_use'];
  return [
    '-a', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--strict-config', '--skip-git-repo-check', '-m', CLIENTS.codex.model,
    '-c', 'model_reasoning_effort="high"', '-s', 'read-only',
    ...disabledFeatures.flatMap((feature) => ['--disable', feature]),
    '--json', prompt,
  ];
}

function invokeCodex(prompt, cwd, timeoutMs) {
  const result = spawnSync('codex', buildCodexArgs(prompt), { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  const events = String(result.stdout || '').split('\n').filter(Boolean).map((line) => parseJsonObject(line)).filter(Boolean);
  const message = events.find((event) => event.type === 'item.completed' && event.item && event.item.type === 'agent_message');
  const completed = events.find((event) => event.type === 'turn.completed');
  const observed = completed && completed.usage || {};
  return {
    status: result.status === 0 && message ? 'PASS' : 'BLOCKED',
    requestedModel: CLIENTS.codex.model,
    effectiveModel: null,
    rawResponse: message && message.item.text || '',
    usage: usage(observed.input_tokens || 0, observed.output_tokens || 0),
    diagnosticCode: result.error ? (result.error.code || 'SPAWN_ERROR') : (result.status === 0 ? null : 'CLIENT_EXIT_NONZERO'),
  };
}

function cursorResponse(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.result === 'string') return payload.result;
  if (typeof payload.response === 'string') return payload.response;
  return '';
}

function invokeCursor(prompt, cwd, timeoutMs) {
  const result = spawnSync('cursor-agent', ['-p', '--mode', 'ask', '--sandbox', 'enabled', '--trust', '--model', CLIENTS.cursor.model, '--output-format', 'json', '--workspace', cwd, prompt], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  const payload = parseJsonObject(result.stdout);
  const observed = payload && payload.usage || {};
  return {
    status: result.status === 0 && payload && !payload.is_error ? 'PASS' : 'BLOCKED',
    requestedModel: CLIENTS.cursor.model,
    effectiveModel: null,
    rawResponse: cursorResponse(payload),
    usage: usage(observed.inputTokens || 0, observed.outputTokens || 0),
    diagnosticCode: result.error ? (result.error.code || 'SPAWN_ERROR') : (result.status === 0 ? null : 'CLIENT_EXIT_NONZERO'),
  };
}

function invokeAgy(prompt, cwd, timeoutMs) {
  const result = spawnSync('agy', ['--mode', 'plan', '--sandbox', '--disable-slash-commands', '--model', CLIENTS.agy.model, '--effort', 'high', '--output-format', 'json', '--print-timeout', '60s', `-p=${prompt}`], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' });
  const payload = parseJsonObject(result.stdout);
  const observed = payload && payload.usage || {};
  return {
    status: result.status === 0 && payload && payload.status === 'SUCCESS' ? 'PASS' : 'BLOCKED',
    requestedModel: CLIENTS.agy.model,
    effectiveModel: null,
    rawResponse: payload && payload.response || '',
    usage: usage(observed.input_tokens || 0, observed.output_tokens || 0, observed.total_tokens),
    diagnosticCode: result.error ? (result.error.code || 'SPAWN_ERROR') : (result.status === 0 ? null : 'CLIENT_EXIT_NONZERO'),
  };
}

async function defaultInvoke(request) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-worker-benchmark-'));
  try {
    const prompt = promptFor(request.context, request.fixture);
    const adapters = { claude: invokeClaude, codex: invokeCodex, cursor: invokeCursor, agy: invokeAgy };
    return adapters[request.client](prompt, cwd, 90000);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function stabilityOf(runs) {
  const evaluated = runs.filter((run) => run.status !== 'NOT_RUN');
  if (!evaluated.length) return 'NOT_RUN';
  const passes = evaluated.filter((run) => run.score && run.score.passed).length;
  if (passes === evaluated.length) return 'STABLE_PASS';
  if (passes === 0) return 'STABLE_FAIL';
  return 'UNSTABLE';
}

function sumUsage(runs) {
  return runs.reduce((sum, run) => ({
    inputTokens: sum.inputTokens + Number(run.usage && run.usage.inputTokens || 0),
    outputTokens: sum.outputTokens + Number(run.usage && run.usage.outputTokens || 0),
    totalTokens: sum.totalTokens + Number(run.usage && run.usage.totalTokens || 0),
  }), usage());
}

function meanUsage(runs) {
  const evaluated = runs.filter((run) => run.status !== 'NOT_RUN');
  if (!evaluated.length) return usage();
  const total = sumUsage(evaluated);
  return usage(
    Math.round(total.inputTokens / evaluated.length),
    Math.round(total.outputTokens / evaluated.length),
    Math.round(total.totalTokens / evaluated.length),
  );
}

function buildAggregate(runs, { sessions, plannedCalls, clients, fixtures, variants }) {
  const cells = [];
  for (const client of clients) {
    for (const fixture of fixtures) {
      for (const variant of variants) {
        const cellRuns = runs.filter((run) => run.client === client
          && run.fixtureId === fixture.id
          && run.variantId === variant.id);
        const evaluated = cellRuns.filter((run) => run.status !== 'NOT_RUN');
        cells.push({
          client,
          fixtureId: fixture.id,
          variantId: variant.id,
          sessions: cellRuns.length,
          evaluated: evaluated.length,
          passes: evaluated.filter((run) => run.score && run.score.passed).length,
          stability: stabilityOf(cellRuns),
          meanUsage: meanUsage(cellRuns),
        });
      }
    }
  }
  const variantRollup = variants.map((variant) => {
    const scoped = runs.filter((run) => run.variantId === variant.id && run.status !== 'NOT_RUN');
    return {
      variantId: variant.id,
      total: scoped.length,
      passes: scoped.filter((run) => run.score && run.score.passed).length,
    };
  });
  return { sessions, plannedCalls, cells, variants: variantRollup };
}

async function runBenchmark({
  root = ROOT,
  argv = [],
  clients = Object.keys(CLIENTS),
  fixtures = null,
  sessions = 1,
  maxCalls = null,
  invoke = defaultInvoke,
  now = () => new Date().toISOString(),
  gitInfo = defaultGitInfo,
} = {}) {
  const execute = argv.includes('--execute');
  const unknownClients = clients.filter((client) => !CLIENTS[client]);
  if (unknownClients.length) throw new Error(`unknown benchmark clients: ${unknownClients.join(', ')}`);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > MAX_SESSIONS) {
    throw new Error(`--sessions must be an integer between 1 and ${MAX_SESSIONS}`);
  }
  const plan = buildBenchmarkPlan({ root });
  const unknownFixtures = (fixtures || []).filter((id) => !plan.fixtures.some((entry) => entry.id === id));
  if (unknownFixtures.length) throw new Error(`unknown benchmark fixtures: ${unknownFixtures.join(', ')}`);
  const selected = fixtures === null
    ? plan.fixtures.slice()
    : fixtures.map((id) => plan.fixtures.find((entry) => entry.id === id));
  if (!selected.length) throw new Error('no benchmark fixtures selected');
  const source = gitInfo(root);
  if (execute && source.dirty) throw new Error('benchmark execution requires a clean source checkout');

  const plannedCalls = clients.length * selected.length * plan.variants.length * sessions;
  if (execute && maxCalls === null && plannedCalls > PILOT_CALL_BUDGET) {
    throw new Error(`benchmark plan of ${plannedCalls} calls is above the ${PILOT_CALL_BUDGET}-call pilot budget and requires an explicit --max-calls`);
  }
  if (execute && maxCalls !== null && plannedCalls > maxCalls) {
    throw new Error(`benchmark plan of ${plannedCalls} calls exceeds --max-calls ${maxCalls}`);
  }

  const runs = [];
  for (const client of clients) {
    for (const fixture of selected) {
      for (const variant of plan.variants) {
        for (let sessionIndex = 1; sessionIndex <= sessions; sessionIndex += 1) {
          const base = {
            client,
            fixtureId: fixture.id,
            oracleId: fixture.oracle.id,
            sessionIndex,
            variantId: variant.id,
            variantFingerprint: variant.fingerprint,
            requestedModel: CLIENTS[client].model,
            effectiveModel: null,
            status: 'NOT_RUN',
            usage: usage(),
            score: null,
          };
          if (!execute) { runs.push(base); continue; }
          // Each session is an independent process in its own throwaway sandbox; the
          // client adapters already run ephemeral and without session persistence.
          const observed = await invoke({
            client,
            variantId: variant.id,
            context: variant.context,
            fixture,
            sessionIndex,
          });
          const hasResponse = typeof observed.rawResponse === 'string' && observed.rawResponse.trim() !== '';
          runs.push({
            ...base,
            status: observed.status === 'PASS' && hasResponse ? 'PASS' : 'BLOCKED',
            requestedModel: observed.requestedModel,
            effectiveModel: observed.effectiveModel,
            usage: observed.usage,
            diagnosticCode: observed.diagnosticCode || (hasResponse ? null : 'EMPTY_RESPONSE'),
            responseFingerprint: digest(observed.rawResponse || ''),
            score: scoreResponse(observed.rawResponse, fixture.oracle),
          });
        }
      }
    }
  }

  // One call per cell stays directional no matter how many cells it covers.  The
  // formal gate needs repeated sessions AND more than the single safety fixture.
  const formal = execute
    && sessions >= FORMAL_SESSION_FLOOR
    && selected.length >= FORMAL_FIXTURE_FLOOR;
  return {
    schema: SCHEMA,
    evidenceClass: formal ? 'formal-comparison' : 'directional-pilot',
    createdAt: now(),
    mode: execute ? 'execute' : 'dry-run',
    source,
    baselineCommit: plan.baselineCommit,
    sessions,
    fixtureIds: selected.map((fixture) => fixture.id),
    oracleIds: selected.map((fixture) => fixture.oracle.id),
    runs,
    aggregate: buildAggregate(runs, {
      sessions,
      plannedCalls,
      clients,
      fixtures: selected,
      variants: plan.variants,
    }),
    usage: sumUsage(runs),
  };
}

function parseBoundedInteger(raw, flag, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${flag} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    execute: false,
    clients: Object.keys(CLIENTS),
    fixtures: null,
    sessions: 1,
    maxCalls: null,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') args.execute = true;
    else if (arg === '--clients') args.clients = String(argv[++index] || '').split(',').filter(Boolean);
    else if (arg === '--fixtures') args.fixtures = String(argv[++index] || '').split(',').filter(Boolean);
    else if (arg === '--sessions') args.sessions = parseBoundedInteger(argv[++index], '--sessions', 1, MAX_SESSIONS);
    else if (arg === '--max-calls') args.maxCalls = parseBoundedInteger(argv[++index], '--max-calls', 1, 1000);
    else if (arg === '--output') args.output = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function validateEvidenceTarget(root, requestedPath) {
  const evidenceRoot = path.join(root, 'docs', 'evidence');
  const target = path.resolve(root, requestedPath);
  if (path.dirname(target) !== evidenceRoot || path.extname(target) !== '.json') {
    throw new Error('--output must be a direct JSON child of docs/evidence/');
  }
  const rootStat = fs.lstatSync(evidenceRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || fs.realpathSync(evidenceRoot) !== evidenceRoot) {
    throw new Error('docs/evidence must be a physical directory');
  }
  return target;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const receipt = await runBenchmark({
      argv: args.execute ? ['--execute'] : [],
      clients: args.clients,
      fixtures: args.fixtures,
      sessions: args.sessions,
      maxCalls: args.maxCalls,
    });
    const output = `${JSON.stringify(receipt, null, 2)}\n`;
    if (args.output) {
      const target = validateEvidenceTarget(ROOT, args.output);
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW || 0);
      const descriptor = fs.openSync(target, flags, 0o600);
      try { fs.writeFileSync(descriptor, output); } finally { fs.closeSync(descriptor); }
    }
    process.stdout.write(output);
  } catch (error) {
    process.stderr.write(`worker-context-benchmark: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  CLIENTS,
  buildBenchmarkPlan,
  buildClaudeArgs,
  buildCodexArgs,
  cursorResponse,
  scoreResponse,
  runBenchmark,
  parseArgs,
  defaultInvoke,
  validateEvidenceTarget,
};
if (require.main === module) main();
