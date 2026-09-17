'use strict';

// One closure gate for the issue #534 breaking retirement wave. The purpose
// and command ledgers explain the reviewed decision, while the inventory and
// checked-in source tree prove that no retired identity remains executable or
// discoverable. Historical evidence is allowed only by exact file path.

const fs = require('node:fs');
const path = require('node:path');
const {
  validateSkillRetirements,
  validateRenamedSkillNames,
} = require('./distribution-inventory');
const { validateSkillPurposeDecisions } = require('./skill-purpose-decisions');
const {
  REMOVED_COMMAND_IDS,
  validateCommandSkillDispositions,
} = require('./command-skill-disposition');

const CURRENT_WAVE_IDS = Object.freeze([
  'laravel-5.4-notes', 'laravel-6-notes', 'laravel-7-notes', 'laravel-8-notes',
  'laravel-9-notes', 'laravel-10-notes', 'laravel-11-notes', 'laravel-mix-notes',
  'phpunit-9-modern', 'phpunit-10-notes', 'phpunit-11-notes', 'claude-health',
  'harness-budget', 'harness-fill', 'harness-revise', 'multi-ai-sync',
  'agy-commit', 'feasibility-study', 'tech-spec', 'create-request', 'op-session',
]);

const CURRENT_WAVE_SET = new Set(CURRENT_WAVE_IDS);
const EXTERNAL_SUCCESSORS = new Set(['openspec-propose']);
const OPERATOR_SUCCESSORS = new Set(['onepassword-cli']);

// These files contain deliberately retained historical evidence. Every entry
// is an exact file, never a directory, glob, or subtree wildcard.
const DEFAULT_HISTORICAL_ALLOWLIST = Object.freeze([
  Object.freeze({ path: 'manifests/distribution-inventory.json', reason: 'inventory-owned retirement and rename evidence' }),
  Object.freeze({ path: 'manifests/skill-purpose-decisions.json', reason: 'purpose and current-wave decision evidence' }),
  Object.freeze({ path: 'manifests/command-skill-dispositions.json', reason: 'active command and removed-command ledger evidence' }),
  Object.freeze({ path: 'generated/claude-marketplace/package/manifests/distribution-inventory.json', reason: 'generated inventory mirror with historical retirement and rename evidence' }),
  Object.freeze({ path: 'generated/claude-marketplace/package/manifests/skill-purpose-decisions.json', reason: 'generated purpose mirror with current-wave decision evidence' }),
  Object.freeze({ path: 'generated/claude-marketplace/package/manifests/command-skill-dispositions.json', reason: 'generated command mirror with removed-command ledger evidence' }),
  Object.freeze({ path: 'commands/INDEX.md', reason: 'command navigation index retains historical retirement notes' }),
  Object.freeze({ path: 'generated/claude-marketplace/package/commands/INDEX.md', reason: 'generated command navigation index mirrors historical retirement notes' }),
  Object.freeze({ path: 'docs/skill-platform-migration.md', reason: 'published migration and rollback history' }),
  Object.freeze({ path: 'docs/skill-platform-migration.zh-TW.md', reason: 'published Traditional Chinese migration and rollback history' }),
  Object.freeze({ path: 'docs/agent-guidance/skill-disposition.md', reason: 'historical disposition snapshot' }),
  Object.freeze({ path: 'openspec/specs/skill-retirement-migration/spec.md', reason: 'reviewed retirement contract and acceptance evidence' }),
]);

// The default scan follows every active publication and routing root. It does
// not scan tests, fixtures, historical documentation, or generated module
// source that is not an active projection. Callers may provide activeFiles or
// activeReferences to add a bounded fixture/projection scan for a mutation test.
const DEFAULT_ACTIVE_ROOTS = Object.freeze([
  'skills',
  'commands',
  'agents',
  'rules',
  'scripts/run-skill.sh',
  'scripts/lib/capability-bundle-selection.js',
  '.agents',
  'docs/agent-guidance',
  'docs/basic-operations.md',
  'docs/basic-operations.zh-TW.md',
  'docs/skill-command-cheat-sheet.md',
  'docs/skill-command-cheat-sheet.zh-TW.md',
  'docs/skill-platform-installation.md',
  'docs/skill-platform-installation.zh-TW.md',
  'plugins',
  'cursor/skills',
  'cursor/commands',
  'cursor/agents',
  'cursor/rules',
  'generated/claude-profiles/minimal/package/skills',
  'generated/claude-profiles/minimal/package/commands',
  'generated/claude-profiles/minimal/package/agents',
  'generated/claude-profiles/minimal/package/rules',
  'generated/claude-profiles/full/package/skills',
  'generated/claude-profiles/full/package/commands',
  'generated/claude-profiles/full/package/agents',
  'generated/claude-profiles/full/package/rules',
  'generated/claude-profiles/compat-v1/package/skills',
  'generated/claude-profiles/compat-v1/package/commands',
  'generated/claude-profiles/compat-v1/package/agents',
  'generated/claude-profiles/compat-v1/package/rules',
  'generated/claude-marketplace/package/skills',
  'generated/claude-marketplace/package/commands',
  'generated/claude-marketplace/package/agents',
  'generated/claude-marketplace/package/rules',
  'generated/claude-marketplace/package/scripts/run-skill.sh',
  'generated/claude-marketplace/package/scripts/lib/capability-bundle-selection.js',
  'manifests/distribution-inventory.json',
  'manifests/skill-purpose-decisions.json',
  'manifests/command-skill-dispositions.json',
  'generated/claude-marketplace/package/manifests/distribution-inventory.json',
  'generated/claude-marketplace/package/manifests/skill-purpose-decisions.json',
  'generated/claude-marketplace/package/manifests/command-skill-dispositions.json',
]);
// Keep the old export name as a compatibility spelling for consumers that
// supplied the active root list directly.
const DEFAULT_ACTIVE_PATHS = DEFAULT_ACTIVE_ROOTS;

const TEXT_EXTENSIONS = new Set(['.md', '.mdc', '.json', '.yaml', '.yml', '.sh', '.js', '.ts', '.py', '.toml']);
const ACTIVE_SKIP_SEGMENTS = new Set(['.git', 'node_modules', '__pycache__', 'tests', 'fixtures', 'test-fixtures']);
const GENERATED_INACTIVE_ROOTS = Object.freeze([
  'generated/claude-marketplace/package/docs',
  'generated/claude-marketplace/package/modules',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

function isInactiveActivePath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const segments = normalized.split('/');
  if (segments.some((segment) => ACTIVE_SKIP_SEGMENTS.has(segment))) return true;
  if (GENERATED_INACTIVE_ROOTS.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) return true;
  return false;
}

function walkTextFiles(root, relativePath, out = []) {
  if (isInactiveActivePath(relativePath)) return out;
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return out;
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    if (TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase())) out.push(relativePath);
    return out;
  }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (isInactiveActivePath(path.posix.join(relativePath, entry.name))) continue;
    const child = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) walkTextFiles(root, child, out);
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(child);
  }
  return out;
}

const DEFAULT_ACTIVE_REFERENCE_CACHES = new Map();

function fileSnapshotSignature(stat) {
  const modified = stat.mtimeNs === undefined ? stat.mtimeMs : stat.mtimeNs;
  const changed = stat.ctimeNs === undefined ? stat.ctimeMs : stat.ctimeNs;
  return [stat.dev, stat.ino, stat.size, modified.toString(), changed.toString()].join(':');
}

function defaultActiveReferenceCache(root) {
  let cache = DEFAULT_ACTIVE_REFERENCE_CACHES.get(root);
  if (!cache) {
    cache = new Map();
    DEFAULT_ACTIVE_REFERENCE_CACHES.set(root, cache);
  }
  return cache;
}

function validateHistoricalAllowlist(root, allowlist) {
  const errors = [];
  const rows = Array.isArray(allowlist) ? allowlist : [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const prefix = `historical_allowlist[${index}]`;
    if (!isObject(row)) {
      errors.push(`${prefix} must be an object with exact path and reason`);
      continue;
    }
    if (typeof row.path !== 'string' || row.path.trim() === '') {
      errors.push(`${prefix}.path must be a non-empty exact repository path`);
      continue;
    }
    const normalized = path.posix.normalize(row.path);
    if (normalized !== row.path || row.path.includes('\\') || row.path.includes('*')
      || row.path.endsWith('/') || path.posix.isAbsolute(row.path) || row.path === '.' || row.path.startsWith('../')) {
      errors.push(`${prefix}.path must be an exact normalized file path, not a directory or glob: ${row.path}`);
    }
    if (seen.has(row.path)) errors.push(`${prefix}.path is duplicated: ${row.path}`);
    seen.add(row.path);
    if (typeof row.reason !== 'string' || row.reason.trim() === '') errors.push(`${prefix}.reason is required for exact historical allowlist paths`);
    if (root) {
      const absolute = path.join(root, row.path);
      if (!fs.existsSync(absolute)) errors.push(`${prefix}.path does not exist: ${row.path}`);
      else if (!fs.statSync(absolute).isFile()) errors.push(`${prefix}.path must be an exact normalized file path, not a directory: ${row.path}`);
    }
    if (Object.keys(row).some((key) => !['path', 'reason'].includes(key))) errors.push(`${prefix} contains unsupported fields`);
  }
  return errors;
}

function historicalProjectionText(relativePath, text) {
  const normalized = relativePath.split(path.sep).join('/');
  const isInventory = normalized.endsWith('/distribution-inventory.json') || normalized === 'manifests/distribution-inventory.json';
  const isPurpose = normalized.endsWith('/skill-purpose-decisions.json') || normalized === 'manifests/skill-purpose-decisions.json';
  const isCommands = normalized.endsWith('/command-skill-dispositions.json') || normalized === 'manifests/command-skill-dispositions.json';
  if (!isInventory && !isPurpose && !isCommands) return text;
  try {
    const value = JSON.parse(text);
    if (isInventory) {
      delete value.retired_skills;
      delete value.renamed_skill_names;
    }
    if (isPurpose) delete value.retirements;
    if (isCommands) delete value.removed_commands;
    return JSON.stringify(value);
  } catch {
    return text;
  }
}

function retiredTokens(inventory) {
  const rows = Array.isArray(inventory && inventory.retired_skills) ? inventory.retired_skills : [];
  const current = rows.filter((row) => row && CURRENT_WAVE_SET.has(row.id) && row.retiredIn === '0.54.0');
  return current.flatMap((row) => [
    { value: row.id, kind: 'stable id' },
    { value: row.name, kind: 'public name' },
    { value: row.canonicalPath, kind: 'canonical path' },
    // Route handlers historically used the unqualified command-shaped path
    // (for example `/create-request`) even when the public Skill name was
    // `dhpk-create-request`. Keep that spelling diagnostic-only in the
    // closure scanner; it is never emitted as an alias or successor.
    { value: `/${row.id}`, kind: 'retired route' },
  ]).filter((token) => typeof token.value === 'string' && token.value.trim() !== '');
}

function commandTokens() {
  return REMOVED_COMMAND_IDS.flatMap((id) => [
    { value: `/dhpk:${id}`, kind: 'removed command invocation' },
    { value: `commands/${id}.md`, kind: 'removed command path' },
    { value: `"${id}"`, kind: 'removed command identity' },
    { value: `'${id}'`, kind: 'removed command identity' },
  ]);
}

function renameTokens(inventory) {
  const rows = Array.isArray(inventory && inventory.renamed_skill_names) ? inventory.renamed_skill_names : [];
  return rows.flatMap((row) => [
    { value: row && row.oldName, kind: 'renamed public name' },
    { value: row && row.oldPath, kind: 'renamed old path' },
  ]).filter((token) => typeof token.value === 'string' && token.value.trim() !== '');
}

function tokenPattern(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Stable/public IDs may contain punctuation; boundaries prevent a retired
  // identity from matching a longer unrelated word.
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`);
}

function collectActiveReferences({ root, activeFiles, activeReferences, historicalAllowlist }) {
  const errors = [];
  const candidates = [];
  let discoveryCache = null;
  if (Array.isArray(activeReferences)) {
    for (const [index, entry] of activeReferences.entries()) {
      if (typeof entry === 'string') candidates.push({ path: entry });
      else if (isObject(entry) && typeof entry.path === 'string') candidates.push({ path: entry.path, text: entry.text, discovered: false });
      else errors.push(`active_references[${index}] must be a path or { path, text } object`);
    }
  } else if (Array.isArray(activeFiles)) {
    candidates.push(...activeFiles.map((entry) => ({ path: entry, discovered: false })));
  } else {
    const discovered = new Set();
    discoveryCache = defaultActiveReferenceCache(root);
    for (const entry of DEFAULT_ACTIVE_ROOTS) {
      for (const file of walkTextFiles(root, entry)) discovered.add(file);
    }
    for (const cachedPath of discoveryCache.keys()) {
      if (!discovered.has(cachedPath)) discoveryCache.delete(cachedPath);
    }
    candidates.push(...[...discovered].sort().map((file) => ({ path: file, discovered: true })));
  }
  const allowlisted = new Set((Array.isArray(historicalAllowlist) ? historicalAllowlist : [])
    .filter((entry) => isObject(entry) && typeof entry.path === 'string')
    .map((entry) => entry.path));
  const files = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.path !== 'string' || candidate.path.trim() === '') continue;
    const normalized = path.posix.normalize(candidate.path);
    if (normalized !== candidate.path || candidate.path.startsWith('../') || path.posix.isAbsolute(candidate.path)) {
      errors.push(`active reference path must be normalized and repository-relative: ${candidate.path}`);
      continue;
    }
    const isHistorical = allowlisted.has(candidate.path);
    const file = path.join(root, candidate.path);
    let text = candidate.text;
    let snapshotSignature = null;
    if (text === undefined) {
      if (!fs.existsSync(file)) {
        errors.push(`active reference path does not exist: ${candidate.path}`);
        continue;
      }
      const stat = fs.statSync(file);
      if (!stat.isFile()) {
        errors.push(`active reference path is not a file: ${candidate.path}`);
        continue;
      }
      if (discoveryCache && candidate.discovered) {
        const signature = fileSnapshotSignature(stat);
        snapshotSignature = signature;
        const cached = discoveryCache.get(candidate.path);
        if (cached && cached.signature === signature) text = cached.text;
        else {
          text = fs.readFileSync(file, 'utf8');
          discoveryCache.set(candidate.path, { signature, text });
        }
      } else text = fs.readFileSync(file, 'utf8');
    }
    if (isHistorical && !candidate.path.endsWith('/distribution-inventory.json')
      && !candidate.path.endsWith('/skill-purpose-decisions.json')
      && !candidate.path.endsWith('/command-skill-dispositions.json')) continue;
    files.push({
      path: candidate.path,
      text: historicalProjectionText(candidate.path, String(text)),
      discovered: candidate.discovered === true,
      historical: isHistorical,
      snapshotSignature,
    });
  }
  return { errors, files };
}

function scanActiveReferences({ inventory, root, activeFiles, activeReferences, historicalAllowlist }) {
  const errors = [];
  const findings = [];
  const collected = collectActiveReferences({ root, activeFiles, activeReferences, historicalAllowlist });
  errors.push(...collected.errors);
  const tokens = [...retiredTokens(inventory), ...commandTokens(), ...renameTokens(inventory)];
  for (const file of collected.files) {
    const cache = file.discovered === true && file.snapshotSignature
      ? defaultActiveReferenceCache(root)
      : null;
    const cached = cache && cache.get(file.path);
    const tokenFindings = cached && cached.signature === file.snapshotSignature && cached.tokenFindings
      ? cached.tokenFindings
      : new Map();
    const projection = /(?:^|\/)(?:distribution-inventory|skill-purpose-decisions|command-skill-dispositions)\.json$/.test(file.path)
      ? file.historical
      : false;
    const fileFindings = [];
    for (const token of tokens) {
      const tokenKey = JSON.stringify([projection, token.kind, token.value]);
      let tokenResult = tokenFindings.get(tokenKey);
      if (!tokenResult) {
        const match = tokenMatchesActiveReference(token, file.text, file.discovered === true)
          ? tokenPattern(token.value).exec(file.text)
          : null;
        tokenResult = match
          ? [{ path: file.path, token: token.value, kind: token.kind, index: match.index }]
          : [];
        tokenFindings.set(tokenKey, tokenResult);
      }
      fileFindings.push(...clone(tokenResult));
    }
    if (cache && file.snapshotSignature) {
      cache.set(file.path, {
        signature: file.snapshotSignature,
        text: cached ? cached.text : file.text,
        tokenFindings,
      });
    }
    findings.push(...fileFindings);
  }
  for (const finding of findings) errors.push(`active reference to ${finding.kind} '${finding.token}' in ${finding.path}`);
  return { errors, findings, files: collected.files.map((file) => file.path) };
}

function tokenMatchesActiveReference(token, text, discovered) {
  if (!discovered) return true;
  if (token.kind.startsWith('removed command')) return true;
  const value = token.value;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A plain historical word in explanatory prose is not an executable
  // reference. Active routing/discovery fields and explicit host syntax are.
  if (token.kind === 'canonical path' || token.kind === 'removed command path' || token.kind === 'retired route') return true;
  if (token.kind === 'public name' || token.kind === 'renamed public name') {
    return new RegExp(`(?:\\$|/)${escaped}(?![A-Za-z0-9_-])`).test(text)
      || new RegExp(`(?:id|stable[_-]?id|skill|command|route|public[_-]?name)\\s*[:=]\\s*[\\"'\`]${escaped}[\\"'\`]`).test(text);
  }
  if (token.kind === 'renamed old path') return true;
  return new RegExp(`(?:id|stable[_-]?id|skill|command|route|public[_-]?name|canonical[_-]?path)\\s*[:=]\\s*[\\"'\`]${escaped}[\\"'\`]`).test(text)
    || new RegExp(`(?:\\$|/dhpk:)${escaped}(?![A-Za-z0-9_-])`).test(text);
}

function validateExactWave({ inventory, purposeLedger, commandManifest, errors }) {
  const retiredRows = Array.isArray(inventory && inventory.retired_skills) ? inventory.retired_skills : [];
  const currentIds = retiredRows.filter((row) => row && row.retiredIn === '0.54.0').map((row) => row.id).sort();
  if (JSON.stringify(currentIds) !== JSON.stringify([...CURRENT_WAVE_IDS].sort())) {
    errors.push(`inventory must contain exactly the current 0.54.0 retirement wave: ${CURRENT_WAVE_IDS.join(', ')}`);
  }
  const purposeIds = Array.isArray(purposeLedger && purposeLedger.retirements)
    ? purposeLedger.retirements.map((row) => row && row.id).filter(Boolean).sort()
    : [];
  if (JSON.stringify(purposeIds) !== JSON.stringify([...CURRENT_WAVE_IDS].sort())) {
    errors.push(`purpose retirement ledger must contain exactly ${CURRENT_WAVE_IDS.length} current-wave rows`);
  }
  const activeCommands = new Set(Array.isArray(commandManifest && commandManifest.commands)
    ? commandManifest.commands.map((row) => row && row.id).filter(Boolean)
    : []);
  const removedCommands = Array.isArray(commandManifest && commandManifest.removed_commands)
    ? commandManifest.removed_commands.map((row) => row && row.id).filter(Boolean).sort()
    : [];
  if (JSON.stringify(removedCommands) !== JSON.stringify([...REMOVED_COMMAND_IDS].sort())) {
    errors.push(`command removal ledger must contain exactly ${REMOVED_COMMAND_IDS.length} approved commands`);
  }
  for (const id of REMOVED_COMMAND_IDS) if (activeCommands.has(id)) errors.push(`removed command '${id}' is present in the active command set`);
  return { retiredRows, activeCommands, removedCommands };
}

function validateSuccessors({ inventory, errors }) {
  const activeIds = new Set((Array.isArray(inventory && inventory.skills) ? inventory.skills : [])
    .map((row) => row && row.id).filter((id) => typeof id === 'string'));
  const agents = new Set((Array.isArray(inventory && inventory.agent_roster) ? inventory.agent_roster : [])
    .filter((id) => typeof id === 'string'));
  for (const row of Array.isArray(inventory && inventory.retired_skills) ? inventory.retired_skills : []) {
    if (!row || row.retiredIn !== '0.54.0') continue;
    if (!Array.isArray(row.replacements) || row.replacements.length !== 1) {
      errors.push(`current-wave retirement '${row.id}' must have exactly one successor replacement`);
      continue;
    }
    const replacement = row.replacements[0];
    if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
      errors.push(`retirement '${row.id}' successor replacement must be an object`);
      continue;
    }
    if (!['skill', 'agent', 'model-default', 'external-skill', 'operator-action'].includes(replacement.kind)) {
      errors.push(`retirement '${row.id}' has an unsupported successor kind: ${replacement.kind}`);
      continue;
    }
    if (replacement.kind === 'skill' && !activeIds.has(replacement.id)) errors.push(`retirement '${row.id}' successor skill is not active: ${replacement.id}`);
    if (replacement.kind === 'agent' && !agents.has(replacement.id)) errors.push(`retirement '${row.id}' successor agent is not active: ${replacement.id}`);
    if (replacement.kind === 'external-skill' && !EXTERNAL_SUCCESSORS.has(replacement.id)) errors.push(`retirement '${row.id}' has an unregistered external successor: ${replacement.id}`);
    if (replacement.kind === 'operator-action' && !OPERATOR_SUCCESSORS.has(replacement.id)) errors.push(`retirement '${row.id}' has an unregistered operator successor: ${replacement.id}`);
  }
  return { activeIds, agents };
}

function readManifest(root, relativePath, label, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${label} cannot be read: ${error.message}`);
    return null;
  }
}

function validateRetirementClosure({
  root = process.cwd(),
  inventory,
  purposeLedger,
  commandManifest,
  activeFiles,
  activeReferences,
  historicalAllowlist = DEFAULT_HISTORICAL_ALLOWLIST,
} = {}) {
  const repositoryRoot = path.resolve(root);
  const errors = [];
  const loadedInventory = inventory || readManifest(repositoryRoot, 'manifests/distribution-inventory.json', 'distribution inventory', errors);
  const loadedPurpose = purposeLedger || readManifest(repositoryRoot, 'manifests/skill-purpose-decisions.json', 'purpose decision ledger', errors);
  const loadedCommands = commandManifest || readManifest(repositoryRoot, 'manifests/command-skill-dispositions.json', 'command disposition manifest', errors);
  if (!loadedInventory || !loadedPurpose || !loadedCommands) return { ok: false, errors, findings: [], activeFiles: [] };

  errors.push(...validateHistoricalAllowlist(repositoryRoot, historicalAllowlist));
  const exact = validateExactWave({ inventory: loadedInventory, purposeLedger: loadedPurpose, commandManifest: loadedCommands, errors });
  errors.push(...validateSkillRetirements({ inventory: loadedInventory }).errors);
  errors.push(...validateRenamedSkillNames({ inventory: loadedInventory }).errors);
  const purpose = validateSkillPurposeDecisions({ inventory: loadedInventory, ledger: loadedPurpose, root: repositoryRoot });
  errors.push(...purpose.errors);
  const command = validateCommandSkillDispositions({
    manifest: loadedCommands,
    root: repositoryRoot,
    skillIds: (loadedInventory.skills || []).map((skill) => skill.id),
    skills: loadedInventory.skills || [],
  });
  errors.push(...command.errors);

  for (const row of exact.retiredRows) {
    if (!row || typeof row.canonicalPath !== 'string') continue;
    if (fs.existsSync(path.join(repositoryRoot, row.canonicalPath))) errors.push(`retired skill path is present: ${row.canonicalPath}`);
  }
  for (const row of Array.isArray(loadedCommands.removed_commands) ? loadedCommands.removed_commands : []) {
    if (!row || typeof row.path !== 'string') continue;
    if (fs.existsSync(path.join(repositoryRoot, row.path))) errors.push(`removed command path is present: ${row.path}`);
  }
  validateSuccessors({ inventory: loadedInventory, errors });
  const scan = scanActiveReferences({
    inventory: loadedInventory,
    root: repositoryRoot,
    activeFiles,
    activeReferences,
    historicalAllowlist,
  });
  errors.push(...scan.errors);
  return {
    ok: errors.length === 0,
    errors,
    findings: scan.findings.map(clone),
    activeFiles: scan.files,
    currentWaveIds: [...CURRENT_WAVE_IDS],
    removedCommandIds: [...REMOVED_COMMAND_IDS],
  };
}

module.exports = {
  CURRENT_WAVE_IDS,
  DEFAULT_ACTIVE_PATHS,
  DEFAULT_HISTORICAL_ALLOWLIST,
  REMOVED_COMMAND_IDS,
  scanActiveReferences,
  validateHistoricalAllowlist,
  validateRetirementClosure,
};
