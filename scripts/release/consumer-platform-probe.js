#!/usr/bin/env node
'use strict';

// Surface-scoped consumer probe. Structural package validation is deliberately
// separate from client execution: an absent CLI is UNAVAILABLE, a configured
// but not executed probe is NOT_RUN, and an explicitly requested route that
// lacks a prerequisite is BLOCKED. The probe uses a temporary home when the
// Codex CLI is available and never mutates a maintainer's consumer cache.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateAgentPluginPackage } = require('../lib/agent-plugin-package');
const { runCursorConsumerProbe, validateCursorPackage } = require('../lib/cursor-plugin-package');
const { redactSensitiveText } = require('../lib/redaction');
const { normalizeConsumerEvidence } = require('../lib/release-evidence');

const STATUSES = ['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE'];

function parseArgs(argv) {
  const args = { execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--platform') args.platform = argv[++i];
    else if (arg === '--package-root') args.packageRoot = argv[++i];
    else if (arg === '--execute') args.execute = true;
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--help') {
      console.log('usage: consumer-platform-probe.js --platform codex|cursor --package-root <path> [--execute] [--version X.Y.Z]');
      process.exit(0);
    } else {
      console.error(`consumer-platform-probe: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!['codex', 'cursor'].includes(args.platform) || !args.packageRoot) {
    console.error('usage: consumer-platform-probe.js --platform codex|cursor --package-root <path> [--execute] [--version X.Y.Z]');
    process.exit(2);
  }
  return args;
}

function emit(payload, code = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(code);
}

function diagnostic(result) {
  const text = `${result && result.stdout ? result.stdout : ''}\n${result && result.stderr ? result.stderr : ''}`.trim();
  return text ? redactSensitiveText(text) : null;
}

function probeEnvironment(tempHome) {
  const allowed = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'CI'];
  const env = {};
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  env.PATH = env.PATH || '/usr/local/bin:/usr/bin:/bin';
  env.HOME = tempHome;
  env.USERPROFILE = tempHome;
  env.XDG_CONFIG_HOME = path.join(tempHome, 'config');
  env.XDG_DATA_HOME = path.join(tempHome, 'data');
  env.XDG_CACHE_HOME = path.join(tempHome, 'cache');
  env.CODEX_HOME = path.join(tempHome, 'codex');
  env.DHPK_CONSUMER_PROBE_NETWORK = 'disabled';
  return env;
}

function networkSandboxAvailable() {
  if (process.platform !== 'linux') return false;
  const result = spawnSync('unshare', ['--net', '--', 'true'], { encoding: 'utf8', env: { PATH: process.env.PATH || '/usr/bin:/bin' } });
  return !result.error && result.status === 0;
}

function executeWithSandbox(command, args, options) {
  const { env, cwd } = options;
  if (networkSandboxAvailable()) {
    return spawnSync('unshare', ['--net', '--', command, ...args], { encoding: 'utf8', env, cwd });
  }
  if (process.env.DHPK_CONSUMER_PROBE_ALLOW_UNSANDBOXED_EXECUTION === '1') {
    return spawnSync(command, args, { encoding: 'utf8', env, cwd });
  }
  return { status: 125, error: new Error('OS network sandbox is unavailable; set DHPK_CONSUMER_PROBE_ALLOW_UNSANDBOXED_EXECUTION=1 only for trusted test fixtures') };
}

function packageManifest(platform, root) {
  const rel = platform === 'codex' ? ['plugin.json', '.codex-plugin/plugin.json'] : ['plugin.json', '.cursor-plugin/plugin.json'];
  for (const candidate of rel) {
    const file = path.join(root, candidate);
    if (!fs.existsSync(file)) continue;
    try {
      return { path: file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (error) {
      return { path: file, error: `invalid JSON: ${error.message}` };
    }
  }
  return null;
}

function runCodexProbe(root, execute = false) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-home-'));
  const env = probeEnvironment(tempHome);
  let codex;
  try { codex = spawnSync('codex', ['--version'], { encoding: 'utf8', env }); } catch (error) {
    fs.rmSync(tempHome, { recursive: true, force: true });
    return { status: 'UNAVAILABLE', reason: `codex CLI probe unavailable: ${error.message}`, commands: [] };
  }
  if (codex.error && codex.error.code === 'ENOENT') {
    fs.rmSync(tempHome, { recursive: true, force: true });
    return { status: 'UNAVAILABLE', reason: 'codex CLI is not installed', commands: [] };
  }
  if (codex.status !== 0) {
    fs.rmSync(tempHome, { recursive: true, force: true });
    return { status: 'BLOCKED', reason: `codex --version failed with exit ${codex.status}`, commands: ['codex --version'] };
  }
  if (!execute && !process.env.DHPK_CONSUMER_PROBE_EXECUTE) {
    fs.rmSync(tempHome, { recursive: true, force: true });
    return { status: 'NOT_RUN', reason: 'Codex CLI is present; pass --execute to run the sandboxed route', commands: ['codex --version'] };
  }
  try {
    fs.mkdirSync(env.CODEX_HOME, { recursive: true });
    const command = ['codex', 'plugin', 'marketplace', 'add', root];
    const result = executeWithSandbox(command[0], command.slice(1), { env, cwd: root });
    if (result.status === 0) return { status: 'PASS', reason: 'sandboxed Codex marketplace route completed', commands: [`codex plugin marketplace add ${root}`] };
    if (result.error && /network sandbox is unavailable/i.test(result.error.message)) return { status: 'BLOCKED', reason: result.error.message, commands: [`codex plugin marketplace add ${root}`] };
    return { status: 'FAIL', reason: `sandboxed Codex route failed with exit ${result.status}`, diagnostic: diagnostic(result), commands: [`codex plugin marketplace add ${root}`] };
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

function runCursorProbe(root, execute = false) {
  if (!execute) {
    return {
      status: 'UNAVAILABLE',
      reason: 'Cursor client runtime probe is opt-in; pass --execute on an isolated runner',
      commands: [],
    };
  }

  const agentRoot = path.join(path.dirname(root), 'dhpk-agent');
  const agentPackage = validateAgentPluginPackage(agentRoot);
  if (!agentPackage.ok) {
    return {
      status: 'BLOCKED',
      reason: 'Cursor consumer probe requires the sibling Agent Plugin package',
      diagnostics: agentPackage.errors,
      commands: [],
    };
  }

  const command = 'cursor-agent --plugin-dir <agent-package> --plugin-dir <cursor-package> --mode ask --trust --print <smoke-prompt> --output-format json';
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-consumer-'));
  const stagedAgent = path.join(sandbox, 'agent-plugin');
  const stagedCursor = path.join(sandbox, 'cursor-plugin');
  const workspace = path.join(sandbox, 'workspace');
  try {
    fs.cpSync(agentRoot, stagedAgent, { recursive: true, dereference: true });
    fs.cpSync(root, stagedCursor, { recursive: true, dereference: true });
    fs.mkdirSync(workspace, { recursive: true });
    const result = runCursorConsumerProbe({
      // The Cursor package is the consumer under test. The Agent package is a
      // companion projection passed as a second plugin directory, but must
      // not become the probe's working root or environment identity.
      packageRoot: stagedCursor,
      args: [
        '--plugin-dir', stagedAgent,
        '--plugin-dir', stagedCursor,
        '--mode', 'ask',
        '--trust',
        '-p', 'List the dhpk skills, commands, agents, and rules you discover. Do not edit files.',
        '--output-format', 'json',
      ],
      cwd: workspace,
      requireOutput: true,
      requireJson: true,
      requireDiscovery: true,
      requirePackageChallenge: true,
      networkMode: 'disabled',
    });
    return {
      ...result,
      packageRoot: root,
      commands: [{ cmd: command, exitCode: result.exit_code === undefined ? null : result.exit_code }],
    };
  } catch (error) {
    return { status: 'BLOCKED', reason: `Cursor consumer probe could not start: ${error.message}`, commands: [{ cmd: command, exitCode: null }] };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function validatePackage(platform, root) {
  const result = platform === 'codex'
    ? validateAgentPluginPackage(root)
    : validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor' });
  return result;
}

function normalizedProbeEvidence(platform, manifest, result, version) {
  const surface = platform === 'codex' ? 'codex-marketplace' : 'cursor-plugin';
  const evidence = normalizeConsumerEvidence({
    stage: 'CONSUMER',
    producer: 'consumer-platform-probe',
    adapter: { id: 'consumer-platform-probe', version: '1.0.0' },
    surfaceResults: [{
      surface,
      status: result.status,
      commands: result.commands || [],
      environment: { network: result.network || 'unknown', packageRoot: '<repo-package>' },
      artifacts: [
        ...(manifest && manifest.path ? [{ path: `<repo-package>/${path.basename(manifest.path)}`, version: version || null }] : []),
        ...(result.artifacts || []),
      ],
      diagnostics: result.diagnostics || result.diagnostic || [],
      reasons: result.reasons || (result.reason ? [result.reason] : []),
      checkedClaims: ['package-manifest', 'consumer-route'],
      ...(result.planFingerprint ? { planFingerprint: result.planFingerprint } : {}),
      ...(result.artifactFingerprint ? { artifactFingerprint: result.artifactFingerprint } : {}),
    }],
  });
  return { surfaceEvidence: evidence.surfaceResults[0], surfaceResults: evidence.surfaceResults };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.packageRoot);
  const manifest = packageManifest(args.platform, root);
  if (!manifest) emit({ platform: args.platform, status: 'BLOCKED', packageRoot: root, reason: 'package manifest is missing', commands: [] }, 1);
  if (manifest.error) emit({ platform: args.platform, status: 'FAIL', packageRoot: root, reason: manifest.error, commands: [] }, 1);
  const structural = validatePackage(args.platform, root);
  if (!structural.ok) emit({
    platform: args.platform,
    status: 'FAIL',
    packageRoot: root,
    reason: 'projected package failed structural validation before consumer execution',
    errors: structural.errors.map((error) => diagnostic({ stdout: error })),
    commands: [],
  }, 1);
  const result = args.platform === 'codex'
    ? runCodexProbe(root, args.execute)
    : runCursorProbe(root, args.execute);
  if (!STATUSES.includes(result.status)) emit({ platform: args.platform, status: 'FAIL', packageRoot: root, reason: `unknown probe status ${result.status}` }, 1);
  let normalized;
  try {
    normalized = normalizedProbeEvidence(args.platform, manifest, result, args.version || null);
  } catch (error) {
    emit({ platform: args.platform, packageRoot: root, manifest: manifest.path, version: args.version || null, ...result, normalizationError: error.message }, 1);
  }
  emit({ platform: args.platform, packageRoot: root, manifest: manifest.path, version: args.version || null, ...result, ...normalized }, ['FAIL', 'BLOCKED'].includes(result.status) ? 1 : 0);
}

main();
