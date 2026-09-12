'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createTraversalBudget, readFileBounded, readDirectoryEntries } = require('../../lib/bounded-filesystem');
const { collectCodexRoleNeighborErrors } = require('../../lib/codex-role-neighbors');

const TIER_LABEL = /\b(?:haiku|sonnet|opus)\b/i;
const BACKTICKED_TOKEN = /`([a-z0-9]+(?:-[a-z0-9]+)*)`/g;
const VALID_CODEX_MODELS = new Set(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']);
const VALID_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'max', 'xhigh']);
const VALID_SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const DEFAULT_SUBAGENT_MODEL = 'gpt-5.6-luna';
const DEFAULT_SUBAGENT_EFFORT = 'medium';
const ROLE_OWNERSHIP_MANIFEST = 'codex/agent-projection-manifest.json';

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function isInside(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
}

function readProjectionFile(file, allowedRoots) {
  const realFile = fs.realpathSync(file);
  const allowed = allowedRoots.some((root) => {
    try { return isInside(fs.realpathSync(root), realFile); } catch (_) { return false; }
  });
  if (!allowed) throw new Error(`Codex projection symlink escapes allowed roots: ${file}`);
  return readFileBounded(realFile);
}

function namesFrom(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return readDirectoryEntries(directory)
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(extension))
    .map((name) => name.slice(0, -extension.length));
}

function walkFiles(directory, predicate, output = [], budget = createTraversalBudget(), depth = 0) {
  if (!fs.existsSync(directory)) return output;
  const realDirectory = budget.enterDirectory(directory, depth);
  try {
    for (const entry of readDirectoryEntries(directory, { budget })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walkFiles(file, predicate, output, budget, depth + 1);
      else if (predicate(file)) {
        budget.accountFile(file, fs.statSync(file));
        output.push(file);
      }
    }
  } finally {
    budget.leaveDirectory(realDirectory);
  }
  return output;
}

function readRoleOwnershipManifest(root) {
  const file = path.join(root, ROLE_OWNERSHIP_MANIFEST);
  if (!fs.existsSync(file)) {
    return {
      manifest: null,
      errors: [`${ROLE_OWNERSHIP_MANIFEST} — role ownership manifest is missing`],
      generated: new Set(),
      packageRoles: new Set(),
      local: new Set(),
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileBounded(file).toString('utf8'));
  } catch (error) {
    return {
      manifest: null,
      errors: [`${ROLE_OWNERSHIP_MANIFEST} — role ownership manifest is not valid JSON: ${error.message}`],
      generated: new Set(),
      packageRoles: new Set(),
      local: new Set(),
    };
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      manifest: null,
      errors: [`${ROLE_OWNERSHIP_MANIFEST} — role ownership manifest must be an object`],
      generated: new Set(),
      packageRoles: new Set(),
      local: new Set(),
    };
  }
  const errors = [];
  const generated = Array.isArray(manifest.generated_roles) ? manifest.generated_roles : null;
  const packageRoles = Array.isArray(manifest.package_roles) ? manifest.package_roles : null;
  const local = Array.isArray(manifest.workspace_local_extensions)
    ? manifest.workspace_local_extensions
    : null;
  if (!generated || !packageRoles || !local) {
    errors.push(
      `${ROLE_OWNERSHIP_MANIFEST} — must declare generated_roles, package_roles, and workspace_local_extensions arrays`,
    );
  }
  const asSet = (values) => new Set(Array.isArray(values) ? values : []);
  const generatedSet = asSet(generated);
  const packageSet = asSet(packageRoles);
  const localSet = asSet(local);
  for (const [label, values] of [['generated_roles', generated], ['package_roles', packageRoles], ['workspace_local_extensions', local]]) {
    if (!Array.isArray(values)) continue;
    if (values.some((value) => typeof value !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value))) {
      errors.push(`${ROLE_OWNERSHIP_MANIFEST} — ${label} contains an invalid role name`);
    }
    if (new Set(values).size !== values.length) {
      errors.push(`${ROLE_OWNERSHIP_MANIFEST} — ${label} contains duplicate role names`);
    }
  }
  for (const role of generatedSet) {
    if (!packageSet.has(role)) {
      errors.push(`${ROLE_OWNERSHIP_MANIFEST} — generated role '${role}' is not package-owned`);
    }
  }
  for (const role of localSet) {
    if (packageSet.has(role)) {
      errors.push(`${ROLE_OWNERSHIP_MANIFEST} — workspace-local role '${role}' collides with package-owned role`);
    }
  }
  return { manifest, errors, generated: generatedSet, packageRoles: packageSet, local: localSet };
}

function canonicalAgentNames(root) {
  const names = new Set(
    namesFrom(path.join(root, 'agents'), '.md').filter((name) => name !== 'INDEX'),
  );
  const modulesDir = path.join(root, 'modules');
  if (!fs.existsSync(modulesDir)) return names;
  for (const entry of readDirectoryEntries(modulesDir)) {
    const moduleName = entry.name;
    const moduleAgents = path.join(modulesDir, moduleName, 'agents');
    for (const name of namesFrom(moduleAgents, '.md')) names.add(name);
  }
  return names;
}

function collectCanonicalAgentOwnershipErrors(root) {
  const errors = [];
  const roots = [path.join(root, 'agents')];
  const modulesDir = path.join(root, 'modules');
  if (fs.existsSync(modulesDir)) {
    for (const entry of readDirectoryEntries(modulesDir)) {
      const moduleName = entry.name;
      roots.push(path.join(modulesDir, moduleName, 'agents'));
    }
  }
  for (const agentsRoot of roots) {
    if (!fs.existsSync(agentsRoot)) continue;
    for (const file of readDirectoryEntries(agentsRoot).map((entry) => entry.name).filter((entry) => entry.endsWith('.md') && entry !== 'INDEX.md')) {
      const fullPath = path.join(agentsRoot, file);
      const source = readFileBounded(fullPath).toString('utf8');
      const nameMatch = source.match(/^name\s*:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
      const expected = file.slice(0, -'.md'.length);
      if (!nameMatch || nameMatch[1].trim() !== expected) {
        errors.push(`${relative(root, fullPath)} — canonical agent filename '${expected}.md' does not match frontmatter name '${nameMatch ? nameMatch[1].trim() : '(missing)'}'`);
      }
    }
  }
  return errors;
}

function tomlStringField(source, field) {
  const inline = source.match(new RegExp(`^${field}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"\\s*$`, 'm'));
  if (inline) return inline[1].replace(/\\\\"/g, '"').replace(/\\\\\\\\/g, '\\\\');

  const multiline = source.match(new RegExp(`^${field}\\s*=\\s*"""([\\s\\S]*?)"""`, 'm'));
  return multiline ? multiline[1] : null;
}

function topLevelAgentsConfig(source) {
  let inAgents = false;
  let hasConcurrency = false;
  let defaultModel = null;
  let defaultEffort = null;
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
    if (inAgents && /^\s*default_subagent_model\s*=\s*"([^"]+)"/.test(line)) {
      defaultModel = line.match(/^\s*default_subagent_model\s*=\s*"([^"]+)"/)[1];
    }
    if (inAgents && /^\s*default_subagent_reasoning_effort\s*=\s*"([^"]+)"/.test(line)) {
      defaultEffort = line.match(/^\s*default_subagent_reasoning_effort\s*=\s*"([^"]+)"/)[1];
    }
    if (inAgents && /^\s*max_(?:threads|depth)\s*=/.test(line)) {
      legacyKeys.push(line.trim().split(/\s*=/, 1)[0]);
    }
  }

  return { hasConcurrency, legacyKeys, defaultModel, defaultEffort };
}

function collectCodexRoleOwnershipErrors(root) {
  const errors = [];
  const ownership = readRoleOwnershipManifest(root);
  errors.push(...ownership.errors);
  const agentsDir = path.join(root, 'codex', 'agents');
  const files = namesFrom(agentsDir, '.toml');
  const fileNames = new Set(files);
  const localExtensions = new Set(ownership.local);
  const sidecarPath = path.join(agentsDir, '.codex-agent-ownership.json');
  if (fs.existsSync(sidecarPath)) {
    try {
      const sidecar = JSON.parse(readFileBounded(sidecarPath).toString('utf8'));
      for (const role of sidecar.workspace_local_extensions || []) localExtensions.add(role);
    } catch (error) {
      errors.push(`${relative(root, sidecarPath)} — workspace-local role ownership manifest is not valid JSON: ${error.message}`);
    }
  }

  if (ownership.manifest) {
    for (const role of [...ownership.packageRoles].sort()) {
      if (!fileNames.has(role)) {
        errors.push(`${ROLE_OWNERSHIP_MANIFEST} — package-owned role '${role}' is missing from codex/agents`);
      }
    }
    for (const role of [...ownership.generated].sort()) {
      if (!fs.existsSync(path.join(root, 'agents', `${role}.md`))) {
        errors.push(`${ROLE_OWNERSHIP_MANIFEST} — generated role '${role}' has no canonical agents/${role}.md source`);
      }
    }
    for (const role of files.sort()) {
      if (!ownership.packageRoles.has(role) && !localExtensions.has(role)) {
        errors.push(`codex/agents/${role}.toml — stale package-owned TOML is outside the ownership manifest`);
      }
    }
  }
  return errors;
}

function collectCodexRoleMetadataErrors(root) {
  const errors = [];
  const agentsDir = path.join(root, 'codex', 'agents');
  if (!fs.existsSync(agentsDir)) return errors;
  for (const entry of readDirectoryEntries(agentsDir).map((item) => item.name)) {
    if (!entry.endsWith('.toml')) continue;
    const role = entry.slice(0, -'.toml'.length);
    const file = path.join(agentsDir, entry);
    const source = readFileBounded(file).toString('utf8');
    const relativeFile = relative(root, file);
    const fields = {
      name: tomlStringField(source, 'name'),
      description: tomlStringField(source, 'description'),
      model: tomlStringField(source, 'model'),
      model_reasoning_effort: tomlStringField(source, 'model_reasoning_effort'),
      sandbox_mode: tomlStringField(source, 'sandbox_mode'),
      developer_instructions: tomlStringField(source, 'developer_instructions'),
    };
    for (const field of ['name', 'description', 'model', 'model_reasoning_effort', 'sandbox_mode', 'developer_instructions']) {
      if (fields[field] == null || !fields[field].trim()) {
        errors.push(`${relativeFile} — missing non-empty ${field}`);
      }
    }
    if (fields.name && fields.name !== role) {
      errors.push(`${relativeFile} — filename '${role}.toml' does not match declared name '${fields.name}'`);
    }
    if (fields.model && !VALID_CODEX_MODELS.has(fields.model)) {
      errors.push(`${relativeFile} — invalid model '${fields.model}' (not in the Codex model catalog)`);
    }
    if (fields.model_reasoning_effort && !VALID_REASONING_EFFORTS.has(fields.model_reasoning_effort)) {
      errors.push(`${relativeFile} — invalid model_reasoning_effort '${fields.model_reasoning_effort}'`);
    }
    if (fields.sandbox_mode && !VALID_SANDBOX_MODES.has(fields.sandbox_mode)) {
      errors.push(`${relativeFile} — invalid sandbox_mode '${fields.sandbox_mode}'`);
    }
  }
  return errors;
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
  for (const role of ['architect', 'code-reviewer', 'security-reviewer', 'database-reviewer', 'tdd-guide', 'e2e-runner', 'migration-reviewer']) {
    const roleRoot = path.join(trapRoot, role);
    if (!fs.existsSync(roleRoot)) continue;
    for (const name of readDirectoryEntries(roleRoot, { sort: true }).map((entry) => entry.name).filter((entry) => entry.endsWith('.md'))) {
      expected.add(`dhpk/agent-traps/${role}/${name}`);
    }
  }
  return expected;
}

function readSupportingInventory(sourceRoot) {
  const inventoryPath = path.join(sourceRoot, 'manifests', 'distribution-inventory.json');
  if (!fs.existsSync(inventoryPath)) return null;
  try {
    const inventory = JSON.parse(readFileBounded(inventoryPath).toString('utf8'));
    return Array.isArray(inventory.supporting_assets) ? inventory.supporting_assets : null;
  } catch {
    return null;
  }
}

function collectCodexMarkdownReferenceErrors(root, file, assets, sourceRoot) {
  const errors = [];
  let source;
  try {
    source = readProjectionFile(file, [root, assets, sourceRoot]).toString('utf8');
  } catch (error) {
    return [`${relative(root, file)} — unable to read contained Codex supporting asset: ${error.message}`];
  }
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
      const receipt = JSON.parse(readFileBounded(receiptPath).toString('utf8'));
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
      errors.push(...collectCodexMarkdownReferenceErrors(root, target, assets, sourceRoot));
    }
  }
  return errors;
}

function readRoleMatrix(root) {
  const file = path.join(root, 'codex', 'agent-role-map.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(readFileBounded(file).toString('utf8'));
  } catch {
    return null;
  }
}

function readRoleMatrixContract(root) {
  const file = path.join(root, 'codex', 'agent-role-map.json');
  if (!fs.existsSync(file)) {
    return {
      matrix: null,
      errors: ['codex/agent-role-map.json — canonical Codex coverage matrix is missing'],
    };
  }
  let matrix;
  try {
    matrix = JSON.parse(readFileBounded(file).toString('utf8'));
  } catch (error) {
    return {
      matrix: null,
      errors: [`codex/agent-role-map.json — coverage matrix is not valid JSON: ${error.message}`],
    };
  }
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)
    || !matrix.roles || typeof matrix.roles !== 'object' || Array.isArray(matrix.roles)) {
    return {
      matrix,
      errors: ['codex/agent-role-map.json — coverage matrix must contain a roles object'],
    };
  }
  return { matrix, errors: [] };
}

function collectSupportingDispatchErrors(root, sourceRoot, assets) {
  const errors = [];
  const matrix = readRoleMatrix(sourceRoot);
  if (!matrix || !matrix.roles || !fs.existsSync(assets)) return errors;
  const canonical = new Set(Object.keys(matrix.roles));
  const direct = new Set(namesFrom(path.join(sourceRoot, 'codex', 'agents'), '.toml'));
  const files = walkFiles(assets, (file) => file.endsWith('.md'));
  for (const file of files) {
    const source = readProjectionFile(file, [root, assets, sourceRoot]).toString('utf8');
    const relativeFile = relative(root, file);
    for (const match of source.matchAll(/\bdhpk:([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
      errors.push(`${relativeFile} — supporting Codex asset retains unsupported Claude namespace '${match[0]}'`);
    }
    for (const [lineNumber, line] of source.split(/\r?\n/).entries()) {
      const tokens = [...line.matchAll(BACKTICKED_TOKEN)].map((match) => match[1]);
      for (const token of tokens) {
        if (!canonical.has(token)) continue;
        const entry = matrix.roles[token];
        if (entry && entry.status !== 'direct') {
          errors.push(
            `${relativeFile}:${lineNumber + 1} — supporting asset dispatch target '${token}' is ${entry.status}; use a direct Codex role or an explicit manual/capability fallback`,
          );
        } else if (!direct.has(token)) {
          errors.push(`${relativeFile}:${lineNumber + 1} — supporting asset dispatch target '${token}' is not a discovered Codex role`);
        }
      }
      if (/\b(?:dispatch|handoff|hand off|delegate|invoke)\b/i.test(line)) {
        for (const match of line.matchAll(BACKTICKED_TOKEN)) {
          const token = match[1];
          if (canonical.has(token) || direct.has(token)) continue;
          if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(token)) {
            errors.push(
              `${relativeFile}:${lineNumber + 1} — supporting asset dispatch target '${token}' is not declared in the role graph`,
            );
          }
        }
      }
    }
  }
  return errors;
}

function collectCodexProjectionReferenceErrors(root, sourceRoot = root) {
  const errors = [];
  const { agents, assets } = projectionRoots(root);
  const ownership = readRoleOwnershipManifest(sourceRoot);
  const roleMapContract = readRoleMatrixContract(sourceRoot);
  const roleMap = roleMapContract.matrix;
  errors.push(...ownership.errors, ...roleMapContract.errors);
  const resolvableTargets = new Set(namesFrom(agents, '.toml'));
  if (!fs.existsSync(agents)) return errors;
  errors.push(...collectSupportingClosureErrors(root, sourceRoot, assets));
  errors.push(...collectSupportingDispatchErrors(root, sourceRoot, assets));
  const referencePattern = /\.codex\/dhpk\/[A-Za-z0-9._/<>{}-]+\.md/g;
  for (const name of readDirectoryEntries(agents, { sort: true }).map((entry) => entry.name).filter((entry) => entry.endsWith('.toml'))) {
    const file = path.join(agents, name);
    const source = readProjectionFile(file, [root, sourceRoot]).toString('utf8');
    const sourceRole = name.slice(0, -'.toml'.length);
    if (ownership.generated.has(sourceRole)) {
      errors.push(...collectCodexRoleNeighborErrors({
        sourceRole,
        text: source,
        roleMap,
        generatedRoles: ownership.generated,
        packageRoles: ownership.packageRoles,
        resolvableTargets,
        file: relative(root, file),
      }));
    }
    if (source.includes('${CLAUDE_PLUGIN_ROOT}')) {
      errors.push(`${relative(root, file)} — generated Codex role retains unsupported $\{CLAUDE_PLUGIN_ROOT\} interpolation`);
    }
    if (source.includes('../docs/contracts')) {
      errors.push(`${relative(root, file)} — generated Codex role retains unreachable parent-relative contract reference`);
    }
    if (/(?:`|\(|\s)modules\/[A-Za-z0-9._-]+(?:\/[^`\s)]*)?/.test(source)) {
      errors.push(`${relative(root, file)} — generated Codex role retains an unresolved source-module reference`);
    }
    if (/\bdhpk:[A-Za-z0-9_-]+/.test(source)) {
      errors.push(`${relative(root, file)} — generated Codex role retains a Claude namespace reference`);
    }
    if (/\bclaude-mem\b/.test(source)) {
      errors.push(`${relative(root, file)} — generated Codex role retains Claude-only claude-mem routing`);
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

function collectCodexCoverageErrors(root) {
  const errors = [];
  const mapPath = path.join(root, 'codex', 'agent-role-map.json');
  if (!fs.existsSync(mapPath)) {
    return ['codex/agent-role-map.json — canonical Codex coverage matrix is missing'];
  }

  let matrix;
  try {
    matrix = JSON.parse(readFileBounded(mapPath).toString('utf8'));
  } catch (error) {
    return [`codex/agent-role-map.json — coverage matrix is not valid JSON: ${error.message}`];
  }

  const canonicalNames = canonicalAgentNames(root);
  errors.push(...collectCanonicalAgentOwnershipErrors(root));
  const roles = matrix && matrix.roles;
  const statuses = new Set(Array.isArray(matrix && matrix.statuses) ? matrix.statuses : []);
  const validStatuses = new Set([
    'direct',
    'merged',
    'skill/manual-fallback',
    'capability-gated',
    'intentionally-unavailable',
  ]);
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
    return ['codex/agent-role-map.json — coverage matrix must contain a roles object'];
  }
  for (const status of validStatuses) {
    if (!statuses.has(status)) {
      errors.push(`codex/agent-role-map.json — status vocabulary is missing '${status}'`);
    }
  }

  const mappedNames = new Set(Object.keys(roles));
  const declaredDispatchRoles = readRoleOwnershipManifest(root).packageRoles;
  for (const name of [...canonicalNames].sort()) {
    if (!mappedNames.has(name)) {
      errors.push(`codex/agent-role-map.json — canonical role '${name}' is not classified`);
    }
  }
  for (const name of [...declaredDispatchRoles].sort()) {
    if (!mappedNames.has(name)) {
      errors.push(`codex/agent-role-map.json — package dispatch role '${name}' is not classified`);
    }
  }
  for (const name of [...mappedNames].sort()) {
    if (!canonicalNames.has(name) && !declaredDispatchRoles.has(name)) {
      errors.push(`codex/agent-role-map.json — matrix contains non-canonical role '${name}'`);
    }
  }

  const dispatchableNames = new Set(namesFrom(path.join(root, 'codex', 'agents'), '.toml'));
  const capabilities = matrix && matrix.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    errors.push('codex/agent-role-map.json — capability-gated outcomes require a capabilities object');
  }
  const capabilityEntries = capabilities && typeof capabilities === 'object' ? capabilities : {};
  const capabilityNames = new Set(Object.keys(capabilityEntries));
  for (const [capability, definition] of Object.entries(capabilityEntries)) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      errors.push(`codex/agent-role-map.json — capability '${capability}' must have a definition object`);
      continue;
    }
    if (definition.kind === 'module') {
      if (typeof definition.path !== 'string' || !definition.path.trim()) {
        errors.push(`codex/agent-role-map.json — module capability '${capability}' must declare a path`);
      } else if (!fs.existsSync(path.join(root, definition.path))) {
        errors.push(`codex/agent-role-map.json — module capability '${capability}' points at missing '${definition.path}'`);
      }
    }
  }
  const resolveTarget = (name, entry) => {
    if (typeof entry.target !== 'string' || !entry.target.trim()) return;
    const target = entry.target.trim();
    if (entry.status === 'direct') {
      if (!dispatchableNames.has(target) || !Object.prototype.hasOwnProperty.call(roles, target)) {
        errors.push(`codex/agent-role-map.json — direct role '${name}' targets non-dispatchable Codex role '${target}'`);
      }
      return;
    }
    if (entry.status === 'merged') {
      const targets = target.split('/').map((part) => part.trim()).filter(Boolean);
      if (targets.length === 0) {
        errors.push(`codex/agent-role-map.json — merged role '${name}' has no target roles`);
      }
      for (const targetRole of targets) {
        if (!dispatchableNames.has(targetRole)) {
          errors.push(`codex/agent-role-map.json — merged role '${name}' targets non-dispatchable Codex role '${targetRole}'`);
        }
      }
      return;
    }
    if (entry.status === 'skill/manual-fallback' || entry.status === 'capability-gated') {
      if (target.startsWith('capability:')) {
        const capability = target.slice('capability:'.length);
        if (!capability || !capabilityNames.has(capability)) {
          errors.push(`codex/agent-role-map.json — ${entry.status} role '${name}' targets unknown capability '${capability || target}'`);
        }
      } else if (!dispatchableNames.has(target)) {
        errors.push(`codex/agent-role-map.json — ${entry.status} role '${name}' target '${target}' must resolve to a direct role or capability:<id>`);
      }
      return;
    }
    if (entry.status === 'intentionally-unavailable' && !target) {
      errors.push(`codex/agent-role-map.json — intentionally unavailable role '${name}' needs a rationale`);
    }
  };
  const graphNames = new Set([...canonicalNames, ...declaredDispatchRoles]);
  for (const name of [...graphNames].sort()) {
    const entry = roles[name];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`codex/agent-role-map.json — role '${name}' must have one classification object`);
      continue;
    }
    if (!validStatuses.has(entry.status)) {
      errors.push(`codex/agent-role-map.json — role '${name}' has invalid status '${entry.status || ''}'`);
    }
    if (typeof entry.target !== 'string' || !entry.target.trim()) {
      errors.push(`codex/agent-role-map.json — role '${name}' must declare a non-empty target or rationale`);
    }
    resolveTarget(name, entry);
  }
  return errors;
}

function collectCodexRuntimeErrors(root) {
  const errors = [];
  const codexAgentsDir = path.join(root, 'codex', 'agents');
  const codexConfig = path.join(root, 'codex', 'config.toml.example');
  const canonicalNames = canonicalAgentNames(root);
  const codexFiles = namesFrom(codexAgentsDir, '.toml').sort();
  const dispatchableNames = new Set(codexFiles);

  errors.push(...collectCodexRoleOwnershipErrors(root));
  errors.push(...collectCodexRoleMetadataErrors(root));
  errors.push(...collectCodexProjectionReferenceErrors(root));

  if (!fs.existsSync(codexAgentsDir)) {
    errors.push('codex/agents — projection directory is missing');
  } else {
    for (const entry of readDirectoryEntries(codexAgentsDir).map((item) => item.name)) {
      if (!entry.endsWith('.toml')) {
        errors.push(
          `${relative(root, path.join(codexAgentsDir, entry))} — Codex agent definitions must use the .toml format`,
        );
      }
    }

    for (const role of codexFiles) {
      const file = path.join(codexAgentsDir, `${role}.toml`);
      const source = readFileBounded(file).toString('utf8');
      const description = tomlStringField(source, 'description');
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
    const config = readFileBounded(codexConfig).toString('utf8');
    const { hasConcurrency, legacyKeys, defaultModel, defaultEffort } = topLevelAgentsConfig(config);
    if (!hasConcurrency) {
      errors.push(
        'codex/config.toml.example — [agents] must define max_concurrent_threads_per_session',
      );
    }
    for (const key of legacyKeys) {
      errors.push(`codex/config.toml.example — legacy [agents] key '${key}' is not supported`);
    }
    if (defaultModel !== DEFAULT_SUBAGENT_MODEL) {
      errors.push(
        `codex/config.toml.example — default_subagent_model must be '${DEFAULT_SUBAGENT_MODEL}', found '${defaultModel || '(missing)'}'`,
      );
    }
    if (defaultEffort !== DEFAULT_SUBAGENT_EFFORT) {
      errors.push(
        `codex/config.toml.example — default_subagent_reasoning_effort must be '${DEFAULT_SUBAGENT_EFFORT}', found '${defaultEffort || '(missing)'}'`,
      );
    }
  }

  return errors;
}

module.exports = {
  collectCodexRoleMetadataErrors,
  collectCodexRoleOwnershipErrors,
  collectCodexCoverageErrors,
  collectCodexProjectionReferenceErrors,
  collectCodexRuntimeErrors,
};
