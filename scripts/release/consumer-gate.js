#!/usr/bin/env node
'use strict';

// CONSUMER release gate (task 4.2-4.5): verifies each surface's proof at its
// own support level and never substitutes one for another.
//   - Codex sync installer (supported): scripts/hooks/install-codex-skills.sh
//     materializes skills/agents into a clean project and records a matching
//     version + content fingerprint. Fully runnable and safe: it only writes
//     inside a throwaway temp project directory.
//   - Claude plugin update/reinstall (supported): `claude plugin
//     marketplace add` + `install --scope project` + `plugin list` in a
//     clean temp project. Only safe to run for real on an ephemeral CI
//     runner (a dev machine's `claude plugin install` writes to the shared
//     global plugin cache) — reported UNAVAILABLE when the `claude` CLI is
//     absent from PATH rather than skipped silently.
//   - Native Codex marketplace (experimental): always reported as a
//     separate artifact, never counted toward the supported verdict.
//
// Prints the stage as JSON on stdout; exit code mirrors the verdict.
//
// Usage: node scripts/release/consumer-gate.js --version X.Y.Z [--repo-root <path>]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { VERDICTS } = require('../lib/release-evidence');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') args.version = argv[++i];
    else if (arg === '--repo-root') args.root = argv[++i];
    else {
      console.error(`consumer-gate: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!args.version) {
    console.error('usage: consumer-gate.js --version X.Y.Z [--repo-root <path>]');
    process.exit(2);
  }
  return args;
}

function mkTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-gate-'));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function verifyCodexSync(root, version) {
  const commands = [];
  const project = mkTempProject();
  try {
    const installer = path.join(root, 'scripts', 'hooks', 'install-codex-skills.sh');
    const res = spawnSync('bash', [installer, '--force'], { cwd: project, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: root } });
    commands.push({ cmd: `bash ${installer} --force (in clean project)`, exitCode: res.status });
    if (res.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`install-codex-skills.sh exited ${res.status}: ${(res.stderr || '').trim()}`] };
    }
    const manifestPath = path.join(project, '.codex', '.dhpk-installed.json');
    if (!fs.existsSync(manifestPath)) {
      return { verdict: VERDICTS.FAIL, commands, reasons: ['no .codex/.dhpk-installed.json manifest after install'] };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const skillsPresent = fs.existsSync(path.join(project, '.codex', 'skills')) && fs.readdirSync(path.join(project, '.codex', 'skills')).length > 0;
    if (!skillsPresent) {
      return { verdict: VERDICTS.FAIL, commands, reasons: ['no skills materialized under .codex/skills after install'] };
    }
    if (manifest.plugin_version !== version) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`installed manifest version '${manifest.plugin_version}' does not match target '${version}'`] };
    }
    return { verdict: VERDICTS.PASS, commands, reasons: [] };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function claudeAvailable() {
  return spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
}

function verifyClaudeReinstall(root, version) {
  if (!claudeAvailable()) {
    return { verdict: VERDICTS.UNAVAILABLE, commands: [], reasons: ["claude CLI not found on PATH — Claude update/reinstall proof requires a clean CI runner or a fresh session; not verifiable here"] };
  }
  const commands = [];
  const project = mkTempProject();
  try {
    const add = spawnSync('claude', ['plugin', 'marketplace', 'add', root, '--scope', 'project'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin marketplace add <root> --scope project', exitCode: add.status });
    if (add.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`marketplace add exited ${add.status}: ${(add.stderr || '').trim()}`] };
    }

    const install = spawnSync('claude', ['plugin', 'install', 'dhpk@dhpk', '--scope', 'project'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin install dhpk@dhpk --scope project', exitCode: install.status });
    if (install.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`plugin install exited ${install.status}: ${(install.stderr || '').trim()}`] };
    }

    const list = spawnSync('claude', ['plugin', 'list', '--json'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin list --json', exitCode: list.status });
    if (list.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`plugin list exited ${list.status}`] };
    }
    const installed = JSON.parse(list.stdout || '[]').find((p) => p.id === 'dhpk@dhpk');
    if (!installed) {
      return { verdict: VERDICTS.FAIL, commands, reasons: ["'dhpk@dhpk' not present in 'claude plugin list --json' after install"] };
    }
    if (installed.version !== version) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`installed plugin reports version '${installed.version}', expected '${version}'`] };
    }
    return { verdict: VERDICTS.PASS, commands, reasons: [] };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));

const codex = verifyCodexSync(args.root, args.version);
const claude = verifyClaudeReinstall(args.root, args.version);

const commands = [...codex.commands, ...claude.commands];
const failureReasons = [...codex.reasons.map((r) => `codex-sync: ${r}`), ...claude.reasons.map((r) => `claude-reinstall: ${r}`)];

let verdict;
if (codex.verdict === VERDICTS.FAIL || claude.verdict === VERDICTS.FAIL) verdict = VERDICTS.FAIL;
else if (claude.verdict === VERDICTS.UNAVAILABLE) verdict = VERDICTS.UNAVAILABLE;
else verdict = VERDICTS.PASS;

const stage = {
  verdict,
  commands,
  environment: process.env.CI ? 'ci' : 'local',
  // Native Codex marketplace is always reported separately as experimental
  // (task 4.5) and never substituted for the supported codex-sync result.
  artifacts: ['native-codex-marketplace: experimental, not verified by this gate — see docs/distribution-surfaces.md'],
  failureReasons,
};

console.log(JSON.stringify(stage, null, 2));
process.exit(stage.verdict === VERDICTS.FAIL ? 1 : 0);
