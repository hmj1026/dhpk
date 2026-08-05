'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TIER_LABEL = /\b(?:haiku|sonnet|opus)\b/i;
const BACKTICKED_TOKEN = /`([a-z0-9]+(?:-[a-z0-9]+)*)`/g;

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function namesFrom(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .map((name) => name.slice(0, -extension.length));
}

function tomlStringField(source, field) {
  const inline = source.match(new RegExp(`^${field}\\s*=\\s*"([^"]*)"\\s*$`, 'm'));
  if (inline) return inline[1];

  const multiline = source.match(new RegExp(`^${field}\\s*=\\s*"""([\\s\\S]*?)"""`, 'm'));
  return multiline ? multiline[1] : null;
}

function topLevelAgentsConfig(source) {
  let inAgents = false;
  let hasConcurrency = false;
  const legacyKeys = [];

  for (const line of source.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      inAgents = header[1] === 'agents';
      continue;
    }
    if (inAgents && /^\s*max_concurrent_threads_per_session\s*=/.test(line)) {
      hasConcurrency = true;
    }
    if (inAgents && /^\s*max_(?:threads|depth)\s*=/.test(line)) {
      legacyKeys.push(line.trim().split(/\s*=/, 1)[0]);
    }
  }

  return { hasConcurrency, legacyKeys };
}

function projectionRoots(root) {
  const sourceAgents = path.join(root, 'codex', 'agents');
  const sourceAssets = path.join(root, 'codex', 'supporting');
  if (fs.existsSync(sourceAgents) && fs.existsSync(sourceAssets)) {
    return {
      agents: sourceAgents,
      assets: sourceAssets,
    };
  }
  const consumerAgents = path.join(root, '.codex', 'agents');
  if (fs.existsSync(consumerAgents)) {
    return {
      agents: consumerAgents,
      assets: path.join(root, '.codex', 'dhpk'),
    };
  }
  return {
    agents: path.join(root, 'codex', 'agents'),
    assets: path.join(root, 'codex', 'supporting'),
  };
}

function expectedSupportingDestinations(sourceRoot) {
  const expected = new Set([
    'dhpk/agent-traps/_common/prompt-defense.md',
    'dhpk/agent-traps/_common/trap-sheet-loader.md',
    'dhpk/contracts/artifact-contract.md',
    'dhpk/contracts/reviewer-contract.md',
    'dhpk/policies/execution-policy.md',
  ]);
  const trapRoot = path.join(sourceRoot, 'agent-traps');
  for (const role of ['architect', 'code-reviewer', 'security-reviewer', 'database-reviewer', 'tdd-guide']) {
    const roleRoot = path.join(trapRoot, role);
    if (!fs.existsSync(roleRoot)) continue;
    for (const name of fs.readdirSync(roleRoot).filter((entry) => entry.endsWith('.md')).sort()) {
      expected.add(`dhpk/agent-traps/${role}/${name}`);
    }
  }
  return expected;
}

function readSupportingInventory(sourceRoot) {
  const inventoryPath = path.join(sourceRoot, 'manifests', 'distribution-inventory.json');
  if (!fs.existsSync(inventoryPath)) return null;
  try {
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    return Array.isArray(inventory.supporting_assets) ? inventory.supporting_assets : null;
  } catch {
    return null;
  }
}

function collectCodexMarkdownReferenceErrors(root, file, assets) {
  const errors = [];
  const source = fs.readFileSync(file, 'utf8');
  const relativeFile = relative(root, file);
  if (source.includes('${CLAUDE_PLUGIN_ROOT}')) {
    errors.push(`${relativeFile} — supporting Codex asset retains unsupported $\{CLAUDE_PLUGIN_ROOT\} interpolation`);
  }
  if (source.includes('.claude/') || /\bCLAUDE\.md\b/.test(source)) {
    errors.push(`${relativeFile} — supporting Codex asset retains unreachable Claude project reference`);
  }
  if (/(?:`|\(|\s)(?:modules|rules|skills)\/[A-Za-z0-9._-]+(?:\/[^`\s)]*)?/.test(source)) {
    errors.push(`${relativeFile} — supporting Codex asset retains an unresolved source-tree reference`);
  }
  if (/subagent-stop-verify|clear-sentinel|post-edit-remind|\.pending-/.test(source)) {
    errors.push(`${relativeFile} — supporting Codex asset retains Claude lifecycle mechanics`);
  }
  const referencePattern = /\.codex\/dhpk\/[A-Za-z0-9._/<>{}-]+\.md/g;
  for (const reference of new Set(source.match(referencePattern) || [])) {
    if (reference.includes('<') || reference.includes('>')) continue;
    const relativeAsset = reference.slice('.codex/dhpk/'.length);
    const target = path.join(assets, relativeAsset);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      errors.push(`${relativeFile} — required Codex supporting asset is missing: ${reference}`);
    }
  }
  const skillReferencePattern = /\.codex\/skills\/[A-Za-z0-9._/<>{}-]+\.md/g;
  for (const reference of new Set(source.match(skillReferencePattern) || [])) {
    if (reference.includes('<') || reference.includes('>')) continue;
    const relativeSkill = reference.slice('.codex/skills/'.length);
    const candidates = [
      path.join(root, '.codex', 'skills', relativeSkill),
      path.join(root, 'codex', 'skills', relativeSkill),
    ];
    if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
      errors.push(`${relativeFile} — required Codex skill reference is missing: ${reference}`);
    }
  }
  return errors;
}

function collectSupportingClosureErrors(root, sourceRoot, assets) {
  const errors = [];
  const expected = expectedSupportingDestinations(sourceRoot);
  if (expected.size === 0) return errors;
  const inventory = readSupportingInventory(sourceRoot);
  const declared = new Set((inventory || []).map((entry) => entry && entry.destination).filter(Boolean));
  const isConsumerProjection = path.resolve(assets) === path.resolve(root, '.codex', 'dhpk');
  const receiptPath = path.join(root, '.codex', '.dhpk-installed.json');
  let receiptEntries = null;
  if (isConsumerProjection && fs.existsSync(receiptPath)) {
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receiptEntries = receipt.managed_entries && receipt.managed_entries.supporting_assets;
    } catch {
      errors.push('.codex/.dhpk-installed.json — supporting asset receipt is not valid JSON');
    }
  }
  for (const destination of [...expected].sort()) {
    if (!declared.has(destination)) {
      errors.push(`distribution inventory — required Codex supporting asset is not declared: ${destination}`);
    }
    if (isConsumerProjection && !receiptEntries) {
      errors.push('.codex/.dhpk-installed.json — supporting asset receipt is missing');
    } else if (receiptEntries && !receiptEntries[destination]) {
      errors.push(`.codex/.dhpk-installed.json — required supporting asset is not receipt-managed: ${destination}`);
    }
    const target = path.join(assets, destination.slice('dhpk/'.length));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      errors.push(`${relative(root, target)} — required Codex supporting asset is missing: ${destination}`);
    } else if (target.endsWith('.md')) {
      errors.push(...collectCodexMarkdownReferenceErrors(root, target, assets));
    }
  }
  return errors;
}

function collectCodexProjectionReferenceErrors(root, sourceRoot = root) {
  const errors = [];
  const { agents, assets } = projectionRoots(root);
  if (!fs.existsSync(agents)) return errors;
  errors.push(...collectSupportingClosureErrors(root, sourceRoot, assets));
  const referencePattern = /\.codex\/dhpk\/[A-Za-z0-9._/<>{}-]+\.md/g;
  for (const name of fs.readdirSync(agents).filter((entry) => entry.endsWith('.toml')).sort()) {
    const file = path.join(agents, name);
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes('${CLAUDE_PLUGIN_ROOT}')) {
      errors.push(`${relative(root, file)} — generated Codex role retains unsupported $\{CLAUDE_PLUGIN_ROOT\} interpolation`);
    }
    if (source.includes('../docs/contracts')) {
      errors.push(`${relative(root, file)} — generated Codex role retains unreachable parent-relative contract reference`);
    }
    for (const reference of new Set(source.match(referencePattern) || [])) {
      if (reference.includes('<') || reference.includes('>')) continue;
      const relativeAsset = reference.slice('.codex/dhpk/'.length);
      const target = path.join(assets, relativeAsset);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        errors.push(`${relative(root, file)} — required Codex supporting asset is missing: ${reference}`);
      }
    }
  }
  return errors;
}

function collectCodexRuntimeErrors(root) {
  const errors = [];
  const canonicalDir = path.join(root, 'agents');
  const codexAgentsDir = path.join(root, 'codex', 'agents');
  const codexConfig = path.join(root, 'codex', 'config.toml.example');
  const canonicalNames = new Set(namesFrom(canonicalDir, '.md'));
  const codexFiles = namesFrom(codexAgentsDir, '.toml').sort();
  const dispatchableNames = new Set(codexFiles);

  errors.push(...collectCodexProjectionReferenceErrors(root));

  if (!fs.existsSync(codexAgentsDir)) {
    errors.push('codex/agents — projection directory is missing');
  } else {
    for (const entry of fs.readdirSync(codexAgentsDir)) {
      if (!entry.endsWith('.toml')) {
        errors.push(
          `${relative(root, path.join(codexAgentsDir, entry))} — Codex agent definitions must use the .toml format`,
        );
      }
    }

    for (const role of codexFiles) {
      const file = path.join(codexAgentsDir, `${role}.toml`);
      const source = fs.readFileSync(file, 'utf8');
      const description = tomlStringField(source, 'description');

      const requiredFields = [
        'name',
        'description',
        'model',
        'model_reasoning_effort',
        'developer_instructions',
      ];
      for (const field of requiredFields) {
        const value = tomlStringField(source, field);
        if (value == null || !value.trim()) {
          errors.push(`${relative(root, file)} — missing non-empty ${field}`);
        }
      }

      const tierLabel = description && description.match(TIER_LABEL);
      if (tierLabel) {
        errors.push(
          `${relative(root, file)} — description contains Claude model tier label '${tierLabel[0]}'; ` +
          'use model and model_reasoning_effort as the runtime metadata',
        );
      }

      for (const match of source.matchAll(BACKTICKED_TOKEN)) {
        const referencedRole = match[1];
        if (canonicalNames.has(referencedRole) && !dispatchableNames.has(referencedRole)) {
          errors.push(
            `${relative(root, file)} — references non-dispatchable Codex agent '${referencedRole}'`,
          );
        }
      }
    }
  }

  if (!fs.existsSync(codexConfig)) {
    errors.push('codex/config.toml.example — example configuration is missing');
  } else {
    const config = fs.readFileSync(codexConfig, 'utf8');
    const { hasConcurrency, legacyKeys } = topLevelAgentsConfig(config);
    if (!hasConcurrency) {
      errors.push(
        'codex/config.toml.example — [agents] must define max_concurrent_threads_per_session',
      );
    }
    for (const key of legacyKeys) {
      errors.push(`codex/config.toml.example — legacy [agents] key '${key}' is not supported`);
    }
  }

  return errors;
}

module.exports = { collectCodexProjectionReferenceErrors, collectCodexRuntimeErrors };
