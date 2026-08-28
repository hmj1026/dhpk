#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildContext } = require('./build-cli-dispatch-context');
const { createSessionDiagnostics } = require('./cli-role-resolver');

const SESSION_DIAGNOSTICS = createSessionDiagnostics((message) => {
  process.stderr.write(`launch-cli-dispatch: WARNING: ${message}\n`);
});

const VALUE_OPTIONS = Object.freeze(new Set([
  'dispatching-agent', 'execution-provider', 'requested-role', 'mode',
  'task-id', 'attempt-id', 'workdir', 'prompt', 'scope', 'config-layer',
]));
const REQUIRED_OPTIONS = Object.freeze([
  'dispatching-agent', 'execution-provider', 'requested-role', 'mode',
  'task-id', 'attempt-id', 'workdir', 'prompt', 'scope',
]);
const SCOPE_KEYS = Object.freeze([
  'artifact_root', 'receipt_path', 'context_path', 'assigned_files', 'report_only', 'runtime_path',
]);
const ADAPTERS = Object.freeze({
  codex: Object.freeze({
    path: path.join(__dirname, '..', '..', 'dhpk-codex-bridge', 'scripts', 'run-codex.sh'),
    args(context) {
      const required = [context.mode, context.workdir, context.prompt_file];
      if (context.requested_effort !== null) return [...required, context.requested_model || '', context.requested_effort];
      if (context.requested_model !== null) return [...required, context.requested_model];
      return required;
    },
  }),
  agy: Object.freeze({
    path: path.join(__dirname, '..', '..', 'dhpk-agy-fast-worker', 'scripts', 'run-agy.sh'),
    args(context) { return [context.workdir, context.prompt_file, context.requested_model]; },
  }),
});

class CliError extends Error {
  constructor(message, exitCode = 65) {
    super(message);
    this.exitCode = exitCode;
  }
}

function usage() {
  return [
    'Usage: launch-cli-dispatch.js',
    '  --dispatching-agent <id> --execution-provider <codex|agy>',
    '  --requested-role <role> --mode <read-only|workspace-write>',
    '  --task-id <id> --attempt-id <id> --workdir <absolute-path>',
    '  --prompt <absolute-path> --scope <absolute-json-path>',
    '  [--config-layer <absolute-json-path>]...',
  ].join('\n');
}

function parseArgs(argv) {
  let parsed = Object.freeze({ 'config-layer': Object.freeze([]) });
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') return { help: true };
    if (!token.startsWith('--') || !VALUE_OPTIONS.has(token.slice(2))) throw new CliError(`unknown option: ${token}`, 2);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new CliError(`missing value for --${name}`, 2);
    index += 1;
    if (name === 'config-layer') {
      parsed = Object.freeze({ ...parsed, [name]: Object.freeze([...parsed[name], value]) });
    } else {
      if (parsed[name] !== undefined) throw new CliError(`duplicate option: --${name}`, 2);
      parsed = Object.freeze({ ...parsed, [name]: value });
    }
  }
  const missing = REQUIRED_OPTIONS.filter((name) => parsed[name] === undefined);
  if (missing.length > 0) throw new CliError(`missing required options: ${missing.map((name) => `--${name}`).join(', ')}`, 2);
  return parsed;
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isContained(parent, child, { direct = false } = {}) {
  const parentPath = path.resolve(parent);
  const childPath = path.resolve(child);
  if (direct) return path.dirname(childPath) === parentPath;
  const relative = path.relative(parentPath, childPath);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function requireAbsolutePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || !path.isAbsolute(value)) {
    throw new CliError(`${label} must be an explicit absolute path`, 2);
  }
}

function validateOptionPaths(options) {
  requireAbsolutePath(options.workdir, 'workdir');
  requireAbsolutePath(options.prompt, 'prompt');
  requireAbsolutePath(options.scope, 'scope');
  for (const filePath of options['config-layer']) requireAbsolutePath(filePath, 'config layer');
  if (!isContained(options.workdir, options.prompt)) throw new CliError('prompt must be lexically contained by workdir');
}

function validateScopePaths(workdir, scope) {
  for (const key of ['artifact_root', 'receipt_path', 'context_path']) requireAbsolutePath(scope[key], key);
  if (typeof scope.runtime_path !== 'string' || scope.runtime_path.length === 0 || scope.runtime_path.includes('\0')) {
    throw new CliError('runtime_path must be an explicit restricted PATH');
  }
  const runtimeEntries = scope.runtime_path.split(path.delimiter);
  if (runtimeEntries.some((entry) => entry.length === 0 || !path.isAbsolute(entry))) {
    throw new CliError('runtime_path must contain only absolute directory entries');
  }
  if (!isContained(workdir, scope.artifact_root)) throw new CliError('artifact_root must be lexically contained by workdir');
  if (!isContained(scope.artifact_root, scope.receipt_path, { direct: true })) {
    throw new CliError('receipt_path must be directly contained by artifact_root');
  }
  if (!isContained(scope.artifact_root, scope.context_path, { direct: true })) {
    throw new CliError('context_path must be directly contained by artifact_root');
  }
}

function lstat(filePath, label) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    throw new CliError(`${label} is unavailable: ${error.message}`);
  }
}

function requireDirectory(filePath, label) {
  const stat = lstat(filePath, label);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CliError(`${label} must be a regular non-symlink directory`);
  return stat;
}

function requireFile(filePath, label) {
  const stat = lstat(filePath, label);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CliError(`${label} must be a regular non-symlink file`);
  return stat;
}

function requireFileParent(filePath, label) {
  return requireDirectory(path.dirname(filePath), `${label} parent`);
}

function requireContainedPhysicalPath(workdir, workdirRealPath, filePath, label, expectedType) {
  const relative = path.relative(path.resolve(workdir), path.resolve(filePath));
  const parts = relative.split(path.sep).filter((part) => part.length > 0);
  let cursor = path.resolve(workdir);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const stat = lstat(cursor, label);
    if (stat.isSymbolicLink()) throw new CliError(`${label} must not traverse a symlink`);
    const isLast = index === parts.length - 1;
    if (!isLast && !stat.isDirectory()) throw new CliError(`${label} parent must be a regular non-symlink directory`);
    if (isLast && expectedType === 'directory' && !stat.isDirectory()) {
      throw new CliError(`${label} must be a regular non-symlink directory`);
    }
    if (isLast && expectedType === 'file' && !stat.isFile()) {
      throw new CliError(`${label} must be a regular non-symlink file`);
    }
  }
  let realPath;
  try {
    realPath = fs.realpathSync(filePath);
  } catch (error) {
    throw new CliError(`${label} is unavailable: ${error.message}`);
  }
  if (!isContained(workdirRealPath, realPath)) throw new CliError(`${label} must be contained by the physical workdir`);
  return { path: path.resolve(filePath), realPath, stat: lstat(filePath, label) };
}

function validatePhysicalPaths(options, scope) {
  requireFileParent(options.scope, 'scope');
  requireFile(options.scope, 'scope');
  requireFileParent(options.prompt, 'prompt');
  const workdir = requireDirectory(options.workdir, 'workdir');
  let workdirRealPath;
  try {
    workdirRealPath = fs.realpathSync(options.workdir);
  } catch (error) {
    throw new CliError(`workdir is unavailable: ${error.message}`);
  }
  const prompt = requireContainedPhysicalPath(options.workdir, workdirRealPath, options.prompt, 'prompt', 'file');
  const artifactRoot = requireContainedPhysicalPath(options.workdir, workdirRealPath, scope.artifact_root, 'artifact_root', 'directory');
  const contextParent = requireContainedPhysicalPath(options.workdir, workdirRealPath, path.dirname(scope.context_path), 'context parent', 'directory');
  try {
    const context = fs.lstatSync(scope.context_path);
    if (context.isSymbolicLink()) throw new CliError('context_path must not be a symlink');
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error.code !== 'ENOENT') throw new CliError(`context_path is unavailable: ${error.message}`);
  }
  return Object.freeze({ workdir: Object.freeze({ path: path.resolve(options.workdir), realPath: workdirRealPath, stat: workdir }), prompt, artifactRoot, contextParent });
}

function readJsonObject(filePath, label) {
  if (!path.isAbsolute(filePath)) throw new CliError(`${label} path must be absolute`, 2);
  let before;
  let descriptor;
  try {
    before = fs.lstatSync(filePath);
  } catch (error) {
    throw new CliError(`${label} is unavailable: ${error.message}`);
  }
  if (!before.isFile() || before.isSymbolicLink()) throw new CliError(`${label} must be a regular non-symlink file`);
  let value;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const pinned = fs.fstatSync(descriptor);
    if (!pinned.isFile() || pinned.dev !== before.dev || pinned.ino !== before.ino) {
      throw new CliError(`${label} changed while opening`);
    }
    value = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`${label} must contain valid JSON: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (!isPlainRecord(value)) throw new CliError(`${label} must contain a JSON object`);
  return value;
}

function loadScope(filePath) {
  const scope = readJsonObject(filePath, 'scope');
  const keys = Object.keys(scope).sort();
  const expected = [...SCOPE_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new CliError(`scope must contain exactly: ${SCOPE_KEYS.join(', ')}`);
  }
  return scope;
}

function loadConfigLayers(filePaths) {
  let config = Object.freeze({});
  for (const filePath of filePaths) {
    const layer = readJsonObject(filePath, 'config layer');
    for (const key of Object.keys(layer)) {
      if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new CliError(`config layer contains invalid key: ${key}`);
    }
    config = Object.freeze({ ...config, ...layer });
  }
  return config;
}

function promptEvidence(promptPath) {
  if (!path.isAbsolute(promptPath)) throw new CliError('prompt path must be absolute', 2);
  let before;
  let descriptor;
  try {
    before = fs.lstatSync(promptPath);
    if (!before.isFile() || before.isSymbolicLink()) throw new CliError('prompt must be a regular non-symlink file');
    descriptor = fs.openSync(promptPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const pinned = fs.fstatSync(descriptor);
    if (pinned.dev !== before.dev || pinned.ino !== before.ino) throw new CliError('prompt changed while opening');
    const payload = fs.readFileSync(descriptor);
    return { path: promptPath, dev: pinned.dev, ino: pinned.ino, sha256: crypto.createHash('sha256').update(payload).digest('hex') };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`prompt is unavailable: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function trustedWriter(filePath, payload, options, expectedParent) {
  if (!options || options.mode !== 0o600 || options.atomic !== true || options.noFollow !== true) {
    throw new Error('writer contract must require mode 0600, atomic create, and no-follow');
  }
  const parent = path.dirname(filePath);
  if (!expectedParent || path.resolve(parent) !== expectedParent.path) throw new Error('context parent does not match validated scope');
  const parentStat = fs.lstatSync(parent);
  const parentRealPath = fs.realpathSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()
      || parentStat.dev !== expectedParent.stat.dev || parentStat.ino !== expectedParent.stat.ino
      || parentRealPath !== expectedParent.realPath) {
    throw new Error('context parent changed after validation');
  }
  const directoryFlags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0);
  const parentDescriptor = fs.openSync(parent, directoryFlags);
  const pinnedParent = fs.fstatSync(parentDescriptor);
  if (!pinnedParent.isDirectory() || pinnedParent.dev !== expectedParent.stat.dev || pinnedParent.ino !== expectedParent.stat.ino) {
    fs.closeSync(parentDescriptor);
    throw new Error('context parent changed while opening');
  }
  const descriptorRoots = ['/proc/self/fd', '/dev/fd'];
  const descriptorRoot = descriptorRoots.find((root) => {
    try {
      const pinned = fs.statSync(path.join(root, String(parentDescriptor)));
      return pinned.dev === pinnedParent.dev && pinned.ino === pinnedParent.ino;
    } catch (_error) {
      return false;
    }
  });
  if (!descriptorRoot) {
    fs.closeSync(parentDescriptor);
    throw new Error('context parent cannot be pinned for atomic creation');
  }
  const pinnedParentPath = path.join(descriptorRoot, String(parentDescriptor));
  const pinnedFilePath = path.join(pinnedParentPath, path.basename(filePath));
  const temporary = path.join(pinnedParentPath, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  try {
    try {
      fs.lstatSync(pinnedFilePath);
      throw new Error('context path already exists');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    descriptor = fs.openSync(temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, payload, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporary, pinnedFilePath);
    const created = fs.lstatSync(pinnedFilePath);
    if (!created.isFile() || created.isSymbolicLink() || (created.mode & 0o777) !== 0o600) {
      throw new Error('created context is not a private regular non-symlink file');
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.closeSync(parentDescriptor);
  }
}

function launch(options) {
  validateOptionPaths(options);
  requireFileParent(options.scope, 'scope');
  requireFile(options.scope, 'scope');
  const scope = loadScope(options.scope);
  validateScopePaths(options.workdir, scope);
  const physicalPaths = validatePhysicalPaths(options, scope);
  const config = loadConfigLayers(options['config-layer']);
  const evidence = promptEvidence(options.prompt);
  const result = buildContext({
    dispatching_agent: options['dispatching-agent'],
    execution_provider: options['execution-provider'],
    requested_role: options['requested-role'],
    mode: options.mode,
    task_id: options['task-id'],
    attempt_id: options['attempt-id'],
    workdir: options.workdir,
    prompt_file: options.prompt,
    prompt_evidence: evidence,
    config,
    ...scope,
  }, {
    diagnostics: SESSION_DIAGNOSTICS,
    writeFile: (filePath, payload, writerOptions) => trustedWriter(filePath, payload, writerOptions, physicalPaths.contextParent),
  });
  if (result.status !== 'READY') throw new CliError(result.reason);
  const adapter = ADAPTERS[result.context.execution_provider];
  if (!adapter) throw new CliError('execution provider has no adapter');
  const adapterStat = fs.lstatSync(adapter.path);
  if (!adapterStat.isFile() || adapterStat.isSymbolicLink() || (adapterStat.mode & 0o111) === 0) {
    throw new CliError('provider adapter must be an executable regular non-symlink file');
  }
  if (result.context.execution_provider === 'agy' && !result.context.requested_model) {
    throw new CliError('AGY model must resolve explicitly before adapter execution');
  }
  const child = spawnSync(adapter.path, adapter.args(result.context), {
    cwd: result.context.workdir,
    env: { ...process.env, PATH: result.context.runtime_path, DHPK_CLI_TRANSPORT_CONTEXT: result.contextPath },
    stdio: 'inherit',
  });
  if (child.error) throw new CliError(`provider adapter failed to start: ${child.error.message}`);
  if (child.signal) return 128;
  return child.status === null ? 1 : child.status;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    return launch(options);
  } catch (error) {
    const exitCode = error instanceof CliError ? error.exitCode : 65;
    process.stderr.write(`launch-cli-dispatch: BLOCKED: ${error.message}\n`);
    if (exitCode === 2) process.stderr.write(`${usage()}\n`);
    return exitCode;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ main });
