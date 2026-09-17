#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA = 'dhpk.worker-context-benchmark-receipt.v1';
const CLIENTS = Object.freeze({
  claude: Object.freeze({ model: 'claude-sonnet-5', effort: 'high' }),
  codex: Object.freeze({ model: 'gpt-5.6-luna', effort: 'high' }),
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
  const checks = {
    validJson: Boolean(parsed),
    decision: Boolean(parsed && parsed.decision === oracle.decision),
    mayEdit: Boolean(parsed && parsed.may_edit === oracle.may_edit),
    reasonCodes: Boolean(parsed && Array.isArray(parsed.reason_codes)
      && oracle.requiredReasonCodes.every((code) => parsed.reason_codes.includes(code))),
    technique: Boolean(parsed && new RegExp(oracle.techniquePattern, 'i').test(String(parsed.technique || ''))),
  };
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

function invokeClaude(prompt, cwd, timeoutMs) {
  const result = spawnSync('claude', ['-p', '--restricted', '--safe-mode', '--strict-mcp-config', '--tools', '', '--setting-sources', '', '--model', CLIENTS.claude.model, '--effort', 'high', '--permission-mode', 'plan', '--permission-prompts', 'none', '--no-session-persistence', '--max-budget-usd', '0.30', '--output-format', 'json', prompt], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' });
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

function sumUsage(runs) {
  return runs.reduce((sum, run) => ({
    inputTokens: sum.inputTokens + Number(run.usage && run.usage.inputTokens || 0),
    outputTokens: sum.outputTokens + Number(run.usage && run.usage.outputTokens || 0),
    totalTokens: sum.totalTokens + Number(run.usage && run.usage.totalTokens || 0),
  }), usage());
}

async function runBenchmark({ root = ROOT, argv = [], clients = Object.keys(CLIENTS), invoke = defaultInvoke, now = () => new Date().toISOString(), gitInfo = defaultGitInfo } = {}) {
  const execute = argv.includes('--execute');
  const unknown = clients.filter((client) => !CLIENTS[client]);
  if (unknown.length) throw new Error(`unknown benchmark clients: ${unknown.join(', ')}`);
  const plan = buildBenchmarkPlan({ root });
  const fixture = plan.fixtures[0];
  const source = gitInfo(root);
  if (execute && source.dirty) throw new Error('benchmark execution requires a clean source checkout');
  const runs = [];
  for (const client of clients) {
    for (const variant of plan.variants) {
      const base = {
        client,
        variantId: variant.id,
        variantFingerprint: variant.fingerprint,
        requestedModel: CLIENTS[client].model,
        effectiveModel: null,
        status: 'NOT_RUN',
        usage: usage(),
        score: null,
      };
      if (!execute) { runs.push(base); continue; }
      const observed = await invoke({ client, variantId: variant.id, context: variant.context, fixture });
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
  return {
    schema: SCHEMA,
    evidenceClass: 'directional-pilot',
    createdAt: now(),
    mode: execute ? 'execute' : 'dry-run',
    source,
    baselineCommit: plan.baselineCommit,
    fixtureId: fixture.id,
    oracleId: fixture.oracle.id,
    runs,
    usage: sumUsage(runs),
  };
}

function parseArgs(argv) {
  const args = { execute: false, clients: Object.keys(CLIENTS), output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') args.execute = true;
    else if (arg === '--clients') args.clients = String(argv[++index] || '').split(',').filter(Boolean);
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
    const receipt = await runBenchmark({ argv: args.execute ? ['--execute'] : [], clients: args.clients });
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
  buildCodexArgs,
  cursorResponse,
  scoreResponse,
  runBenchmark,
  defaultInvoke,
  validateEvidenceTarget,
};
if (require.main === module) main();
