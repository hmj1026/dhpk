'use strict';

// Deterministic Cursor Plugin projection.
//
// The canonical Claude tree remains the authoring source.  This module emits a
// physical Cursor package with Cursor-owned frontmatter and paths; it never
// creates symlink projections and it deliberately keeps Codex/Claude policy
// fields out of Cursor documents.  The generated package is an interoperability
// artifact.  A structurally valid package is not evidence that a Cursor client
// loaded it (see runCursorConsumerProbe()).

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { RECEIPT_SCHEMA, SURFACE_OWNERS, resolveGeneratedFromTree } = require('./platform-provenance');
const { selectPortableSkills } = require('./agent-plugin-package');
const {
  compileDistribution,
  materializeDistribution,
  verifyDistribution,
} = require('./distribution-compiler');
const { ProjectionArtifactStore } = require('./projection-artifact-store');
const { bindSurfaceSelection } = require('./capability-bundle-selection');
const { createTraversalBudget, readFileBounded, readDirectoryEntries } = require('./bounded-filesystem');
const { redactSensitiveText } = require('./redaction');
const {
  parseToolList,
  rewriteCursorHarnessBody,
  cursorAgentModel,
  cursorDocumentDestinationName,
  retainsClaudePluginRoot,
} = require('./cursor-harness-adapt');
const { CURSOR_SESSION_ALLOWLIST, cloneCursorSessionFiles } = require('./cursor-session-home');

const GENERATOR_VERSION = '1.0.0';
const DEFAULT_CURSOR_PROBE_TIMEOUT_MS = 30_000;
const DEFAULT_CURSOR_PROBE_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_CURSOR_PROBE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CURSOR_PROBE_OUTPUT_BYTES = 4 * 1024 * 1024;
const CURSOR_PROBE_DIAGNOSTIC_MAX_LENGTH = 800;
const CURSOR_PROBE_REASON_CODES = Object.freeze([
  'READY',
  'PACKAGE_INVALID',
  'PACKAGE_UNAVAILABLE',
  'TOOL_UNAVAILABLE',
  'CLI_INCOMPATIBLE',
  'INVOCATION_INVALID',
  'AUTH_REQUIRED',
  'SESSION_UNAVAILABLE',
  'NETWORK_UNAVAILABLE',
  'SANDBOX_UNAVAILABLE',
  'SANDBOX_PATH_UNSAFE',
  'TIMEOUT_SILENT',
  'TIMEOUT_PARTIAL_OUTPUT',
  'OUTPUT_LIMIT',
  'NO_OUTPUT',
  'PROBE_FAILED',
]);
const CURSOR_STREAM_EVENT_TYPES = Object.freeze([
  'system', 'user', 'assistant', 'thinking', 'tool_call', 'tool_result', 'result',
]);
const CURSOR_STREAM_FRAME_KEYS = Object.freeze([
  'progress', 'stream', 'delta', 'partial', 'event', 'chunk',
]);
const CURSOR_DIAGNOSTIC_SAFE_KEYS = new Set([
  'type', 'subtype', 'status', 'code', 'is_error', 'signal', 'exit_code', 'reason_code', 'response',
]);
const CURSOR_DIAGNOSTIC_SENSITIVE_KEYS = /^(?:session[_-]?id|request[_-]?id|event[_-]?id|timestamp(?:[_-]?(?:ms|us|ns))?|created[_-]?at|updated[_-]?at|prompt|message|content|input|arguments|tool|tool[_-]?(?:call|result)|result|response|output|stdout|stderr)$/i;
const SANDBOX_PREFLIGHT_TIMEOUT_MS = 2_000;
const MAX_OPERATOR_STAGE_ENTRIES = 20_000;
const MAX_OPERATOR_STAGE_BYTES = 128 * 1024 * 1024;
const MASKED_SANDBOX_ROOTS = Object.freeze([
  '/home',
  '/root',
  '/run/user',
  '/run/secrets',
  '/var/run/secrets',
  '/etc/ssh',
  '/etc/ssl/private',
]);
const NEGATIVE_CURSOR_DISCOVERY_PATTERNS = Object.freeze([
  /\bno\s+dhpk\b.{0,120}\b(?:discovered|found|available|loaded|present)\b/i,
  /\bdhpk(?:\s+\w+){0,4}\b(?:no|none|zero)\b(?:\s+\w+){0,2}\b(?:skills?|commands?|agents?|rules?)\b/i,
  /\bdhpk\b.{0,80}\b(?:not\s+discovered|not\s+found|not\s+available|missing|unavailable)\b/i,
  /\bdhpk\b.{0,100}\b(?:couldn['’]?t|could not|unable to|failed to|fail(?:ed)? to)\b.{0,80}\b(?:skills?|commands?|agents?|rules?|load(?:ed|ing)?|discover(?:ed|y)?|find)\b/i,
]);
const CURSOR_PROBE_ENV_KEYS = Object.freeze([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'CI',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
]);
const CANONICAL_REPOSITORY_URL = 'https://github.com/hmj1026/dhpk/blob/main/';
const CURSOR_MANIFEST_FIELDS = new Set([
  '$schema',
  'name',
  'description',
  'version',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'logo',
  'rules',
  'agents',
  'skills',
  'commands',
  'hooks',
  'variables',
]);
const CURSOR_HOOK_EVENTS = new Set([
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'subagentStart',
  'subagentStop',
  'beforeShellExecution',
  'afterShellExecution',
  'beforeMCPExecution',
  'afterMCPExecution',
  'beforeReadFile',
  'afterFileEdit',
  'beforeSubmitPrompt',
  'preCompact',
  'stop',
  'afterAgentResponse',
  'afterAgentThought',
  'beforeTabFileRead',
  'afterTabFileEdit',
  'workspaceOpen',
]);
const COMPONENT_EXTENSIONS = Object.freeze({
  rules: new Set(['.md', '.mdc', '.markdown']),
  agents: new Set(['.md', '.mdc', '.markdown']),
  commands: new Set(['.md', '.mdc', '.markdown', '.txt']),
});
const SECRET_PATTERNS = [
  /-----BEGIN\s+(?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/i,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\n$]{8,}["']/i,
  /["'](?:api[_-]?key|secret|password|token|authorization)["']\s*:\s*["'](?!\$\{)[^"'\n]{8,}["']/i,
];
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SAFE_COMMAND_PATH = /^(?:\.?\/?[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._-]+)*$/;
const URL_CREDENTIAL_PATTERN = /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@/i;
const CONNECTION_SECRET_PATTERN = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s/@]+:[^\s/@]+@/i;

function lstatOrNull(candidate) {
  try {
    return fs.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertPhysicalAncestors(directory, label) {
  let current = path.resolve(directory);
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label} ancestor: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function ensurePhysicalDirectory(directory, label) {
  assertPhysicalAncestors(directory, label);
  const stat = lstatOrNull(directory);
  if (!stat) {
    fs.mkdirSync(directory, { recursive: true });
    return;
  }
  if (stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label}: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${directory}`);
  if (fs.realpathSync(directory) !== path.resolve(directory)) {
    throw new Error(`refusing ${label} whose realpath escapes its lexical root: ${directory}`);
  }
}

function physicalPackageRootError(directory) {
  try {
    assertPhysicalAncestors(directory, 'Cursor package root');
    const stat = lstatOrNull(directory);
    if (!stat || !stat.isDirectory()) return `Cursor package root must be a physical directory: ${directory}`;
    if (fs.realpathSync(directory) !== path.resolve(directory)) {
      return `Cursor package root realpath escapes its lexical root: ${directory}`;
    }
    return null;
  } catch (error) {
    return error.message;
  }
}

function boundedPhysicalPackageScan(directory, options = {}) {
  const budget = createTraversalBudget({
    maxEntries: options.maxEntries === undefined ? MAX_OPERATOR_STAGE_ENTRIES : options.maxEntries,
    maxBytes: options.maxBytes === undefined ? MAX_OPERATOR_STAGE_BYTES : options.maxBytes,
    maxDepth: options.maxDepth,
    maxFiles: options.maxFiles,
  });
  const walk = (current, depth) => {
    const stat = lstatOrNull(current);
    if (!stat) throw new Error(`package entry disappeared during physical scan: ${current}`);
    if (stat.isSymbolicLink()) throw new Error(`package contains symlink entry: ${current}`);
    if (stat.isFile()) {
      budget.accountFile(current, stat, current);
      return;
    }
    if (!stat.isDirectory()) throw new Error(`package contains non-regular entry: ${current}`);
    const realDirectory = budget.enterDirectory(current, depth);
    try {
      for (const entry of readDirectoryEntries(current, { budget })) {
        walk(path.join(current, entry.name), depth + 1);
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  walk(path.resolve(directory), 0);
  return { entries: budget.entries, files: budget.files, bytes: budget.bytes };
}

function assertPhysicalPackageRoot(directory, label = 'package') {
  const resolved = path.resolve(directory);
  const error = physicalPackageRootError(resolved);
  if (error) throw new Error(`${label} is not a physical package root: ${error}`);
  try {
    // Keep the physical staging scan separate from the package identity
    // fingerprint: generated bytecode is intentionally omitted from the
    // identity hash, but it must still be bounded and symlink-free before a
    // caller copies or executes the package.
    boundedPhysicalPackageScan(resolved);
    fingerprintDir(resolved);
  } catch (scanError) {
    throw new Error(`${label} failed bounded physical scan: ${scanError.message}`);
  }
  return resolved;
}

function findSymlinks(directory, options = {}) {
  const budget = createTraversalBudget(options);
  const walk = (current, depth) => {
    const found = [];
    const stat = lstatOrNull(current);
    if (!stat) return found;
    if (stat.isSymbolicLink()) return [current];
    if (!stat.isDirectory()) return found;
    const realDirectory = budget.enterDirectory(current, depth);
    try {
      for (const entry of readDirectoryEntries(current, { budget })) {
        const child = path.join(current, entry.name);
        if (entry.isSymbolicLink()) found.push(child);
        else if (entry.isDirectory()) found.push(...walk(child, depth + 1));
      }
      return found;
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  return walk(directory, 0);
}

function stripLeadingDotSlash(value) {
  return String(value).replace(/^\.\//, '');
}

function isSafeRelativePath(value, { allowDot = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (allowDot && (value === '.' || value === './')) return true;
  const normalizedInput = stripLeadingDotSlash(value);
  if (!normalizedInput || normalizedInput === '.' || normalizedInput.startsWith('../') || normalizedInput.includes('/../') || normalizedInput.endsWith('/..')) return false;
  const normalized = path.posix.normalize(normalizedInput);
  return normalized === normalizedInput && normalized !== '..' && !normalized.startsWith('../');
}

function resolveContained(root, relative, { allowDot = false } = {}) {
  if (!isSafeRelativePath(relative, { allowDot })) return null;
  const resolved = path.resolve(root, stripLeadingDotSlash(relative));
  return isInside(root, resolved) ? resolved : null;
}

function assertProjectionDestination(root, outDir, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  if (resolvedRoot === resolvedOut || isInside(resolvedOut, resolvedRoot)) {
    throw new Error(`${label} output must not be the canonical root or its ancestor: ${resolvedOut}`);
  }
  for (const source of ['skills', 'rules', 'agents', 'commands', 'hooks', 'modules', 'scripts', 'docs', 'manifests']) {
    if (isInside(path.join(resolvedRoot, source), resolvedOut)) throw new Error(`${label} output overlaps canonical source tree: ${resolvedOut}`);
  }
  assertPhysicalAncestors(path.dirname(resolvedOut), `${label} output`);
  const existing = lstatOrNull(resolvedOut);
  if (existing && existing.isSymbolicLink()) throw new Error(`${label} output must not be a symlink: ${resolvedOut}`);
}

function confinedChild(parent, name) {
  if (!isSafeRelativePath(name)) throw new Error(`Cursor output path is unsafe: ${name}`);
  const child = path.resolve(parent, stripLeadingDotSlash(name));
  if (path.dirname(child) !== path.resolve(parent)) throw new Error(`Cursor output path escapes its parent: ${name}`);
  return child;
}

function parseScalar(value) {
  const trimmed = String(value == null ? '' : value).trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) && trimmed.length >= 2) return trimmed.slice(1, -1).replace(/''/g, "'");
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) && trimmed.length >= 2) {
    try { return JSON.parse(trimmed); } catch (_) { return trimmed.slice(1, -1); }
  }
  return trimmed;
}

function parseFrontmatter(content) {
  const clean = String(content).replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { present: false, fields: {}, body: clean };
  const lines = match[1].split(/\r?\n/);
  const fields = Object.create(null);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s/.test(line)) continue;
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const raw = keyMatch[2].trim();
    if (/^[|>]/.test(raw)) {
      const block = [];
      let next = index + 1;
      while (next < lines.length && (/^\s+/.test(lines[next]) || lines[next].trim() === '')) {
        block.push(lines[next].replace(/^\s{2}/, ''));
        next += 1;
      }
      fields[key] = block.join(raw.startsWith('>') ? ' ' : '\n').trim();
      index = next - 1;
    } else {
      fields[key] = parseScalar(raw);
    }
  }
  return { present: true, fields, body: clean.slice(match[0].length) };
}

function firstHeading(body, fallback) {
  const heading = String(body).match(/^#\s+(.+?)\s*$/m);
  return heading ? heading[1].trim() : fallback;
}

function renderFrontmatter(fields, body) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) lines.push(`${key}: ${JSON.stringify(value)}`);
    else if (typeof value === 'boolean') lines.push(`${key}: ${value ? 'true' : 'false'}`);
    else if (key === 'name' && NAME_PATTERN.test(String(value))) lines.push(`${key}: ${String(value)}`);
    else lines.push(`${key}: ${JSON.stringify(String(value))}`);
  }
  lines.push('---');
  const normalizedBody = String(body || '').replace(/^\r?\n/, '');
  return `${lines.join('\n')}\n${normalizedBody}${normalizedBody.endsWith('\n') || normalizedBody.length === 0 ? '' : '\n'}`;
}

function adaptSkill(content, publicName) {
  const parsed = parseFrontmatter(content);
  const name = parsed.fields.name;
  const description = parsed.fields.description;
  if (!parsed.present || !name || !description) return { ok: false, reason: 'requires name and description frontmatter' };
  if (name !== publicName) return { ok: false, reason: `frontmatter name '${name}' does not match public name '${publicName}'` };
  if (!NAME_PATTERN.test(name)) return { ok: false, reason: `frontmatter name '${name}' is not Cursor-safe` };
  return { ok: true, content: renderFrontmatter({ name, description }, parsed.body), transform: 'agent-skills-frontmatter' };
}

function sanitizeMarkdownLinks(content, sourceFile, canonicalRoot) {
  return String(content).replace(/(\[[^\]]*\])\(([^)]+)\)/g, (whole, label, rawTarget) => {
    const target = rawTarget.trim();
    if (!target || target.startsWith('#') || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(target)) return whole;
    const pathPart = target.split('#', 1)[0].trim();
    if (!pathPart) return whole;
    const resolved = path.resolve(path.dirname(sourceFile), pathPart);
    if (!isInside(canonicalRoot, resolved) || !fs.existsSync(resolved)) return label;
    const relative = path.relative(canonicalRoot, resolved).split(path.sep).join('/');
    const fragment = target.includes('#') ? `#${target.split('#').slice(1).join('#')}` : '';
    return `${label}(${CANONICAL_REPOSITORY_URL}${relative}${fragment})`;
  });
}

function adaptNativeDocument(content, kind, basename, sourceFile = null, canonicalRoot = null) {
  const parsed = parseFrontmatter(content);
  const fallbackName = basename.replace(/\.(?:md|mdc|markdown|txt)$/i, '').toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
  const name = parsed.fields.name || fallbackName;
  const description = parsed.fields.description || firstHeading(parsed.body, `${kind} component ${name}`);
  if (!name || !description || !NAME_PATTERN.test(name)) return { ok: false, reason: 'requires Cursor-safe name and description' };
  const fields = { name, description };
  if (kind === 'rules') {
    fields.alwaysApply = parsed.fields.alwaysApply === true || String(parsed.fields.alwaysApply).toLowerCase() === 'true';
    if (parsed.fields.globs) fields.globs = parsed.fields.globs;
  }
  if (kind === 'agents') {
    fields.model = cursorAgentModel(parsed.fields.name || basename);
    const tools = parseToolList(parsed.fields.tools);
    fields.readonly = !(tools.includes('Write') || tools.includes('Edit'));
  }
  let body = rewriteCursorHarnessBody(parsed.body);
  if (sourceFile && canonicalRoot) body = sanitizeMarkdownLinks(body, sourceFile, canonicalRoot);
  if (retainsClaudePluginRoot(body)) {
    return { ok: false, reason: 'retains unsupported Claude plugin-root interpolation' };
  }
  return { ok: true, content: renderFrontmatter(fields, body), transform: `cursor-${kind}-frontmatter` };
}

function stableInventoryDigest(inventory) {
  const source = { ...(inventory || {}) };
  delete source.profile_policy;
  return crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

function listComponentFiles(directory, extensions) {
  if (!fs.existsSync(directory)) return [];
  return readDirectoryEntries(directory)
    .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()) && !/^(?:INDEX|README)\./i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function surfaceIds(inventory, surface) {
  const membership = inventory && inventory.surface_membership;
  if (membership && Object.prototype.hasOwnProperty.call(membership, surface)) return new Set((membership[surface] || []).filter((id) => typeof id === 'string'));
  return new Set((inventory && inventory.skills || []).filter((skill) => (skill.surfaces || []).includes(surface)).map((skill) => skill.id));
}

function matrixSelection(inventory, surface, kind) {
  const entries = inventory && inventory.platform_matrix && Array.isArray(inventory.platform_matrix.entries)
    ? inventory.platform_matrix.entries.filter((entry) => entry && entry.surface === surface)
    : [];
  const ids = [];
  const keys = [
    'stable_ids', 'stableIds',
    'source_id', 'sourceId', 'source_ids', 'sourceIds',
    'skill_id', 'skillId', 'skill_ids', 'skillIds',
    'selected_id', 'selectedId', 'selected_ids', 'selectedIds',
    'ids',
  ];
  for (const entry of entries) {
    if (kind && entry.public_name && !new RegExp(kind, 'i').test(`${entry.public_name} ${entry.destination || ''} ${entry.transform || ''}`)) continue;
    for (const key of keys) {
      if (Array.isArray(entry[key])) ids.push(...entry[key]);
      else if (typeof entry[key] === 'string') ids.push(entry[key]);
    }
  }
  return new Set(ids.filter((id) => typeof id === 'string'));
}

function projectionSelection(inventory, surface) {
  const projections = inventory && inventory.projections;
  if (!projections) return new Set();
  const selected = Array.isArray(projections) ? projections : projections[surface];
  const values = Array.isArray(selected)
    ? selected
    : selected && typeof selected === 'object' ? Object.values(selected).flatMap((value) => Array.isArray(value) ? value : [value]) : [];
  const ids = values.map((value) => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return null;
    return value.source_id || value.sourceId || value.skill_id || value.skillId || value.id;
  });
  return new Set(ids.filter((id) => typeof id === 'string'));
}

function selectCursorSkills(inventory, selectedStableIds = null) {
  if (Array.isArray(selectedStableIds)) {
    const selected = new Set(selectedStableIds);
    return (inventory && inventory.skills || [])
      .filter((skill) => skill && skill.lifecycle !== 'deprecated' && (selected.has(skill.id) || selected.has(skill.name)))
      .sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)));
  }
  const explicit = surfaceIds(inventory, 'cursor-plugin');
  const projection = projectionSelection(inventory, 'cursor-plugin');
  const matrix = matrixSelection(inventory, 'cursor-plugin', 'skill');
  const selectedIds = matrix.size > 0 ? matrix : projection;
  const hasSelectedIds = selectedIds.size > 0;
  return (inventory && inventory.skills || []).filter((skill) => {
    if (!skill || skill.lifecycle === 'deprecated') return false;
    if (hasSelectedIds) return selectedIds.has(skill.id) || selectedIds.has(skill.name);
    return explicit.has(skill.id) || explicit.has(skill.name);
  }).sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)));
}

function skillMatrixEntries(inventory) {
  const entries = inventory && inventory.platform_matrix && Array.isArray(inventory.platform_matrix.entries)
    ? inventory.platform_matrix.entries.filter((entry) => entry && entry.surface === 'cursor-plugin')
    : [];
  return entries.filter((entry) => {
    const sourcePaths = Array.isArray(entry.source_paths) ? entry.source_paths : [];
    return sourcePaths.some((source) => source === 'skills/' || String(source).startsWith('skills/'))
      || /skills/i.test(`${entry.public_name || ''} ${entry.destination || ''} ${entry.transform || ''}`);
  });
}

function matrixEntryIds(entry) {
  const values = [];
  for (const key of ['stable_ids', 'stableIds', 'source_id', 'sourceId', 'source_ids', 'sourceIds', 'skill_id', 'skillId', 'skill_ids', 'skillIds', 'selected_id', 'selectedId', 'selected_ids', 'selectedIds', 'ids']) {
    if (Array.isArray(entry && entry[key])) values.push(...entry[key]);
    else if (typeof (entry && entry[key]) === 'string') values.push(entry[key]);
  }
  return values.filter((value) => typeof value === 'string');
}

function cursorSkillProjection(inventory, selectedStableIds = null) {
  const rows = skillMatrixEntries(inventory);
  const projectionMode = (entry) => entry.projection_mode || (entry.shared_surface ? 'shared' : 'overlay');
  const sharedRows = rows.filter((entry) => projectionMode(entry) === 'shared');
  const overlayRows = rows.filter((entry) => projectionMode(entry) === 'overlay');
  const byId = new Map((inventory && inventory.skills || []).map((skill) => [skill && skill.id, skill]));
  const agentSkills = selectPortableSkills(inventory, 'agent-plugin', selectedStableIds);
  const sharedIds = new Set(sharedRows.flatMap(matrixEntryIds));
  if (sharedRows.length > 0 && sharedIds.size === 0) agentSkills.forEach((skill) => sharedIds.add(skill.id));
  const overlayIds = new Set(overlayRows.flatMap(matrixEntryIds));
  const hasExplicitRows = rows.length > 0;
  const overlaySkills = hasExplicitRows && overlayIds.size > 0
    ? (inventory.skills || []).filter((skill) => overlayIds.has(skill.id) || overlayIds.has(skill.name))
    : (hasExplicitRows && overlayRows.length === 0 ? [] : selectCursorSkills(inventory, selectedStableIds));
  const sharedSurface = sharedRows.length > 0 ? sharedRows[0].shared_surface : null;
  return {
    mode: sharedRows.length > 0 && overlaySkills.length === 0 ? 'shared' : (overlaySkills.length > 0 ? 'overlay' : null),
    sharedSurface,
    sharedSkills: [...sharedIds].map((id) => byId.get(id)).filter(Boolean).sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id))),
    overlaySkills: overlaySkills.filter((skill, index, all) => all.findIndex((candidate) => candidate.id === skill.id) === index).sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id))),
  };
}

function safeVariables(variables) {
  if (!variables) return { type: 'object', properties: {} };
  if (typeof variables !== 'object' || Array.isArray(variables)) throw new Error('Cursor variables must be a JSON Schema object');
  const copy = JSON.parse(JSON.stringify(variables));
  if (!copy.type) copy.type = 'object';
  if (!copy.properties) copy.properties = {};
  return copy;
}

function buildManifest({ name, version, variables, componentDirs, hasHooks }) {
  const manifest = {
    name,
    version,
    description: 'dhpk Cursor Plugin projection (generated from canonical sources).',
    author: { name: 'hmj1026' },
    homepage: 'https://github.com/hmj1026/dhpk',
    repository: 'https://github.com/hmj1026/dhpk',
    license: 'MIT',
    keywords: ['dhpk', 'agent', 'cursor'],
  };
  if (componentDirs.skills) manifest.skills = './skills/';
  if (componentDirs.rules) manifest.rules = './rules/';
  if (componentDirs.agents) manifest.agents = './agents/';
  if (componentDirs.commands) manifest.commands = './commands/';
  if (hasHooks) manifest.hooks = './hooks/hooks.json';
  manifest.variables = variables;
  return manifest;
}

function writeMarketplace(outDir, name, version) {
  const marketplace = {
    name: 'dhpk',
    owner: { name: 'hmj1026' },
    metadata: {
      description: 'Local Cursor Plugin marketplace fixture for dhpk.',
      version,
      pluginRoot: '.',
    },
    plugins: [{
      name,
      source: '.',
      description: 'dhpk Cursor Plugin projection',
      version,
      license: 'MIT',
    }],
  };
  fs.writeFileSync(path.join(outDir, '.cursor-plugin', 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);
  return marketplace;
}

function fingerprintPath(target, options = {}) {
  const stat = lstatOrNull(target);
  if (!stat) return '';
  if (stat.isSymbolicLink()) throw new Error(`cannot fingerprint symlink entry: ${target}`);
  const budget = createTraversalBudget(options);
  const hashNode = (current, depth) => {
    const currentStat = lstatOrNull(current);
    if (!currentStat) return '';
    if (currentStat.isSymbolicLink()) throw new Error(`cannot fingerprint symlink entry: ${current}`);
    if (currentStat.isDirectory()) {
      const realDirectory = budget.enterDirectory(current, depth);
      try {
        const nodeDigest = crypto.createHash('sha256');
        nodeDigest.update('directory\0');
        for (const entry of readDirectoryEntries(current, { budget, sort: true })) {
          const name = entry.name;
          if (name === '__pycache__' || name.endsWith('.pyc')) continue;
          nodeDigest.update(name);
          nodeDigest.update('\0');
          nodeDigest.update(hashNode(path.join(current, name), depth + 1));
          nodeDigest.update('\0');
        }
        return nodeDigest.digest('hex');
      } finally {
        budget.leaveDirectory(realDirectory);
      }
    }
    if (currentStat.isFile()) {
      const nodeDigest = crypto.createHash('sha256');
      nodeDigest.update('file\0');
      nodeDigest.update(budget.readFile(current, currentStat));
      return nodeDigest.digest('hex');
    }
    throw new Error(`cannot fingerprint special entry: ${current}`);
  };
  if (stat.isDirectory()) {
    return hashNode(target, 0);
  }
  if (stat.isFile()) {
    const fileDigest = crypto.createHash('sha256');
    fileDigest.update('file\0');
    fileDigest.update(budget.readFile(target, stat));
    return fileDigest.digest('hex');
  }
  throw new Error(`cannot fingerprint special entry: ${target}`);
}

function fingerprintDir(directory, options = {}) {
  return fingerprintPath(directory, options);
}

function collectCursorPhysicalTree(source, destination = '', { sourceRoot, filter = () => true, budget = null, depth = 0 } = {}) {
  const traversalBudget = budget || createTraversalBudget();
  const sourceStat = lstatOrNull(source);
  if (!sourceStat) throw new Error(`Cursor source path does not exist: ${source}`);
  if (sourceStat.isSymbolicLink()) {
    let target;
    try { target = fs.realpathSync(source); } catch (_) { throw new Error(`broken Cursor source symlink: ${source}`); }
    if (!isInside(sourceRoot, target)) throw new Error(`Cursor source symlink target escapes source root: ${source}`);
    return collectCursorPhysicalTree(target, destination, { sourceRoot, filter, budget: traversalBudget, depth: depth + 1 });
  }
  if (sourceStat.isDirectory()) {
    const files = [];
    const realDirectory = traversalBudget.enterDirectory(source, depth);
    try {
      for (const entry of readDirectoryEntries(source, { budget: traversalBudget, sort: true, localeSort: true })) {
        const child = path.join(source, entry.name);
        const relative = path.relative(sourceRoot, child).split(path.sep).join('/');
        if (entry.name === '__pycache__' || relative.endsWith('.pyc') || !filter(relative, child, entry)) continue;
        files.push(...collectCursorPhysicalTree(child, path.posix.join(destination, entry.name), { sourceRoot, filter, budget: traversalBudget, depth: depth + 1 }));
      }
    } finally {
      traversalBudget.leaveDirectory(realDirectory);
    }
    return files;
  }
  if (!sourceStat.isFile()) throw new Error(`unsupported Cursor source filesystem entry: ${source}`);
  const real = fs.realpathSync(source);
  if (!isInside(sourceRoot, real)) throw new Error(`Cursor source symlink target escapes source root: ${source}`);
  const sourceRelative = path.relative(sourceRoot, source).split(path.sep).join('/');
  const contentBuffer = traversalBudget.readFile(source, fs.statSync(source));
  const content = path.extname(source).toLowerCase() === '.md'
    ? Buffer.from(sanitizeMarkdownLinks(contentBuffer.toString('utf8'), source, sourceRoot))
    : contentBuffer;
  return [{
    source: sourceRelative,
    destination,
    content,
    mode: fs.statSync(source).mode & 0o777,
  }];
}

function collectAdaptedCursorDocuments(sourceDir, destinationDir, kind, transformations, canonicalRoot, traversalBudget) {
  if (!fs.existsSync(sourceDir)) return { files: [], names: [] };
  const files = [];
  const names = [];
  for (const source of listComponentFiles(sourceDir, COMPONENT_EXTENSIONS[kind])) {
    const name = path.basename(source);
    const sourceStat = fs.statSync(source);
    const adapted = adaptNativeDocument(traversalBudget.readFile(source, sourceStat).toString('utf8'), kind, name, source, canonicalRoot);
    if (!adapted.ok) {
      transformations.push({ source: path.relative(sourceDir, source).split(path.sep).join('/'), destination: null, transform: `SKIP_INCOMPATIBLE: ${adapted.reason}` });
      continue;
    }
    const destName = cursorDocumentDestinationName(kind, name);
    const output = {
      source: path.relative(sourceDir, source).split(path.sep).join('/'),
      destination: path.posix.join(destinationDir, destName),
      content: Buffer.from(adapted.content),
      mode: 0o644,
    };
    traversalBudget.accountBytes(output.content.byteLength, output.destination);
    files.push(output);
    names.push(destName);
    transformations.push({ source: path.relative(sourceDir, source).split(path.sep).join('/'), destination: path.posix.join(destinationDir, destName), transform: adapted.transform });
  }
  return { files, names };
}

function collectAdaptedCursorHooks(root, transformations, traversalBudget) {
  const sourcePath = path.join(root, 'hooks', 'hooks.json');
  const adapted = { hooks: {} };
  const files = [];
  if (fs.existsSync(sourcePath)) {
    let source;
    try { source = JSON.parse(traversalBudget.readFile(sourcePath, fs.statSync(sourcePath)).toString('utf8')); } catch (error) {
      transformations.push({ source: 'hooks/hooks.json', destination: 'hooks/hooks.json', transform: `SKIP_INCOMPATIBLE: invalid JSON (${error.message})` });
      const output = { source: 'hooks/hooks.json', destination: 'hooks/hooks.json', content: Buffer.from(`${JSON.stringify(adapted, null, 2)}\n`), mode: 0o644 };
      traversalBudget.accountBytes(output.content.byteLength, output.destination);
      files.push(output);
      return { adapted, files };
    }
    for (const event of Object.keys(source && source.hooks || {}).sort()) {
      if (!CURSOR_HOOK_EVENTS.has(event) || !Array.isArray(source.hooks[event])) {
        transformations.push({ source: `hooks/hooks.json#${event}`, destination: null, transform: 'SKIP_INCOMPATIBLE: unsupported Cursor hook event or shape' });
        continue;
      }
      for (const [index, hook] of source.hooks[event].entries()) {
        if (!hook || typeof hook !== 'object' || Array.isArray(hook) || Object.keys(hook).some((key) => !['command', 'matcher'].includes(key))) {
          transformations.push({ source: `hooks/hooks.json#${event}[${index}]`, destination: null, transform: 'SKIP_INCOMPATIBLE: unknown hook field' });
          continue;
        }
        const command = hook && typeof hook.command === 'string' ? hook.command : null;
        if (!command || !isSafeRelativePath(command) || !SAFE_COMMAND_PATH.test(stripLeadingDotSlash(command))) {
          transformations.push({ source: `hooks/hooks.json#${event}[${index}]`, destination: null, transform: 'SKIP_INCOMPATIBLE: command is not a package-relative path' });
          continue;
        }
        const sourceCommand = resolveContained(root, command);
        if (!sourceCommand || !fs.existsSync(sourceCommand) || !fs.statSync(sourceCommand).isFile()) {
          transformations.push({ source: `hooks/hooks.json#${event}[${index}]`, destination: null, transform: 'SKIP_INCOMPATIBLE: command file is missing' });
          continue;
        }
        const destinationName = `${event}-${index}-${path.basename(sourceCommand)}`;
        const destination = `hooks/commands/${destinationName}`;
        files.push(...collectCursorPhysicalTree(sourceCommand, destination, { sourceRoot: root, budget: traversalBudget }));
        const entry = { command: `./${destination}` };
        if (hook.matcher) entry.matcher = String(hook.matcher);
        adapted.hooks[event] = adapted.hooks[event] || [];
        adapted.hooks[event].push(entry);
        transformations.push({ source: `hooks/hooks.json#${event}[${index}]`, destination, transform: 'cursor-hook-contained-command' });
      }
    }
  } else {
    transformations.push({ source: null, destination: 'hooks/hooks.json', transform: 'no-canonical-hooks' });
  }
  const output = { source: 'hooks/hooks.json', destination: 'hooks/hooks.json', content: Buffer.from(`${JSON.stringify(adapted, null, 2)}\n`), mode: 0o644 };
  traversalBudget.accountBytes(output.content.byteLength, output.destination);
  files.push(output);
  return { adapted, files };
}

function cursorVirtualFingerprint(files, prefix) {
  const normalized = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
  const exact = files.find((file) => file.destination === prefix);
  if (exact) return crypto.createHash('sha256').update('file\0').update(exact.content).digest('hex');
  const names = new Set();
  for (const file of files) {
    if (!file.destination.startsWith(normalized)) continue;
    const remainder = file.destination.slice(normalized.length);
    if (remainder) names.add(remainder.split('/')[0]);
  }
  if (names.size === 0) return '';
  const hash = crypto.createHash('sha256').update('directory\0');
  for (const name of [...names].sort()) {
    hash.update(name).update('\0').update(cursorVirtualFingerprint(files, prefix ? `${prefix}/${name}` : name)).update('\0');
  }
  return hash.digest('hex');
}

function cursorReadmeContents() {
  return {
    'README.md': [
      '# dhpk Cursor Plugin package',
      '',
      'This physical Cursor-native projection is generated from the canonical inventory.',
      'Portable skills are owned by the standard Agent Plugin package at',
      '`plugins/dhpk-agent/skills/` and are not duplicated here unless an explicit',
      'inventory overlay is selected.',
      'Follow the [platform installation guide](../../docs/platform-installation.md)',
      'for coordinated installation, verification, and Cursor-only rollback.',
      'The marketplace/local plugin route is this package. The supported project-local',
      'route is `bash scripts/hooks/install-cursor-harness.sh` into `.cursor/` (native',
      'hooks are not mapped in v1).',
      '',
    ].join('\n'),
    'README.zh-TW.md': [
      '# dhpk Cursor Plugin 套件',
      '',
      '此 physical Cursor-native projection 由 canonical inventory 產生。portable skills 由 standard Agent Plugin 的 `plugins/dhpk-agent/skills/` 單獨擁有，除非明確選擇 environment overlay，不在此重複複製。協同安裝、驗證與 Cursor-only rollback 請依照[平台安裝指南](../../docs/platform-installation.zh-TW.md)。marketplace／local plugin 路徑是此套件；支援的 project-local 路徑是 `bash scripts/hooks/install-cursor-harness.sh`（v1 不映射 native hooks）。',
      '',
    ].join('\n'),
  };
}

function buildCursorProjection({ inventory, root, name, version, sourceCommit, generatorVersion, variables, traversalOptions = {}, selectionMode = 'compiler', profileSelection = null }) {
  if (profileSelection) {
    const bound = bindSurfaceSelection({ selection: profileSelection, surface: 'cursor-plugin' });
    if (!bound.ok) throw new Error(bound.error.message);
    profileSelection = bound.value;
  }
  const resolvedRoot = path.resolve(root);
  const transformations = [];
  const skippedSkills = [];
  const files = [];
  const traversalBudget = createTraversalBudget(traversalOptions);
  const selection = selectionMode === 'legacy' ? null : compileDistribution({ inventory, surface: 'cursor-plugin', profileSelection });
  if (selection && !selection.ok) throw new Error(selection.error.message);
  const skillProjection = cursorSkillProjection(
    inventory,
    selection && selection.value.selectionPolicy ? selection.value.selectedStableIds : null,
  );
  const selectedIds = [];
  const selectedNames = [];
  if (skillProjection.sharedSkills.length > 0) {
    transformations.push({ source: 'plugins/dhpk-agent/skills/', destination: null, transform: 'shared-surface:agent-plugin', stableIds: skillProjection.sharedSkills.map((skill) => skill.id).sort() });
  }
  for (const skill of skillProjection.overlaySkills) {
    const publicName = skill.name || skill.id;
    const sourceDir = resolveContained(resolvedRoot, skill.path);
    const sourceSkill = sourceDir && path.join(sourceDir, 'SKILL.md');
    if (!sourceDir || !sourceSkill || !fs.existsSync(sourceSkill)) {
      skippedSkills.push({ id: skill.id, name: publicName, reason: 'source SKILL.md is missing' });
      continue;
    }
    const adapted = adaptSkill(traversalBudget.readFile(sourceSkill, fs.statSync(sourceSkill)).toString('utf8'), publicName);
    if (!adapted.ok) {
      skippedSkills.push({ id: skill.id, name: publicName, reason: adapted.reason });
      continue;
    }
    const skillFiles = collectCursorPhysicalTree(sourceDir, `skills/${publicName}`, {
      sourceRoot: resolvedRoot,
      budget: traversalBudget,
      filter: (relative) => !/(?:^|\/)agents\/openai\.yaml$/.test(relative),
    });
    const skillFile = skillFiles.find((file) => file.destination === `skills/${publicName}/SKILL.md`);
    if (!skillFile) throw new Error(`Cursor source skill is missing SKILL.md: ${skill.path}`);
    skillFile.content = Buffer.from(adapted.content);
    traversalBudget.accountBytes(skillFile.content.byteLength, skillFile.destination);
    selectedIds.push(skill.id);
    selectedNames.push(publicName);
    files.push(...skillFiles);
    transformations.push({ source: skill.path, destination: `skills/${publicName}`, transform: adapted.transform });
  }

  const componentDirs = {};
  for (const kind of ['rules', 'agents', 'commands']) {
    const result = collectAdaptedCursorDocuments(path.join(resolvedRoot, kind), kind, kind, transformations, resolvedRoot, traversalBudget);
    if (result.files.length > 0) componentDirs[kind] = true;
    files.push(...result.files);
  }
  const hooks = collectAdaptedCursorHooks(resolvedRoot, transformations, traversalBudget);
  files.push(...hooks.files);
  const cursorVariables = safeVariables(variables || inventory.cursor_variables || inventory.cursorVariables || inventory.variables);
  const manifest = buildManifest({ name, version, variables: cursorVariables, componentDirs: { ...componentDirs, skills: selectedNames.length > 0 }, hasHooks: true });
  const marketplace = {
    name: 'dhpk',
    owner: { name: 'hmj1026' },
    metadata: { description: 'Local Cursor Plugin marketplace fixture for dhpk.', version, pluginRoot: '.' },
    plugins: [{ name, source: '.', description: 'dhpk Cursor Plugin projection', version, license: 'MIT' }],
  };
  const manifestOutput = { source: 'generated/.cursor-plugin/plugin.json', destination: '.cursor-plugin/plugin.json', content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), mode: 0o644 };
  const marketplaceOutput = { source: 'generated/.cursor-plugin/marketplace.json', destination: '.cursor-plugin/marketplace.json', content: Buffer.from(`${JSON.stringify(marketplace, null, 2)}\n`), mode: 0o644 };
  traversalBudget.accountBytes(manifestOutput.content.byteLength, manifestOutput.destination);
  traversalBudget.accountBytes(marketplaceOutput.content.byteLength, marketplaceOutput.destination);
  files.push(manifestOutput);
  files.push(marketplaceOutput);
  const fingerprints = {};
  for (const relative of ['skills', 'rules', 'agents', 'commands', 'hooks/hooks.json']) {
    const value = cursorVirtualFingerprint(files, relative);
    if (value) fingerprints[relative] = value;
  }
  const generatedFromTree = resolveGeneratedFromTree(resolvedRoot, sourceCommit);
  const provenance = {
    schema: RECEIPT_SCHEMA,
    surface: 'cursor-plugin',
    selectionMode,
    owner: SURFACE_OWNERS['cursor-plugin'],
    packageRoot: 'plugins/dhpk-cursor',
    sourceVersion: version,
    sourceCommit,
    generatedFromCommit: sourceCommit,
    ...(generatedFromTree ? { generatedFromTree } : {}),
    inventoryDigest: stableInventoryDigest(inventory),
    generatorVersion,
    selectedSkillIds: [...selectedIds].sort(),
    selectedSkillNames: [...selectedNames].sort(),
    skillProjectionMode: skillProjection.mode,
    sharedSkillSurface: skillProjection.sharedSurface,
    sharedSkillSource: skillProjection.sharedSkills.length > 0 ? 'plugins/dhpk-agent/skills/' : null,
    sharedSkillIds: skillProjection.sharedSkills.map((skill) => skill.id).sort(),
    sharedSkillNames: skillProjection.sharedSkills.map((skill) => skill.name || skill.id).sort(),
    skippedSkills: skippedSkills.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))),
    transformations: transformations.slice().sort((a, b) => `${a.source || ''}:${a.destination || ''}`.localeCompare(`${b.source || ''}:${b.destination || ''}`)),
    fingerprints,
    consumer: { status: 'NOT_RUN', reason: 'Cursor client consumer probe is separate from structural generation.' },
    ...(profileSelection ? {
      profileId: profileSelection.profileId || profileSelection.id,
      selectedStableIds: profileSelection.selectedStableIds,
      canonicalSelectedStableIds: profileSelection.selectedStableIds,
      emittedStableIds: profileSelection.emittedStableIds || profileSelection.selectedStableIds,
      compatibilityMode: profileSelection.compatibilityMode || profileSelection.mode || null,
      selectionPolicyVersion: profileSelection.selectionPolicyVersion || null,
      selectionFingerprint: profileSelection.selectionFingerprint || null,
      surfaceSelectionFingerprint: profileSelection.surfaceSelectionFingerprint || null,
    } : {}),
  };
  const fingerprintsOutput = { source: 'generated/fingerprints.json', destination: 'fingerprints.json', content: Buffer.from(`${JSON.stringify(fingerprints, null, 2)}\n`), mode: 0o644 };
  const provenanceOutput = { source: 'generated/provenance.json', destination: 'provenance.json', content: Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`), mode: 0o644 };
  traversalBudget.accountBytes(fingerprintsOutput.content.byteLength, fingerprintsOutput.destination);
  traversalBudget.accountBytes(provenanceOutput.content.byteLength, provenanceOutput.destination);
  files.push(fingerprintsOutput);
  files.push(provenanceOutput);
  for (const [destination, content] of Object.entries(cursorReadmeContents())) {
    const output = { source: `generated/${destination}`, destination, content: Buffer.from(content), mode: 0o644 };
    traversalBudget.accountBytes(output.content.byteLength, output.destination);
    files.push(output);
  }
  return {
    files,
    manifest,
    marketplace,
    selectedSkillIds: [...selectedIds].sort(),
    selectedSkillNames: [...selectedNames].sort(),
    skippedSkills: provenance.skippedSkills,
    fingerprints,
    provenance,
    traversalBudget,
    selection: selection && selection.ok ? selection.value : null,
  };
}

function compileCursorPackage({
  inventory,
  root,
  outDir,
  name = 'dhpk-cursor',
  version = '0.0.0',
  sourceCommit = 'unknown',
  generatorVersion = GENERATOR_VERSION,
  variables = null,
  traversalOptions = {},
  selectionMode = 'compiler',
  profileSelection = null,
} = {}) {
  if (!inventory || typeof inventory !== 'object') throw new Error('Cursor package inventory is required');
  if (!root || !outDir) throw new Error('Cursor package root and outDir are required');
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  ensurePhysicalDirectory(resolvedRoot, 'canonical root');
  assertProjectionDestination(resolvedRoot, resolvedOut, 'Cursor Plugin');
  const projection = buildCursorProjection({ inventory, root: resolvedRoot, name, version, sourceCommit, generatorVersion, variables, traversalOptions, selectionMode, profileSelection });
  const entries = projection.files.map((file) => ({
      stableId: `cursor:${file.destination}`,
      source: file.source,
      destination: file.destination,
      owner: SURFACE_OWNERS['cursor-plugin'],
      transform: { id: 'cursor-native-render', version: generatorVersion },
      // The receipt carries the compiled plan identity.  Exclude only that
      // receipt's own bytes from the plan input to avoid a self-referential
      // fingerprint; the store still validates its destination, mode, and
      // staged physical output.
      expectedFingerprint: file.destination === 'provenance.json'
        ? null
        : crypto.createHash('sha256').update(file.content).digest('hex'),
      mode: file.mode,
      symlinkPolicy: 'forbid',
  }));
  const compiled = compileDistribution({
      surface: 'cursor-plugin',
      compilerVersion: `cursor-${generatorVersion}`,
      inventoryFingerprint: stableInventoryDigest(inventory),
      // Plan identity is a contract identity, not a host-specific temp path.
      ownershipRoot: 'plugins/dhpk-cursor',
      entries,
      selectedStableIds: projection.selection && projection.selection.selectionPolicy
        ? projection.selection.selectedStableIds
        : undefined,
      selectionPolicy: projection.selection && projection.selection.selectionPolicy
        ? projection.selection.selectionPolicy
        : undefined,
      selectionEntries: projection.selection && projection.selection.selectionPolicy
        ? (projection.selection.selectionEntries || projection.selection.entries)
        : undefined,
      profileSelection,
      selectionFingerprint: profileSelection && profileSelection.selectionFingerprint,
      surfaceSelectionFingerprint: profileSelection && profileSelection.surfaceSelectionFingerprint,
  });
  if (!compiled.ok) throw new Error(compiled.error.message);
  projection.provenance.planFingerprint = compiled.value.planFingerprint;
  const provenanceOutput = projection.files.find((file) => file.destination === 'provenance.json');
  if (provenanceOutput) {
    const nextContent = Buffer.from(`${JSON.stringify(projection.provenance, null, 2)}\n`);
    if (nextContent.byteLength > provenanceOutput.content.byteLength) {
      // The initial receipt was budgeted during projection. Charge only the
      // additional bytes introduced by the compiler-bound plan fingerprint.
      projection.traversalBudget?.accountBytes(nextContent.byteLength - provenanceOutput.content.byteLength, provenanceOutput.destination);
    }
    provenanceOutput.content = nextContent;
  }
  const adapter = {
      identity: { id: 'cursor-plugin', version: generatorVersion },
      render: () => ({
        adapter: { id: 'cursor-plugin', version: generatorVersion },
        outputs: projection.files.slice().sort((left, right) => left.destination.localeCompare(right.destination)).map((file) => ({
          ...file,
          stableId: `cursor:${file.destination}`,
        })),
        links: [],
        metadata: {
          manifest: projection.manifest,
          marketplace: projection.marketplace,
          skillIds: projection.selectedSkillIds,
          skillNames: projection.selectedSkillNames,
          skippedSkills: projection.skippedSkills,
          fingerprints: projection.fingerprints,
          provenance: projection.provenance,
        },
      }),
      validate: (rendered, context) => {
        if (!context || !context.session || !context.session.stageRoot) return rendered;
        const validation = validateCursorPackage({
          packageRoot: context.session.stageRoot,
          expectedManifestName: rendered.metadata.manifest.name,
        });
        if (!validation.ok) throw new Error(`generated Cursor Plugin failed validation: ${validation.errors.join('; ')}`);
        return rendered;
      },
  };
  return {
    plan: compiled.value,
    adapter,
    manifest: projection.manifest,
    marketplace: projection.marketplace,
    selectedSkillIds: projection.selectedSkillIds,
    selectedSkillNames: projection.selectedSkillNames,
    skillIds: projection.selectedSkillIds,
    skillNames: projection.selectedSkillNames,
    sharedSkillIds: projection.provenance.sharedSkillIds,
    sharedSkillNames: projection.provenance.sharedSkillNames,
    sharedSkillSurface: projection.provenance.sharedSkillSurface,
    skippedSkills: projection.skippedSkills,
    fingerprints: projection.fingerprints,
    provenance: projection.provenance,
  };
}

function materializeCursorPackage(options = {}) {
  const { root, outDir } = options;
  if (!root || !outDir) throw new Error('Cursor package root and outDir are required');
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  ensurePhysicalDirectory(resolvedRoot, 'canonical root');
  assertProjectionDestination(resolvedRoot, resolvedOut, 'Cursor Plugin');
  const parent = path.dirname(resolvedOut);
  ensurePhysicalDirectory(parent, 'Cursor staging parent');
  const projection = options.compiledProjection || compileCursorPackage({ ...options, root: resolvedRoot, outDir: resolvedOut });
  const artifactStore = options.artifactStore || new ProjectionArtifactStore({
    root: parent,
    sourceRoot: resolvedRoot,
    publishRoot: resolvedOut,
  });
  const artifact = materializeDistribution(projection.plan, projection.adapter, artifactStore);
  if (!artifact.ok) throw new Error(`generated Cursor Plugin failed validation: ${artifact.error.message}`);
  const metadata = artifact.value.metadata || {};
  return {
    manifest: metadata.manifest || projection.manifest,
    marketplace: metadata.marketplace || projection.marketplace,
    manifestPath: path.join(resolvedOut, '.cursor-plugin', 'plugin.json'),
    skillIds: metadata.skillIds || projection.skillIds,
    skillNames: metadata.skillNames || projection.skillNames,
    skippedSkills: metadata.skippedSkills || projection.skippedSkills,
    fingerprints: metadata.fingerprints || projection.fingerprints,
    provenance: metadata.provenance || projection.provenance,
    artifact: artifact.value,
  };
}

function verifyCursorPackage(input = {}, maybeOptions = {}) {
  const options = typeof input === 'string' ? { ...maybeOptions, packageRoot: input } : input;
  const packageRoot = options.packageRoot;
  const stage = options.stage || 'structural';
  const observedAt = options.observedAt;
  const resolvedPackageRoot = packageRoot ? path.resolve(packageRoot) : '';
  const packageRootError = packageRoot ? physicalPackageRootError(resolvedPackageRoot) : null;
  if (packageRootError) {
    const structural = { ok: false, errors: [packageRootError], skippedSkills: [] };
    return {
      ...structural,
      structural,
      ok: false,
      evidence: { ok: false, error: { code: 'UNSAFE_PACKAGE_ROOT', message: packageRootError } },
    };
  }
  const structural = validateCursorPackage(options);
  let planFingerprint = 'cursor-plugin-unbound';
  let artifactFingerprint = 'cursor-plugin-unobserved';
  try {
    const provenance = JSON.parse(readFileBounded(path.join(resolvedPackageRoot, 'provenance.json')).toString('utf8'));
    if (typeof provenance.planFingerprint === 'string' && provenance.planFingerprint.length > 0) planFingerprint = provenance.planFingerprint;
    else if (typeof provenance.inventoryDigest === 'string' && provenance.inventoryDigest.length > 0) planFingerprint = provenance.inventoryDigest;
  } catch (_) { /* structural errors retain the legacy report; evidence stays FAIL */ }
  try {
    artifactFingerprint = fingerprintDir(resolvedPackageRoot);
  } catch (error) {
    const diagnostic = `Cursor package fingerprint failed: ${error.message}`;
    structural.errors.push(diagnostic);
    structural.ok = false;
  }
  const defaultConsumerStage = stage === 'consumer-runtime' && !options.consumerAdapter;
  const consumerAdapter = options.consumerAdapter || {
    identity: { id: defaultConsumerStage ? 'cursor-consumer' : 'cursor-validator', version: GENERATOR_VERSION },
    verify: () => ({
      verdict: defaultConsumerStage ? 'NOT_CONFIGURED' : (structural.ok ? 'PASS' : 'FAIL'),
      claims: defaultConsumerStage ? ['Cursor consumer configuration'] : ['Cursor package structure', 'Cursor package boundary', 'Cursor provenance receipt'],
      observations: defaultConsumerStage ? ['no Cursor consumer adapter configured'] : (structural.ok ? ['validated Cursor package output'] : structural.errors),
      diagnostics: defaultConsumerStage ? ['Cursor consumer adapter is not configured'] : structural.errors,
      observedAt,
    }),
  };
  const observer = options.consumerAdapter ? {
    ...consumerAdapter,
    verify: (requestedStage, artifact) => ({ ...(consumerAdapter.verify(requestedStage, artifact) || {}), observedAt }),
  } : consumerAdapter;
  const evidenceResult = verifyDistribution(stage, { planFingerprint, artifactFingerprint }, observer);
  return {
    ...structural,
    structural,
    ok: structural.ok && evidenceResult.ok,
    evidence: evidenceResult.ok ? evidenceResult.value : evidenceResult,
  };
}

function collectPackageFiles(directory) {
  const files = [];
  const budget = createTraversalBudget();
  const walk = (current, depth) => {
    const stat = lstatOrNull(current);
    if (!stat || stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      const realDirectory = budget.enterDirectory(current, depth);
      try {
        for (const entry of readDirectoryEntries(current, { budget, sort: true, localeSort: true })) {
          const child = path.join(current, entry.name);
          walk(child, depth + 1);
        }
      } finally {
        budget.leaveDirectory(realDirectory);
      }
    } else {
      if (stat.isFile()) budget.accountFile(current, stat);
      files.push(current);
    }
  };
  walk(directory, 0);
  return files;
}

function scanSecrets(packageRoot) {
  const findings = [];
  for (const file of collectPackageFiles(packageRoot)) {
    const relative = path.relative(packageRoot, file).split(path.sep).join('/');
    const extension = path.extname(relative).toLowerCase();
    let executable = false;
    try { executable = Boolean(fs.statSync(file).mode & 0o111); } catch (_) { /* file disappeared */ }
    const configuration = ['.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.conf'].includes(extension);
    const executableArtifact = executable || ['.sh', '.bash', '.cmd', '.bat', '.ps1', '.js', '.mjs', '.cjs', '.ts'].includes(extension);
    if (!configuration && !executableArtifact) continue;
    const text = readFileBounded(file).toString('utf8');
    for (const pattern of [...SECRET_PATTERNS, URL_CREDENTIAL_PATTERN, CONNECTION_SECRET_PATTERN]) {
      if (pattern.test(text)) {
        findings.push(`${relative} contains a literal credential-like value`);
        break;
      }
    }
  }
  return findings;
}

function validateManifestPathField({ packageRoot, field, value, errors }) {
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.some((candidate) => typeof candidate !== 'string')) {
    errors.push(`manifest ${field} must be a relative path or array of relative paths`);
    return [];
  }
  const resolved = [];
  for (const candidate of values) {
    if (!isSafeRelativePath(candidate)) {
      errors.push(`manifest ${field} path must be package-relative and contained: '${candidate}'`);
      continue;
    }
    const target = resolveContained(packageRoot, candidate);
    if (!target) {
      errors.push(`manifest ${field} path escapes package root: '${candidate}'`);
      continue;
    }
    if (!fs.existsSync(target)) errors.push(`manifest ${field} path does not exist: '${candidate}'`);
    resolved.push(target);
  }
  return resolved;
}

function validateVariables(variables, errors) {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables) || variables.type !== 'object' || !variables.properties || typeof variables.properties !== 'object' || Array.isArray(variables.properties)) {
    errors.push('manifest variables must be an object JSON Schema with type=object and properties');
    return;
  }
  const required = variables.required || [];
  if (!Array.isArray(required) || required.some((name) => typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(variables.properties, name))) {
    errors.push('manifest variables.required must name declared properties');
  }
  for (const [name, schema] of Object.entries(variables.properties)) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'string') errors.push(`manifest variables property '${name}' must declare a type`);
    if (schema && Object.prototype.hasOwnProperty.call(schema, 'default') && /(api[_-]?key|token|secret|password|credential|authorization)/i.test(name) && String(schema.default).trim() !== '') {
      errors.push(`manifest variables property '${name}' must not declare a secret default`);
    }
    if (schema && Object.prototype.hasOwnProperty.call(schema, 'default') && [...SECRET_PATTERNS, URL_CREDENTIAL_PATTERN, CONNECTION_SECRET_PATTERN].some((pattern) => pattern.test(JSON.stringify(schema.default)))) {
      errors.push(`manifest variables property '${name}' contains a literal credential-like default`);
    }
    if (schema && Object.prototype.hasOwnProperty.call(schema, 'default') && URL_CREDENTIAL_PATTERN.test(String(schema.default))) {
      errors.push(`manifest variables property '${name}' must not contain URL credentials`);
    }
  }
  const scan = (value, location) => {
    if (typeof value === 'string') {
      if ([...SECRET_PATTERNS, URL_CREDENTIAL_PATTERN, CONNECTION_SECRET_PATTERN].some((pattern) => pattern.test(value))) {
        errors.push(`manifest variables value '${location}' contains a literal credential-like value`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${location}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) scan(child, `${location}.${key}`);
    }
  };
  scan(variables, 'variables');
}

function validateSkills(packageRoot, skillRoots, errors, skippedSkills) {
  for (const root of skillRoots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const entry of readDirectoryEntries(root, { sort: true, localeSort: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const skillPath = path.join(root, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) {
        const relative = path.relative(packageRoot, path.join(root, entry.name)).split(path.sep).join('/');
        skippedSkills.push({ path: relative, reason: 'missing SKILL.md' });
        errors.push(`${relative} is invalid: missing SKILL.md`);
        continue;
      }
      const parsed = parseFrontmatter(readFileBounded(skillPath).toString('utf8'));
      if (!parsed.present || !parsed.fields.name || !parsed.fields.description || parsed.fields.name !== entry.name || !NAME_PATTERN.test(parsed.fields.name)) {
        const relative = path.relative(packageRoot, skillPath).split(path.sep).join('/');
        skippedSkills.push({ path: relative, reason: 'invalid Cursor skill frontmatter' });
        errors.push(`${relative} is invalid: invalid Cursor skill frontmatter`);
      }
    }
  }
}

function validateNativeDocuments(packageRoot, roots, kind, errors) {
  const extensions = COMPONENT_EXTENSIONS[kind];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of listComponentFiles(root, extensions)) {
      const content = readFileBounded(file).toString('utf8');
      const parsed = parseFrontmatter(content);
      const relative = path.relative(packageRoot, file).split(path.sep).join('/');
      if (kind === 'rules' && path.extname(file).toLowerCase() !== '.mdc') {
        errors.push(`${relative} must use the .mdc extension`);
      }
      if (retainsClaudePluginRoot(content)) {
        errors.push(`${relative} retains Claude plugin-root interpolation`);
      }
      if (!parsed.present || !parsed.fields.name || !parsed.fields.description || !NAME_PATTERN.test(parsed.fields.name)) {
        errors.push(`${relative} has invalid Cursor ${kind} frontmatter (name and description are required)`);
      }
      if (kind === 'rules' && parsed.fields.alwaysApply !== true && !['true', 'false'].includes(String(parsed.fields.alwaysApply).toLowerCase())) {
        errors.push(`${relative} Cursor rule frontmatter must declare boolean alwaysApply`);
      }
    }
  }
}

function validateHooks(packageRoot, hookRoots, errors) {
  for (const hooksPath of hookRoots) {
    let config;
    try { config = JSON.parse(readFileBounded(hooksPath).toString('utf8')); } catch (error) {
      errors.push(`${path.relative(packageRoot, hooksPath).split(path.sep).join('/')} is invalid JSON: ${error.message}`);
      continue;
    }
    if (!config || typeof config !== 'object' || !config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) {
      errors.push('Cursor hooks config must contain a hooks object');
      continue;
    }
    for (const [event, entries] of Object.entries(config.hooks)) {
      if (!CURSOR_HOOK_EVENTS.has(event)) errors.push(`unsupported Cursor hook event '${event}'`);
      if (!Array.isArray(entries)) {
        errors.push(`Cursor hook event '${event}' must be an array`);
        continue;
      }
      for (const [index, hook] of entries.entries()) {
        if (!hook || typeof hook !== 'object' || typeof hook.command !== 'string') {
          errors.push(`Cursor hook '${event}[${index}]' must declare a command`);
          continue;
        }
        for (const key of Object.keys(hook)) if (!['command', 'matcher'].includes(key)) errors.push(`Cursor hook '${event}[${index}]' has unknown field '${key}'`);
        if (hook.matcher !== undefined && typeof hook.matcher !== 'string') errors.push(`Cursor hook '${event}[${index}]' matcher must be a string`);
        if (!SAFE_COMMAND_PATH.test(stripLeadingDotSlash(hook.command))) errors.push(`Cursor hook '${event}[${index}]' command contains unsafe executable characters: '${hook.command}'`);
        const target = resolveContained(packageRoot, hook.command);
        if (!target) errors.push(`Cursor hook '${event}[${index}]' command must be package-relative and contained: '${hook.command}'`);
        else {
          const stat = lstatOrNull(target);
          if (!stat || stat.isSymbolicLink() || !stat.isFile()) errors.push(`Cursor hook '${event}[${index}]' command must be a regular file: '${hook.command}'`);
          else if (!isInside(packageRoot, fs.realpathSync(target))) errors.push(`Cursor hook '${event}[${index}]' command realpath escapes package root: '${hook.command}'`);
        }
      }
    }
  }
}

function validateMarketplace(packageRoot, errors) {
  const file = path.join(packageRoot, '.cursor-plugin', 'marketplace.json');
  if (!fs.existsSync(file)) {
    errors.push('.cursor-plugin/marketplace.json is missing');
    return;
  }
  let marketplace;
  try { marketplace = JSON.parse(readFileBounded(file).toString('utf8')); } catch (error) {
    errors.push(`.cursor-plugin/marketplace.json is invalid JSON: ${error.message}`);
    return;
  }
  if (!marketplace || typeof marketplace.name !== 'string' || !marketplace.owner || typeof marketplace.owner.name !== 'string' || !Array.isArray(marketplace.plugins)) {
    errors.push('.cursor-plugin/marketplace.json must declare name, owner.name, and plugins[]');
    return;
  }
  for (const [index, plugin] of marketplace.plugins.entries()) {
    if (!plugin || typeof plugin.name !== 'string' || !NAME_PATTERN.test(plugin.name)) errors.push(`marketplace plugin[${index}] has invalid name`);
    if (!plugin || typeof plugin.source !== 'string' || !isSafeRelativePath(plugin.source, { allowDot: true })) errors.push(`marketplace plugin[${index}] source must be relative and contained`);
    else if (!resolveContained(packageRoot, plugin.source, { allowDot: true })) errors.push(`marketplace plugin[${index}] source escapes package root`);
  }
}

function validateCursorPackage(input = {}) {
  const packageRoot = typeof input === 'string' ? input : input.packageRoot;
  const expectedManifestName = typeof input === 'string' ? null : input.expectedManifestName || null;
  const errors = [];
  const skippedSkills = [];
  if (!packageRoot) return { ok: false, errors: ['Cursor packageRoot is required'], skippedSkills };
  const root = path.resolve(packageRoot);
  const packageRootError = physicalPackageRootError(root);
  if (packageRootError) return { ok: false, errors: [packageRootError], skippedSkills };
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { ok: false, errors: [`Cursor package root does not exist: ${packageRoot}`], skippedSkills };
  for (const link of findSymlinks(root)) errors.push(`Cursor package contains symlink: ${path.relative(root, link).split(path.sep).join('/')}`);
  const manifestPath = path.join(root, '.cursor-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) errors.push('.cursor-plugin/plugin.json is missing');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileBounded(manifestPath).toString('utf8')); } catch (error) { errors.push(`.cursor-plugin/plugin.json is invalid JSON: ${error.message}`); }
  }
  const componentRoots = {};
  if (manifest) {
    for (const key of Object.keys(manifest)) if (!CURSOR_MANIFEST_FIELDS.has(key)) errors.push(`.cursor-plugin/plugin.json contains unknown field '${key}'`);
    if (typeof manifest.name !== 'string' || !NAME_PATTERN.test(manifest.name)) errors.push('Cursor manifest name must be lowercase kebab-case');
    if (expectedManifestName && manifest.name !== expectedManifestName) errors.push(`Cursor manifest name '${manifest.name}' does not match '${expectedManifestName}'`);
    if (manifest.version !== undefined && (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version))) errors.push('Cursor manifest version must be semver');
    if (typeof manifest.description !== 'string' || !manifest.description.trim()) errors.push('Cursor manifest description is required');
    for (const field of ['skills', 'rules', 'agents', 'commands']) {
      if (manifest[field] !== undefined) componentRoots[field] = validateManifestPathField({ packageRoot: root, field, value: manifest[field], errors });
    }
    if (manifest.hooks !== undefined) {
      if (typeof manifest.hooks === 'string' || Array.isArray(manifest.hooks)) componentRoots.hooks = validateManifestPathField({ packageRoot: root, field: 'hooks', value: manifest.hooks, errors });
      else if (!manifest.hooks || typeof manifest.hooks !== 'object') errors.push('manifest hooks must be a relative path or inline object');
      else errors.push('manifest hooks inline objects are not accepted in generated packages; use hooks/hooks.json');
    }
    if (manifest.variables !== undefined) validateVariables(manifest.variables, errors);
  }
  if (componentRoots.skills) validateSkills(root, componentRoots.skills, errors, skippedSkills);
  if (componentRoots.rules) validateNativeDocuments(root, componentRoots.rules, 'rules', errors);
  if (componentRoots.agents) validateNativeDocuments(root, componentRoots.agents, 'agents', errors);
  if (componentRoots.commands) validateNativeDocuments(root, componentRoots.commands, 'commands', errors);
  if (componentRoots.hooks) validateHooks(root, componentRoots.hooks, errors);
  if (fs.existsSync(path.join(root, 'mcp.json')) || (manifest && Object.prototype.hasOwnProperty.call(manifest, 'mcpServers'))) {
    errors.push('Cursor mcpServers/mcp.json is rejected until a closed transport schema validator is available');
  }
  validateMarketplace(root, errors);
  if (fs.existsSync(path.join(root, 'fingerprints.json'))) {
    try {
      const fingerprints = JSON.parse(readFileBounded(path.join(root, 'fingerprints.json')).toString('utf8'));
      for (const key of Object.keys(fingerprints || {})) if (!isSafeRelativePath(key)) errors.push(`fingerprint path escapes package root: '${key}'`);
    } catch (error) { errors.push(`fingerprints.json is invalid JSON: ${error.message}`); }
  }
  const provenancePath = path.join(root, 'provenance.json');
  if (fs.existsSync(provenancePath)) {
    try {
      const provenance = JSON.parse(readFileBounded(provenancePath).toString('utf8'));
      const sharedIds = Array.isArray(provenance.sharedSkillIds) ? provenance.sharedSkillIds : [];
      const selectedIds = Array.isArray(provenance.selectedSkillIds) ? provenance.selectedSkillIds : [];
      if (provenance.skillProjectionMode !== undefined && !['shared', 'overlay', null].includes(provenance.skillProjectionMode)) {
        errors.push('Cursor provenance skillProjectionMode must be shared, overlay, or null');
      }
      if (provenance.skillProjectionMode === 'shared' && (fs.existsSync(path.join(root, 'skills')) || manifest && manifest.skills !== undefined)) {
        errors.push('shared Cursor skill projection must not contain a duplicate skills directory');
      }
      if (sharedIds.length > 0 && provenance.sharedSkillSurface !== 'agent-plugin') {
        errors.push('shared Cursor skills must identify agent-plugin as their owning surface');
      }
      if (sharedIds.length > 0 && provenance.sharedSkillSource !== 'plugins/dhpk-agent/skills/') {
        errors.push('shared Cursor skills must identify plugins/dhpk-agent/skills/ as their physical source');
      }
      const overlap = selectedIds.filter((id) => sharedIds.includes(id));
      if (overlap.length > 0) errors.push(`Cursor overlay repeats shared skill IDs: ${overlap.sort().join(', ')}`);
    } catch (error) { errors.push(`provenance.json is invalid JSON: ${error.message}`); }
  }
  for (const finding of scanSecrets(root)) errors.push(`secret-safety: ${finding}`);
  return { ok: errors.length === 0, errors, warnings: [], skippedSkills, manifest };
}

function findExecutable(names, pathValue = process.env.PATH) {
  for (const name of names) {
    if (!pathValue) continue;
    for (const directory of String(pathValue).split(path.delimiter)) {
      if (!directory) continue;
      const candidate = path.join(path.resolve(directory), name);
      try {
        if (fs.statSync(candidate).isFile() && (process.platform === 'win32' || (fs.statSync(candidate).mode & 0o111))) return candidate;
      } catch (_) { /* absent candidate */ }
    }
  }
  return null;
}

function positiveProbeLimit(value, fallback, label, maximum) {
  const numeric = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > maximum) {
    throw new TypeError(`${label} must be a positive safe integer <= ${maximum}`);
  }
  return numeric;
}

function isCursorStreamEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return CURSOR_STREAM_FRAME_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))
    || CURSOR_STREAM_EVENT_TYPES.includes(String(value.type || '').toLowerCase());
}

function cursorStreamFrame(output) {
  const text = String(output || '').trim();
  if (!text) return false;
  for (const line of text.split(/\r?\n/).slice(-200)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isCursorStreamEvent(parsed)) {
        return true;
      }
    } catch (_) {
      if (/\b(?:progress|stream|delta|chunk|partial)\b\s*[:=]/i.test(trimmed)) return true;
    }
  }
  return false;
}

function parseCursorStreamOutput(output) {
  const text = String(output || '').trim();
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) events.push(parsed);
    } catch (_) {
      // Stream mode is line-delimited JSON; malformed progress is retained in
      // the bounded diagnostic but cannot satisfy a JSON response contract.
    }
  }
  const terminal = events.slice().reverse().find((event) => (
    String(event.type || '').toLowerCase() === 'result'
  ));
  if (terminal) {
    const responseText = typeof terminal.result === 'string'
      ? terminal.result
      : terminal.result === undefined || terminal.result === null
        ? ''
        : JSON.stringify(terminal.result);
    return { events, parsed: terminal, responseText };
  }
  // A few older/fixture clients accept the stream flag but still emit one
  // JSON object. Keep that compatibility path without treating arbitrary
  // prompt/tool frames as the response.
  if (events.length === 1 && text && !isCursorStreamEvent(events[0])) {
    return { events, parsed: events[0], responseText: text };
  }
  return { events, parsed: null, responseText: '' };
}

function cursorReasonCode(result) {
  if (!result || typeof result !== 'object') return 'PROBE_FAILED';
  const explicitReason = String(result.reason_code || result.reasonCode || '').trim().toUpperCase();
  if (CURSOR_PROBE_REASON_CODES.includes(explicitReason)) return explicitReason;
  if (result.status === 'PASS') return 'READY';
  if (result.timed_out) return result.no_stdout ? 'TIMEOUT_SILENT' : 'TIMEOUT_PARTIAL_OUTPUT';
  if (result.output_limited) return 'OUTPUT_LIMIT';
  if (result.no_stdout || result.output_missing) return 'NO_OUTPUT';
  if (result.response_invalid || /response payload|not valid json/.test(String(result.reason || '').toLowerCase())) return 'CLI_INCOMPATIBLE';
  const reason = String(result.reason || '').toLowerCase();
  if (/package (?:is )?missing|package .*invalid|physical package|structural/.test(reason)) return 'PACKAGE_INVALID';
  if (/not available on path|tooling .*not available|cli .*unavailable/.test(reason)) return 'TOOL_UNAVAILABLE';
  if (/auth|login|logged-in|unauthenticated/.test(reason)) return 'AUTH_REQUIRED';
  if (/sandbox paths|outside .*temporary|path .*unsafe/.test(reason)) return 'SANDBOX_PATH_UNSAFE';
  if (/sandbox|namespace|network mode/.test(reason)) return 'SANDBOX_UNAVAILABLE';
  if (/network|transport|dns|connection/.test(reason)) return 'NETWORK_UNAVAILABLE';
  if (/no stdout|no .*payload|not valid json|no supported|loader|discovery/.test(reason)) return 'CLI_INCOMPATIBLE';
  if (result.status === 'NOT_RUN') return 'CLI_INCOMPATIBLE';
  if (result.status === 'UNAVAILABLE') return 'TOOL_UNAVAILABLE';
  return 'PROBE_FAILED';
}

function withCursorReasonCode(result) {
  if (!result || typeof result !== 'object') return result;
  const reasonCode = cursorReasonCode(result);
  const output = `${result.diagnostic || ''}`;
  return {
    ...result,
    reason_code: reasonCode,
    reasonCode,
    ...(result.timed_out && !result.no_stdout ? { partial_output: Boolean(result.partial_output || output || cursorStreamFrame(output)) } : {}),
    ...(result.timed_out ? { pass_ineligible: true } : {}),
  };
}

function preflightCursorConsumer({
  pathValue = process.env.PATH,
  executable = null,
  args = null,
  hostHome = process.env.HOME,
  networkMode = 'shared',
} = {}) {
  const client = executable || findExecutable(['cursor-agent'], pathValue);
  if (!client) return { status: 'UNAVAILABLE', reasonCode: 'TOOL_UNAVAILABLE', reason: 'Cursor client tooling is not available on PATH' };
  if (!path.isAbsolute(client)) return { status: 'UNAVAILABLE', reasonCode: 'INVOCATION_INVALID', reason: 'Cursor client executable must resolve to an absolute path' };
  const version = commandVersionForProbe(client);
  if (!Array.isArray(args)) return { status: 'NOT_RUN', reasonCode: 'CLI_INCOMPATIBLE', version, reason: 'Cursor executable has no supported plugin-loader invocation' };
  const pluginDirs = args.filter((arg, index) => args[index - 1] === '--plugin-dir');
  if (pluginDirs.length === 0 || pluginDirs.some((directory) => typeof directory !== 'string' || !path.isAbsolute(directory))) {
    return { status: 'BLOCKED', reasonCode: 'INVOCATION_INVALID', version, reason: 'Cursor invocation must use absolute --plugin-dir paths' };
  }
  const sessionFiles = [];
  if (typeof hostHome === 'string' && path.isAbsolute(hostHome)) {
    for (const relative of CURSOR_SESSION_ALLOWLIST) {
      try {
        const stat = fs.lstatSync(path.join(hostHome, relative));
        if (stat.isFile() && !stat.isSymbolicLink()) sessionFiles.push(relative);
      } catch (_) { /* absence is reported as AUTH_REQUIRED */ }
    }
  }
  if (!sessionFiles.includes('.config/cursor/auth.json')) {
    return { status: 'BLOCKED', reasonCode: 'AUTH_REQUIRED', version, sessionFiles, sessionFileCount: sessionFiles.length, reason: 'Cursor login session is unavailable' };
  }
  if (!['disabled', 'shared'].includes(networkMode)) {
    return { status: 'BLOCKED', reasonCode: 'SANDBOX_UNAVAILABLE', version, sessionFiles, sessionFileCount: sessionFiles.length, reason: 'Cursor preflight requires a controlled network mode' };
  }
  return { status: 'PASS', reasonCode: 'READY', version, sessionFiles, sessionFileCount: sessionFiles.length, network: networkMode };
}

function commandVersionForProbe(executable) {
  try {
    const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 });
    if (result.error || result.status !== 0) return null;
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/, 1)[0];
    return output ? redactSensitiveText(output, { maxLength: 128 }) : null;
  } catch (_) {
    return null;
  }
}

function scrubCursorDiagnosticValue(value, key = '', depth = 0) {
  if (CURSOR_DIAGNOSTIC_SENSITIVE_KEYS.test(String(key))) return '<redacted>';
  if (depth > 4) return '<redacted-depth>';
  if (Array.isArray(value)) return value.slice(0, 32).map((entry) => scrubCursorDiagnosticValue(entry, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value)
      .filter((childKey) => CURSOR_DIAGNOSTIC_SAFE_KEYS.has(childKey))
      .map((childKey) => [childKey, scrubCursorDiagnosticValue(value[childKey], childKey, depth + 1)]));
  }
  if (typeof value === 'string') return redactSensitiveText(value, { maxLength: 160 });
  return value;
}

function redactCursorDiagnostic(value, { maxLength = CURSOR_PROBE_DIAGNOSTIC_MAX_LENGTH } = {}) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const sanitized = lines.map((line) => {
    const trimmed = line.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(scrubCursorDiagnosticValue(parsed));
      }
    } catch (_) {
      // Non-JSON client output is not an observable contract. Do not preserve
      // arbitrary plain text after token redaction because it may still carry
      // prompts, tool payloads, paths, or provider metadata.
    }
    return '<redacted-client-output>';
  }).join('\n');
  return redactSensitiveText(sanitized, { maxLength });
}

function probeDiagnostic(result) {
  const output = `${result && result.stdout ? result.stdout : ''}\n${result && result.stderr ? result.stderr : ''}`.trim();
  return output ? redactCursorDiagnostic(output) : null;
}

function cursorAuthenticationRequired(result) {
  const output = `${result && result.stdout ? result.stdout : ''}\n${result && result.stderr ? result.stderr : ''}`;
  return /authentication required|login required|not logged in|please log in|unauthenticated/i.test(output);
}

function cursorNetworkUnavailable(result) {
  const output = `${result && result.stdout ? result.stdout : ''}\n${result && result.stderr ? result.stderr : ''}`;
  return /(?:EAI_[A-Z]+|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENETDOWN|network is unreachable|network unreachable|could not resolve|dns resolution|name resolution|connection (?:refused|reset|timed out)|socket hang up|network request failed)/i.test(output);
}

function terminateProbeGroup(result) {
  if (process.platform === 'win32' || !result || !result.pid) return;
  try { process.kill(-result.pid, 'SIGTERM'); } catch (_) { /* child group already exited */ }
  try { process.kill(-result.pid, 'SIGKILL'); } catch (_) { /* child group already exited */ }
}

function cursorProbeEnvironment(packageRoot, { probeHome } = {}) {
  const env = {};
  for (const key of CURSOR_PROBE_ENV_KEYS) {
    if (['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'].includes(key)) continue;
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const home = probeHome || fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-home-'));
  env.HOME = home;
  env.USERPROFILE = home;
  env.APPDATA = path.join(home, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
  // Session cloning uses the standard HOME-relative `.config/cursor` path.
  // Keep XDG_CONFIG_HOME aligned with that directory so XDG-aware clients
  // observe the same allowlisted login without widening the copied surface.
  env.XDG_CONFIG_HOME = path.join(home, '.config');
  env.XDG_DATA_HOME = path.join(home, 'data');
  env.XDG_CACHE_HOME = path.join(home, 'cache');
  env.CURSOR_PLUGIN_ROOT = path.resolve(packageRoot);
  env.DHPK_CURSOR_PLUGIN_ROOT = path.resolve(packageRoot);
  return env;
}

function packageLoaderProbe(packageRoot, challenge, { addCursorManifest = false } = {}) {
  // Cursor refuses to load plugins whose root is directly under the shared
  // system temporary directory. Keep both the container and staged package
  // private so the real CLI can execute the probe-owned hook.
  const probeContainerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-package-'));
  const probePackageRoot = path.join(probeContainerRoot, 'package');
  try {
    fs.mkdirSync(probePackageRoot, { recursive: true, mode: 0o700 });
    assertPhysicalPackageRoot(packageRoot, 'Cursor probe package');
    fs.cpSync(packageRoot, probePackageRoot, { recursive: true, dereference: false });
    assertPhysicalPackageRoot(probePackageRoot, 'staged Cursor probe package');
    const hooksRoot = path.join(probePackageRoot, 'hooks');
    const commandRoot = path.join(hooksRoot, 'commands');
    const challengePath = path.join(hooksRoot, '.dhpk-probe-challenge.json');
    const attestationPath = path.join(hooksRoot, '.dhpk-probe-attestation.json');
    fs.mkdirSync(commandRoot, { recursive: true, mode: 0o700 });
    fs.writeFileSync(challengePath, `${JSON.stringify(challenge)}\n`, { mode: 0o600 });
    const loader = [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const hooksRoot = path.resolve(__dirname, '..');",
      "const challenge = JSON.parse(fs.readFileSync(path.join(hooksRoot, '.dhpk-probe-challenge.json'), 'utf8'));",
      "const components = ['skills', 'commands', 'agents', 'rules'].filter((name) => fs.existsSync(path.join(path.resolve(hooksRoot, '..'), name)));",
      "fs.writeFileSync(path.join(hooksRoot, '.dhpk-probe-attestation.json'), `${JSON.stringify({ challenge: challenge.challenge, packageFingerprint: challenge.packageFingerprint, loaded: true, components })}\\n`, { mode: 0o600 });",
    ].join('\n') + '\n';
    const loaderPath = path.join(commandRoot, 'dhpk-probe.js');
    fs.writeFileSync(loaderPath, loader, { mode: 0o700 });
    // Cursor's plugin hook loader requires the explicit v1 schema marker when
    // it parses a generated hooks file.  Keep the probe-owned overlay in that
    // format even when the canonical package omits hooks or uses Claude shape.
    let hooks = { version: 1, hooks: {} };
    const hooksPath = path.join(hooksRoot, 'hooks.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      if (parsed && parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)) {
        hooks = { version: 1, hooks: { ...parsed.hooks } };
      }
    } catch (_) {
      // The package validator owns malformed canonical hooks; the probe must
      // fail closed rather than silently replacing them.
    }
    hooks.hooks.sessionStart = [
      ...(Array.isArray(hooks.hooks.sessionStart) ? hooks.hooks.sessionStart : []),
      { command: './hooks/commands/dhpk-probe.js' },
    ];
    fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, { mode: 0o600 });
    if (addCursorManifest) {
      // `mcp.json` is an Agent Plugin-owned optional surface. Cursor's native
      // validator intentionally rejects that file until its transport schema
      // is closed, so keep it out of the disposable Cursor attestation copy;
      // the published Agent package is never modified or stripped.
      const portableMcpPath = path.join(probePackageRoot, 'mcp.json');
      if (fs.existsSync(portableMcpPath)) fs.rmSync(portableMcpPath, { force: true });
      const cursorManifestRoot = path.join(probePackageRoot, '.cursor-plugin');
      fs.mkdirSync(cursorManifestRoot, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(cursorManifestRoot, 'plugin.json'), `${JSON.stringify({
        name: 'dhpk-probe-agent',
        version: '1.0.0',
        description: 'Temporary Cursor loader attestation overlay for the portable Agent Plugin probe.',
        hooks: './hooks/hooks.json',
      }, null, 2)}\n`, { mode: 0o600 });
      fs.writeFileSync(path.join(cursorManifestRoot, 'marketplace.json'), `${JSON.stringify({
        name: 'dhpk-probe',
        owner: { name: 'dhpk' },
        plugins: [{ name: 'dhpk-probe-agent', source: '.' }],
      }, null, 2)}\n`, { mode: 0o600 });
      const validation = validateCursorPackage({ packageRoot: probePackageRoot, expectedManifestName: 'dhpk-probe-agent' });
      if (!validation.ok) throw new Error(`probe Cursor loader overlay is invalid: ${validation.errors.join('; ')}`);
    }
    return { packageRoot: probePackageRoot, attestationPath, challengePath, cleanupRoot: probeContainerRoot };
  } catch (error) {
    fs.rmSync(probeContainerRoot, { recursive: true, force: true });
    throw error;
  }
}

function verifiedSandboxExecutable(name, pathValue = process.env.PATH) {
  const directories = [...new Set([
    ...String(pathValue || '').split(path.delimiter),
  ].filter(Boolean))];
  for (const directoryValue of directories) {
    try {
      const directory = fs.realpathSync(path.resolve(directoryValue));
      if (!fs.statSync(directory).isDirectory()) continue;
      const lexical = path.join(directory, name);
      const lexicalStat = fs.lstatSync(lexical);
      // A PATH entry is not a trust boundary: reject symlinks and regular
      // files owned by a user-writable directory before executing them.
      if (lexicalStat.isSymbolicLink() || !lexicalStat.isFile() || !(lexicalStat.mode & 0o111)) continue;
      const resolved = fs.realpathSync(lexical);
      if (resolved !== lexical) continue;
      const resolvedStat = fs.statSync(resolved);
      if (!resolvedStat.isFile() || !(resolvedStat.mode & 0o111)) continue;
      if (process.platform === 'linux') {
        if (resolvedStat.uid !== 0) continue;
        let parent = path.dirname(resolved);
        let trustedParents = true;
        while (true) {
          const parentStat = fs.statSync(parent);
          if (parentStat.uid !== 0 || (parentStat.mode & 0o022)) {
            trustedParents = false;
            break;
          }
          if (parent === '/') break;
          parent = path.dirname(parent);
        }
        if (!trustedParents) continue;
      }
      return resolved;
    } catch (_) {
      // The candidate may be absent, inaccessible, or invalid; continue to
      // the next trusted PATH entry.
    }
  }
  return null;
}

function bubblewrapPrefix(networkMode) {
  const prefix = [
    '--ro-bind', '/', '/',
    ...MASKED_SANDBOX_ROOTS
      .filter((root) => fs.existsSync(root))
      .flatMap((root) => ['--tmpfs', root]),
    '--dev', '/dev',
    '--proc', '/proc',
  ];
  if (networkMode === 'shared') {
    prefix.push('--unshare-user', '--unshare-all', '--share-net', '--die-with-parent');
  } else {
    prefix.push('--unshare-net', '--die-with-parent');
  }
  return prefix;
}

function sandboxPreflight(command, args, pathValue) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    env: { PATH: pathValue || '/usr/local/bin:/usr/bin:/bin' },
    timeout: SANDBOX_PREFLIGHT_TIMEOUT_MS,
    maxBuffer: 4096,
    killSignal: 'SIGKILL',
  });
}

function networkSandboxProbe(pathValue = process.env.PATH, networkMode = 'disabled', _requireFilesystemIsolation = false) {
  if (process.platform !== 'linux') return false;
  if (!['disabled', 'shared'].includes(networkMode)) return null;
  // Bubblewrap is required for every consumer route because unshare(2) only
  // changes the network namespace and cannot apply the masked read-only
  // filesystem/private-path contract. Keep the root read-only and preflight
  // the exact requested network shape before accepting this backend.
  const bwrap = verifiedSandboxExecutable('bwrap', pathValue);
  if (!bwrap) return null;
  const result = sandboxPreflight(bwrap, [...bubblewrapPrefix(networkMode), '--', 'true'], pathValue);
  if (!result.error && result.status === 0) {
    return {
      command: bwrap,
      prefix: bubblewrapPrefix(networkMode),
    };
  }
  return null;
}

function existingAbsolutePaths(values) {
  return [...new Set(values.filter((value) => (
    typeof value === 'string' && path.isAbsolute(value) && fs.existsSync(value)
  )))];
}

function safeWritablePaths(values, privateRoot = null) {
  const paths = existingAbsolutePaths(values);
  if (!privateRoot) return paths;
  const root = path.resolve(privateRoot);
  const rootPrefix = `${root}${path.sep}`;
  for (const value of paths) {
    try {
      const lexical = path.resolve(value);
      const lexicalStat = fs.lstatSync(lexical);
      if (lexicalStat.isSymbolicLink() || !lexicalStat.isDirectory() || (lexicalStat.mode & 0o022)) return null;
      const resolved = fs.realpathSync(lexical);
      if (resolved !== lexical || !resolved.startsWith(rootPrefix)) return null;
    } catch (_) {
      return null;
    }
  }
  return paths;
}

function sandboxClientBindArguments(command) {
  let resolved;
  try { resolved = fs.realpathSync(command); } catch (_) { return null; }
  const homeRoots = ['/home', '/root'];
  for (const root of homeRoots) {
    if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) continue;
    const relative = path.relative(root, resolved);
    const owner = relative.split(path.sep)[0];
    if (!owner || owner === '..') return null;
    const ownerHome = path.join(root, owner);
    const brewRoot = path.join(ownerHome, '.linuxbrew');
    if (!resolved.startsWith(`${ownerHome}${path.sep}`)) return null;
    // The home tree is masked before this bind is applied. Rebinding the
    // entire ~/.local root would reopen unrelated user data (for example
    // ~/.local/share/opencode), so bind only the physical directory containing
    // the resolved executable. Homebrew's self-contained prefix is a runtime
    // tree whose binaries use absolute sibling libraries, so it remains the
    // narrowest usable prefix for that layout.
    const executableDirectory = path.dirname(resolved);
    const relativeDirectory = path.relative(ownerHome, executableDirectory);
    if (!relativeDirectory || relativeDirectory === '.local') return null;
    const sensitiveHomeRoots = ['.config', '.ssh', '.gnupg', '.aws', '.azure', '.kube'];
    if (sensitiveHomeRoots.some((name) => relativeDirectory === name || relativeDirectory.startsWith(`${name}${path.sep}`))) return null;
    const bindRoot = resolved.startsWith(`${brewRoot}${path.sep}`) ? brewRoot : executableDirectory;
    try {
      const directoryStat = fs.lstatSync(bindRoot);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return null;
      if (fs.realpathSync(bindRoot) !== bindRoot) return null;
      if (bindRoot !== brewRoot) {
        const symlinks = findSymlinks(bindRoot, { maxEntries: 20_000 });
        if (symlinks.some((link) => {
          // A broken link is just as unsafe as an escaping link: the bind
          // tree must be a complete, physical runtime tree before it enters
          // the namespace.
          try { return !fs.realpathSync(link).startsWith(`${bindRoot}${path.sep}`); } catch (_) { return true; }
        })) return null;
      }
    } catch (_) { return null; }
    return ['--ro-bind', bindRoot, bindRoot];
  }
  return [];
}

function sandboxInvocation(sandbox, command, args, writablePaths = [], privateRoot = null) {
  const safePaths = safeWritablePaths(writablePaths, privateRoot);
  if (!safePaths) return null;
  if (path.basename(sandbox.command).replace(/\.exe$/i, '') === 'unshare') {
    return [sandbox.command, [...sandbox.prefix, command, ...args]];
  }
  const clientBinds = sandboxClientBindArguments(command);
  if (!clientBinds || !safePaths) return null;
  const bindArgs = safePaths.flatMap((directory) => ['--bind', directory, directory]);
  let commandForNamespace = command;
  try {
    const resolved = fs.realpathSync(command);
    if (resolved !== command && /^\/(?:home|root)\//.test(resolved)) commandForNamespace = resolved;
  } catch (_) {
    return null;
  }
  return [sandbox.command, [...sandbox.prefix, ...clientBinds, ...bindArgs, '--', commandForNamespace, ...args]];
}

function runCursorConsumerProbeRaw({
  packageRoot,
  pathValue = process.env.PATH,
  executable = null,
  args = null,
  timeoutMs = undefined,
  maxOutputBytes = undefined,
  requireOutput = false,
  requireJson = false,
  requireDiscovery = false,
  requiredDiscoveryCapabilities = null,
  requiredLoaderComponents = null,
  requirePackageChallenge = false,
  loaderOverlay = false,
  allowUnauthenticatedFixture = false,
  networkMode = 'unrestricted',
  cwd = null,
  hostHome = process.env.DHPK_CURSOR_HOST_HOME || process.env.HOME,
} = {}) {
  // The release consumer-platform route sets requirePackageChallenge=true.
  // The legacy cursor-agent-probe wrapper remains launch-scoped and
  // experimental; it cannot promote a release surface by itself.
  // Validate caller-controlled limits before resolving/invoking any client.
  const probeTimeoutMs = positiveProbeLimit(timeoutMs, DEFAULT_CURSOR_PROBE_TIMEOUT_MS, 'timeoutMs', MAX_CURSOR_PROBE_TIMEOUT_MS);
  const probeMaxOutputBytes = positiveProbeLimit(maxOutputBytes, DEFAULT_CURSOR_PROBE_MAX_OUTPUT_BYTES, 'maxOutputBytes', MAX_CURSOR_PROBE_OUTPUT_BYTES);
  const outputFormatIndex = Array.isArray(args) ? args.indexOf('--output-format') : -1;
  const outputFormat = outputFormatIndex >= 0 ? String(args[outputFormatIndex + 1] || '').toLowerCase() : '';
  const streamOutput = outputFormat === 'stream-json';
  if (!packageRoot || !fs.existsSync(packageRoot)) return { surface: 'cursor-plugin', status: 'BLOCKED', reason: 'Cursor package is missing' };
  const authenticatedSessionRequired = requirePackageChallenge;
  if (authenticatedSessionRequired) {
    try {
      assertPhysicalPackageRoot(path.resolve(packageRoot), 'Cursor consumer package');
    } catch (error) {
      return { surface: 'cursor-plugin', status: 'BLOCKED', reason: redactSensitiveText(String(error.message || error), { maxLength: 800 }) };
    }
  }
  if (cwd !== null && cwd !== undefined && !path.isAbsolute(cwd)) {
    return {
      surface: 'cursor-plugin',
      status: 'BLOCKED',
      reason: 'Cursor consumer cwd must be an absolute path inside the private temporary root',
      network: 'unknown',
    };
  }
  if (cwd !== null && cwd !== undefined) {
    try {
      const cwdStat = fs.lstatSync(cwd);
      if (cwdStat.isSymbolicLink() || !cwdStat.isDirectory()) throw new Error('not a physical directory');
    } catch (_) {
      return {
        surface: 'cursor-plugin',
        status: 'BLOCKED',
        reason: 'Cursor consumer cwd must exist as a physical directory inside the private temporary root',
        network: 'unknown',
      };
    }
  }
  if (!['disabled', 'shared', 'unrestricted'].includes(networkMode)) {
    return {
      surface: 'cursor-plugin',
      status: 'BLOCKED',
      reason: `Unsupported Cursor consumer network mode '${networkMode}'`,
      network: 'unknown',
    };
  }
  if (authenticatedSessionRequired && !['disabled', 'shared'].includes(networkMode)) {
    return {
      surface: 'cursor-plugin',
      status: 'BLOCKED',
      reason: 'Release Cursor consumer probes must request a disabled network namespace or a controlled shared network namespace',
      network: 'unknown',
    };
  }
  const client = executable || findExecutable(['cursor-agent'], pathValue);
  if (!client) return { surface: 'cursor-plugin', status: 'UNAVAILABLE', reason: 'Cursor client tooling (cursor-agent) is not available on PATH', packageRoot };
  if (!path.isAbsolute(client)) return { surface: 'cursor-plugin', status: 'UNAVAILABLE', reason: 'Cursor client executable must resolve to an absolute path', packageRoot, executable: client };
  if (/^cursor(?:\.exe)?$/i.test(path.basename(client))) {
    return { surface: 'cursor-plugin', status: 'UNAVAILABLE', reason: 'Desktop cursor binary is not a cursor-agent consumer runtime', packageRoot, executable: client };
  }
  if (!Array.isArray(args)) return { surface: 'cursor-plugin', status: 'NOT_RUN', reason: 'Cursor executable exists but no supported local plugin-loader command is configured', packageRoot, executable: client };
  if (networkMode === 'unrestricted' && !allowUnauthenticatedFixture) {
    return {
      surface: 'cursor-plugin',
      status: 'BLOCKED',
      reason: 'Unrestricted Cursor consumer probes are fixture-only; request disabled/shared sandbox mode',
      network: 'unknown',
      packageRoot,
      executable: client,
    };
  }
  const challenge = requirePackageChallenge ? {
    challenge: crypto.randomBytes(18).toString('hex'),
    packageFingerprint: fingerprintDir(packageRoot),
  } : null;
  const probeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-home-'));
  let session = { copiedFiles: [] };
  let loaderProbe = null;
  try {
    session = cloneCursorSessionFiles({ hostHome, probeHome });
    if (authenticatedSessionRequired && !session.copiedFiles.includes('.config/cursor/auth.json')) {
      return {
        surface: 'cursor-plugin',
        status: 'BLOCKED',
        reason: 'Cursor consumer login session is unavailable; auth.json is required',
        network: networkMode === 'disabled' ? 'unknown' : networkMode,
        session_files: session.copiedFiles,
      };
    }
    loaderProbe = challenge ? packageLoaderProbe(packageRoot, challenge, { addCursorManifest: loaderOverlay }) : null;
    const probeArgs = [...args].map((arg) => {
      if (!loaderProbe || typeof arg !== 'string') return arg;
      return path.resolve(arg) === path.resolve(packageRoot) ? loaderProbe.packageRoot : arg;
    });
    const spawnOptions = {
      cwd: cwd || packageRoot,
      encoding: 'utf8',
      timeout: probeTimeoutMs,
      maxBuffer: probeMaxOutputBytes,
      killSignal: 'SIGKILL',
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cursorProbeEnvironment(loaderProbe ? loaderProbe.packageRoot : packageRoot, { probeHome }),
    };
    const writablePaths = [
      spawnOptions.cwd,
      spawnOptions.env && spawnOptions.env.HOME,
      loaderProbe && loaderProbe.packageRoot,
    ];
    const privateRoot = ['disabled', 'shared'].includes(networkMode) || authenticatedSessionRequired ? os.tmpdir() : null;
    let result;
    if (privateRoot && !safeWritablePaths(writablePaths, privateRoot)) {
      result = {
        status: 125,
        error: Object.assign(new Error('sandbox paths are outside the private temporary root'), { code: 'DHPK_SANDBOX_PATH_UNSAFE' }),
        network: 'unknown',
      };
    } else if (networkMode === 'disabled' || networkMode === 'shared') {
      // Even offline fixtures use the verified bubblewrap filesystem boundary;
      // an unshare-only backend is never accepted for consumer execution.
      const sandbox = networkSandboxProbe(pathValue, networkMode, true);
      if (!sandbox) {
        // Release promotion requires the requested network policy. The
        // fixture-only override remains available only for the legacy
        // network-disabled route; a shared-network request must never fall
        // back to an unrestricted process.
        if (networkMode === 'disabled' && !authenticatedSessionRequired && process.env.DHPK_CONSUMER_PROBE_ALLOW_UNSANDBOXED_EXECUTION === '1') {
          result = { ...spawnSync(client, probeArgs, spawnOptions), network: 'unrestricted' };
        } else {
          result = {
            status: 125,
            error: Object.assign(new Error('OS network sandbox is unavailable'), { code: 'DHPK_NETWORK_SANDBOX_UNAVAILABLE' }),
            network: 'unknown',
          };
        }
      } else {
        const sandboxInvocationResult = sandboxInvocation(
          sandbox,
          client,
          probeArgs,
          writablePaths,
          privateRoot,
        );
        if (!sandboxInvocationResult) {
          result = {
            status: 125,
            error: Object.assign(new Error('sandbox paths are outside the private temporary root'), { code: 'DHPK_SANDBOX_PATH_UNSAFE' }),
            network: 'unknown',
          };
        } else {
          const [sandboxCommand, sandboxArgs] = sandboxInvocationResult;
          result = {
            ...spawnSync(sandboxCommand, sandboxArgs, spawnOptions),
            network: networkMode,
          };
        }
      }
    } else {
      result = { ...spawnSync(client, probeArgs, spawnOptions), network: 'unrestricted' };
    }
    const evidence = {
      packageRoot,
      executable: client,
      network: result.network || networkMode,
      timeout_ms: probeTimeoutMs,
      output_limit_bytes: probeMaxOutputBytes,
      output_format: outputFormat || null,
      session_files: session.copiedFiles,
      exit_code: result.status === undefined ? null : result.status,
      signal: result.signal || null,
      diagnostic: probeDiagnostic(result),
    };
    if (result.error && result.error.code === 'ETIMEDOUT') {
      terminateProbeGroup(result);
      const noStdout = !evidence.diagnostic;
      const streamObserved = cursorStreamFrame(evidence.diagnostic);
      return {
        surface: 'cursor-plugin',
        status: noStdout ? 'SKIP_INCOMPATIBLE' : 'BLOCKED',
        reason: noStdout
          ? `Cursor consumer probe produced no stdout/stderr before timeout (${probeTimeoutMs} ms); CLI has no non-LLM plugin list`
          : `Cursor consumer probe timed out after ${probeTimeoutMs} ms`,
        timed_out: true,
        no_stdout: noStdout,
        stream_observed: streamObserved,
        ...evidence,
      };
    }
    if (result.error && result.error.code === 'ENOBUFS') {
      terminateProbeGroup(result);
      return {
        surface: 'cursor-plugin',
        status: 'BLOCKED',
        reason: `Cursor consumer probe output exceeded ${probeMaxOutputBytes} bytes`,
        output_limited: true,
        ...evidence,
      };
    }
    if (result.error && result.error.code === 'DHPK_NETWORK_SANDBOX_UNAVAILABLE') {
      return {
        surface: 'cursor-plugin',
        status: 'BLOCKED',
        reason: 'Cursor consumer probe requires an OS network sandbox; actual network state is unknown',
        ...evidence,
      };
    }
    if (result.error && result.error.code === 'DHPK_SANDBOX_PATH_UNSAFE') {
      return {
        surface: 'cursor-plugin',
        status: 'BLOCKED',
        reason: 'Cursor consumer probe refused writable paths outside its private temporary root',
        ...evidence,
      };
    }
    if (result.error) {
      const diagnostic = probeDiagnostic({ stderr: result.error.message }) || 'unknown invocation error';
      return { surface: 'cursor-plugin', status: 'UNAVAILABLE', reason: `Cursor consumer invocation unavailable: ${diagnostic}`, ...evidence };
    }
    if (authenticatedSessionRequired && !session.copiedFiles.includes('.config/cursor/auth.json')) {
      return { surface: 'cursor-plugin', status: 'BLOCKED', reason: 'Cursor consumer login session is unavailable; auth.json is required', ...evidence };
    }
    if (!allowUnauthenticatedFixture && session.copiedFiles.length === 0) {
      return { surface: 'cursor-plugin', status: 'BLOCKED', reason: 'Cursor consumer login session is unavailable', ...evidence };
    }
    if (result.status !== 0) {
      if (cursorAuthenticationRequired(result)) {
        return { surface: 'cursor-plugin', status: 'BLOCKED', reason: 'Cursor consumer requires authentication; use an already-logged-in session', exit_code: result.status, ...evidence };
      }
      if (cursorNetworkUnavailable(result)) {
        return { surface: 'cursor-plugin', status: 'UNAVAILABLE', reason: 'Cursor consumer network transport is unavailable', exit_code: result.status, ...evidence };
      }
      return { surface: 'cursor-plugin', status: 'FAIL', reason: `Cursor consumer exited with status ${result.status}`, exit_code: result.status, ...evidence };
    }
    const streamResponse = streamOutput ? parseCursorStreamOutput(result.stdout || '') : null;
    const responseText = streamOutput && streamResponse
      ? streamResponse.responseText
      : String(result.stdout || '').trim();
    // Discovery is evaluated against the assistant's response, not raw
    // stream frames. Cursor NDJSON includes the user's prompt and tool calls;
    // counting those would allow an unloaded package to look discovered.
    const output = `${responseText}\n${result.stderr || ''}`.trim();
    if (requireOutput && !output) {
      return { surface: 'cursor-plugin', status: 'BLOCKED', reason: 'Cursor consumer returned success without a response payload', output_missing: true, ...evidence };
    }
    let parsed = null;
    if (requireJson) {
      try {
        parsed = streamOutput && streamResponse
          ? streamResponse.parsed
          : JSON.parse(String(result.stdout || '').trim());
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('missing JSON response');
      } catch (_) {
        return { surface: 'cursor-plugin', status: 'BLOCKED', reason: 'Cursor consumer response was not valid JSON', response_invalid: true, ...evidence };
      }
    }
    if (requireDiscovery) {
      const normalized = output.toLowerCase();
      const requestedCapabilities = Array.isArray(requiredDiscoveryCapabilities) && requiredDiscoveryCapabilities.length > 0
        ? requiredDiscoveryCapabilities.map((value) => String(value).toLowerCase())
        : ['dhpk', 'skill', 'command', 'agent', 'rule'];
      const negative = NEGATIVE_CURSOR_DISCOVERY_PATTERNS.some((pattern) => pattern.test(output));
      const probe = parsed && parsed.dhpkProbe;
      let attestation = null;
      if (requirePackageChallenge && loaderProbe) {
        try { attestation = JSON.parse(fs.readFileSync(loaderProbe.attestationPath, 'utf8')); } catch (_) { /* hook did not run */ }
      }
      const components = probe && Array.isArray(probe.components) ? probe.components.map((value) => String(value).toLowerCase()) : [];
      const attestedComponents = attestation && Array.isArray(attestation.components)
        ? attestation.components.map((value) => String(value).toLowerCase())
        : [];
      const missingChallenge = requirePackageChallenge && (!attestation
        || attestation.challenge !== challenge.challenge
        || attestation.packageFingerprint !== challenge.packageFingerprint
        || attestation.loaded !== true);
      const loaderComponents = Array.isArray(requiredLoaderComponents) && requiredLoaderComponents.length > 0
        ? requiredLoaderComponents.map((value) => String(value).toLowerCase())
        : requestedCapabilities.filter((term) => term !== 'dhpk').map((term) => `${term}s`);
      const missingComponents = requirePackageChallenge
        ? loaderComponents.filter((component) => !attestedComponents.includes(component))
        : [];
      if (negative || missingChallenge || missingComponents.length > 0 || !requestedCapabilities.every((term) => normalized.includes(term))) {
        return {
          surface: 'cursor-plugin',
          status: 'BLOCKED',
          reason: negative
            ? 'Cursor consumer response explicitly denied the requested dhpk capability evidence'
            : missingChallenge
              ? 'Cursor consumer did not execute the package-owned loader hook; plugin loading is unproven'
              : 'Cursor consumer response did not contain the requested dhpk capability evidence',
          discovery_missing: missingComponents,
          discovery_negative: negative,
          ...(requirePackageChallenge ? { challenge_verified: !missingChallenge, loader_attestation: Boolean(attestation) } : {}),
          ...evidence,
        };
      }
    }
    return {
      surface: 'cursor-plugin',
      status: 'PASS',
      reason: requirePackageChallenge
        ? 'Cursor consumer probe loaded the package and returned matching challenge evidence'
        : 'Cursor consumer probe discovered the package',
      ...(requirePackageChallenge ? { challenge_verified: true, loader_attestation: true } : {}),
      ...evidence,
    };
  } finally {
    fs.rmSync(probeHome, { recursive: true, force: true });
    if (loaderProbe) {
      try { fs.rmSync(loaderProbe.cleanupRoot || loaderProbe.packageRoot, { recursive: true, force: true }); } catch (_) { /* best-effort cleanup */ }
    }
  }
}

function runCursorConsumerProbe(options = {}) {
  return withCursorReasonCode(runCursorConsumerProbeRaw(options));
}

module.exports = {
  GENERATOR_VERSION,
  CURSOR_MANIFEST_FIELDS,
  CURSOR_HOOK_EVENTS,
  COMPONENT_EXTENSIONS,
  adaptSkill,
  adaptNativeDocument,
  rewriteCursorHarnessBody,
  cursorDocumentDestinationName,
  selectCursorSkills,
  cursorSkillProjection,
  materializeCursorPackage,
  compileCursorPackage,
  verifyCursorPackage,
  validateCursorPackage,
  assertPhysicalPackageRoot,
  validateHooks,
  validateVariables,
  fingerprintDir,
  fingerprintPath,
  findSymlinks,
  networkSandboxProbe,
  sandboxInvocation,
  CURSOR_PROBE_REASON_CODES,
  cursorReasonCode,
  cursorStreamFrame,
  parseCursorStreamOutput,
  preflightCursorConsumer,
  runCursorConsumerProbe,
  isSafeRelativePath,
  resolveContained,
  parseFrontmatter,
};
