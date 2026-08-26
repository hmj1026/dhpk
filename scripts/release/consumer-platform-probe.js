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
const {
  assertPhysicalPackageRoot,
  networkSandboxProbe,
  runCursorConsumerProbe,
  sandboxInvocation,
  validateCursorPackage,
} = require('../lib/cursor-plugin-package');
const { redactSensitiveText } = require('../lib/redaction');
const { normalizeConsumerEvidence } = require('../lib/release-evidence');

const STATUSES = ['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE'];
const DEFAULT_CODEX_PROBE_TIMEOUT_MS = 30_000;
const MAX_CODEX_PROBE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CODEX_PROBE_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_CODEX_PROBE_OUTPUT_BYTES = 4 * 1024 * 1024;
const CURSOR_DISCOVERY_PROMPT = 'Read only. Return exactly: dhpk skills commands agents rules loaded. CURSOR_SMOKE_OK. Do not call tools or edit files.';
const CURSOR_STREAM_OUTPUT_FLAGS = ['--output-format', 'stream-json', '--stream-partial-output'];

function parseArgs(argv) {
  const args = { execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--platform') args.platform = argv[++i];
    else if (arg === '--package-root') args.packageRoot = argv[++i];
    else if (arg === '--execute') args.execute = true;
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--help') {
      console.log('usage: consumer-platform-probe.js --platform codex|agent-plugin|cursor --package-root <path> [--execute] [--version X.Y.Z]');
      process.exit(0);
    } else {
      console.error(`consumer-platform-probe: unknown argument '${redactSensitiveText(String(arg), { maxLength: 200 })}'`);
      process.exit(2);
    }
  }
  if (!['codex', 'agent-plugin', 'cursor'].includes(args.platform) || !args.packageRoot) {
    console.error('usage: consumer-platform-probe.js --platform codex|agent-plugin|cursor --package-root <path> [--execute] [--version X.Y.Z]');
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

function resolveExecutable(name, pathValue = process.env.PATH) {
  let blocked = null;
  for (const directoryValue of String(pathValue || '').split(path.delimiter)) {
    if (!directoryValue) continue;
    const candidate = path.join(path.resolve(directoryValue), name);
    try {
      const lexical = fs.lstatSync(candidate);
      if (!lexical.isFile() && !lexical.isSymbolicLink()) continue;
      let resolved;
      try {
        resolved = fs.realpathSync(candidate);
      } catch (_) {
        blocked = `codex executable symlink target is unavailable: ${candidate}`;
        continue;
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || !(stat.mode & 0o111)) {
        blocked = `codex executable candidate is not a regular executable: ${candidate}`;
        continue;
      }
      return { path: resolved };
    } catch (_) {
      // Continue to the next PATH entry; an absent or inaccessible client is
      // reported as UNAVAILABLE by the caller.
    }
  }
  return blocked ? { blocked } : null;
}

function boundedCodexLimits() {
  const parse = (name, fallback, maximum) => {
    const candidate = Number(process.env[name]);
    if (!Number.isSafeInteger(candidate) || candidate <= 0) return fallback;
    return Math.min(candidate, maximum);
  };
  return {
    timeoutMs: parse('DHPK_CONSUMER_PROBE_TIMEOUT_MS', DEFAULT_CODEX_PROBE_TIMEOUT_MS, MAX_CODEX_PROBE_TIMEOUT_MS),
    maxOutputBytes: parse('DHPK_CONSUMER_PROBE_MAX_OUTPUT_BYTES', DEFAULT_CODEX_PROBE_MAX_OUTPUT_BYTES, MAX_CODEX_PROBE_OUTPUT_BYTES),
  };
}

function terminateSandboxProcess(result) {
  if (process.platform === 'win32' || !result || !result.pid) return;
  try { process.kill(-result.pid, 'SIGTERM'); } catch (_) { /* child group already exited */ }
  try { process.kill(-result.pid, 'SIGKILL'); } catch (_) { /* child group already exited */ }
}

function executeWithSandbox(command, args, options) {
  const {
    env,
    cwd,
    pathValue = env && env.PATH,
    writablePaths = [],
    privateRoot = os.tmpdir(),
    timeoutMs = DEFAULT_CODEX_PROBE_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_CODEX_PROBE_MAX_OUTPUT_BYTES,
  } = options;
  const sandbox = networkSandboxProbe(pathValue, 'disabled', true);
  if (!sandbox) {
    return {
      status: 125,
      error: Object.assign(new Error('OS filesystem/network sandbox is unavailable'), { code: 'DHPK_NETWORK_SANDBOX_UNAVAILABLE' }),
    };
  }
  const invocation = sandboxInvocation(sandbox, command, args, writablePaths, privateRoot);
  if (!invocation) {
    return {
      status: 125,
      error: Object.assign(new Error('sandbox paths are outside the private temporary root'), { code: 'DHPK_SANDBOX_PATH_UNSAFE' }),
    };
  }
  const [sandboxCommand, sandboxArgs] = invocation;
  return spawnSync(sandboxCommand, sandboxArgs, {
    encoding: 'utf8',
    env,
    cwd,
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes,
    killSignal: 'SIGKILL',
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function packageManifest(platform, root) {
  const rel = platform === 'cursor' ? ['.cursor-plugin/plugin.json', 'plugin.json'] : ['plugin.json', '.codex-plugin/plugin.json'];
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
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-package-'));
  const stagedPackage = path.join(stagingRoot, 'package');
  const workspace = path.join(stagingRoot, 'workspace');
  const env = probeEnvironment(tempHome);
  const limits = boundedCodexLimits();
  const commandDescription = 'codex plugin marketplace add <package-root>';
  try {
    const codexResolution = resolveExecutable('codex', env.PATH);
    if (!codexResolution) return { status: 'UNAVAILABLE', reason: 'codex CLI is not installed', commands: ['codex --version'] };
    if (codexResolution.blocked) return { status: 'BLOCKED', network: 'unknown', reason: codexResolution.blocked, commands: ['codex --version'] };
    if (!execute && !process.env.DHPK_CONSUMER_PROBE_EXECUTE) {
      return { status: 'NOT_RUN', reason: 'Codex CLI is present; pass --execute to run the sandboxed route', commands: ['codex --version'] };
    }
    const codexPath = codexResolution.path;
    assertPhysicalPackageRoot(root, 'Codex package');
    fs.cpSync(root, stagedPackage, { recursive: true, dereference: false });
    assertPhysicalPackageRoot(stagedPackage, 'staged Codex package');
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    fs.mkdirSync(env.CODEX_HOME, { recursive: true });
    const sandboxOptions = {
      env,
      cwd: workspace,
      pathValue: env.PATH,
      writablePaths: [workspace, env.HOME, env.CODEX_HOME],
      privateRoot: os.tmpdir(),
      timeoutMs: limits.timeoutMs,
      maxOutputBytes: limits.maxOutputBytes,
    };
    const version = executeWithSandbox(codexPath, ['--version'], sandboxOptions);
    if (version.error && version.error.code === 'ETIMEDOUT') {
      terminateSandboxProcess(version);
      return { status: 'BLOCKED', network: 'unknown', reason: `codex --version timed out after ${limits.timeoutMs} ms`, commands: ['codex --version'] };
    }
    if (version.error && version.error.code === 'ENOBUFS') {
      terminateSandboxProcess(version);
      return { status: 'BLOCKED', network: 'unknown', reason: `codex --version output exceeded ${limits.maxOutputBytes} bytes`, commands: ['codex --version'] };
    }
    if (version.error && ['DHPK_NETWORK_SANDBOX_UNAVAILABLE', 'DHPK_SANDBOX_PATH_UNSAFE'].includes(version.error.code)) {
      return { status: 'BLOCKED', network: 'unknown', reason: version.error.message, commands: ['codex --version'] };
    }
    if (version.error) {
      return { status: 'UNAVAILABLE', network: 'unknown', reason: `codex CLI probe unavailable: ${redactSensitiveText(String(version.error.message || version.error), { maxLength: 800 })}`, commands: ['codex --version'] };
    }
    if (version.status !== 0) {
      return { status: 'BLOCKED', network: 'unknown', reason: `codex --version failed with exit ${version.status}`, diagnostic: diagnostic(version), commands: ['codex --version'] };
    }
    const result = executeWithSandbox(codexPath, ['plugin', 'marketplace', 'add', stagedPackage], sandboxOptions);
    if (result.error && result.error.code === 'ETIMEDOUT') {
      terminateSandboxProcess(result);
      return { status: 'BLOCKED', network: 'unknown', reason: `sandboxed Codex route timed out after ${limits.timeoutMs} ms`, commands: [commandDescription] };
    }
    if (result.error && result.error.code === 'ENOBUFS') {
      terminateSandboxProcess(result);
      return { status: 'BLOCKED', network: 'unknown', reason: `sandboxed Codex route output exceeded ${limits.maxOutputBytes} bytes`, commands: [commandDescription] };
    }
    if (result.status === 0) return { status: 'PASS', network: 'disabled', reason: 'sandboxed Codex marketplace route completed', commands: [commandDescription] };
    if (result.error && ['DHPK_NETWORK_SANDBOX_UNAVAILABLE', 'DHPK_SANDBOX_PATH_UNSAFE'].includes(result.error.code)) {
      return { status: 'BLOCKED', network: 'unknown', reason: result.error.message, commands: [commandDescription] };
    }
    return { status: 'FAIL', network: 'disabled', reason: `sandboxed Codex route failed with exit ${result.status}`, diagnostic: diagnostic(result), commands: [commandDescription] };
  } catch (error) {
    return {
      status: 'BLOCKED',
      network: 'unknown',
      reason: `Codex consumer probe could not start: ${redactSensitiveText(String(error && error.message ? error.message : error), { maxLength: 800 })}`,
      commands: [commandDescription],
    };
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(stagingRoot, { recursive: true, force: true });
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

  const command = 'cursor-agent --plugin-dir <agent-package> --plugin-dir <cursor-package> --mode ask --trust -p <smoke-prompt> --output-format stream-json --stream-partial-output';
  const agentRoot = path.join(path.dirname(root), 'dhpk-agent');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-consumer-'));
  const stagedAgent = path.join(sandbox, 'agent-plugin');
  const stagedCursor = path.join(sandbox, 'cursor-plugin');
  const workspace = path.join(sandbox, 'workspace');
  try {
    let agentPackage;
    try {
      agentPackage = validateAgentPluginPackage(agentRoot);
    } catch (error) {
      const reason = redactSensitiveText(String(error && error.message ? error.message : error), { maxLength: 800 });
      return { status: 'BLOCKED', reason: 'Cursor consumer probe could not validate the sibling Agent Plugin package safely', diagnostics: [reason], commands: [{ cmd: command, exitCode: null }] };
    }
    if (!agentPackage.ok) {
      return {
        status: 'BLOCKED',
        reason: 'Cursor consumer probe requires the sibling Agent Plugin package',
        diagnostics: agentPackage.errors,
        commands: [{ cmd: command, exitCode: null }],
      };
    }
    assertPhysicalPackageRoot(agentRoot, 'Agent package');
    assertPhysicalPackageRoot(root, 'Cursor package');
    fs.cpSync(agentRoot, stagedAgent, { recursive: true, dereference: false });
    fs.cpSync(root, stagedCursor, { recursive: true, dereference: false });
    assertPhysicalPackageRoot(stagedAgent, 'staged Agent package');
    assertPhysicalPackageRoot(stagedCursor, 'staged Cursor package');
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
        '-p', CURSOR_DISCOVERY_PROMPT,
        ...CURSOR_STREAM_OUTPUT_FLAGS,
      ],
      cwd: workspace,
      requireOutput: true,
      requireJson: true,
      requireDiscovery: true,
      // Cursor owns agents/commands/rules here; skills are intentionally
      // supplied by the companion Agent Plugin projection.
      requiredLoaderComponents: ['agents', 'commands', 'rules'],
      requirePackageChallenge: true,
      networkMode: 'shared',
    });
    return {
      ...result,
      packageRoot: root,
      commands: [{ cmd: command, exitCode: result.exit_code === undefined ? null : result.exit_code }],
    };
  } catch (error) {
    const reason = redactSensitiveText(String(error && error.message ? error.message : 'unknown Cursor probe setup error'), { maxLength: 800 });
    return { status: 'BLOCKED', reason: `Cursor consumer probe could not start: ${reason}`, commands: [{ cmd: command, exitCode: null }] };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function runAgentPluginProbe(root, execute = false) {
  if (!execute) {
    return {
      status: 'UNAVAILABLE',
      reason: 'Agent Plugin consumer runtime probe is opt-in; pass --execute on an isolated runner',
      commands: [],
    };
  }

  const command = 'cursor-agent --plugin-dir <agent-package> --mode ask --trust -p <smoke-prompt> --output-format stream-json --stream-partial-output';
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-consumer-'));
  const stagedRoot = path.join(sandbox, 'agent-plugin');
  const workspace = path.join(sandbox, 'workspace');
  try {
    assertPhysicalPackageRoot(root, 'Agent package');
    fs.cpSync(root, stagedRoot, { recursive: true, dereference: false });
    assertPhysicalPackageRoot(stagedRoot, 'staged Agent package');
    fs.mkdirSync(workspace, { recursive: true });
    const result = runCursorConsumerProbe({
      packageRoot: stagedRoot,
      args: [
        '--plugin-dir', stagedRoot,
        '--mode', 'ask',
        '--trust',
        '-p', CURSOR_DISCOVERY_PROMPT,
        ...CURSOR_STREAM_OUTPUT_FLAGS,
      ],
      cwd: workspace,
      requireOutput: true,
      requireJson: true,
      requireDiscovery: true,
      requiredDiscoveryCapabilities: ['dhpk', 'skill'],
      // The portable package has no native Cursor manifest. The probe stages
      // a validated, temporary Cursor manifest solely for loader attestation;
      // the client still receives exactly one --plugin-dir.
      requirePackageChallenge: true,
      loaderOverlay: true,
      networkMode: 'shared',
    });
    return {
      ...result,
      packageRoot: root,
      commands: [{ cmd: command, exitCode: result.exit_code === undefined ? null : result.exit_code }],
    };
  } catch (error) {
    const reason = redactSensitiveText(String(error && error.message ? error.message : 'unknown Agent Plugin probe setup error'), { maxLength: 800 });
    return { status: 'BLOCKED', reason: `Agent Plugin consumer probe could not start: ${reason}`, commands: [{ cmd: command, exitCode: null }] };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function validatePackage(platform, root) {
  const result = platform === 'codex' || platform === 'agent-plugin'
    ? validateAgentPluginPackage(root)
    : validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor' });
  return result;
}

function normalizedProbeEvidence(platform, manifest, result, version) {
  const surface = platform === 'codex' ? 'codex-marketplace' : platform === 'agent-plugin' ? 'agent-plugin' : 'cursor-plugin';
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
      ...(result.reason_code ? { reason_code: result.reason_code } : {}),
      ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    }],
  });
  return { surfaceEvidence: evidence.surfaceResults[0], surfaceResults: evidence.surfaceResults };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.packageRoot);
  try {
    // Preflight the complete tree before reading a caller-controlled manifest;
    // this bounds bytes/entries and rejects symlinks, including generated
    // bytecode paths that identity fingerprints intentionally omit.
    assertPhysicalPackageRoot(root, `${args.platform} package`);
  } catch (error) {
    const blocked = {
      platform: args.platform,
      packageRoot: root,
      status: 'BLOCKED',
      reason: 'package physical preflight could not complete safely',
      diagnostics: [redactSensitiveText(String(error && error.message ? error.message : error), { maxLength: 800 })],
      commands: [],
    };
    const normalized = normalizedProbeEvidence(args.platform, null, blocked, args.version || null);
    emit({ ...blocked, ...normalized }, 1);
  }
  const manifest = packageManifest(args.platform, root);
  if (!manifest) emit({ platform: args.platform, status: 'BLOCKED', packageRoot: root, reason: 'package manifest is missing', commands: [] }, 1);
  if (manifest.error) emit({ platform: args.platform, status: 'FAIL', packageRoot: root, reason: manifest.error, commands: [] }, 1);
  let structural;
  try {
    structural = validatePackage(args.platform, root);
  } catch (error) {
    const blocked = {
      platform: args.platform,
      packageRoot: root,
      status: 'BLOCKED',
      reason: 'package structural validation could not complete safely',
      diagnostics: [redactSensitiveText(String(error && error.message ? error.message : error), { maxLength: 800 })],
      commands: [],
    };
    const normalized = normalizedProbeEvidence(args.platform, manifest, blocked, args.version || null);
    emit({ ...blocked, ...normalized }, 1);
  }
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
    : args.platform === 'agent-plugin'
      ? runAgentPluginProbe(root, args.execute)
      : runCursorProbe(root, args.execute);
  if (!STATUSES.includes(result.status)) emit({ platform: args.platform, status: 'FAIL', packageRoot: root, reason: `unknown probe status ${result.status}` }, 1);
  let normalized;
  try {
    normalized = normalizedProbeEvidence(args.platform, manifest, result, args.version || null);
  } catch (error) {
    emit({ platform: args.platform, packageRoot: root, manifest: manifest.path, version: args.version || null, ...result, normalizationError: redactSensitiveText(String(error && error.message ? error.message : error), { maxLength: 800 }) }, 1);
  }
  emit({ platform: args.platform, packageRoot: root, manifest: manifest.path, version: args.version || null, ...result, ...normalized }, ['FAIL', 'BLOCKED'].includes(result.status) ? 1 : 0);
}

main();
