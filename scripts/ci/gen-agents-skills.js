#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  deriveProjectionRoots,
  materializeAgentsSkillsProjection,
  uninstallAgentsSkillsProjection,
  rollbackAgentsSkillsProjection,
} = require('../lib/agents-skills-package');
const {
  normalizeClaudePluginStateOverride,
  resolveClaudePluginProvision,
} = require('../lib/claude-plugin-provision');

function usage() {
  return [
    'Usage: node scripts/ci/gen-agents-skills.js [options] [out-dir]',
    '  --repo-root <dir>     Canonical repository root (defaults to this checkout)',
    '  --source-root <dir>   Override the canonical source root',
    '  --project-root <dir>  Consumer project for installation or lifecycle actions',
    '  --out-dir <dir>       Projection output directory (also accepted positionally)',
    '  --profile <id>        Consumer selection profile',
    '  --host <name>         Requested Host; repeat to select multiple Hosts',
    '  --claude-plugin-state <auto|inactive>',
    '                        auto asks the Claude CLI whether dhpk@dhpk is enabled for the project and skips the',
    '                        .claude/skills bindings it already provides; inactive skips the check and binds all',
    '                        (default auto; environment DHPK_CLAUDE_PLUGIN_STATE, the flag wins)',
    '  --update              Allow canonical source updates',
    '  --preserve-unmanaged  With no receipt, create the in-checkout projection beside non-reserved third-party entries and keep them as-is (they stay unowned)',
    '  --adopt               Adopt matching unmanaged entries',
    '  --repair              Repair the consumer projection',
    '  --uninstall           Uninstall owned entries; requires --project-root',
    '  --rollback            Roll back the projection; requires --project-root',
    '  -h, --help            Show this help without changing files',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    repoRoot: path.join(__dirname, '..', '..'),
    sourceRoot: null,
    projectRoot: null,
    outDir: null,
    profileId: null,
    requestedHosts: [],
    claudePluginState: null,
    update: false,
    preserveUnmanaged: false,
    adopt: false,
    repair: false,
    action: 'install',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { ...args, help: true };
    else if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--source-root') args.sourceRoot = argv[++index];
    else if (arg === '--project-root') args.projectRoot = argv[++index];
    else if (arg === '--out-dir') args.outDir = argv[++index];
    else if (arg === '--profile') args.profileId = argv[++index];
    else if (arg === '--host') args.requestedHosts.push(argv[++index]);
    else if (arg === '--claude-plugin-state') args.claudePluginState = argv[++index];
    else if (arg === '--update') args.update = true;
    else if (arg === '--preserve-unmanaged') args.preserveUnmanaged = true;
    else if (arg === '--adopt') args.adopt = true;
    else if (arg === '--repair') args.repair = true;
    else if (arg === '--uninstall') args.action = 'uninstall';
    else if (arg === '--rollback') args.action = 'rollback';
    else if (!arg.startsWith('--') && !args.outDir) args.outDir = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

// The official plugin only matters when this run publishes the Claude bindings.
function targetsClaude(requestedHosts) {
  return requestedHosts.length === 0 || requestedHosts.includes('claude');
}

function resolveClaudeProvision(args, projectRoot) {
  const override = normalizeClaudePluginStateOverride(
    args.claudePluginState !== null ? args.claudePluginState : (process.env.DHPK_CLAUDE_PLUGIN_STATE || 'auto'),
  );
  if (!projectRoot || !targetsClaude(args.requestedHosts)) return undefined;
  return resolveClaudePluginProvision({ projectRoot, override });
}

function reportClaudeDiscovery(provision, discovery) {
  if (!provision || !discovery) return;
  console.log(`gen-agents-skills: Claude plugin dhpk@dhpk: ${provision.status}; withdrew ${discovery.withdrawnPaths.length}, restored ${discovery.restoredPaths.length} project bindings`);
  for (const conflict of discovery.conflicts) {
    console.log(`gen-agents-skills: Claude plugin conflict ${conflict.reason}: ${conflict.path || conflict.name}`);
  }
}

function fail(message) {
  console.error(`FAIL [gen-agents-skills]: ${message}`);
  process.exit(1);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  const { root, projectRoot, outDir } = deriveProjectionRoots(args);
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  if (args.preserveUnmanaged && (projectRoot || args.sourceRoot || args.action !== 'install')) {
    fail('--preserve-unmanaged applies only to the in-checkout projection; it cannot be combined with --project-root, --source-root, --uninstall, or --rollback');
  }
  if (args.action !== 'install' && !projectRoot) fail(`--${args.action} requires --project-root`);
  let inventory = null;
  if (fs.existsSync(inventoryPath)) inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  if (args.action === 'install') {
    if (!inventory) fail(`distribution inventory not found: ${inventoryPath}`);
    const claudePluginProvision = resolveClaudeProvision(args, projectRoot);
    const result = materializeAgentsSkillsProjection({
      root,
      sourceRoot: args.sourceRoot ? root : undefined,
      projectRoot: projectRoot || undefined,
      outDir: outDir || undefined,
      inventory,
      profileId: args.profileId || undefined,
      requestedHosts: args.requestedHosts.length > 0 ? [...new Set(args.requestedHosts)].sort() : undefined,
      allowCanonicalChanges: args.update,
      preserveUnmanaged: args.preserveUnmanaged,
      adopt: args.adopt,
      repair: args.repair,
      ...(claudePluginProvision ? { claudePluginProvision } : {}),
    });
    console.log(`gen-agents-skills: wrote ${result.selectedIds.length} selected skills and ${result.managedPaths.length} managed files`);
    reportClaudeDiscovery(claudePluginProvision, result.claudeDiscovery);
    if (result.backupPath) console.log(`gen-agents-skills: adoption backup ${result.backupPath}`);
    const released = result.released || [];
    if (released.length > 0) {
      const names = released.map((entry) => entry.name).join(', ');
      console.log(`gen-agents-skills: released ${released.length} ${released.length === 1 ? 'entry' : 'entries'} (files kept on disk): ${names}`);
    }
    const preserved = result.preservedUnmanaged || [];
    if (preserved.length > 0) {
      console.log(`gen-agents-skills: preserved ${preserved.length} unmanaged ${preserved.length === 1 ? 'entry' : 'entries'} (kept as-is): ${preserved.join(', ')}`);
    }
  } else {
    const operation = args.action === 'uninstall' ? uninstallAgentsSkillsProjection : rollbackAgentsSkillsProjection;
    const result = operation({ projectRoot, outDir: outDir || undefined, inventory: inventory || undefined });
    if (!result.ok) fail(result.error && result.error.message ? result.error.message : `${args.action} failed`);
    console.log(`gen-agents-skills: ${args.action} ${result.state || 'completed'}`);
    // 舊版收據的所有權已無法證明，列出保留項目讓使用者能自行處理。
    if (result.released && result.released.length > 0) {
      console.log(`gen-agents-skills: released ${result.released.length} entries (files kept on disk): ${result.released.map((entry) => entry.name).join(', ')}`);
    }
  }
} catch (error) {
  fail(error.message);
}
