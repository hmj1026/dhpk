'use strict';

// Agent Plugins 1.0.0 physical publication and validation.
//
// This module deliberately does not share the Codex-native manifest or its
// ownership rules.  The portable package has a closed root plugin.json,
// immediate-child skills/, and an optional schema-versioned mcp.json.  All
// generated files are physical files so a package can be copied to a clean
// client cache without relying on the source checkout's symlinks.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RECEIPT_SCHEMA, SURFACE_OWNERS } = require('./platform-provenance');
const { compileDistribution, materializeDistribution, verifyDistribution } = require('./distribution-compiler');
const { ProjectionArtifactStore } = require('./projection-artifact-store');

const AGENT_PLUGIN_VERSION = '1.0.0';
const AGENT_PLUGIN_SCHEMA = `https://agent-plugins.org/schemas/${AGENT_PLUGIN_VERSION}/plugin.schema.json`;
const MCP_SCHEMA = `https://agent-plugins.org/schemas/${AGENT_PLUGIN_VERSION}/mcp.schema.json`;
const GENERATOR_VERSION = '1.0.0';

const MANIFEST_FIELDS = new Set([
  '$schema', 'name', 'version', 'description', 'author', 'homepage',
  'repository', 'license', 'keywords', 'extensions',
]);
const FRONTMATTER_DEFAULT_ALLOWLIST = [
  'name', 'description', 'license', 'compatibility', 'metadata',
];
const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PLUGIN_NAME = /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SUPPORTED_MCP_TRANSPORTS = new Set(['stdio', 'streamable-http', 'sse']);
const SAFE_MCP_PLACEHOLDER = /^(?:\$\{PLUGIN_ROOT\}|\$\{PLUGIN_DATA\})(?:\/[^/\\]+)*$/;
const SAFE_ENV_PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const MCP_SECRET_PATTERNS = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]{8,}/i,
  /\b(?:api[_-]?key|token|secret|password|credential|authorization)\s*[:=]\s*["']?(?!\$\{)[^\s,"'}]{8,}/i,
  /\b(?:https?|postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/i,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/i,
];
const CANONICAL_REPOSITORY_URL = 'https://github.com/hmj1026/dhpk/blob/main/';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function lstatOrNull(candidate) {
  try {
    return fs.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isInside(parent, candidate) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
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

function safeRelative(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  if (value.includes('\\') || path.posix.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '.' && normalized !== '..' && !normalized.startsWith('../');
}

function safeMcpPlaceholder(value) {
  if (!SAFE_MCP_PLACEHOLDER.test(value)) return false;
  const segments = String(value).split('/').slice(1);
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function containsMcpCredential(value) {
  return typeof value === 'string' && MCP_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function confinedChild(parent, name, label = 'package child') {
  if (typeof name !== 'string' || name.length === 0 || name.includes('/') || name.includes('\\')) {
    throw new Error(`${label} must be a single path component: ${name}`);
  }
  const candidate = path.resolve(parent, name);
  if (path.dirname(candidate) !== path.resolve(parent)) throw new Error(`${label} escapes its parent: ${name}`);
  return candidate;
}

function findSymlinks(directory) {
  const found = [];
  const stat = lstatOrNull(directory);
  if (!stat) return found;
  if (stat.isSymbolicLink()) return [directory];
  if (!stat.isDirectory()) return found;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) found.push(child);
    else if (entry.isDirectory()) found.push(...findSymlinks(child));
  }
  return found;
}

function assertSourceTreeContained(sourceDir, root) {
  const sourceRoot = fs.realpathSync(root);
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = fs.realpathSync(child);
        } catch (error) {
          throw new Error(`broken source symlink cannot be projected: ${child}`);
        }
        if (!isInside(sourceRoot, target)) {
          throw new Error(`source symlink escapes canonical root: ${path.relative(sourceRoot, child)} -> ${target}`);
        }
        continue;
      }
      if (entry.isDirectory()) walk(child);
    }
  };
  walk(sourceDir);
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

function copyPhysicalTree(sourceDir, destinationDir, relative = '', canonicalRoot = null) {
  const stat = lstatOrNull(sourceDir);
  if (!stat || !stat.isDirectory()) throw new Error(`source skill directory is missing: ${sourceDir}`);
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const source = path.join(sourceDir, entry.name);
    const destination = path.join(destinationDir, entry.name);
    const sourceRelative = path.posix.join(relative, entry.name);
    if (entry.name === '__pycache__' || sourceRelative.endsWith('.pyc')) continue;
    // Codex's openai.yaml is a client-owned policy contract, not an Agent
    // Skills resource.  Do not leak it into the portable package (and do not
    // create an otherwise empty agents/ directory for it).
    if (sourceRelative === 'agents/openai.yaml') continue;
    if (entry.isSymbolicLink()) {
      const target = fs.realpathSync(source);
      // The source containment check runs before copy.  Dereference here so
      // the generated package can never inherit a source symlink.
      if (fs.statSync(target).isDirectory()) copyPhysicalTree(target, destination, sourceRelative, canonicalRoot);
      else if (path.extname(source).toLowerCase() === '.md' && canonicalRoot) fs.writeFileSync(destination, sanitizeMarkdownLinks(fs.readFileSync(target, 'utf8'), target, canonicalRoot));
      else fs.copyFileSync(target, destination);
    } else if (entry.isDirectory()) {
      copyPhysicalTree(source, destination, sourceRelative, canonicalRoot);
    } else if (entry.isFile()) {
      if (path.extname(source).toLowerCase() === '.md' && canonicalRoot) fs.writeFileSync(destination, sanitizeMarkdownLinks(fs.readFileSync(source, 'utf8'), source, canonicalRoot));
      else fs.copyFileSync(source, destination);
    } else {
      throw new Error(`unsupported source filesystem entry: ${source}`);
    }
  }
}

function removeEmptyDirectories(directory) {
  const stat = lstatOrNull(directory);
  if (!stat || !stat.isDirectory()) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(path.join(directory, entry.name));
  }
  if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}

function unquote(value) {
  const trimmed = String(value == null ? '' : value).trim();
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    try { return JSON.parse(trimmed); } catch (_) { return trimmed.slice(1, -1); }
  }
  if (trimmed.length >= 2 && trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'") {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseFrontmatter(content) {
  const clean = String(content).replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { present: false, values: {}, metadata: {}, unknown: [], duplicates: [], body: clean };

  const lines = match[1].split(/\r?\n/);
  const values = {};
  const metadata = {};
  const unknown = [];
  const duplicates = [];
  const seen = new Set();
  let inMetadata = false;
  for (const line of lines) {
    if (/^\s+/.test(line)) {
      if (inMetadata) {
        const nested = line.match(/^\s+([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (nested) metadata[nested[1]] = unquote(nested[2]);
      }
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const raw = keyMatch[2];
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
    if (key === 'metadata' && raw.trim() === '') {
      inMetadata = true;
      values[key] = metadata;
    } else {
      inMetadata = false;
      values[key] = unquote(raw);
      if (key !== 'name' && key !== 'description' && key !== 'license' && key !== 'compatibility' && key !== 'metadata') unknown.push(key);
    }
  }
  return {
    present: true,
    values,
    metadata,
    unknown,
    duplicates,
    body: clean.slice(match[0].length),
  };
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function normalizePortableFrontmatter(content, options = {}) {
  const parsed = parseFrontmatter(content);
  const errors = [];
  if (!parsed.present) errors.push('SKILL.md is missing YAML frontmatter');
  if (parsed.duplicates.length > 0) errors.push(`duplicate frontmatter keys: ${parsed.duplicates.join(', ')}`);

  const allowlist = Array.isArray(options.allowlist) && options.allowlist.length > 0
    ? options.allowlist
    : FRONTMATTER_DEFAULT_ALLOWLIST;
  const values = parsed.values;
  const name = String(values.name == null ? '' : values.name);
  const description = String(values.description == null ? '' : values.description);
  if (!SKILL_NAME.test(name) || name.includes('--')) errors.push(`invalid Agent Skills name: '${name || '(missing)'}'`);
  if (description.length < 1 || description.length > 1024) errors.push('description must be a non-empty string of at most 1024 characters');

  const output = { name, description };
  for (const field of allowlist) {
    if (field === 'name' || field === 'description' || field === 'metadata') continue;
    if (Object.prototype.hasOwnProperty.call(values, field)) output[field] = String(values[field]);
  }
  if (allowlist.includes('metadata') && Object.keys(parsed.metadata).length > 0) {
    output.metadata = Object.fromEntries(Object.keys(parsed.metadata).sort().map((key) => [key, String(parsed.metadata[key])]));
  }
  // Values which are not part of the explicit portable allowlist are policy
  // owned by Claude/Codex/Cursor and intentionally omitted from the output.
  const lines = ['---'];
  for (const field of ['name', 'description', 'license', 'compatibility']) {
    if (Object.prototype.hasOwnProperty.call(output, field)) {
      const rendered = field === 'name' ? output[field] : yamlScalar(output[field]);
      lines.push(`${field}: ${rendered}`);
    }
  }
  if (output.metadata && Object.keys(output.metadata).length > 0) {
    lines.push('metadata:');
    for (const [key, value] of Object.entries(output.metadata)) lines.push(`  ${key}: ${yamlScalar(value)}`);
  }
  lines.push('---');
  const header = `${lines.join('\n')}\n`;
  return {
    ok: errors.length === 0,
    errors,
    name,
    description,
    unknown: parsed.unknown,
    output: `${header}${parsed.body}`,
    frontmatter: output,
  };
}

function validatePortableManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, errors: ['plugin.json must contain a top-level object'] };
  for (const key of Object.keys(manifest)) if (!MANIFEST_FIELDS.has(key)) errors.push(`unknown portable plugin.json field '${key}'`);
  if (manifest.$schema !== AGENT_PLUGIN_SCHEMA) errors.push(`plugin.json $schema must be '${AGENT_PLUGIN_SCHEMA}'`);
  if (typeof manifest.name !== 'string' || !PLUGIN_NAME.test(manifest.name) || manifest.name.includes('--') || manifest.name.includes('..')) errors.push(`plugin.json name must be a lowercase Agent Plugins name: '${manifest.name || '(missing)'}'`);
  for (const field of ['version', 'description', 'homepage', 'repository', 'license']) {
    if (manifest[field] !== undefined && typeof manifest[field] !== 'string') errors.push(`plugin.json ${field} must be a string`);
  }
  if (manifest.author !== undefined) {
    if (!manifest.author || typeof manifest.author !== 'object' || Array.isArray(manifest.author)) errors.push('plugin.json author must be an object');
    else {
      for (const key of Object.keys(manifest.author)) {
        if (!['name', 'email', 'url'].includes(key)) errors.push(`plugin.json author has unknown field '${key}'`);
        else if (typeof manifest.author[key] !== 'string') errors.push(`plugin.json author.${key} must be a string`);
      }
    }
  }
  if (manifest.keywords !== undefined && (!Array.isArray(manifest.keywords) || manifest.keywords.some((value) => typeof value !== 'string'))) errors.push('plugin.json keywords must be a string array');
  if (manifest.extensions !== undefined) {
    if (!manifest.extensions || typeof manifest.extensions !== 'object' || Array.isArray(manifest.extensions)) errors.push('plugin.json extensions must be an object');
    else for (const [namespace, value] of Object.entries(manifest.extensions)) {
      if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\.[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(namespace)) errors.push(`plugin.json extension namespace must be reverse-domain: '${namespace}'`);
      if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push(`plugin.json extension '${namespace}' must contain an object`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function pathValueInsidePackage(value, packageRoot, label, allowData = true) {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, error: `${label} must be a non-empty string` };
  if (value.startsWith('./')) {
    if (!safeRelative(value.slice(2)) || value === './' || value.includes('/../')) return { ok: false, error: `${label} must be a contained './' path: '${value}'` };
    const resolved = path.resolve(packageRoot, value);
    if (!isInside(packageRoot, resolved)) return { ok: false, error: `${label} escapes package root: '${value}'` };
    return { ok: true, resolved };
  }
  if (allowData && safeMcpPlaceholder(value)) return { ok: true };
  return { ok: false, error: `${label} must be a './' package path or PLUGIN_ROOT/PLUGIN_DATA placeholder: '${value}'` };
}

function validateMcpPackagePath(value, packageRoot, label, kind) {
  const checked = pathValueInsidePackage(value, packageRoot, label);
  if (!checked.ok) return checked;
  if (!checked.resolved) return checked;
  const stat = lstatOrNull(checked.resolved);
  if (!stat) return { ok: false, error: `${label} does not exist: '${value}'` };
  if (stat.isSymbolicLink()) return { ok: false, error: `${label} must not be a symlink: '${value}'` };
  let real;
  try { real = fs.realpathSync(checked.resolved); } catch (error) { return { ok: false, error: `${label} cannot resolve: '${value}' (${error.message})` }; }
  if (!isInside(packageRoot, real)) return { ok: false, error: `${label} realpath escapes package root: '${value}'` };
  if (kind === 'file' && !stat.isFile()) return { ok: false, error: `${label} must be a regular file: '${value}'` };
  if (kind === 'directory' && !stat.isDirectory()) return { ok: false, error: `${label} must be a directory: '${value}'` };
  return { ok: true, resolved: checked.resolved };
}

function readContainedJson(root, relative, label) {
  const candidate = path.resolve(root, relative);
  if (!isInside(root, candidate)) throw new Error(`${label} path escapes canonical root: ${relative}`);
  const stat = lstatOrNull(candidate);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file: ${relative}`);
  const real = fs.realpathSync(candidate);
  if (!isInside(root, real)) throw new Error(`${label} realpath escapes canonical root: ${relative}`);
  return JSON.parse(fs.readFileSync(candidate, 'utf8'));
}

function assertProjectionDestination(root, outDir, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  if (resolvedRoot === resolvedOut || isInside(resolvedOut, resolvedRoot)) {
    throw new Error(`${label} output must not be the canonical root or its ancestor: ${resolvedOut}`);
  }
  for (const source of ['skills', 'rules', 'agents', 'commands', 'hooks', 'modules', 'scripts', 'docs', 'manifests']) {
    const sourceRoot = path.join(resolvedRoot, source);
    if (isInside(sourceRoot, resolvedOut)) throw new Error(`${label} output overlaps canonical source tree: ${resolvedOut}`);
  }
  assertPhysicalAncestors(path.dirname(resolvedOut), `${label} output`);
  const existing = lstatOrNull(resolvedOut);
  if (existing && existing.isSymbolicLink()) throw new Error(`${label} output must not be a symlink: ${resolvedOut}`);
}

function replaceDirectory(staged, destination, label) {
  const parent = path.dirname(destination);
  ensurePhysicalDirectory(parent, `${label} destination parent`);
  const existing = lstatOrNull(destination);
  if (existing && existing.isSymbolicLink()) throw new Error(`${label} destination must not be a symlink: ${destination}`);
  const backup = existing ? `${destination}.backup-${process.pid}-${Date.now()}` : null;
  try {
    if (backup) fs.renameSync(destination, backup);
    fs.renameSync(staged, destination);
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (lstatOrNull(destination) && !backup) fs.rmSync(destination, { recursive: true, force: true });
    if (backup && lstatOrNull(backup) && !lstatOrNull(destination)) fs.renameSync(backup, destination);
    throw error;
  }
}

function isRemoteUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.hash;
  } catch (_) {
    return false;
  }
}

function validateMcpServer(name, server, packageRoot) {
  const errors = [];
  if (!server || typeof server !== 'object' || Array.isArray(server)) return [`MCP server '${name}' must be an object`];
  if (!SUPPORTED_MCP_TRANSPORTS.has(server.type)) errors.push(`MCP server '${name}' has unsupported transport '${server.type || '(missing)'}'`);
  const allowed = server.type === 'stdio'
    ? new Set(['type', 'command', 'args', 'env', 'cwd'])
    : new Set(['type', 'url', 'headers']);
  for (const key of Object.keys(server)) if (!allowed.has(key)) errors.push(`MCP server '${name}' has unknown field '${key}'`);
  if (server.type === 'stdio') {
    if (typeof server.command !== 'string' || server.command.trim() === '' || /\s/.test(server.command.trim())) errors.push(`MCP server '${name}' command must be one executable token`);
    else if (server.command.startsWith('./') || server.command.startsWith('${')) {
      const checked = validateMcpPackagePath(server.command, packageRoot, `MCP server '${name}' command`, 'file');
      if (!checked.ok) errors.push(checked.error);
    } else if (!/^[A-Za-z0-9._:+@%=-]+$/.test(server.command) || path.isAbsolute(server.command) || server.command.startsWith('../') || server.command.includes('\\')) errors.push(`MCP server '${name}' command is not a safe executable token: '${server.command}'`);
    if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string'))) errors.push(`MCP server '${name}' args must be a string array`);
    if (Array.isArray(server.args)) server.args.forEach((arg, index) => {
      if (containsMcpCredential(arg)) errors.push(`MCP server '${name}' args[${index}] contains a literal credential-like value`);
    });
    if (server.env !== undefined) {
      if (!server.env || typeof server.env !== 'object' || Array.isArray(server.env)) errors.push(`MCP server '${name}' env must be an object`);
      else for (const [key, value] of Object.entries(server.env)) {
        if (key === 'PLUGIN_ROOT' || key === 'PLUGIN_DATA') errors.push(`MCP server '${name}' may not override reserved environment variable '${key}'`);
        if (typeof value !== 'string') errors.push(`MCP server '${name}' env.${key} must be a string`);
        else {
          if (containsMcpCredential(value)) errors.push(`MCP server '${name}' env.${key} contains a literal credential-like value`);
          if (/(?:api[_-]?key|token|secret|password|credential|authorization)/i.test(key) && !SAFE_ENV_PLACEHOLDER.test(value)) {
            errors.push(`MCP server '${name}' env.${key} must use a variable placeholder`);
          }
        }
      }
    }
    if (server.cwd !== undefined) {
      const checked = validateMcpPackagePath(server.cwd, packageRoot, `MCP server '${name}' cwd`, 'directory');
      if (!checked.ok) errors.push(checked.error);
    }
  } else {
    if (typeof server.url !== 'string' || !isRemoteUrl(server.url)) errors.push(`MCP server '${name}' url must be an absolute HTTP(S) URL without credentials or fragments`);
    if (server.headers !== undefined) {
      if (!server.headers || typeof server.headers !== 'object' || Array.isArray(server.headers)) errors.push(`MCP server '${name}' headers must be an object`);
      else for (const [key, value] of Object.entries(server.headers)) {
        if (typeof value !== 'string') errors.push(`MCP server '${name}' header '${key}' must be a string`);
        if (/authorization|token|secret|password|api[-_]?key/i.test(key) || /^(?:bearer|basic)\s+/i.test(String(value))) errors.push(`MCP server '${name}' header '${key}' must not contain credentials`);
      }
    }
  }
  return errors;
}

function validateMcpConfig(config, packageRoot) {
  const errors = [];
  const valid = [];
  const invalid = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { ok: false, errors: ['mcp.json must contain a top-level object'], valid, invalid };
  if (config.$schema !== MCP_SCHEMA) errors.push(`mcp.json $schema must be '${MCP_SCHEMA}'`);
  for (const key of Object.keys(config)) if (!['$schema', 'mcpServers'].includes(key)) errors.push(`unknown mcp.json field '${key}'`);
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    errors.push('mcp.json mcpServers must be an object');
    return { ok: false, errors, valid, invalid };
  }
  for (const name of Object.keys(config.mcpServers).sort()) {
    const serverErrors = validateMcpServer(name, config.mcpServers[name], packageRoot);
    if (serverErrors.length > 0) {
      invalid.push({ name, errors: serverErrors });
      errors.push(...serverErrors);
    } else valid.push({ name, config: config.mcpServers[name] });
  }
  return { ok: errors.length === 0, errors, valid, invalid };
}

function matrixEntries(inventory, surface) {
  const matrix = inventory && inventory.platform_matrix;
  const entries = Array.isArray(matrix) ? matrix : matrix && Array.isArray(matrix.entries) ? matrix.entries : [];
  return entries.filter((entry) => entry && entry.surface === surface);
}

function projectionIds(inventory, surface) {
  const projections = inventory && inventory.projections;
  if (!projections) return [];
  const value = Array.isArray(projections) ? projections.filter((item) => !item || typeof item === 'string' || !item.surface || item.surface === surface) : projections[surface];
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : item && (item.source_id || item.id || item.skill_id)).filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => Array.isArray(item) ? item : [item]).map((item) => typeof item === 'string' ? item : item && (item.source_id || item.id || item.skill_id)).filter(Boolean);
  return [];
}

function idsFromMatrixRow(row) {
  const values = [];
  for (const field of ['source_id', 'skill_id', 'sourceId', 'skillId']) if (typeof row[field] === 'string') values.push(row[field]);
  for (const field of ['source_ids', 'skill_ids', 'selected_ids', 'selectedIds']) if (Array.isArray(row[field])) values.push(...row[field].filter((value) => typeof value === 'string'));
  return values;
}

function selectPortableSkills(inventory, surface = 'agent-plugin') {
  const entries = Array.isArray(inventory && inventory.skills) ? inventory.skills : [];
  const byId = new Map(entries.map((entry) => [entry && entry.id, entry]));
  const byName = new Map(entries.map((entry) => [entry && entry.name, entry]));
  const membership = inventory && inventory.surface_membership && inventory.surface_membership[surface];
  const direct = entries.filter((entry) => {
    if (!entry || entry.lifecycle === 'deprecated') return false;
    if (Array.isArray(entry.surfaces) && entry.surfaces.includes(surface)) return true;
    if (Array.isArray(entry.surface_membership)) return entry.surface_membership.includes(surface);
    return Boolean(entry.surface_membership && Array.isArray(entry.surface_membership[surface]));
  });
  let selected = Array.isArray(membership) ? membership.map((id) => byId.get(id) || byName.get(id)).filter(Boolean) : direct;
  const projection = projectionIds(inventory, surface);
  if (projection.length > 0) selected = projection.map((id) => byId.get(id) || byName.get(id)).filter(Boolean);
  const rows = matrixEntries(inventory, surface);
  const matrixIds = rows.flatMap(idsFromMatrixRow);
  if (matrixIds.length > 0) selected = matrixIds.map((id) => byId.get(id) || byName.get(id)).filter(Boolean);
  if (rows.length > 0 && matrixIds.length === 0) {
    const paths = rows.flatMap((row) => Array.isArray(row.source_paths) ? row.source_paths : []);
    if (paths.length > 0) {
      selected = selected.filter((entry) => paths.some((source) => source === 'skills/' || source === entry.path || (source.endsWith('/') && entry.path && entry.path.startsWith(source))));
    }
  }
  const seen = new Set();
  return selected.filter((entry) => {
    const id = entry && entry.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return entry.lifecycle !== 'deprecated';
  }).sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

function fingerprintDir(directory) {
  const hash = crypto.createHash('sha256');
  const walk = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const rel = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(absolute, rel);
      else if (entry.isFile()) {
        hash.update(rel);
        hash.update('\0');
        hash.update(fs.readFileSync(absolute));
      } else throw new Error(`cannot fingerprint symlink or special file: ${absolute}`);
    }
  };
  walk(directory, '');
  return hash.digest('hex');
}

function readManifestMetadata(root, manifestMetadata) {
  if (manifestMetadata && typeof manifestMetadata === 'object') return manifestMetadata;
  const candidate = path.join(root, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(candidate)) return {};
  try { return JSON.parse(fs.readFileSync(candidate, 'utf8')); } catch (_) { return {}; }
}

function portableManifest({ name = 'dhpk', version = '0.0.0', manifestMetadata = {}, description, author, homepage, repository, license, keywords, extensions }) {
  const source = readManifestMetadata(process.cwd(), manifestMetadata);
  const manifest = {
    $schema: AGENT_PLUGIN_SCHEMA,
    name,
    version,
    description: description !== undefined ? description : source.description,
    author: author !== undefined ? author : source.author,
    homepage: homepage !== undefined ? homepage : source.homepage,
    repository: repository !== undefined ? repository : source.repository,
    license: license !== undefined ? license : source.license,
    keywords: keywords !== undefined ? keywords : source.keywords,
    extensions,
  };
  return Object.fromEntries(Object.entries(manifest).filter(([, value]) => value !== undefined));
}

function loadMcpOption({ mcpConfig, mcpServers, inventory, root }) {
  if (mcpConfig !== undefined) {
    if (typeof mcpConfig === 'string') {
      return readContainedJson(root, mcpConfig, 'MCP source');
    }
    return mcpConfig;
  }
  if (mcpServers !== undefined) return { $schema: MCP_SCHEMA, mcpServers };
  const source = inventory && (inventory.mcp || inventory.mcp_config || inventory.mcp_servers);
  if (source === undefined) return null;
  if (typeof source === 'string') {
    return readContainedJson(root, source, 'MCP source');
  }
  return source.mcpServers ? source : { $schema: MCP_SCHEMA, mcpServers: source };
}

function writePackageReadmes(packageRoot) {
  fs.writeFileSync(path.join(packageRoot, 'README.md'), [
    '# dhpk Agent Plugin package',
    '',
    'This physical package is generated from the canonical inventory. Install and',
    'verify it using the [platform installation guide](../../docs/platform-installation.md).',
    'It is the physical owner of portable skills shared with the Cursor-native package;',
    'Cursor receives a separate skills tree only when an explicit environment overlay is selected.',
    'Structural validation is not runtime client proof; use the documented consumer',
    'probe and keep `provenance.json`/`fingerprints.json` with this surface.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(packageRoot, 'README.zh-TW.md'), [
    '# dhpk Agent Plugin 套件',
    '',
    '此 physical package 由 canonical inventory 產生，並且是與 Cursor-native package 共用的 portable skills 唯一 physical owner；除非明確選擇 environment overlay，Cursor 不會再複製 skills。安裝與驗證請依照[平台安裝指南](../../docs/platform-installation.zh-TW.md)。結構驗證不等於 client runtime proof；請依指南執行 consumer probe，並保留本 surface 的 `provenance.json`/`fingerprints.json`。',
    '',
  ].join('\n'));
}

function packageReadmeContents() {
  return {
    'README.md': [
      '# dhpk Agent Plugin package',
      '',
      'This physical package is generated from the canonical inventory. Install and',
      'verify it using the [platform installation guide](../../docs/platform-installation.md).',
      'It is the physical owner of portable skills shared with the Cursor-native package;',
      'Cursor receives a separate skills tree only when an explicit environment overlay is selected.',
      'Structural validation is not runtime client proof; use the documented consumer',
      'probe and keep `provenance.json`/`fingerprints.json` with this surface.',
      '',
    ].join('\n'),
    'README.zh-TW.md': [
      '# dhpk Agent Plugin 套件',
      '',
      '此 physical package 由 canonical inventory 產生，並且是與 Cursor-native package 共用的 portable skills 唯一 physical owner；除非明確選擇 environment overlay，Cursor 不會再複製 skills。安裝與驗證請依照[平台安裝指南](../../docs/platform-installation.zh-TW.md)。結構驗證不等於 client runtime proof；請依指南執行 consumer probe，並保留本 surface 的 `provenance.json`/`fingerprints.json`。',
      '',
    ].join('\n'),
  };
}

function fingerprintProjectedFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files.slice().sort((a, b) => a.relative.localeCompare(b.relative))) {
    hash.update(file.relative);
    hash.update('\0');
    hash.update(file.content);
  }
  return hash.digest('hex');
}

function collectProjectedFiles(sourceDir, canonicalRoot, relative = '', overrides = {}) {
  const files = [];
  const addFile = (sourceFile, destinationRelative) => {
    const override = Object.prototype.hasOwnProperty.call(overrides, destinationRelative)
      ? overrides[destinationRelative]
      : null;
    let content = override === null ? fs.readFileSync(sourceFile) : Buffer.from(String(override));
    if (override === null && path.extname(sourceFile).toLowerCase() === '.md') {
      content = Buffer.from(sanitizeMarkdownLinks(fs.readFileSync(sourceFile, 'utf8'), sourceFile, canonicalRoot));
    }
    files.push({ relative: destinationRelative, source: sourceFile, content });
  };
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const source = path.join(sourceDir, entry.name);
    const destinationRelative = path.posix.join(relative, entry.name);
    if (entry.name === '__pycache__' || destinationRelative.endsWith('.pyc')) continue;
    if (destinationRelative === 'agents/openai.yaml') continue;
    if (entry.isSymbolicLink()) {
      const target = fs.realpathSync(source);
      if (fs.statSync(target).isDirectory()) collectProjectedFiles(target, canonicalRoot, destinationRelative, overrides).forEach((file) => files.push(file));
      else if (fs.statSync(target).isFile()) addFile(target, destinationRelative);
      else throw new Error(`unsupported source filesystem entry: ${source}`);
    } else if (entry.isDirectory()) {
      collectProjectedFiles(source, canonicalRoot, destinationRelative, overrides).forEach((file) => files.push(file));
    } else if (entry.isFile()) {
      addFile(source, destinationRelative);
    } else {
      throw new Error(`unsupported source filesystem entry: ${source}`);
    }
  }
  return files;
}

function outputRecord(stableId, destination, content, source, transform) {
  return {
    stableId,
    source: source || `generated/${destination}`,
    destination,
    content,
    transform: transform || { id: 'agent-plugin-generated', version: GENERATOR_VERSION },
  };
}

function buildAgentPluginProjection(options = {}) {
  const {
    inventory = {},
    root,
    outDir,
    name = 'dhpk',
    version = '0.0.0',
    sourceCommit = 'unknown',
    generatorVersion = GENERATOR_VERSION,
    manifestMetadata,
    description,
    author,
    homepage,
    repository,
    license,
    keywords,
    extensions,
    mcpConfig,
    mcpServers,
  } = options;
  if (!root || !outDir) throw new Error('materializeAgentPluginPackage requires root and outDir');
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  ensurePhysicalDirectory(resolvedRoot, 'canonical root');
  assertProjectionDestination(resolvedRoot, resolvedOut, 'Agent Plugin');

  const allowlist = inventory.portable_frontmatter && inventory.portable_frontmatter.allowlist;
  const selected = selectPortableSkills(inventory);
  const files = [];
  const fingerprints = {};
  const selectedEntries = [];
  const skipped = [];
  for (const entry of selected) {
    const publicName = entry.name || entry.id;
    const sourcePath = entry.path;
    if (!safeRelative(sourcePath)) throw new Error(`unsafe source path for '${publicName}': ${sourcePath}`);
    const sourceDir = path.resolve(resolvedRoot, ...sourcePath.split('/'));
    if (!isInside(resolvedRoot, sourceDir)) throw new Error(`source path for '${publicName}' escapes canonical root: ${sourcePath}`);
    const sourceStat = lstatOrNull(sourceDir);
    if (!sourceStat || !sourceStat.isDirectory()) {
      skipped.push({ id: entry.id, name: publicName, reason: `source skill directory is missing: ${sourcePath}` });
      continue;
    }
    const sourceFile = path.join(sourceDir, 'SKILL.md');
    if (!lstatOrNull(sourceFile) || !fs.statSync(sourceFile).isFile()) {
      skipped.push({ id: entry.id, name: publicName, reason: 'SKILL.md is missing' });
      continue;
    }
    let normalized;
    try { normalized = normalizePortableFrontmatter(fs.readFileSync(sourceFile, 'utf8'), { allowlist }); } catch (error) {
      skipped.push({ id: entry.id, name: publicName, reason: error.message });
      continue;
    }
    if (!normalized.ok || normalized.name !== publicName) {
      skipped.push({ id: entry.id, name: publicName, reason: normalized.errors.concat(normalized.name !== publicName ? `frontmatter name '${normalized.name || '(missing)'}' does not match public name '${publicName}'` : []).join('; ') });
      continue;
    }
    assertSourceTreeContained(sourceDir, resolvedRoot);
    const skillFiles = collectProjectedFiles(sourceDir, resolvedRoot, '', { 'SKILL.md': normalized.output });
    fingerprints[publicName] = fingerprintProjectedFiles(skillFiles);
    for (const file of skillFiles) {
      files.push(outputRecord(
        `skill:${entry.id}:${file.relative}`,
        path.posix.join('skills', publicName, file.relative),
        file.content,
        path.posix.join(sourcePath, file.relative),
        { id: 'agent-plugin-skill', version: generatorVersion },
      ));
    }
    selectedEntries.push(entry);
  }

  const sourceManifest = readManifestMetadata(resolvedRoot, manifestMetadata);
  const manifest = portableManifest({
    name,
    version,
    manifestMetadata: sourceManifest,
    description,
    author,
    homepage,
    repository,
    license,
    keywords,
    extensions,
  });
  const manifestValidation = validatePortableManifest(manifest);
  if (!manifestValidation.ok) throw new Error(`generated portable manifest is invalid: ${manifestValidation.errors.join('; ')}`);
  files.push(outputRecord('manifest:plugin', 'plugin.json', `${JSON.stringify(manifest, null, 2)}\n`));

  const mcpSource = loadMcpOption({ mcpConfig, mcpServers, inventory, root: resolvedRoot });
  let mcp = { valid: [], invalid: [], errors: [] };
  if (mcpSource !== null) {
    mcp = validateMcpConfig(mcpSource, resolvedOut);
    if (!mcp.ok) throw new Error(`MCP configuration is invalid: ${mcp.errors.join('; ')}`);
    if (mcp.valid.length > 0) {
      const generated = { $schema: MCP_SCHEMA, mcpServers: Object.fromEntries(mcp.valid.map((entry) => [entry.name, entry.config])) };
      files.push(outputRecord('manifest:mcp', 'mcp.json', `${JSON.stringify(generated, null, 2)}\n`));
    }
  }

  const selectedSkillIds = selectedEntries.map((entry) => entry.id).sort();
  const selectedSkillNames = selectedEntries.map((entry) => entry.name || entry.id).sort();
  const selectedMatrixIds = matrixEntries(inventory, 'agent-plugin').map((entry) => entry.id).filter(Boolean).sort();
  const provenance = {
    schema: RECEIPT_SCHEMA,
    surface: 'agent-plugin',
    owner: SURFACE_OWNERS['agent-plugin'],
    sourceVersion: version,
    sourceCommit,
    inventoryDigest: digest(stableStringify(inventory)),
    generatorVersion,
    schemaVersion: AGENT_PLUGIN_VERSION,
    selectedSkillIds,
    selectedSkillNames,
    selectedPlatformMatrixIds: selectedMatrixIds,
    skippedSkills: skipped,
    mcpServerNames: mcp.valid.map((entry) => entry.name).sort(),
    fingerprints,
  };
  files.push(outputRecord('manifest:provenance', 'provenance.json', `${JSON.stringify(provenance, null, 2)}\n`));
  files.push(outputRecord('manifest:fingerprints', 'fingerprints.json', `${JSON.stringify({ generatorVersion, surface: 'agent-plugin', skills: fingerprints }, null, 2)}\n`));
  for (const [destination, content] of Object.entries(packageReadmeContents())) files.push(outputRecord(`manifest:${destination}`, destination, content));

  const entries = files.map((file) => ({
    stableId: file.stableId,
    source: file.source,
    destination: file.destination,
    owner: 'plugins/dhpk-agent',
    transform: file.transform,
    expectedFingerprint: digest(file.content),
    symlinkPolicy: 'forbid',
  }));
  const compiled = compileDistribution({
    surface: 'agent-plugin',
    compilerVersion: `agent-plugin-${generatorVersion}`,
    inventoryFingerprint: digest(stableStringify(inventory)),
    ownershipRoot: resolvedOut,
    entries,
  });
  if (!compiled.ok) throw new Error(compiled.error.message);

  const adapter = {
    identity: { id: 'agent-plugin', version: generatorVersion },
    render: () => ({
      adapter: { id: 'agent-plugin', version: generatorVersion },
      outputs: files.slice().sort((a, b) => a.destination.localeCompare(b.destination)),
      links: [],
      metadata: {
        manifest,
        skillIds: selectedSkillIds,
        skillNames: selectedSkillNames,
        fingerprints,
        provenance,
        skippedSkills: skipped,
        mcp,
      },
    }),
    validate: (rendered, context) => {
      if (!context || !context.session || !context.session.stageRoot) return;
      const validation = validateAgentPluginPackage(context.session.stageRoot, { allowlist });
      if (!validation.ok) throw new Error(`generated Agent Plugin failed validation: ${validation.errors.join('; ')}`);
      return rendered;
    },
  };
  return { plan: compiled.value, adapter, selectedSkillIds, selectedSkillNames, fingerprints, provenance, skippedSkills: skipped, mcp };
}

function compileAgentPluginPackage(options = {}) {
  return buildAgentPluginProjection(options);
}

function materializeAgentPluginPackageUnsafe({
  inventory = {},
  root,
  outDir,
  name = 'dhpk',
  version = '0.0.0',
  sourceCommit = 'unknown',
  generatorVersion = GENERATOR_VERSION,
  manifestMetadata,
  description,
  author,
  homepage,
  repository,
  license,
  keywords,
  extensions,
  mcpConfig,
  mcpServers,
} = {}) {
  if (!root || !outDir) throw new Error('materializeAgentPluginPackage requires root and outDir');
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  ensurePhysicalDirectory(resolvedRoot, 'canonical root');
  ensurePhysicalDirectory(resolvedOut, 'output root');
  const skillsOut = path.join(resolvedOut, 'skills');
  ensurePhysicalDirectory(skillsOut, 'skills output directory');

  const allowlist = inventory.portable_frontmatter && inventory.portable_frontmatter.allowlist;
  const selected = selectPortableSkills(inventory);
  const selectedNames = new Set(selected.map((entry) => entry.name || entry.id));
  for (const existing of fs.readdirSync(skillsOut)) {
    if (!selectedNames.has(existing)) fs.rmSync(confinedChild(skillsOut, existing, 'stale skill'), { recursive: true, force: true });
  }

  const fingerprints = {};
  const selectedEntries = [];
  const skipped = [];
  for (const entry of selected) {
    const publicName = entry.name || entry.id;
    const sourcePath = entry.path;
    if (!safeRelative(sourcePath)) throw new Error(`unsafe source path for '${publicName}': ${sourcePath}`);
    const sourceDir = path.resolve(resolvedRoot, ...sourcePath.split('/'));
    if (!isInside(resolvedRoot, sourceDir)) throw new Error(`source path for '${publicName}' escapes canonical root: ${sourcePath}`);
    const sourceStat = lstatOrNull(sourceDir);
    if (!sourceStat || !sourceStat.isDirectory()) {
      skipped.push({ id: entry.id, name: publicName, reason: `source skill directory is missing: ${sourcePath}` });
      continue;
    }
    const sourceFile = path.join(sourceDir, 'SKILL.md');
    if (!lstatOrNull(sourceFile) || !fs.statSync(sourceFile).isFile()) {
      skipped.push({ id: entry.id, name: publicName, reason: 'SKILL.md is missing' });
      continue;
    }
    let normalized;
    try { normalized = normalizePortableFrontmatter(fs.readFileSync(sourceFile, 'utf8'), { allowlist }); } catch (error) {
      skipped.push({ id: entry.id, name: publicName, reason: error.message });
      continue;
    }
    if (!normalized.ok || normalized.name !== publicName) {
      skipped.push({ id: entry.id, name: publicName, reason: normalized.errors.concat(normalized.name !== publicName ? `frontmatter name '${normalized.name || '(missing)'}' does not match public name '${publicName}'` : []).join('; ') });
      continue;
    }
    assertSourceTreeContained(sourceDir, resolvedRoot);
    const destination = confinedChild(skillsOut, publicName, 'skill output');
    if (lstatOrNull(destination)) fs.rmSync(destination, { recursive: true, force: true });
    copyPhysicalTree(sourceDir, destination, '', resolvedRoot);
    removeEmptyDirectories(destination);
    // The portable projection owns SKILL.md; replace the copied canonical file
    // with its normalized, policy-free form.
    fs.writeFileSync(path.join(destination, 'SKILL.md'), normalized.output);
    const links = findSymlinks(destination);
    if (links.length > 0) throw new Error(`generated skill contains symlinks: ${links.join(', ')}`);
    fingerprints[publicName] = fingerprintDir(destination);
    selectedEntries.push(entry);
  }

  const sourceManifest = readManifestMetadata(resolvedRoot, manifestMetadata);
  const manifest = portableManifest({
    name,
    version,
    manifestMetadata: sourceManifest,
    description,
    author,
    homepage,
    repository,
    license,
    keywords,
    extensions,
  });
  const manifestValidation = validatePortableManifest(manifest);
  if (!manifestValidation.ok) throw new Error(`generated portable manifest is invalid: ${manifestValidation.errors.join('; ')}`);
  fs.writeFileSync(path.join(resolvedOut, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const mcpSource = loadMcpOption({ mcpConfig, mcpServers, inventory, root: resolvedRoot });
  let mcp = { valid: [], invalid: [], errors: [] };
  if (mcpSource !== null) {
    mcp = validateMcpConfig(mcpSource, resolvedOut);
    if (!mcp.ok) throw new Error(`MCP configuration is invalid: ${mcp.errors.join('; ')}`);
    if (mcp.valid.length > 0) {
      const generated = { $schema: MCP_SCHEMA, mcpServers: Object.fromEntries(mcp.valid.map((entry) => [entry.name, entry.config])) };
      fs.writeFileSync(path.join(resolvedOut, 'mcp.json'), `${JSON.stringify(generated, null, 2)}\n`);
    } else if (fs.existsSync(path.join(resolvedOut, 'mcp.json'))) {
      fs.rmSync(path.join(resolvedOut, 'mcp.json'), { force: true });
    }
  } else if (fs.existsSync(path.join(resolvedOut, 'mcp.json'))) {
    fs.rmSync(path.join(resolvedOut, 'mcp.json'), { force: true });
  }

  const selectedSkillIds = selectedEntries.map((entry) => entry.id).sort();
  const selectedSkillNames = selectedEntries.map((entry) => entry.name || entry.id).sort();
  const selectedMatrixIds = matrixEntries(inventory, 'agent-plugin').map((entry) => entry.id).filter(Boolean).sort();
  const provenance = {
    schema: RECEIPT_SCHEMA,
    surface: 'agent-plugin',
    owner: SURFACE_OWNERS['agent-plugin'],
    sourceVersion: version,
    sourceCommit,
    inventoryDigest: digest(stableStringify(inventory)),
    generatorVersion,
    schemaVersion: AGENT_PLUGIN_VERSION,
    selectedSkillIds,
    selectedSkillNames,
    selectedPlatformMatrixIds: selectedMatrixIds,
    skippedSkills: skipped,
    mcpServerNames: mcp.valid.map((entry) => entry.name).sort(),
    fingerprints,
  };
  fs.writeFileSync(path.join(resolvedOut, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  const evidence = { generatorVersion, surface: 'agent-plugin', skills: fingerprints };
  fs.writeFileSync(path.join(resolvedOut, 'fingerprints.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  writePackageReadmes(resolvedOut);

  return {
    manifest,
    manifestPath: path.join(resolvedOut, 'plugin.json'),
    skillIds: selectedSkillIds,
    skillNames: selectedSkillNames,
    fingerprints,
    provenance,
    skippedSkills: skipped,
    mcp,
  };
}

function materializeAgentPluginPackage(options = {}) {
  const { root, outDir } = options;
  if (!root || !outDir) throw new Error('materializeAgentPluginPackage requires root and outDir');
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  ensurePhysicalDirectory(resolvedRoot, 'canonical root');
  assertProjectionDestination(resolvedRoot, resolvedOut, 'Agent Plugin');
  const parent = path.dirname(resolvedOut);
  ensurePhysicalDirectory(parent, 'Agent Plugin staging parent');
  const projection = options.compiledProjection || buildAgentPluginProjection({ ...options, root: resolvedRoot, outDir: resolvedOut });
  const artifactStore = options.artifactStore || new ProjectionArtifactStore({
    root: parent,
    sourceRoot: resolvedRoot,
    publishRoot: resolvedOut,
  });
  const artifact = materializeDistribution(projection.plan, projection.adapter, artifactStore);
  if (!artifact.ok) throw new Error(`generated Agent Plugin failed validation: ${artifact.error.message}`);
  const metadata = artifact.value.metadata || {};
  return {
    manifest: metadata.manifest || projection.adapter.manifest,
    manifestPath: path.join(resolvedOut, 'plugin.json'),
    skillIds: metadata.skillIds || projection.selectedSkillIds,
    skillNames: metadata.skillNames || projection.selectedSkillNames,
    fingerprints: metadata.fingerprints || projection.fingerprints,
    provenance: metadata.provenance || projection.provenance,
    skippedSkills: metadata.skippedSkills || projection.skippedSkills,
    mcp: metadata.mcp || projection.mcp,
    artifact: artifact.value,
  };
}

function validateAgentPluginPackage(input, maybeOptions = {}) {
  const packageRoot = typeof input === 'string' ? path.resolve(input) : path.resolve(input.packageRoot);
  const options = typeof input === 'string' ? maybeOptions : input;
  const errors = [];
  const warnings = [];
  const skills = { valid: [], invalid: [] };
  const mcp = { valid: [], invalid: [] };
  const rootStat = lstatOrNull(packageRoot);
  if (!rootStat || !rootStat.isDirectory()) return { ok: false, errors: [`package root is not a directory: ${packageRoot}`], warnings, skills, mcp };
  if (rootStat.isSymbolicLink()) errors.push('package root must not be a symlink');
  const links = findSymlinks(packageRoot);
  if (links.length > 0) errors.push(`package contains symlinks: ${links.map((link) => path.relative(packageRoot, link)).join(', ')}`);
  const manifestPath = path.join(packageRoot, 'plugin.json');
  const manifestStat = lstatOrNull(manifestPath);
  if (!manifestStat || !manifestStat.isFile()) errors.push('package root must contain a regular plugin.json');
  let manifest = null;
  if (manifestStat && manifestStat.isFile()) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (error) { errors.push(`plugin.json is not valid JSON: ${error.message}`); }
  }
  if (manifest) errors.push(...validatePortableManifest(manifest).errors);

  const skillsRoot = path.join(packageRoot, 'skills');
  const skillsStat = lstatOrNull(skillsRoot);
  if (skillsStat && !skillsStat.isDirectory()) errors.push('skills must be a directory when present');
  if (skillsStat && skillsStat.isDirectory()) {
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) {
        errors.push(`skills contains a non-directory immediate child '${entry.name}'`);
        continue;
      }
      const directory = path.join(skillsRoot, entry.name);
      const skillFile = path.join(directory, 'SKILL.md');
      const stat = lstatOrNull(skillFile);
      if (!stat || !stat.isFile()) {
        const invalid = { name: entry.name, errors: ['SKILL.md is missing or not a regular file'] };
        skills.invalid.push(invalid);
        errors.push(`skill '${entry.name}' is invalid: ${invalid.errors.join('; ')}`);
        continue;
      }
      const normalized = normalizePortableFrontmatter(fs.readFileSync(skillFile, 'utf8'), { allowlist: options.allowlist });
      const skillErrors = [...normalized.errors];
      if (normalized.name !== entry.name) skillErrors.push(`frontmatter name '${normalized.name || '(missing)'}' does not match directory '${entry.name}'`);
      if (skillErrors.length > 0) {
        skills.invalid.push({ name: entry.name, errors: skillErrors });
        errors.push(`skill '${entry.name}' is invalid: ${skillErrors.join('; ')}`);
      }
      else skills.valid.push({ name: entry.name, fingerprint: fingerprintDir(directory) });
    }
  }

  const mcpPath = path.join(packageRoot, 'mcp.json');
  if (fs.existsSync(mcpPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      const checked = validateMcpConfig(config, packageRoot);
      mcp.valid.push(...checked.valid);
      mcp.invalid.push(...checked.invalid);
      errors.push(...checked.errors);
    } catch (error) { errors.push(`mcp.json is not valid JSON: ${error.message}`); }
  }

  const fingerprintsPath = path.join(packageRoot, 'fingerprints.json');
  if (fs.existsSync(fingerprintsPath)) {
    try {
      const recorded = JSON.parse(fs.readFileSync(fingerprintsPath, 'utf8'));
      for (const skill of skills.valid) if (recorded.skills && recorded.skills[skill.name] && recorded.skills[skill.name] !== skill.fingerprint) errors.push(`fingerprint drifted for skill '${skill.name}'`);
    } catch (error) { errors.push(`fingerprints.json is not valid JSON: ${error.message}`); }
  }
  const provenancePath = path.join(packageRoot, 'provenance.json');
  if (fs.existsSync(provenancePath)) {
    try {
      const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
      if (provenance.surface !== undefined && provenance.surface !== 'agent-plugin') errors.push(`provenance surface must be agent-plugin, got '${provenance.surface}'`);
      if (provenance.schemaVersion !== undefined && provenance.schemaVersion !== AGENT_PLUGIN_VERSION) errors.push(`provenance schemaVersion must be ${AGENT_PLUGIN_VERSION}`);
      const actualNames = skills.valid.map((skill) => skill.name).sort();
      if (Array.isArray(provenance.selectedSkillNames) && JSON.stringify(provenance.selectedSkillNames) !== JSON.stringify(actualNames)) errors.push('provenance selectedSkillNames does not match generated skills');
    } catch (error) { errors.push(`provenance.json is not valid JSON: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors, warnings, manifest, skills, mcp };
}

function verifyAgentPluginPackage(input, maybeOptions = {}) {
  const structural = validateAgentPluginPackage(input, maybeOptions);
  const packageRoot = typeof input === 'string' ? path.resolve(input) : path.resolve(input.packageRoot);
  let planFingerprint = 'agent-plugin-unbound';
  let artifactFingerprint = 'agent-plugin-unobserved';
  try {
    const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'provenance.json'), 'utf8'));
    if (typeof provenance.inventoryDigest === 'string' && provenance.inventoryDigest.length > 0) planFingerprint = provenance.inventoryDigest;
  } catch (_) { /* structural errors retain the legacy report; evidence stays FAIL */ }
  try { artifactFingerprint = fingerprintDir(packageRoot); } catch (_) { /* missing/invalid roots remain FAIL */ }
  const evidence = verifyDistribution('structural', {
    planFingerprint,
    artifactFingerprint,
  }, {
    identity: { id: 'agent-plugin-validator', version: GENERATOR_VERSION },
    verify: () => ({
      verdict: structural.ok ? 'PASS' : 'FAIL',
      claims: ['portable package structure', 'package-boundary safety', 'provenance receipt'],
      observations: structural.errors.length === 0 ? ['validated package output'] : structural.errors,
      diagnostics: structural.errors,
    }),
  });
  return { ...structural, evidence: evidence.ok ? evidence.value : evidence };
}

module.exports = {
  AGENT_PLUGIN_VERSION,
  AGENT_PLUGIN_SCHEMA,
  MCP_SCHEMA,
  GENERATOR_VERSION,
  MANIFEST_FIELDS: [...MANIFEST_FIELDS],
  FRONTMATTER_DEFAULT_ALLOWLIST,
  parseFrontmatter,
  normalizePortableFrontmatter,
  validatePortableManifest,
  validateMcpConfig,
  validateMcpServer,
  selectPortableSkills,
  matrixEntries,
  materializeAgentPluginPackage,
  compileAgentPluginPackage,
  validateAgentPluginPackage,
  verifyAgentPluginPackage,
  fingerprintDir,
  stableStringify,
};
