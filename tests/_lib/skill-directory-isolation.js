'use strict';

// Trusted behavioral fixtures, not an OS sandbox: conventional external tool
// calls are denied/stubbed and all fixture-owned state uses a fresh directory.
// Tests must not execute untrusted code or use absolute external-tool bypasses.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTraversalBudget } = require('../../scripts/lib/bounded-filesystem');

const DENIED_TOOLS = [
  'git', 'gh', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'uv',
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'docker', 'kubectl', 'brew',
  'claude', 'codex', 'agy', 'cursor', 'openspec',
];
const RESERVED = new Set(['NODE_PATH', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME']);

function ignored(name) {
  return ['.git', '.cache', '__pycache__'].includes(name) || name.endsWith('.pyc');
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)
    || /[\\\0]/.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`resource escapes the Skill boundary: ${String(value)}`);
  }
  if (value.split('/').some(ignored)) throw new Error(`required resource uses an ignored path: ${value}`);
  return value;
}

function physicalFile(root, relative) {
  relativePath(relative);
  let current = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`symlink crosses Skill boundary: ${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`non-directory ancestor: ${relative}`);
    if (index === parts.length - 1 && !stat.isFile()) throw new Error(`resource is not a regular file: ${relative}`);
  }
  return current;
}

function snapshotSource(source, selected) {
  const root = path.resolve(source);
  if (fs.lstatSync(root).isSymbolicLink() || !fs.lstatSync(root).isDirectory()
    || fs.realpathSync(root) !== root) throw new Error('Skill source must have a physical directory boundary');
  const budget = createTraversalBudget();
  const names = [];
  function visit(directory, prefix, depth) {
    const identity = budget.enterDirectory(directory, depth);
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (ignored(entry.name)) continue;
        const relative = prefix + entry.name;
        budget.accountEntry(relative);
        if (entry.isSymbolicLink()) throw new Error(`symlink crosses Skill boundary: ${relative}`);
        if (entry.isDirectory()) visit(path.join(directory, entry.name), relative + '/', depth + 1);
        else if (entry.isFile()) names.push(relative);
        else throw new Error(`non-regular Skill resource: ${relative}`);
      }
    } finally { budget.leaveDirectory(identity); }
  }
  if (selected !== undefined) {
    if (!Array.isArray(selected) || new Set(selected).size !== selected.length) throw new Error('files must be a unique array');
    names.push(...selected.map(relativePath));
  } else visit(root, '', 0);
  if (!names.includes('SKILL.md')) throw new Error('isolated Skill must include SKILL.md');
  return names.sort().map((relative) => {
    const file = physicalFile(root, relative);
    const stat = fs.lstatSync(file);
    return { relative, mode: stat.mode & 0o777, bytes: budget.readFile(file, stat, relative) };
  });
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function installStub(directory, name, definition) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error(`invalid fixture tool name: ${name}`);
  const status = definition.status === undefined ? 127 : definition.status;
  if (!Number.isInteger(status) || status < 0 || status > 255) throw new Error(`invalid stub status: ${name}`);
  const code = definition.body === undefined
    ? `process.stdout.write(${JSON.stringify(String(definition.stdout || ''))});process.stderr.write(${JSON.stringify(String(definition.stderr || ''))});process.exitCode=${status};`
    : String(definition.body);
  const file = path.join(directory, name);
  fs.writeFileSync(file, `#!/bin/sh\nexec ${quoteShell(process.execPath)} -e ${quoteShell(code)} -- "$@"\n`, { mode: 0o755 });
}

function fixtureEnvironment(values, directories) {
  const env = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (RESERVED.has(key) || /(?:DHPK|PLUGIN|SOURCE|CURSOR).*ROOT/.test(key)) continue;
    if (typeof value === 'string') env[key] = value;
  }
  return {
    ...env,
    PATH: directories.binDir + path.delimiter + '/usr/bin:/bin',
    HOME: directories.homeDir,
    TMPDIR: directories.tempDir,
    TMP: directories.tempDir,
    TEMP: directories.tempDir,
    XDG_CACHE_HOME: directories.cacheDir,
    npm_config_cache: path.join(directories.cacheDir, 'npm'),
    PIP_CACHE_DIR: path.join(directories.cacheDir, 'pip'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(directories.homeDir, '.gitconfig'),
    LANG: 'C.UTF-8',
  };
}

function withIsolatedSkill({ source, files, env, stubs = {} }, callback) {
  if (typeof callback !== 'function') throw new Error('isolation callback is required');
  const resources = snapshotSource(source, files);
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk raw skill '));
  const directories = {
    skillDir: path.join(sandbox, 'relocated skill'),
    projectDir: path.join(sandbox, 'fixture project'),
    homeDir: path.join(sandbox, 'fixture home'),
    cacheDir: path.join(sandbox, 'fixture cache'),
    tempDir: path.join(sandbox, 'fixture temp'),
    binDir: path.join(sandbox, 'fixture tools'),
  };
  try {
    for (const directory of Object.values(directories)) fs.mkdirSync(directory);
    for (const resource of resources) {
      const target = path.join(directories.skillDir, resource.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, resource.bytes, { mode: resource.mode });
      fs.chmodSync(target, resource.mode);
    }
    fs.writeFileSync(path.join(directories.binDir, 'node'),
      `#!/bin/sh\nexec ${quoteShell(process.execPath)} "$@"\n`, { mode: 0o755 });
    for (const name of new Set([...DENIED_TOOLS, ...Object.keys(stubs)])) {
      installStub(directories.binDir, name, stubs[name] || {
        status: 127, stderr: `UNAVAILABLE: fixture must explicitly stub ${name}\n`,
      });
    }
    const childEnv = fixtureEnvironment(env, directories);
    const context = {
      ...directories,
      env: childEnv,
      evidenceKind: 'fixture',
      hostStatus: 'NOT_RUN',
      run(entry, args = [], options = {}) {
        const file = physicalFile(directories.skillDir, entry);
        const cwd = path.resolve(options.cwd || directories.projectDir);
        if (cwd !== directories.projectDir && !cwd.startsWith(directories.projectDir + path.sep)) {
          throw new Error('fixture cwd must stay within the isolated project');
        }
        if (fs.realpathSync(cwd) !== cwd) throw new Error('fixture cwd must not traverse a symlink');
        const extension = path.extname(file);
        const interpreter = { '.js': process.execPath, '.sh': '/bin/bash', '.py': '/usr/bin/python3' }[extension];
        const result = spawnSync(interpreter || file, interpreter ? [file, ...args] : args, {
          cwd,
          env: fixtureEnvironment({ ...childEnv, ...(options.env || {}) }, directories),
          encoding: 'utf8', input: options.input,
          timeout: Math.min(options.timeout || 10000, 30000),
          maxBuffer: 4 * 1024 * 1024,
        });
        return { ...result, evidenceKind: 'fixture', hostStatus: 'NOT_RUN' };
      },
    };
    const result = callback(context);
    if (result && typeof result.then === 'function') throw new Error('isolation callbacks must be synchronous');
    return result;
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
}

module.exports = { withIsolatedSkill };
