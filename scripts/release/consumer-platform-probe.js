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
const { validateRelocatableAgentsSkillsProjection } = require('../lib/project-agent-projection-publisher');
const {
  AGY_DIRECT_FILE_TRANSFORM_ID,
  AGY_PROJECT_PROBE_ADAPTER,
  AGY_PROJECT_PROBE_CLAIMS,
  DIRECT_FILE_SHAPE,
} = require('../lib/project-agent-provider-adapters');

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
    else if (arg === '--inventory') args.inventory = argv[++i];
    else if (arg === '--help') {
      console.log('usage: consumer-platform-probe.js --platform codex|agent-plugin|cursor|agy-project|claude-project --package-root <path> [--inventory <path>] [--execute] [--version X.Y.Z]');
      process.exit(0);
    } else {
      console.error(`consumer-platform-probe: unknown argument '${redactSensitiveText(String(arg), { maxLength: 200 })}'`);
      process.exit(2);
    }
  }
  if (!['codex', 'agent-plugin', 'cursor', 'agy-project', 'claude-project'].includes(args.platform) || !args.packageRoot) {
    console.error('usage: consumer-platform-probe.js --platform codex|agent-plugin|cursor|agy-project|claude-project --package-root <path> [--inventory <path>] [--execute] [--version X.Y.Z]');
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
        blocked = `${name} executable symlink target is unavailable: ${candidate}`;
        continue;
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || !(stat.mode & 0o111)) {
        blocked = `${name} executable candidate is not a regular executable: ${candidate}`;
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
  // Canonicalize immediately (issue #436): an OS temp alias (e.g. macOS's
  // /var) in these path strings would otherwise fail the physical-ancestor
  // and private-writable-path checks below for an entirely legitimate root.
  const tempHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-home-')));
  const stagingRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-package-')));
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
  // Canonicalize immediately (issue #436): staged*/assertPhysicalPackageRoot
  // below walk ancestor symlinks, and an OS temp alias (e.g. macOS's /var)
  // would otherwise reject a legitimate staged package.
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-consumer-')));
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
  // Canonicalize immediately (issue #436): same reasoning as runCursorProbe.
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-consumer-')));
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

const AGY_PROJECT_DISCOVERY_PROMPT = 'Read only. Inspect the project-local generated skill named %s under .agents/skills. Return exactly AGY_PROJECT_SMOKE_OK when it is available. Do not call tools or edit files.';

function runAgyProjectProbe(root, structural, execute = false) {
  const receipt = structural && structural.receipt;
  const evidenceFingerprint = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? `sha256:${value}` : value;
  const command = `agy --mode plan --agent agy-fast-worker --print <project-artifact> --output-format text`;
  const blocked = (reason) => ({
    status: 'BLOCKED',
    reason,
    commands: [command],
    checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(),
  });
  const agyBinding = receipt && receipt.hostBindings && receipt.hostBindings.agy;
  if (!agyBinding
    || agyBinding.surface !== 'agy-plugin'
    || agyBinding.shape !== DIRECT_FILE_SHAPE
    || !agyBinding.transform
    || agyBinding.transform.id !== AGY_DIRECT_FILE_TRANSFORM_ID) {
    return blocked('AGY project probe requires a concrete receipt Host binding for the AGY direct-file adapter');
  }
  const entries = receipt && Array.isArray(receipt.entries) ? receipt.entries : [];
  const firstEntry = entries[0];
  if (!firstEntry || typeof firstEntry.name !== 'string' || !Array.isArray(firstEntry.generatedPaths)) {
    return blocked('AGY project probe requires at least one receipt entry with a generated direct-file path');
  }
  const directPath = `${firstEntry.name}.md`;
  if (!firstEntry.generatedPaths.includes(directPath)
    || !Array.isArray(receipt.managedPaths)
    || !receipt.managedPaths.includes(directPath)
    || !structural.outputRoot) {
    return blocked(`AGY project probe is not bound to the receipt direct-file artifact: ${directPath}`);
  }
  const directFile = path.join(structural.outputRoot, directPath);
  try {
    const stat = fs.lstatSync(directFile);
    if (stat.isSymbolicLink() || !stat.isFile()) return blocked(`AGY project direct-file artifact is not a regular file: ${directPath}`);
  } catch (_) {
    return blocked(`AGY project direct-file artifact is unavailable: ${directPath}`);
  }
  const planFingerprint = evidenceFingerprint(receipt.planFingerprint);
  const artifactFingerprint = evidenceFingerprint(receipt.artifactFingerprint);
  const skillName = firstEntry.name;
  const identity = {
    adapter: { ...AGY_PROJECT_PROBE_ADAPTER },
    planFingerprint,
    artifactFingerprint,
    artifacts: [
      { path: '<project-root>/.agents/.dhpk-installed.json', version: null },
      { path: `<project-root>/.agents/skills/${directPath}`, version: null },
    ],
  };
  if (!execute) {
    return {
      status: 'NOT_RUN',
      reason: 'AGY project artifact runtime probe is opt-in; pass --execute on an isolated runner',
      commands: [command],
      checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(),
      ...identity,
    };
  }

  const tempHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agy-project-home-')));
  const stagingRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agy-project-artifact-')));
  const stagedProject = path.join(stagingRoot, 'project');
  const workspace = path.join(stagingRoot, 'workspace');
  const env = probeEnvironment(tempHome);
  const limits = boundedCodexLimits();
  try {
    const resolution = resolveExecutable('agy', env.PATH);
    if (!resolution) return { status: 'UNAVAILABLE', reason: 'agy CLI is not installed', commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    if (resolution.blocked) return { status: 'BLOCKED', reason: resolution.blocked, commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    assertPhysicalPackageRoot(root, 'AGY project artifact');
    fs.cpSync(root, stagedProject, { recursive: true, dereference: false });
    assertPhysicalPackageRoot(stagedProject, 'staged AGY project artifact');
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const sandboxOptions = {
      env,
      // Keep the copied artifact outside the writable bind list. The AGY
      // process receives it through --add-dir and can inspect, but cannot
      // mutate, the exact receipt-owned bytes under test.
      cwd: workspace,
      pathValue: env.PATH,
      writablePaths: [workspace, env.HOME],
      privateRoot: os.tmpdir(),
      timeoutMs: limits.timeoutMs,
      maxOutputBytes: limits.maxOutputBytes,
    };
    const args = [
      '--add-dir', stagedProject,
      '--mode', 'plan',
      '--agent', 'agy-fast-worker',
      '--print', AGY_PROJECT_DISCOVERY_PROMPT.replace('%s', skillName),
      '--output-format', 'text',
    ];
    const result = executeWithSandbox(resolution.path, args, sandboxOptions);
    if (result.error && result.error.code === 'ETIMEDOUT') {
      terminateSandboxProcess(result);
      return { status: 'BLOCKED', reason: `AGY project probe timed out after ${limits.timeoutMs} ms`, commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    if (result.error && result.error.code === 'ENOBUFS') {
      terminateSandboxProcess(result);
      return { status: 'BLOCKED', reason: `AGY project probe output exceeded ${limits.maxOutputBytes} bytes`, commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    if (result.error && ['DHPK_NETWORK_SANDBOX_UNAVAILABLE', 'DHPK_SANDBOX_PATH_UNSAFE'].includes(result.error.code)) {
      return { status: 'BLOCKED', reason: result.error.message, commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    if (result.error) {
      return { status: 'UNAVAILABLE', reason: `agy project probe unavailable: ${redactSensitiveText(String(result.error.message || result.error), { maxLength: 800 })}`, commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    if (result.status !== 0) {
      const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      const lower = output.toLowerCase();
      if (/unknown argument|unknown flag|flag provided but not defined/.test(lower)) {
        return { status: 'SKIP_INCOMPATIBLE', reason: 'agy CLI does not support the bounded project skill probe route', diagnostic: diagnostic(result), commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
      }
      if (/authentication|unauthorized|api key|credential|network|connection|timed out|timeout|dns|resolve/.test(lower)) {
        return { status: 'UNAVAILABLE', reason: 'agy project probe is unavailable in the isolated runtime', diagnostic: diagnostic(result), commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
      }
      return { status: 'FAIL', reason: `agy project probe failed with exit ${result.status}`, diagnostic: diagnostic(result), commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    if (String(result.stdout || '').trim() !== 'AGY_PROJECT_SMOKE_OK') {
      return { status: 'FAIL', reason: 'agy project probe did not return the exact AGY_PROJECT_SMOKE_OK marker', diagnostic: diagnostic(result), commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    return { status: 'PASS', reason: 'bounded AGY project probe returned AGY_PROJECT_SMOKE_OK', network: 'disabled', commands: [command], checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(), ...identity };
  } catch (error) {
    return {
      status: 'BLOCKED',
      reason: `AGY project probe could not start: ${redactSensitiveText(String(error && error.message ? error.message : error), { maxLength: 800 })}`,
      commands: [command],
      checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(),
      ...identity,
    };
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

const CLAUDE_PROJECT_DISCOVERY_PROMPT = 'Read only. Discover the generated dhpk skill under .claude/skills. Return exactly CLAUDE_PROJECT_SMOKE_OK. Do not call tools or edit files.';
const CLAUDE_PROJECT_PROBE_CLAIMS = ['project-artifact-structure', 'claude-project-discovery', 'consumer-route'];

function assertPhysicalProjectRoot(root, label) {
  let stat;
  try { stat = fs.lstatSync(root); } catch (error) { throw new Error(`${label} is unavailable: ${error.message}`); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a physical directory`);
}

function runClaudeProjectProbe(root, structural, execute = false) {
  const receipt = structural && structural.receipt;
  const evidenceFingerprint = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? `sha256:${value}` : value;
  const command = 'claude -p <smoke-prompt> --output-format text';
  const blocked = (reason) => ({
    status: 'BLOCKED',
    reason,
    commands: [command],
    checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(),
  });
  const binding = receipt && receipt.hostBindings && receipt.hostBindings.claude;
  const discovery = binding && binding.discovery;
  const bindingPaths = receipt && receipt.bindingPaths && receipt.bindingPaths.claude;
  if (!binding || binding.surface !== 'claude-core' || binding.shape !== 'project-skill-directory'
    || !discovery || discovery.adapterId !== 'claude-project-discovery'
    || discovery.adapterVersion !== '1.0.0') {
    return blocked('Claude project probe requires a concrete receipt Host binding for the Claude discovery adapter');
  }
  if (!Array.isArray(bindingPaths) || bindingPaths.length === 0 || !structural.outputRoot) {
    return blocked('Claude project probe requires receipt-owned discovery paths');
  }
  for (const entry of bindingPaths) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.target !== 'string') return blocked('Claude project probe found an invalid discovery binding path');
    const target = path.join(root, entry.path);
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isSymbolicLink() || fs.readlinkSync(target) !== entry.target) return blocked(`Claude discovery binding is not the receipt-owned symlink: ${entry.path}`);
      if (!fs.existsSync(target)) return blocked(`Claude discovery binding target is unavailable: ${entry.path}`);
    } catch (_) {
      return blocked(`Claude discovery binding is unavailable: ${entry.path}`);
    }
  }
  const planFingerprint = evidenceFingerprint(receipt.planFingerprint);
  const artifactFingerprint = evidenceFingerprint(receipt.artifactFingerprint);
  const identity = {
    adapter: { id: 'claude-project-discovery', version: '1.0.0' },
    planFingerprint,
    artifactFingerprint,
    artifacts: [
      { path: '<project-root>/.agents/.dhpk-installed.json', version: null },
      ...bindingPaths.map((entry) => ({ path: `<project-root>/${entry.path}`, version: null })),
    ],
  };
  if (!execute) {
    return {
      status: 'NOT_RUN',
      reason: 'Claude project discovery runtime probe is opt-in; pass --execute on an isolated runner',
      commands: [command],
      checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(),
      ...identity,
    };
  }

  const tempHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-project-home-')));
  const stagingRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-project-artifact-')));
  const stagedProject = path.join(stagingRoot, 'project');
  const workspace = path.join(stagingRoot, 'workspace');
  const env = probeEnvironment(tempHome);
  const limits = boundedCodexLimits();
  try {
    const resolution = resolveExecutable('claude', env.PATH);
    if (!resolution) return { status: 'UNAVAILABLE', reason: 'claude CLI is not installed', commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    if (resolution.blocked) return { status: 'BLOCKED', reason: resolution.blocked, commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    assertPhysicalProjectRoot(root, 'Claude project artifact');
    fs.cpSync(root, stagedProject, { recursive: true, dereference: false });
    assertPhysicalProjectRoot(stagedProject, 'staged Claude project artifact');
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const sandboxOptions = {
      env,
      cwd: stagedProject,
      pathValue: env.PATH,
      writablePaths: [workspace, env.HOME],
      privateRoot: os.tmpdir(),
      timeoutMs: limits.timeoutMs,
      maxOutputBytes: limits.maxOutputBytes,
    };
    const result = executeWithSandbox(resolution.path, ['-p', CLAUDE_PROJECT_DISCOVERY_PROMPT, '--output-format', 'text'], sandboxOptions);
    if (result.error && result.error.code === 'ETIMEDOUT') {
      terminateSandboxProcess(result);
      return { status: 'BLOCKED', reason: `Claude project probe timed out after ${limits.timeoutMs} ms`, commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    if (result.error && result.error.code === 'ENOBUFS') {
      terminateSandboxProcess(result);
      return { status: 'BLOCKED', reason: `Claude project probe output exceeded ${limits.maxOutputBytes} bytes`, commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    if (result.error && ['DHPK_NETWORK_SANDBOX_UNAVAILABLE', 'DHPK_SANDBOX_PATH_UNSAFE'].includes(result.error.code)) {
      return { status: 'BLOCKED', reason: result.error.message, commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    if (result.error) return { status: 'UNAVAILABLE', reason: `claude project probe unavailable: ${redactSensitiveText(String(result.error.message || result.error), { maxLength: 800 })}`, commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    if (result.status !== 0) {
      const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      const lower = output.toLowerCase();
      if (/unknown argument|unknown flag|flag provided but not defined/.test(lower)) return { status: 'SKIP_INCOMPATIBLE', reason: 'claude CLI does not support the bounded project skill probe route', diagnostic: diagnostic(result), commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
      if (/authentication|unauthorized|api key|credential|network|connection|timed out|timeout|dns|resolve/.test(lower)) return { status: 'UNAVAILABLE', reason: 'claude project probe is unavailable in the isolated runtime', diagnostic: diagnostic(result), commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
      return { status: 'FAIL', reason: `claude project probe failed with exit ${result.status}`, diagnostic: diagnostic(result), commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    }
    if (String(result.stdout || '').trim() !== 'CLAUDE_PROJECT_SMOKE_OK') return { status: 'FAIL', reason: 'claude project probe did not return the exact CLAUDE_PROJECT_SMOKE_OK marker', diagnostic: diagnostic(result), commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
    return { status: 'PASS', reason: 'bounded Claude project probe returned CLAUDE_PROJECT_SMOKE_OK', network: 'disabled', commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
  } catch (error) {
    return { status: 'BLOCKED', reason: `Claude project probe could not start: ${redactSensitiveText(String(error && error.message ? error.message : error), { maxLength: 800 })}`, commands: [command], checkedClaims: CLAUDE_PROJECT_PROBE_CLAIMS.slice(), ...identity };
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function validatePackage(platform, root, inventoryPath = null) {
  if (platform === 'agy-project') {
    return validateRelocatableAgentsSkillsProjection({ projectRoot: root });
  }
  if (platform === 'claude-project') {
    return validateRelocatableAgentsSkillsProjection({ projectRoot: root });
  }
  let inventory = null;
  if (platform === 'cursor' && inventoryPath) {
    inventory = JSON.parse(fs.readFileSync(path.resolve(inventoryPath), 'utf8'));
  }
  const result = platform === 'codex' || platform === 'agent-plugin'
    ? validateAgentPluginPackage(root)
    : validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor', inventory });
  return result;
}

function normalizedProbeEvidence(platform, manifest, result, version) {
  const surface = platform === 'codex'
    ? 'codex-marketplace'
    : platform === 'agent-plugin'
      ? 'agent-plugin'
      : platform === 'agy-project'
        ? 'agy-plugin'
        : platform === 'claude-project'
          ? 'claude-project'
        : 'cursor-plugin';
  const evidence = normalizeConsumerEvidence({
    stage: 'CONSUMER',
    producer: 'consumer-platform-probe',
    adapter: result.adapter || { id: platform === 'agy-project' ? 'agy-project-direct-file' : 'consumer-platform-probe', version: '1.0.0' },
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
      checkedClaims: result.checkedClaims || (platform === 'agy-project'
        ? ['project-artifact-structure', 'project-agent-direct-file', 'consumer-route']
        : platform === 'claude-project'
          ? CLAUDE_PROJECT_PROBE_CLAIMS.slice()
        : ['package-manifest', 'consumer-route']),
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
  const lexicalRoot = path.resolve(args.packageRoot);
  let root = lexicalRoot;
  try { root = fs.realpathSync(lexicalRoot); } catch (_) { /* preflight reports a missing root below */ }
  try {
    // Preflight the complete tree before reading a caller-controlled manifest;
    // this bounds bytes/entries and rejects symlinks, including generated
    // bytecode paths that identity fingerprints intentionally omit.
    if (args.platform === 'agy-project' || args.platform === 'claude-project') assertPhysicalProjectRoot(root, `${args.platform} artifact`);
    else assertPhysicalPackageRoot(root, `${args.platform} package`);
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
  const manifest = args.platform === 'agy-project' || args.platform === 'claude-project' ? null : packageManifest(args.platform, root);
  if (args.platform !== 'agy-project' && args.platform !== 'claude-project' && !manifest) emit({ platform: args.platform, status: 'BLOCKED', packageRoot: root, reason: 'package manifest is missing', commands: [] }, 1);
  if (args.platform !== 'agy-project' && args.platform !== 'claude-project' && manifest.error) emit({ platform: args.platform, status: 'FAIL', packageRoot: root, reason: manifest.error, commands: [] }, 1);
  let structural;
  try {
    structural = validatePackage(args.platform, root, args.inventory || null);
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
      : args.platform === 'agy-project'
        ? runAgyProjectProbe(root, structural, args.execute)
        : args.platform === 'claude-project'
          ? runClaudeProjectProbe(root, structural, args.execute)
        : runCursorProbe(root, args.execute);
  if (!STATUSES.includes(result.status)) emit({ platform: args.platform, status: 'FAIL', packageRoot: root, reason: `unknown probe status ${result.status}` }, 1);
  let normalized;
  try {
    normalized = normalizedProbeEvidence(args.platform, manifest, result, args.version || null);
  } catch (error) {
    emit({ platform: args.platform, packageRoot: root, manifest: manifest && manifest.path || null, version: args.version || null, ...result, normalizationError: redactSensitiveText(String(error && error.message ? error.message : error), { maxLength: 800 }) }, 1);
  }
  emit({ platform: args.platform, packageRoot: root, manifest: manifest && manifest.path || null, version: args.version || null, ...result, ...normalized }, ['FAIL', 'BLOCKED'].includes(result.status) ? 1 : 0);
}

main();
