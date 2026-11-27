'use strict';

// Cross-version release rehearsal (#1587): resolves v(N-1) from git history,
// materializes a clean baseline checkout, builds/installs baseline packages,
// and exercises v(N-1) -> HEAD upgrade, idempotent rerun, rollback, marketplace
// path migration (generated/ -> dist/), Cursor local plugin link validation,
// AGY Package Receipt lifecycle, and dual-layer Duplicate Discovery without
// masking probe failures or rewriting unexecuted live checks to PASS.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hostCliProbeEvidence, runHostCliProbe } = require('./host-cli-probe');
const { redactSensitiveText } = require('./redaction');
const { createDuplicateDiscoveryReport } = require('./duplicate-discovery');

const SCHEMA = 'dhpk.release-rehearsal.v1';
const SEMVER_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const DEFAULT_STEP_TIMEOUT_MS = 120_000;
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const GIT_OVERRIDE_ENV_KEYS = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
]);

function parseSemver(value) {
  const match = SEMVER_RE.exec(String(value || '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left, right) {
  const a = Array.isArray(left) ? left : parseSemver(left);
  const b = Array.isArray(right) ? right : parseSemver(right);
  if (!a || !b) throw new Error(`invalid SemVer comparison: '${left}' vs '${right}'`);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function stripGitEnv(env) {
  const clean = { ...env };
  for (const key of GIT_OVERRIDE_ENV_KEYS) delete clean[key];
  return clean;
}

function buildSandboxEnv(baseEnv, sandboxHome, workRoot) {
  const clean = stripGitEnv(baseEnv || process.env);
  clean.HOME = sandboxHome;
  clean.USERPROFILE = sandboxHome;
  clean.CODEX_HOME = path.join(sandboxHome, '.codex');
  clean.XDG_CONFIG_HOME = path.join(sandboxHome, '.config');
  clean.XDG_DATA_HOME = path.join(sandboxHome, '.local', 'share');
  clean.XDG_CACHE_HOME = path.join(sandboxHome, '.cache');
  clean.GIT_CONFIG_GLOBAL = path.join(workRoot, 'empty.gitconfig');
  return clean;
}

function invokeCli(command, args, {
  cwd,
  env = process.env,
  timeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  maxBuffer = DEFAULT_MAX_BUFFER_BYTES,
  probeRunner = runHostCliProbe,
} = {}) {
  const result = probeRunner(command, args, { cwd, env, timeoutMs, maxBuffer });
  const evidence = hostCliProbeEvidence(result, redactSensitiveText);
  return {
    command: result.command,
    args: [...args],
    exitCode: evidence.exitCode,
    signal: evidence.signal,
    timedOut: evidence.timedOut,
    durationMs: evidence.durationMs,
    stdoutTail: evidence.stdoutTail,
    stderrTail: evidence.stderrTail,
    stdout: result.stdout,
    stderr: result.stderr,
    errorCode: result.error && result.error.code ? result.error.code : null,
    errorMessage: result.error && result.error.message ? redactSensitiveText(result.error.message) : null,
    outputLimited: Boolean(result.outputLimited),
    reapFailed: Boolean(result.reapFailed),
    ok: !result.error && !result.timedOut && !result.outputLimited && !result.reapFailed && result.exitCode === 0,
  };
}

function compactProbe(run) {
  return {
    command: run.command,
    args: run.args,
    exitCode: run.exitCode,
    signal: run.signal,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    errorCode: run.errorCode,
    stdoutTail: run.stdoutTail,
    stderrTail: run.stderrTail,
  };
}

function resolveTargetVersion(repoRoot, explicitVersion = null) {
  if (explicitVersion) {
    if (!parseSemver(explicitVersion)) {
      throw new Error(`target version must match X.Y.Z (got '${explicitVersion}')`);
    }
    return explicitVersion;
  }
  const pkg = readJsonSafe(path.join(repoRoot, 'package.json'));
  const plugin = readJsonSafe(path.join(repoRoot, '.claude-plugin', 'plugin.json'));
  const version = (pkg && pkg.version) || (plugin && plugin.version) || '';
  if (!parseSemver(version)) {
    throw new Error(`cannot resolve valid X.Y.Z version from repository manifests (got '${version}')`);
  }
  return version;
}

function resolvePriorReleaseTag(repoRoot, {
  targetVersion,
  priorTag = null,
  env = process.env,
  probeRunner = runHostCliProbe,
} = {}) {
  const cleanEnv = stripGitEnv(env);
  const probes = [];
  const headProbe = invokeCli('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { cwd: repoRoot, env: cleanEnv, probeRunner });
  probes.push(compactProbe(headProbe));
  if (!headProbe.ok) {
    return {
      status: 'BLOCKED',
      error: `unable to resolve HEAD commit: ${headProbe.stderrTail || headProbe.errorMessage || `exit ${headProbe.exitCode}`}`,
      probes,
    };
  }
  const headCommit = headProbe.stdout.trim();

  const shallowProbe = invokeCli('git', ['-C', repoRoot, 'rev-parse', '--is-shallow-repository'], { cwd: repoRoot, env: cleanEnv, probeRunner });
  probes.push(compactProbe(shallowProbe));
  const isShallow = shallowProbe.ok && shallowProbe.stdout.trim() === 'true';

  let resolvedTag = priorTag;
  if (!resolvedTag) {
    const tagsProbe = invokeCli('git', ['-C', repoRoot, 'tag', '--merged', 'HEAD', '--list', 'v*'], { cwd: repoRoot, env: cleanEnv, probeRunner });
    probes.push(compactProbe(tagsProbe));
    if (!tagsProbe.ok) {
      return {
        status: 'FAIL',
        headCommit,
        error: `git tag lookup failed (exit ${tagsProbe.exitCode}): ${tagsProbe.stderrTail || tagsProbe.errorMessage || ''}`,
        probes,
      };
    }
    const candidates = tagsProbe.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((tag) => {
        const match = SEMVER_TAG_RE.exec(tag);
        if (!match) return null;
        const version = `${match[1]}.${match[2]}.${match[3]}`;
        return { tag, version, parsed: [Number(match[1]), Number(match[2]), Number(match[3])] };
      })
      .filter(Boolean)
      .filter((entry) => compareSemver(entry.parsed, targetVersion) < 0)
      .sort((a, b) => compareSemver(b.parsed, a.parsed));

    if (candidates.length === 0) {
      return {
        status: 'BLOCKED',
        headCommit,
        error: isShallow
          ? `no prior release tag < v${targetVersion} found in shallow git clone; fetch full history (fetch-depth: 0)`
          : `no prior release tag < v${targetVersion} found in git history reachable from HEAD`,
        probes,
      };
    }
    resolvedTag = candidates[0].tag;
  }

  const tagMatch = SEMVER_TAG_RE.exec(resolvedTag);
  if (!tagMatch) {
    return {
      status: 'BLOCKED',
      headCommit,
      error: `prior release tag must match vX.Y.Z (got '${resolvedTag}')`,
      probes,
    };
  }
  const priorVersion = `${tagMatch[1]}.${tagMatch[2]}.${tagMatch[3]}`;
  const commitProbe = invokeCli('git', ['-C', repoRoot, 'rev-parse', '--verify', `${resolvedTag}^{commit}`], { cwd: repoRoot, env: cleanEnv, probeRunner });
  probes.push(compactProbe(commitProbe));
  if (!commitProbe.ok) {
    return {
      status: 'BLOCKED',
      headCommit,
      error: `unable to resolve commit for prior tag '${resolvedTag}': ${commitProbe.stderrTail || commitProbe.errorMessage || ''}`,
      probes,
    };
  }

  return {
    status: 'PASS',
    priorTag: resolvedTag,
    priorVersion,
    priorCommit: commitProbe.stdout.trim(),
    headCommit,
    probes,
  };
}

function buildOnDemandPackages(checkoutRoot, version, outBase, env, probeRunner) {
  const surfaces = [
    ['agent-plugin', 'dhpk-agent'],
    ['cursor-plugin', 'dhpk-cursor'],
    ['agy-plugin', 'dhpk-agy'],
  ];
  const probes = [];
  const outputs = {};
  fs.mkdirSync(outBase, { recursive: true });
  for (const [surface, dirName] of surfaces) {
    const outDir = path.join(outBase, dirName);
    const run = invokeCli(
      path.join(checkoutRoot, 'bin', 'dhpk'),
      ['distribution', 'build', surface, '--output', outDir, '--version', version, '--json'],
      { cwd: checkoutRoot, env, probeRunner },
    );
    probes.push(compactProbe(run));
    if (!run.ok) {
      return {
        status: 'FAIL',
        outputs,
        probes,
        error: `failed to build ${surface} (${version}): exit=${run.exitCode} timedOut=${run.timedOut} ${run.stderrTail || run.errorMessage || ''}`.trim(),
      };
    }
    outputs[surface] = outDir;
  }
  return { status: 'PASS', outputs, probes };
}

function runProjectSyncPhase({
  host,
  installerRelPath,
  receiptRelPath,
  thirdPartySkillDir,
  baselineRepo,
  repoRoot,
  projectDir,
  sandboxEnv,
  priorVersion,
  targetVersion,
  probeRunner,
}) {
  const thirdPartyFile = path.join(projectDir, thirdPartySkillDir, 'SKILL.md');
  fs.mkdirSync(path.dirname(thirdPartyFile), { recursive: true });
  fs.writeFileSync(thirdPartyFile, `# third-party-${host}\n`);

  const runInstaller = (sourceRoot, args) => invokeCli(
    'bash',
    [path.join(sourceRoot, installerRelPath), ...args],
    {
      cwd: projectDir,
      env: { ...sandboxEnv, DHPK_INSTALLER_ROOT: sourceRoot },
      probeRunner,
    },
  );
  const readReceipt = () => readJsonSafe(path.join(projectDir, receiptRelPath));

  const state = {
    status: 'PASS',
    baseline: null,
    upgrade: null,
    rerun: null,
    rollback: null,
  };

  return {
    installBaseline() {
      const baselineRun = runInstaller(baselineRepo, ['--force']);
      const baselineReceipt = readReceipt();
      const ok = baselineRun.ok && baselineReceipt && baselineReceipt.plugin_version === priorVersion;
      state.baseline = {
        status: ok ? 'PASS' : 'FAIL',
        version: baselineReceipt ? baselineReceipt.plugin_version : null,
        probe: compactProbe(baselineRun),
      };
      if (!ok) {
        state.status = 'FAIL';
        state.error = `${host} baseline install (${priorVersion}) failed: exit=${baselineRun.exitCode} timedOut=${baselineRun.timedOut} receiptVersion=${baselineReceipt && baselineReceipt.plugin_version}`;
      }
      return ok;
    },
    upgradeToHead() {
      if (state.status !== 'PASS') return false;
      const upgradeRun = runInstaller(repoRoot, ['--update', '--force']);
      const upgradeReceipt = readReceipt();
      const ok = upgradeRun.ok && upgradeReceipt && upgradeReceipt.plugin_version === targetVersion && fs.existsSync(thirdPartyFile);
      state.upgrade = {
        status: ok ? 'PASS' : 'FAIL',
        version: upgradeReceipt ? upgradeReceipt.plugin_version : null,
        probe: compactProbe(upgradeRun),
      };
      if (!ok) {
        state.status = 'FAIL';
        state.error = `${host} upgrade (${priorVersion} -> ${targetVersion}) failed: exit=${upgradeRun.exitCode} timedOut=${upgradeRun.timedOut} receiptVersion=${upgradeReceipt && upgradeReceipt.plugin_version}`;
      }
      return ok;
    },
    rerunHead() {
      if (state.status !== 'PASS') return false;
      const rerunRun = runInstaller(repoRoot, ['--update', '--force']);
      const rerunReceipt = readReceipt();
      const ok = rerunRun.ok && rerunReceipt && rerunReceipt.plugin_version === targetVersion && fs.existsSync(thirdPartyFile);
      state.rerun = {
        status: ok ? 'PASS' : 'FAIL',
        version: rerunReceipt ? rerunReceipt.plugin_version : null,
        probe: compactProbe(rerunRun),
      };
      if (!ok) {
        state.status = 'FAIL';
        state.error = `${host} idempotent rerun (${targetVersion}) failed: exit=${rerunRun.exitCode} timedOut=${rerunRun.timedOut}`;
      }
      return ok;
    },
    rollback() {
      if (state.status !== 'PASS') return false;
      const rollbackRun = runInstaller(repoRoot, ['--uninstall', '--force']);
      const receiptGone = !fs.existsSync(path.join(projectDir, receiptRelPath));
      const thirdPartyPreserved = fs.existsSync(thirdPartyFile);
      const ok = rollbackRun.ok && receiptGone && thirdPartyPreserved;
      state.rollback = {
        status: ok ? 'PASS' : 'FAIL',
        receiptRemoved: receiptGone,
        thirdPartyPreserved,
        probe: compactProbe(rollbackRun),
      };
      if (!ok) {
        state.status = 'FAIL';
        state.error = `${host} rollback failed: exit=${rollbackRun.exitCode} timedOut=${rollbackRun.timedOut} receiptRemoved=${receiptGone} thirdPartyPreserved=${thirdPartyPreserved}`;
      }
      return ok;
    },
    result() {
      return state;
    },
  };
}

function replaceSymlinkAtomically(target, linkPath) {
  const parent = path.dirname(linkPath);
  fs.mkdirSync(parent, { recursive: true });
  const tempLink = path.join(parent, `.tmp-${path.basename(linkPath)}-${process.pid}`);
  try { fs.unlinkSync(tempLink); } catch (_) { /* ignore */ }
  fs.symlinkSync(target, tempLink);
  fs.renameSync(tempLink, linkPath);
}

function validateCursorLocalLink(linkPath, expectedTargetDir, expectedVersion, validatorRoot, surface, sandboxEnv, probeRunner) {
  const stat = fs.lstatSync(linkPath);
  if (!stat.isSymbolicLink()) {
    return { ok: false, error: `Cursor local plugin link is not a symlink: ${linkPath}` };
  }
  const resolved = fs.realpathSync(linkPath);
  if (resolved !== fs.realpathSync(expectedTargetDir)) {
    return { ok: false, error: `Cursor local plugin link resolves to unexpected target: ${resolved}` };
  }
  const manifestRel = surface === 'agent-plugin' ? 'plugin.json' : path.join('.cursor-plugin', 'plugin.json');
  const manifest = readJsonSafe(path.join(resolved, manifestRel));
  const version = manifest && manifest.version;
  if (version !== expectedVersion) {
    return { ok: false, error: `Cursor local ${surface} link manifest version '${version}' !== '${expectedVersion}'` };
  }
  const run = invokeCli(
    path.join(validatorRoot, 'bin', 'dhpk'),
    ['distribution', surface, 'validate', '--output', resolved, '--json'],
    { cwd: validatorRoot, env: sandboxEnv, probeRunner },
  );
  if (!run.ok) {
    return {
      ok: false,
      version,
      probe: compactProbe(run),
      error: `Cursor local ${surface} package validation failed: exit=${run.exitCode} timedOut=${run.timedOut}`,
    };
  }
  return { ok: true, version, probe: compactProbe(run) };
}

function runCursorLocalPluginsLifecycle({
  baselineRepo,
  repoRoot,
  baselinePackages,
  headPackages,
  projectDir,
  sandboxHome,
  sandboxEnv,
  priorVersion,
  targetVersion,
  probeRunner,
}) {
  const localDir = path.join(sandboxHome, '.cursor', 'plugins', 'local');
  const agentLink = path.join(localDir, 'dhpk-agent');
  const cursorLink = path.join(localDir, 'dhpk-cursor');
  const foreignPluginManifest = path.join(localDir, 'other-plugin', 'plugin.json');
  fs.mkdirSync(path.dirname(foreignPluginManifest), { recursive: true });
  fs.writeFileSync(foreignPluginManifest, JSON.stringify({ name: 'other-plugin', version: '0.1.0' }));

  // Seed stale marketplace hash cache to exercise cache-drift plan warning without blocking.
  const staleCacheManifest = path.join(sandboxHome, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk', 'stalehash', 'plugin.json');
  fs.mkdirSync(path.dirname(staleCacheManifest), { recursive: true });
  fs.writeFileSync(staleCacheManifest, JSON.stringify({ name: 'dhpk', version: priorVersion }));

  // 1. Baseline links (v(N-1))
  replaceSymlinkAtomically(baselinePackages['agent-plugin'], agentLink);
  replaceSymlinkAtomically(baselinePackages['cursor-plugin'], cursorLink);
  const baseAgent = validateCursorLocalLink(agentLink, baselinePackages['agent-plugin'], priorVersion, baselineRepo, 'agent-plugin', sandboxEnv, probeRunner);
  const baseCursor = validateCursorLocalLink(cursorLink, baselinePackages['cursor-plugin'], priorVersion, baselineRepo, 'cursor-plugin', sandboxEnv, probeRunner);
  if (!baseAgent.ok || !baseCursor.ok) {
    return {
      status: 'FAIL',
      baseline: { status: 'FAIL', versions: { agent: baseAgent.version || null, cursor: baseCursor.version || null }, probes: [baseAgent.probe, baseCursor.probe].filter(Boolean) },
      error: baseAgent.error || baseCursor.error,
    };
  }

  // 2. Upgrade links (v(N-1) -> HEAD)
  replaceSymlinkAtomically(headPackages['agent-plugin'], agentLink);
  replaceSymlinkAtomically(headPackages['cursor-plugin'], cursorLink);
  const headAgent = validateCursorLocalLink(agentLink, headPackages['agent-plugin'], targetVersion, repoRoot, 'agent-plugin', sandboxEnv, probeRunner);
  const headCursor = validateCursorLocalLink(cursorLink, headPackages['cursor-plugin'], targetVersion, repoRoot, 'cursor-plugin', sandboxEnv, probeRunner);
  const planProbe = invokeCli(
    'bash',
    [path.join(repoRoot, 'scripts', 'hooks', 'install-cursor-harness.sh'), '--update', '--plan', '--json', '--force'],
    { cwd: projectDir, env: { ...sandboxEnv, DHPK_INSTALLER_ROOT: repoRoot }, probeRunner },
  );
  let planWarnings = [];
  try {
    planWarnings = (JSON.parse(planProbe.stdout || '{}').warnings || []).map((w) => w.code).filter(Boolean);
  } catch (_) { /* handled below */ }
  if (!headAgent.ok || !headCursor.ok || !planProbe.ok) {
    return {
      status: 'FAIL',
      baseline: { status: 'PASS', versions: { agent: baseAgent.version, cursor: baseCursor.version }, probes: [baseAgent.probe, baseCursor.probe] },
      upgrade: { status: 'FAIL', versions: { agent: headAgent.version || null, cursor: headCursor.version || null }, planWarnings, probes: [headAgent.probe, headCursor.probe, compactProbe(planProbe)].filter(Boolean) },
      error: headAgent.error || headCursor.error || `cursor local plugin plan failed: exit=${planProbe.exitCode} timedOut=${planProbe.timedOut}`,
    };
  }

  // 3. Idempotent rerun at HEAD
  replaceSymlinkAtomically(headPackages['agent-plugin'], agentLink);
  replaceSymlinkAtomically(headPackages['cursor-plugin'], cursorLink);
  const rerunAgent = validateCursorLocalLink(agentLink, headPackages['agent-plugin'], targetVersion, repoRoot, 'agent-plugin', sandboxEnv, probeRunner);
  const rerunCursor = validateCursorLocalLink(cursorLink, headPackages['cursor-plugin'], targetVersion, repoRoot, 'cursor-plugin', sandboxEnv, probeRunner);
  if (!rerunAgent.ok || !rerunCursor.ok) {
    return {
      status: 'FAIL',
      baseline: { status: 'PASS', versions: { agent: baseAgent.version, cursor: baseCursor.version }, probes: [baseAgent.probe, baseCursor.probe] },
      upgrade: { status: 'PASS', versions: { agent: headAgent.version, cursor: headCursor.version }, planWarnings, probes: [headAgent.probe, headCursor.probe, compactProbe(planProbe)] },
      rerun: { status: 'FAIL', probes: [rerunAgent.probe, rerunCursor.probe].filter(Boolean) },
      error: rerunAgent.error || rerunCursor.error,
    };
  }

  // 4. Rollback to v(N-1) and clean up dhpk links while preserving foreign plugins
  replaceSymlinkAtomically(baselinePackages['agent-plugin'], agentLink);
  replaceSymlinkAtomically(baselinePackages['cursor-plugin'], cursorLink);
  const rbAgent = validateCursorLocalLink(agentLink, baselinePackages['agent-plugin'], priorVersion, baselineRepo, 'agent-plugin', sandboxEnv, probeRunner);
  const rbCursor = validateCursorLocalLink(cursorLink, baselinePackages['cursor-plugin'], priorVersion, baselineRepo, 'cursor-plugin', sandboxEnv, probeRunner);
  fs.unlinkSync(agentLink);
  fs.unlinkSync(cursorLink);
  const foreignPreserved = fs.existsSync(foreignPluginManifest);
  const rollbackOk = rbAgent.ok && rbCursor.ok && foreignPreserved;

  return {
    status: rollbackOk ? 'PASS' : 'FAIL',
    baseline: { status: 'PASS', versions: { agent: baseAgent.version, cursor: baseCursor.version }, probes: [baseAgent.probe, baseCursor.probe] },
    upgrade: { status: 'PASS', versions: { agent: headAgent.version, cursor: headCursor.version }, planWarnings, probes: [headAgent.probe, headCursor.probe, compactProbe(planProbe)] },
    rerun: { status: 'PASS', probes: [rerunAgent.probe, rerunCursor.probe] },
    rollback: {
      status: rollbackOk ? 'PASS' : 'FAIL',
      foreignPreserved,
      restoredVersions: { agent: rbAgent.version || null, cursor: rbCursor.version || null },
      probes: [rbAgent.probe, rbCursor.probe].filter(Boolean),
    },
    ...(rollbackOk ? {} : { error: rbAgent.error || rbCursor.error || 'Cursor local plugin rollback did not preserve foreign plugin' }),
  };
}

function runAgyLifecycle({
  baselineRepo,
  repoRoot,
  baselinePackages,
  headPackages,
  sandboxHome,
  sandboxEnv,
  priorVersion,
  targetVersion,
  probeRunner,
}) {
  const agyTarget = path.join(sandboxHome, '.gemini', 'antigravity-cli', 'plugins', 'dhpk');
  const runAgyCli = (scriptRoot, args) => invokeCli(
    process.execPath,
    [path.join(scriptRoot, 'scripts', 'ci', 'install-agy-plugin.js'), ...args],
    { cwd: scriptRoot, env: sandboxEnv, probeRunner },
  );
  const readReceipt = () => readJsonSafe(path.join(agyTarget, 'provenance.json'));

  // 1. Baseline install (v(N-1))
  const baseInstall = runAgyCli(baselineRepo, ['install', '--source', baselinePackages['agy-plugin'], '--target', agyTarget, '--json']);
  const baseReceipt = readReceipt();
  if (!baseInstall.ok || !baseReceipt || baseReceipt.sourceVersion !== priorVersion) {
    return {
      status: 'FAIL',
      baseline: { status: 'FAIL', receiptVersion: baseReceipt ? baseReceipt.sourceVersion : null, probe: compactProbe(baseInstall) },
      error: `AGY baseline install (${priorVersion}) failed: exit=${baseInstall.exitCode} timedOut=${baseInstall.timedOut} ${baseInstall.stderrTail || baseInstall.stdoutTail}`,
    };
  }

  // Seed a foreign user note that update and rollback must preserve.
  const userNote = path.join(agyTarget, 'user-custom-note.txt');
  fs.writeFileSync(userNote, 'preserve me across update and rollback\n');

  // 2. Plan + Update v(N-1) -> HEAD (Package Receipt update)
  const planRun = runAgyCli(repoRoot, ['plan', '--source', headPackages['agy-plugin'], '--target', agyTarget, '--json']);
  let planReport = null;
  try { planReport = JSON.parse(planRun.stdout || '{}'); } catch (_) { planReport = null; }
  const planValid = !planRun.errorCode && !planRun.timedOut && (planRun.exitCode === 0 || planRun.exitCode === 1) && planReport && ['READY', 'CHANGES_PENDING'].includes(planReport.verdict);
  if (!planValid) {
    return {
      status: 'FAIL',
      baseline: { status: 'PASS', receiptVersion: baseReceipt.sourceVersion, probe: compactProbe(baseInstall) },
      planUpgrade: { status: 'FAIL', verdict: planReport && planReport.verdict, probe: compactProbe(planRun) },
      error: `AGY upgrade plan failed: exit=${planRun.exitCode} timedOut=${planRun.timedOut} verdict=${planReport && planReport.verdict}`,
    };
  }

  const updateRun = runAgyCli(repoRoot, ['update', '--source', headPackages['agy-plugin'], '--target', agyTarget, '--json']);
  const upgradedReceipt = readReceipt();
  const userPreservedOnUpdate = fs.existsSync(userNote);
  if (!updateRun.ok || !upgradedReceipt || upgradedReceipt.sourceVersion !== targetVersion || !userPreservedOnUpdate) {
    return {
      status: 'FAIL',
      baseline: { status: 'PASS', receiptVersion: baseReceipt.sourceVersion, probe: compactProbe(baseInstall) },
      planUpgrade: { status: 'PASS', verdict: planReport.verdict, probe: compactProbe(planRun) },
      upgrade: { status: 'FAIL', receiptVersion: upgradedReceipt ? upgradedReceipt.sourceVersion : null, userFilePreserved: userPreservedOnUpdate, probe: compactProbe(updateRun) },
      error: `AGY Package Receipt update (${priorVersion} -> ${targetVersion}) failed: exit=${updateRun.exitCode} timedOut=${updateRun.timedOut}`,
    };
  }

  // 3. Idempotent rerun at HEAD
  const rerunPlan = runAgyCli(repoRoot, ['plan', '--source', headPackages['agy-plugin'], '--target', agyTarget, '--json']);
  let rerunPlanReport = null;
  try { rerunPlanReport = JSON.parse(rerunPlan.stdout || '{}'); } catch (_) { rerunPlanReport = null; }
  const rerunUpdate = runAgyCli(repoRoot, ['update', '--source', headPackages['agy-plugin'], '--target', agyTarget, '--json']);
  const rerunReceipt = readReceipt();
  if (!rerunPlan.ok || !rerunPlanReport || rerunPlanReport.verdict !== 'READY' || !rerunUpdate.ok || !rerunReceipt || rerunReceipt.sourceVersion !== targetVersion) {
    return {
      status: 'FAIL',
      baseline: { status: 'PASS', receiptVersion: baseReceipt.sourceVersion, probe: compactProbe(baseInstall) },
      planUpgrade: { status: 'PASS', verdict: planReport.verdict, probe: compactProbe(planRun) },
      upgrade: { status: 'PASS', receiptVersion: upgradedReceipt.sourceVersion, userFilePreserved: true, probe: compactProbe(updateRun) },
      rerun: { status: 'FAIL', planVerdict: rerunPlanReport && rerunPlanReport.verdict, probes: [compactProbe(rerunPlan), compactProbe(rerunUpdate)] },
      error: `AGY idempotent rerun failed: planExit=${rerunPlan.exitCode} updateExit=${rerunUpdate.exitCode}`,
    };
  }

  // 4. Rollback + baseline restore verification + clean rollback
  const rollbackRun = runAgyCli(repoRoot, ['rollback', '--target', agyTarget, '--json']);
  const receiptRemoved = !fs.existsSync(path.join(agyTarget, 'provenance.json'));
  const userPreservedOnRollback = fs.existsSync(userNote);
  const restoreRun = runAgyCli(baselineRepo, ['install', '--source', baselinePackages['agy-plugin'], '--target', agyTarget, '--json']);
  const restoredReceipt = readReceipt();
  const cleanRollbackRun = runAgyCli(baselineRepo, ['rollback', '--target', agyTarget, '--json']);
  const rollbackOk = rollbackRun.ok && receiptRemoved && userPreservedOnRollback && restoreRun.ok && restoredReceipt && restoredReceipt.sourceVersion === priorVersion && cleanRollbackRun.ok && fs.existsSync(userNote);

  return {
    status: rollbackOk ? 'PASS' : 'FAIL',
    baseline: { status: 'PASS', receiptVersion: baseReceipt.sourceVersion, probe: compactProbe(baseInstall) },
    planUpgrade: { status: 'PASS', verdict: planReport.verdict, probe: compactProbe(planRun) },
    upgrade: { status: 'PASS', receiptVersion: upgradedReceipt.sourceVersion, userFilePreserved: true, probe: compactProbe(updateRun) },
    rerun: { status: 'PASS', planVerdict: rerunPlanReport.verdict, probes: [compactProbe(rerunPlan), compactProbe(rerunUpdate)] },
    rollback: {
      status: rollbackOk ? 'PASS' : 'FAIL',
      receiptRemoved,
      userFilePreserved: userPreservedOnRollback,
      restoredVersion: restoredReceipt ? restoredReceipt.sourceVersion : null,
      probes: [compactProbe(rollbackRun), compactProbe(restoreRun), compactProbe(cleanRollbackRun)],
    },
    ...(rollbackOk ? {} : { error: `AGY Package Receipt rollback failed: exit=${rollbackRun.exitCode} receiptRemoved=${receiptRemoved} restoredVersion=${restoredReceipt && restoredReceipt.sourceVersion}` }),
  };
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

function runMarketplaceMigration({
  repoRoot,
  baselineRepo,
  workRoot,
  sandboxHome,
  sandboxEnv,
  priorVersion,
  targetVersion,
  offline,
  probeRunner,
}) {
  // 1. Structural verification of HEAD .claude-plugin/marketplace.json (generated/ -> dist/)
  const headMarketplacePath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
  const headMarketplace = readJsonSafe(headMarketplacePath);
  const structuralErrors = [];
  const targetSources = [];
  if (!headMarketplace || !Array.isArray(headMarketplace.plugins) || headMarketplace.plugins.length === 0) {
    structuralErrors.push('HEAD .claude-plugin/marketplace.json is missing or has no plugins[]');
  } else {
    for (const entry of headMarketplace.plugins) {
      const src = entry && typeof entry.source === 'string' ? entry.source : '';
      targetSources.push({ name: entry && entry.name, source: src });
      if (!src.startsWith('./dist/claude-marketplace/') || /(?:^|\/)generated(?:\/|$)/.test(src)) {
        structuralErrors.push(`marketplace plugin '${entry && entry.name}' source must migrate to ./dist/claude-marketplace/* (got '${src}')`);
        continue;
      }
      const pkgManifest = readJsonSafe(path.join(repoRoot, src, '.claude-plugin', 'plugin.json'));
      if (!pkgManifest || pkgManifest.version !== targetVersion) {
        structuralErrors.push(`marketplace package '${src}' manifest version '${pkgManifest && pkgManifest.version}' !== '${targetVersion}'`);
      }
    }
  }
  const structuralMigration = {
    status: structuralErrors.length === 0 ? 'PASS' : 'FAIL',
    targetSources,
    errors: structuralErrors,
  };

  // 2. Materialize legacy generated/ marketplace fixture from v(N-1)
  const legacyMarketplace = path.join(workRoot, 'legacy-marketplace');
  const legacyCoreRel = fs.existsSync(path.join(baselineRepo, 'generated', 'claude-marketplace', 'package'))
    ? path.join('generated', 'claude-marketplace', 'package')
    : path.join('dist', 'claude-marketplace', 'package');
  const legacyCoreSrc = path.join(baselineRepo, legacyCoreRel);
  const legacyCoreDest = path.join(legacyMarketplace, 'generated', 'claude-marketplace', 'package');
  if (fs.existsSync(legacyCoreSrc)) {
    copyTree(legacyCoreSrc, legacyCoreDest);
  } else {
    fs.mkdirSync(path.join(legacyCoreDest, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(legacyCoreDest, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: priorVersion }));
  }
  fs.mkdirSync(path.join(legacyMarketplace, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(legacyMarketplace, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({
    name: 'dhpk',
    owner: { name: 'hmj1026' },
    plugins: [{ name: 'dhpk', source: './generated/claude-marketplace/package' }],
  }, null, 2)}\n`);

  const gitInit = invokeCli('git', ['init', '-q'], { cwd: legacyMarketplace, env: sandboxEnv, probeRunner });
  const gitAdd = gitInit.ok ? invokeCli('git', ['add', '-A'], { cwd: legacyMarketplace, env: sandboxEnv, probeRunner }) : gitInit;
  const gitCommit = gitAdd.ok ? invokeCli('git', ['-c', 'user.name=rehearsal', '-c', 'user.email=rehearsal@example.invalid', 'commit', '-q', '-m', 'legacy'], { cwd: legacyMarketplace, env: sandboxEnv, probeRunner }) : gitAdd;
  if (!gitCommit.ok) {
    return {
      status: 'FAIL',
      structuralMigration,
      error: `failed to initialize legacy generated/ marketplace fixture: exit=${gitCommit.exitCode} timedOut=${gitCommit.timedOut}`,
    };
  }

  // 3. Verify install-health.sh resolves generated/ -> dist/ migration cleanly
  const installHealthScript = path.join(repoRoot, 'scripts', 'hooks', '_lib', 'install-health.sh');
  let installHealthMigration = { status: 'SKIPPED', reason: 'install-health.sh or python3 unavailable', probes: [] };
  const pyCheck = invokeCli('python3', ['--version'], { cwd: repoRoot, env: sandboxEnv, probeRunner });
  if (fs.existsSync(installHealthScript) && pyCheck.ok) {
    const claudeDir = path.join(sandboxHome, '.claude', 'plugins');
    fs.mkdirSync(claudeDir, { recursive: true });
    const claudeProject = path.join(workRoot, 'health-project');
    fs.mkdirSync(claudeProject, { recursive: true });
    const runHealth = () => invokeCli(
      'bash',
      ['-c', '. "$1" && dhpk_version_state', '--', installHealthScript],
      { cwd: claudeProject, env: { ...sandboxEnv, DHPK_PLUGINS_DIR: claudeDir, CLAUDE_PROJECT_DIR: claudeProject }, probeRunner },
    );

    fs.writeFileSync(path.join(claudeDir, 'known_marketplaces.json'), JSON.stringify({
      dhpk: { installLocation: legacyMarketplace, source: { source: 'directory' } },
    }));
    fs.writeFileSync(path.join(claudeDir, 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { dhpk_unused: [], 'dhpk@dhpk': [{ scope: 'user', version: priorVersion, installPath: legacyCoreDest }] },
    }));
    const beforeHealth = runHealth();

    // Migrate marketplace installLocation to HEAD (./dist/claude-marketplace/package)
    fs.writeFileSync(path.join(claudeDir, 'known_marketplaces.json'), JSON.stringify({
      dhpk: { installLocation: repoRoot, source: { source: 'directory' } },
    }));
    const midHealth = runHealth();

    fs.writeFileSync(path.join(claudeDir, 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'dhpk@dhpk': [{ scope: 'user', version: targetVersion, installPath: path.join(repoRoot, 'dist', 'claude-marketplace', 'package') }] },
    }));
    const afterHealth = runHealth();

    const beforeOut = beforeHealth.stdout.trim();
    const midOut = midHealth.stdout.trim();
    const afterOut = afterHealth.stdout.trim();
    const healthOk = beforeHealth.ok && midHealth.ok && afterHealth.ok
      && beforeOut.includes(`installed=${priorVersion}`) && beforeOut.includes(`available=${priorVersion}`)
      && midOut.includes(`installed=${priorVersion}`) && midOut.includes(`available=${targetVersion}`)
      && afterOut.includes(`installed=${targetVersion}`) && afterOut.includes(`available=${targetVersion}`) && afterOut.includes('gap=none');

    installHealthMigration = {
      status: healthOk ? 'PASS' : 'FAIL',
      beforeState: beforeOut,
      migratedMarketplaceState: midOut,
      afterState: afterOut,
      probes: [compactProbe(beforeHealth), compactProbe(midHealth), compactProbe(afterHealth)],
    };
    // Clean sandboxed .claude/plugins state before live/CLI claude test
    fs.rmSync(claudeDir, { recursive: true, force: true });
  }

  // 4. Exercise Claude CLI marketplace migration when claude is available (and not --offline)
  let cliMigration = { status: 'NOT_RUN', reason: 'offline rehearsal mode', probes: [] };
  if (!offline) {
    const claudeProject = path.join(workRoot, 'claude-project');
    fs.mkdirSync(claudeProject, { recursive: true });
    const cliProbes = [];
    const runClaude = (args, cwd = claudeProject) => {
      const run = invokeCli('claude', args, { cwd, env: sandboxEnv, probeRunner });
      cliProbes.push(compactProbe(run));
      return run;
    };
    const verProbe = runClaude(['--version']);
    if (verProbe.errorCode === 'ENOENT') {
      cliMigration = { status: 'UNAVAILABLE', reason: 'claude CLI is not installed on PATH', probes: cliProbes };
    } else if (!verProbe.ok) {
      cliMigration = { status: 'FAIL', reason: `claude --version failed (exit=${verProbe.exitCode}, timedOut=${verProbe.timedOut})`, probes: cliProbes };
    } else {
      const strictManifest = path.join(repoRoot, 'dist', 'claude-marketplace', 'package', '.claude-plugin', 'plugin.json');
      const strictRun = runClaude(['plugin', 'validate', strictManifest, '--strict'], repoRoot);
      const addLegacy = strictRun.ok ? runClaude(['plugin', 'marketplace', 'add', legacyMarketplace, '--scope', 'project']) : null;
      const installLegacy = addLegacy && addLegacy.ok ? runClaude(['plugin', 'install', 'dhpk@dhpk', '--scope', 'project']) : null;
      const listLegacy = installLegacy && installLegacy.ok ? runClaude(['plugin', 'list', '--json']) : null;
      let legacyVerified = false;
      if (listLegacy && listLegacy.ok) {
        try {
          const entries = JSON.parse(listLegacy.stdout || '[]');
          const match = entries.find((e) => e && e.id === 'dhpk@dhpk' && (e.scope === 'project' || e.scope === undefined));
          legacyVerified = Boolean(match && match.version === priorVersion && (!match.readFromFolder || String(match.readFromFolder).includes('generated/')));
        } catch (_) { legacyVerified = false; }
      }

      const uninstallLegacy = legacyVerified ? runClaude(['plugin', 'uninstall', 'dhpk@dhpk', '--scope', 'project']) : null;
      const removeLegacyMkt = uninstallLegacy && uninstallLegacy.ok ? runClaude(['plugin', 'marketplace', 'remove', 'dhpk', '--scope', 'project']) : null;
      const addDist = removeLegacyMkt && removeLegacyMkt.ok ? runClaude(['plugin', 'marketplace', 'add', repoRoot, '--scope', 'project']) : null;
      const installDist = addDist && addDist.ok ? runClaude(['plugin', 'install', 'dhpk@dhpk', '--scope', 'project']) : null;
      const rerunDist = installDist && installDist.ok ? runClaude(['plugin', 'install', 'dhpk@dhpk', '--scope', 'project']) : null;
      const listDist = rerunDist && rerunDist.ok ? runClaude(['plugin', 'list', '--json']) : null;
      let distVerified = false;
      if (listDist && listDist.ok) {
        try {
          const entries = JSON.parse(listDist.stdout || '[]');
          const match = entries.find((e) => e && e.id === 'dhpk@dhpk' && (e.scope === 'project' || e.scope === undefined));
          distVerified = Boolean(
            match && match.version === targetVersion
            && (!match.readFromFolder || (String(match.readFromFolder).includes('dist/') && !String(match.readFromFolder).includes('generated/'))),
          );
        } catch (_) { distVerified = false; }
      }

      const rbUninstall = distVerified ? runClaude(['plugin', 'uninstall', 'dhpk@dhpk', '--scope', 'project']) : null;
      const rbRemoveMkt = rbUninstall && rbUninstall.ok ? runClaude(['plugin', 'marketplace', 'remove', 'dhpk', '--scope', 'project']) : null;
      const listAfterRb = rbRemoveMkt && rbRemoveMkt.ok ? runClaude(['plugin', 'list', '--json']) : null;
      let rollbackClean = false;
      if (listAfterRb && listAfterRb.ok) {
        try {
          const entries = JSON.parse(listAfterRb.stdout || '[]');
          rollbackClean = !entries.some((e) => e && e.id === 'dhpk@dhpk' && e.scope === 'project');
        } catch (_) { rollbackClean = false; }
      }

      const cliOk = Boolean(strictRun.ok && legacyVerified && distVerified && rollbackClean);
      cliMigration = {
        status: cliOk ? 'PASS' : 'FAIL',
        reason: cliOk
          ? 'claude CLI verified generated/ -> dist/ marketplace migration, rerun, strict validation, and rollback'
          : 'claude CLI marketplace migration or validation failed',
        probes: cliProbes,
      };
    }
  }

  const stageOk = structuralMigration.status === 'PASS'
    && installHealthMigration.status !== 'FAIL'
    && cliMigration.status !== 'FAIL';

  return {
    status: stageOk ? 'PASS' : 'FAIL',
    structuralMigration,
    installHealthMigration,
    cliMigration,
    ...(stageOk ? {} : {
      error: structuralErrors[0]
        || (installHealthMigration.status === 'FAIL' ? 'install-health.sh marketplace path migration failed' : null)
        || cliMigration.reason,
    }),
  };
}

function runDuplicateDiscoveryCheck({ repoRoot, projectDir, sandboxHome, sandboxEnv, offline, probeRunner }) {
  const codexHome = path.join(sandboxHome, '.codex');
  const script = path.join(repoRoot, 'scripts', 'ci', 'check-duplicate-discovery.js');
  if (fs.existsSync(script)) {
    const args = [
      script,
      '--project-root', projectDir,
      '--home', sandboxHome,
      '--codex-home', codexHome,
      '--host', 'all',
      ...(offline ? ['--offline'] : []),
    ];
    const run = invokeCli(process.execPath, args, { cwd: repoRoot, env: sandboxEnv, probeRunner });
    let report = null;
    try {
      report = JSON.parse(run.stdout || '');
    } catch (_) {
      report = null;
    }
    const baselineOk = Boolean(
      report && report.hosts
      && report.hosts.codex && report.hosts.codex.baseline && report.hosts.codex.baseline.verdict === 'PASS'
      && report.hosts.claude && report.hosts.claude.baseline && report.hosts.claude.baseline.verdict === 'PASS',
    );
    const liveClean = Boolean(
      report && report.hosts
      && report.hosts.codex && report.hosts.codex.live && report.hosts.codex.live.verdict !== 'DUPLICATE'
      && report.hosts.claude && report.hosts.claude.live && report.hosts.claude.live.verdict !== 'DUPLICATE',
    );
    const ok = run.ok && baselineOk && liveClean;
    return {
      status: ok ? 'PASS' : 'FAIL',
      probe: compactProbe(run),
      report,
      ...(ok ? {} : { error: `duplicate discovery check failed (exit=${run.exitCode}, timedOut=${run.timedOut})` }),
    };
  }

  const inventory = readJsonSafe(path.join(repoRoot, 'manifests', 'distribution-inventory.json')) || { skills: [] };
  const inventoryNames = new Set((inventory.skills || []).flatMap((s) => [s.name, s.id].filter(Boolean)));
  const report = createDuplicateDiscoveryReport({
    projectRoot: projectDir,
    home: sandboxHome,
    codexHome,
    hosts: ['codex', 'claude'],
    offline,
    inventoryNames,
    probes: {},
  });
  const ok = report.hosts.codex.baseline.verdict === 'PASS' && report.hosts.claude.baseline.verdict === 'PASS';
  return { status: ok ? 'PASS' : 'FAIL', probe: null, report };
}

function checkLiveFreshSessionHosts({ repoRoot, sandboxEnv, offline, executeLive, probeRunner }) {
  const binaries = {
    claude: 'claude',
    codex: 'codex',
    cursor: 'cursor-agent',
    agy: 'agy',
  };
  const hosts = {};
  for (const [host, binary] of Object.entries(binaries)) {
    if (offline) {
      hosts[host] = {
        status: 'NOT_RUN',
        reason: 'offline rehearsal mode skips Host CLI invocation',
        probe: null,
      };
      continue;
    }
    const run = invokeCli(binary, ['--version'], {
      cwd: repoRoot,
      env: sandboxEnv,
      timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
      probeRunner,
    });
    if (run.errorCode === 'ENOENT') {
      hosts[host] = {
        status: 'UNAVAILABLE',
        reason: `${binary} CLI is not installed on PATH`,
        probe: compactProbe(run),
      };
    } else if (!run.ok) {
      hosts[host] = {
        status: 'FAIL',
        reason: `${binary} --version failed (exit=${run.exitCode}, timedOut=${run.timedOut})`,
        probe: compactProbe(run),
      };
    } else if (!executeLive) {
      hosts[host] = {
        status: 'NOT_RUN',
        reason: 'live authenticated Host fresh-session check was not executed in non-authenticated rehearsal environment',
        probe: compactProbe(run),
      };
    } else {
      hosts[host] = {
        status: 'NOT_RUN',
        reason: 'authenticated live fresh-session prompt execution requires an explicit runner adapter',
        probe: compactProbe(run),
      };
    }
  }

  const statuses = Object.values(hosts).map((entry) => entry.status);
  let status = 'NOT_RUN';
  if (statuses.includes('FAIL')) status = 'FAIL';
  else if (statuses.includes('BLOCKED')) status = 'BLOCKED';
  else if (statuses.every((value) => value === 'UNAVAILABLE')) status = 'UNAVAILABLE';
  else if (statuses.every((value) => value === 'PASS')) status = 'PASS';

  return { status, hosts };
}

function rehearseReleaseUpgrade({
  repoRoot,
  version = null,
  priorTag = null,
  offline = false,
  executeLive = false,
  env = process.env,
  probeRunner = runHostCliProbe,
} = {}) {
  const resolvedRoot = path.resolve(repoRoot || path.join(__dirname, '..', '..'));
  const diagnostics = [];
  const targetVersion = resolveTargetVersion(resolvedRoot, version);

  const priorResolution = resolvePriorReleaseTag(resolvedRoot, {
    targetVersion,
    priorTag,
    env,
    probeRunner,
  });
  if (priorResolution.status !== 'PASS') {
    return {
      schema: SCHEMA,
      verdict: priorResolution.status === 'FAIL' ? 'FAIL' : 'BLOCKED',
      exitCode: 1,
      repoRoot: resolvedRoot,
      targetVersion,
      priorTag: null,
      priorVersion: null,
      priorCommit: null,
      headCommit: priorResolution.headCommit || null,
      offline: Boolean(offline),
      executeLive: Boolean(executeLive),
      stages: {
        priorTagResolution: priorResolution,
      },
      diagnostics: [priorResolution.error],
    };
  }

  const tmpBase = (env && env.TMPDIR) || os.tmpdir();
  fs.mkdirSync(tmpBase, { recursive: true });
  const workRoot = fs.realpathSync(fs.mkdtempSync(path.join(tmpBase, 'dhpk-release-rehearsal-')));
  try {
    const baselineRepo = path.join(workRoot, 'baseline-repo');
    const sandboxHome = path.join(workRoot, 'home');
    const projectDir = path.join(workRoot, 'project');
    fs.mkdirSync(sandboxHome, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(workRoot, 'empty.gitconfig'), '');
    const sandboxEnv = buildSandboxEnv(env, sandboxHome, workRoot);

    const cloneRun = invokeCli(
      'git',
      ['clone', '--quiet', '--config', 'advice.detachedHead=false', '--branch', priorResolution.priorTag, resolvedRoot, baselineRepo],
      { cwd: workRoot, env: sandboxEnv, probeRunner },
    );
    const projectGitRun = cloneRun.ok
      ? invokeCli('git', ['init', '-q'], { cwd: projectDir, env: sandboxEnv, probeRunner })
      : cloneRun;

    let baselineMaterialization = {
      status: cloneRun.ok && projectGitRun.ok ? 'PASS' : 'FAIL',
      builtSurfaces: [],
      probes: [compactProbe(cloneRun), compactProbe(projectGitRun)],
    };
    let baselinePackages = null;
    let headPackages = null;
    if (baselineMaterialization.status === 'PASS') {
      const baseBuild = buildOnDemandPackages(
        baselineRepo,
        priorResolution.priorVersion,
        path.join(workRoot, 'packages', 'baseline'),
        sandboxEnv,
        probeRunner,
      );
      const headBuild = baseBuild.status === 'PASS'
        ? buildOnDemandPackages(
          resolvedRoot,
          targetVersion,
          path.join(workRoot, 'packages', 'head'),
          sandboxEnv,
          probeRunner,
        )
        : null;
      baselinePackages = baseBuild.outputs;
      headPackages = headBuild ? headBuild.outputs : null;
      baselineMaterialization = {
        status: baseBuild.status === 'PASS' && headBuild && headBuild.status === 'PASS' ? 'PASS' : 'FAIL',
        builtSurfaces: headBuild && headBuild.status === 'PASS' ? ['agent-plugin', 'cursor-plugin', 'agy-plugin'] : [],
        probes: [...baselineMaterialization.probes, ...baseBuild.probes, ...(headBuild ? headBuild.probes : [])],
        ...(baseBuild.error || (headBuild && headBuild.error) ? { error: baseBuild.error || headBuild.error } : {}),
      };
    }

    if (baselineMaterialization.status !== 'PASS') {
      diagnostics.push(baselineMaterialization.error || 'baseline materialization failed');
      return {
        schema: SCHEMA,
        verdict: 'FAIL',
        exitCode: 1,
        repoRoot: resolvedRoot,
        targetVersion,
        priorTag: priorResolution.priorTag,
        priorVersion: priorResolution.priorVersion,
        priorCommit: priorResolution.priorCommit,
        headCommit: priorResolution.headCommit,
        offline: Boolean(offline),
        executeLive: Boolean(executeLive),
        stages: {
          priorTagResolution: priorResolution,
          baselineMaterialization,
        },
        diagnostics,
      };
    }

    const codexRunner = runProjectSyncPhase({
      host: 'codex',
      installerRelPath: path.join('scripts', 'hooks', 'install-codex-skills.sh'),
      receiptRelPath: path.join('.codex', '.dhpk-installed.json'),
      thirdPartySkillDir: path.join('.codex', 'skills', 'third-party-custom'),
      baselineRepo,
      repoRoot: resolvedRoot,
      projectDir,
      sandboxEnv,
      priorVersion: priorResolution.priorVersion,
      targetVersion,
      probeRunner,
    });

    const cursorRunner = runProjectSyncPhase({
      host: 'cursor',
      installerRelPath: path.join('scripts', 'hooks', 'install-cursor-harness.sh'),
      receiptRelPath: path.join('.cursor', '.dhpk-installed.json'),
      thirdPartySkillDir: path.join('.cursor', 'skills', 'third-party-cursor-custom'),
      baselineRepo,
      repoRoot: resolvedRoot,
      projectDir,
      sandboxEnv,
      priorVersion: priorResolution.priorVersion,
      targetVersion,
      probeRunner,
    });

    // Install v(N-1) across both shared-projection Hosts before upgrading either to HEAD.
    codexRunner.installBaseline();
    cursorRunner.installBaseline();
    codexRunner.upgradeToHead();
    cursorRunner.upgradeToHead();
    codexRunner.rerunHead();
    cursorRunner.rerunHead();
    const codexSync = codexRunner.result();
    const cursorSync = cursorRunner.result();

    const cursorLocalPlugins = runCursorLocalPluginsLifecycle({
      baselineRepo,
      repoRoot: resolvedRoot,
      baselinePackages,
      headPackages,
      projectDir,
      sandboxHome,
      sandboxEnv,
      priorVersion: priorResolution.priorVersion,
      targetVersion,
      probeRunner,
    });

    const agyPlugin = runAgyLifecycle({
      baselineRepo,
      repoRoot: resolvedRoot,
      baselinePackages,
      headPackages,
      sandboxHome,
      sandboxEnv,
      priorVersion: priorResolution.priorVersion,
      targetVersion,
      probeRunner,
    });

    const claudeMarketplaceMigration = runMarketplaceMigration({
      repoRoot: resolvedRoot,
      baselineRepo,
      workRoot,
      sandboxHome,
      sandboxEnv,
      priorVersion: priorResolution.priorVersion,
      targetVersion,
      offline: Boolean(offline),
      probeRunner,
    });

    const duplicateDiscovery = runDuplicateDiscoveryCheck({
      repoRoot: resolvedRoot,
      projectDir,
      sandboxHome,
      sandboxEnv,
      offline: Boolean(offline),
      probeRunner,
    });

    // Roll back project-local sync hosts (Cursor first, then Codex) after Duplicate Discovery inspects the upgraded state.
    cursorRunner.rollback();
    codexRunner.rollback();

    const liveFreshSession = checkLiveFreshSessionHosts({
      repoRoot: resolvedRoot,
      sandboxEnv,
      offline: Boolean(offline),
      executeLive: Boolean(executeLive),
      probeRunner,
    });

    const stages = {
      priorTagResolution: priorResolution,
      baselineMaterialization,
      codexSync,
      cursorSync,
      cursorLocalPlugins,
      agyPlugin,
      claudeMarketplaceMigration,
      duplicateDiscovery,
      liveFreshSession,
    };

    const requiredStages = [
      codexSync,
      cursorSync,
      cursorLocalPlugins,
      agyPlugin,
      claudeMarketplaceMigration,
      duplicateDiscovery,
    ];
    for (const stage of requiredStages) {
      if (stage.status !== 'PASS' && stage.error) diagnostics.push(stage.error);
    }
    if (liveFreshSession.status === 'FAIL') {
      for (const [host, entry] of Object.entries(liveFreshSession.hosts)) {
        if (entry.status === 'FAIL') diagnostics.push(`${host}: ${entry.reason}`);
      }
    }

    const failed = requiredStages.some((stage) => stage.status !== 'PASS') || liveFreshSession.status === 'FAIL';
    return {
      schema: SCHEMA,
      verdict: failed ? 'FAIL' : 'PASS',
      exitCode: failed ? 1 : 0,
      repoRoot: resolvedRoot,
      targetVersion,
      priorTag: priorResolution.priorTag,
      priorVersion: priorResolution.priorVersion,
      priorCommit: priorResolution.priorCommit,
      headCommit: priorResolution.headCommit,
      offline: Boolean(offline),
      executeLive: Boolean(executeLive),
      stages,
      diagnostics,
    };
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

module.exports = {
  SCHEMA,
  parseSemver,
  compareSemver,
  resolveTargetVersion,
  resolvePriorReleaseTag,
  rehearseReleaseUpgrade,
};
