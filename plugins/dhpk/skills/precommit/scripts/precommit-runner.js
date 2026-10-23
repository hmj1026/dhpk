#!/usr/bin/env node
/**
 * precommit-runner.js
 * Engineering-grade precommit runner (package-manager agnostic):
 * - full: lint:fix && build && test:unit
 * - fast: lint:fix && test:unit
 * Auto-detects yarn/pnpm/npm from lockfile.
 *
 * Outputs:
 * - concise Markdown summary to stdout (for Claude Code context)
 * - writes full logs to .claude/cache/precommit/<repoKey>/<shortSha>/
 *   (or $CLAUDE_PRECOMMIT_CACHE_DIR)
 */

const fs = require('fs');
const path = require('path');
const {
  nowISO,
  sha1,
  safeSlug,
  ensureDir,
  writeText,
  writeJson,
  appendLog,
  runCapture,
  runStep,
  testStdoutFilter,
  gitRepoRoot,
  gitShortHead,
  gitHead,
  gitStatusSB,
  gitRemoteOrigin,
  detectPackageManager,
  readPackageJson,
  hasScript,
  pmCommand,
} = require('./lib/runner-utils');

const CONFIG_FILE = 'precommit.config.json';
const STAGE_ORDER = ['lint_fix', 'build', 'test_unit'];

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

async function gitDiffNameOnly(cwd) {
  const r = await runCapture('git', ['diff', '--name-only'], { cwd });
  const txt = (r.code === 0 ? r.stdout : '').trim();
  if (!txt) return [];
  return txt
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

function formatStepLine(name, code, ms, logFile) {
  const ok = code === 0;
  const sec = Math.round(ms / 1000);
  return `- ${ok ? '✅' : '❌'} **${name}** (${
    ok ? 'PASS' : `FAIL(${code})`
  }, ${sec}s)  \n  log: \`${logFile}\``;
}

function usageText() {
  return [
    'Usage: precommit-runner.js [--mode full|fast] [--dry-run] [--tail N] [--tail-success N] [--tail-failure N]',
    '       precommit-runner.js --help',
    '',
    'full (default) runs lint:fix, build, and unit tests. fast skips build.',
    '',
  ].join('\n');
}

function readConfiguredStages(repoRoot) {
  const configPath = path.join(repoRoot, CONFIG_FILE);
  if (!fs.existsSync(configPath)) return null;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`${CONFIG_FILE}: could not parse JSON (${error.message})`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${CONFIG_FILE}: expected an object with a stages object`);
  }
  if (!config.stages || typeof config.stages !== 'object' || Array.isArray(config.stages)) {
    throw new Error(`${CONFIG_FILE}: expected a stages object`);
  }

  const unknownStages = Object.keys(config.stages).filter(stage => !STAGE_ORDER.includes(stage));
  if (unknownStages.length) {
    throw new Error(`${CONFIG_FILE}: unknown stage(s): ${unknownStages.join(', ')}`);
  }

  const repoRealPath = fs.realpathSync(repoRoot);
  const stages = Object.fromEntries(STAGE_ORDER.map(stage => [stage, []]));
  for (const stage of STAGE_ORDER) {
    const entries = config.stages[stage];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`${CONFIG_FILE}: stages.${stage} must be a non-empty array when present`);
    }
    const usedNames = new Set();
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`${CONFIG_FILE}: stages.${stage}[${index}] must be an object`);
      }
      const { name, cwd = '.', command, args = [] } = entry;
      if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
        throw new Error(`${CONFIG_FILE}: stages.${stage}[${index}].name must use letters, numbers, dot, underscore, or hyphen`);
      }
      if (usedNames.has(name)) {
        throw new Error(`${CONFIG_FILE}: stages.${stage} has duplicate command name '${name}'`);
      }
      usedNames.add(name);
      if (typeof cwd !== 'string' || path.isAbsolute(cwd)) {
        throw new Error(`${CONFIG_FILE}: stages.${stage}[${index}].cwd must be a relative repository path`);
      }
      if (typeof command !== 'string' || !command.trim()) {
        throw new Error(`${CONFIG_FILE}: stages.${stage}[${index}].command must be a non-empty string`);
      }
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
        throw new Error(`${CONFIG_FILE}: stages.${stage}[${index}].args must be an array of strings`);
      }

      const configuredCwd = path.resolve(repoRoot, cwd);
      let cwdRealPath;
      try {
        cwdRealPath = fs.realpathSync(configuredCwd);
      } catch {
        throw new Error(`${CONFIG_FILE}: stages.${stage}[${index}].cwd does not exist: ${cwd}`);
      }
      const relativeCwd = path.relative(repoRealPath, cwdRealPath);
      if (relativeCwd === '..' || relativeCwd.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCwd)) {
        throw new Error(`${CONFIG_FILE}: stages.${stage}[${index}].cwd must stay inside the repository`);
      }
      if (!fs.statSync(cwdRealPath).isDirectory()) {
        throw new Error(`${CONFIG_FILE}: stages.${stage}[${index}].cwd must be a directory`);
      }

      stages[stage].push({
        name: `${stage}:${name}`,
        cmd: command,
        args,
        cwd: cwdRealPath,
      });
    }
  }
  return stages;
}

function packageScriptStages(pkg, pm, mode) {
  const stages = Object.fromEntries(STAGE_ORDER.map(stage => [stage, []]));
  const usesFallbackTest = hasScript(pkg, 'test') && !hasScript(pkg, 'test:js') && !hasScript(pkg, 'test:unit');
  if (hasScript(pkg, 'lint:fix')) {
    const [cmd, args] = pmCommand(pm, 'lint:fix', [
      '--',
      '--ignore-pattern',
      'node_modules/**',
      '--ignore-pattern',
      '**/node_modules/**',
      '--no-error-on-unmatched-pattern',
      'src/**/*.{ts,tsx,js,jsx}',
      'test/**/*.{ts,tsx,js,jsx}',
      'migrations/**/*.{ts,tsx,js,jsx}',
      'loadtest/**/*.{ts,tsx,js,jsx}',
      '*.{ts,js}',
    ]);
    stages.lint_fix.push({
      name: 'lint_fix', cmd, args, cwd: null,
      env: { NO_UPDATE_NOTIFIER: '1' },
    });
  }

  if (mode === 'full' && hasScript(pkg, 'build')) {
    const [cmd, args] = pmCommand(pm, 'build');
    stages.build.push({ name: 'build', cmd, args, cwd: null });
  }

  if (hasScript(pkg, 'test:js')) {
    const [cmd, args] = pmCommand(pm, 'test:js');
    stages.test_unit.push({ name: 'test_unit', cmd, args, cwd: null });
  } else if (hasScript(pkg, 'test:unit')) {
    const [cmd, args] = pmCommand(pm, 'test:unit');
    stages.test_unit.push({ name: 'test_unit', cmd, args, cwd: null });
  } else if (hasScript(pkg, 'test')) {
    const [cmd, args] = pmCommand(pm, 'test');
    stages.test_unit.push({ name: 'test_unit', cmd, args, cwd: null });
  }

  return { stages, usesFallbackTest };
}

function resolveStagePlan(repoRoot, mode, xdgDir) {
  const configuredStages = readConfiguredStages(repoRoot);
  const pm = configuredStages ? null : detectPackageManager(repoRoot);
  const pkg = configuredStages ? null : readPackageJson(repoRoot);
  const packagePlan = configuredStages ? null : packageScriptStages(pkg, pm, mode);
  const stages = configuredStages || packagePlan.stages;
  const notes = [];

  if (configuredStages) {
    notes.push(`> config: ${CONFIG_FILE}`);
    for (const stage of STAGE_ORDER) {
      if (stage === 'build' && mode !== 'full') continue;
      if (!stages[stage].length) notes.push(`> skip ${stage} (not configured)`);
    }
  } else {
    notes.push(`> package manager: ${pm}`);
    if (!stages.lint_fix.length) {
      notes.push('> skip lint_fix (no "lint:fix" script in package.json)');
    }
    if (mode === 'full' && !stages.build.length) {
      notes.push('> skip build (no "build" script in package.json)');
    }
    if (!stages.test_unit.length) {
      notes.push('> skip test_unit (no "test:js", "test:unit" or "test" script in package.json)');
    } else if (packagePlan.usesFallbackTest) {
      notes.push('> fallback: using "test" instead of "test:unit"');
    }
  }

  const steps = STAGE_ORDER
    .filter(stage => stage !== 'build' || mode === 'full')
    .flatMap(stage => stages[stage].map(step => ({
      ...step,
      cwd: step.cwd || repoRoot,
      env: {
        ...(step.env || {}),
        ...(stage === 'lint_fix' ? { XDG_CONFIG_HOME: xdgDir } : {}),
      },
      stdoutFilter: stage === 'test_unit' ? testStdoutFilter : undefined,
      stage,
    })));

  return { notes, steps };
}

function formatCommand(cmd, args) {
  return [cmd, ...args].map(value => {
    if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
    const printable = value.replace(/[\u0000-\u001f\u007f]/g, character =>
      `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`
    );
    return `'${printable.replace(/'/g, `'\\''`)}'`;
  }).join(' ');
}

function printDryRun(repoRoot, mode, plan) {
  const lines = [
    `# Precommit (${mode})`,
    '',
    '- DRY_RUN: commands listed below; no checks were executed',
    `- repo: \`${repoRoot}\``,
    '',
    ...plan.notes,
    '',
    '## Ordered commands',
  ];

  if (!plan.steps.length) {
    lines.push('- no supported commands configured; runner verdict is UNSUPPORTED');
  } else {
    for (const step of plan.steps) {
      lines.push(`- **${step.name}**`);
      lines.push(`  command: ${formatCommand(step.cmd, step.args)}`);
      lines.push(`  cwd: \`${step.cwd}\``);
    }
  }

  lines.push('');
  lines.push(plan.steps.length
    ? '## Overall: DRY_RUN (not a verification verdict)'
    : '## Overall: ⛔ UNSUPPORTED');
  lines.push('');
  process.stdout.write(lines.join('\n'));
  if (!plan.steps.length) process.exitCode = 2;
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const args = {
    mode: 'full', // full | fast
    dryRun: false,
    tail: 120, // default tail lines ceiling
    tailSuccess: 25,
    tailFailure: 120,
  };
  const numeric = {
    '--tail': 'tail',
    '--tail-success': 'tailSuccess',
    '--tail-failure': 'tailFailure',
  };

  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (k === '--mode' || Object.prototype.hasOwnProperty.call(numeric, k)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) return { error: `${k} requires a value` };
      i += 1;
      if (k === '--mode') {
        if (v !== 'full' && v !== 'fast') return { error: `invalid mode '${v}'` };
        args.mode = v;
      } else if (!/^[0-9]+$/.test(v)) {
        return { error: `${k} requires a non-negative integer` };
      } else {
        args[numeric[k]] = Number(v);
      }
      continue;
    }
    return { error: `unknown argument '${k}'` };
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usageText());
    return;
  }
  if (args.error) {
    process.stderr.write(`${args.error}\n${usageText()}`);
    process.exitCode = 2;
    return;
  }
  const repoRoot = await gitRepoRoot();

  if (!repoRoot) {
    process.stdout.write(args.dryRun
      ? `# Precommit (${args.mode})\n\n- DRY_RUN: no checks were executed\n\n⛔ UNSUPPORTED: Not inside a git repo.\n`
      : `# precommit runner\n\n⛔ UNSUPPORTED: Not inside a git repo.\n`);
    process.exitCode = 2;
    return;
  }

  const xdgDir = path.join(repoRoot, '.claude', 'cache', 'xdg');
  if (args.dryRun) {
    try {
      const plan = resolveStagePlan(repoRoot, args.mode, xdgDir);
      printDryRun(repoRoot, args.mode, plan);
    } catch (error) {
      process.stdout.write(
        `# Precommit (${args.mode})\n\n- DRY_RUN: no checks were executed\n\n❌ runner setup failed: ${String((error && error.stack) || error)}\n`
      );
      process.exitCode = 1;
    }
    return;
  }

  const head = await gitHead(repoRoot);
  const short = (await gitShortHead(repoRoot)) || 'unknown';
  const remote = (await gitRemoteOrigin(repoRoot)) || repoRoot;

  const repoBase = path.basename(repoRoot);
  const repoKey = `${safeSlug(repoBase)}--${sha1(remote).slice(0, 8)}`;

  const cacheBase =
    process.env.CLAUDE_PRECOMMIT_CACHE_DIR ||
    path.join(repoRoot, '.claude', 'cache', 'precommit');

  const logDir = path.join(cacheBase, repoKey, short);
  ensureDir(logDir);
  ensureDir(xdgDir);
  const runnerLog = path.join(logDir, 'runner.log');
  appendLog(runnerLog, `[${nowISO()}] start\n`);

  const meta = {
    generatedAt: nowISO(),
    mode: args.mode,
    repoRoot,
    repoKey,
    head,
    short,
    remote,
  };
  writeJson(path.join(logDir, 'meta.json'), meta);

  let statusBefore = '';
  let statusAfter = '';
  let changedAfterLint = [];
  const results = [];
  let summaryError = '';

  try {
    statusBefore = await gitStatusSB(repoRoot);

    const plan = resolveStagePlan(repoRoot, args.mode, xdgDir);
    for (const note of plan.notes) process.stdout.write(`${note}\n`);

    for (const s of plan.steps) {
      appendLog(runnerLog, `[${nowISO()}] step_start ${s.name}\n`);
      process.stdout.write(`> running ${s.name}...\n`);
      const r = await runStep({
        name: s.name,
        cmd: s.cmd,
        args: s.args,
        cwd: s.cwd,
        env: s.env || {},
        logDir,
        tailSuccess: args.tailSuccess,
        tailFailure: args.tailFailure,
        tailLines: args.tail,
        heartbeatMs: 5000,
        stdoutFilter: s.stdoutFilter,
      });
      results.push(r);
      appendLog(
        runnerLog,
        `[${nowISO()}] step_done ${s.name} code=${r.code}\n`
      );
      process.stdout.write(`> finished ${s.name} (code=${r.code})\n`);
      if (s.stage === 'lint_fix') {
        changedAfterLint = await gitDiffNameOnly(repoRoot);
      }
    }

    statusAfter = await gitStatusSB(repoRoot);
  } catch (e) {
    summaryError = String((e && e.stack) || e);
  }

  const summary = {
    ...meta,
    statusBefore,
    statusAfter,
    changedAfterLintFix: changedAfterLint,
    steps: results.map(r => ({
      name: r.name,
      code: r.code,
      durationMs: r.durationMs,
      logFile: r.logFile,
    })),
    overallStatus: summaryError
      ? 'FAIL'
      : results.length === 0
        ? 'UNSUPPORTED'
        : results.every(r => r.code === 0)
          ? 'PASS'
          : 'FAIL',
    overallPass: !summaryError && results.length > 0 && results.every(r => r.code === 0),
    error: summaryError || undefined,
  };
  writeJson(path.join(logDir, 'summary.json'), summary);
  appendLog(runnerLog, `[${nowISO()}] summary_written\n`);

  // Output concise Markdown (for Claude Code context)
  const lines = [];
  lines.push(`# Precommit (${args.mode})`);
  lines.push(`- repo: \`${repoRoot}\``);
  lines.push(`- HEAD: \`${short}\``);
  lines.push(`- logs: \`${logDir}\``);
  if (summary.error) lines.push(`- runner_error: \`${summary.error}\``);
  lines.push('');
  lines.push('## Git status (before)');
  lines.push('```text');
  lines.push(statusBefore || '(empty)');
  lines.push('```');
  lines.push('');

  lines.push('## Steps');
  if (!results.length) {
    lines.push(summaryError
      ? '- no steps ran because runner setup failed'
      : '- no supported commands configured; runner verdict is UNSUPPORTED');
  }
  for (const r of results) {
    lines.push(formatStepLine(r.name, r.code, r.durationMs, r.logFile));
    const ok = r.code === 0;
    const showTail = ok ? args.tailSuccess > 0 : true;
    if (showTail && r.tailText) {
      lines.push('');
      lines.push(
        `<details><summary>tail (${
          ok ? args.tailSuccess : args.tailFailure
        } lines) - ${r.name}</summary>`
      );
      lines.push('');
      lines.push('```text');
      lines.push(r.tailText);
      lines.push('```');
      lines.push('</details>');
    }
    lines.push('');
  }

  lines.push('## Changed files after lint:fix');
  if (changedAfterLint.length) {
    lines.push(changedAfterLint.map(f => `- \`${f}\``).join('\n'));
  } else {
    lines.push('- (no diff)');
  }
  lines.push('');

  lines.push('## Git status (after)');
  lines.push('```text');
  lines.push(statusAfter || '(empty)');
  lines.push('```');
  lines.push('');

  const verdict = summary.overallStatus === 'PASS'
    ? '✅ PASS'
    : summary.overallStatus === 'UNSUPPORTED'
      ? '⛔ UNSUPPORTED'
      : '❌ FAIL';
  lines.push(`## Overall: ${verdict}`);
  lines.push('');

  const summaryMd = lines.join('\n');
  writeText(path.join(logDir, 'summary.md'), summaryMd);
  appendLog(runnerLog, `[${nowISO()}] summary_md_written\n`);
  process.stdout.write(summaryMd);
  if (summary.overallStatus === 'FAIL') process.exitCode = 1;
  if (summary.overallStatus === 'UNSUPPORTED') process.exitCode = 2;
}

main().catch(e => {
  process.stdout.write(
    `# Precommit\n\n❌ runner crashed: ${String((e && e.stack) || e)}\n`
  );
  process.exitCode = 1;
});
