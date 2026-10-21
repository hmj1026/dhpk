#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAX_BYTES = 16 * 1024 * 1024;
const REPOSITORY_ENV = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX',
];

function git(cwd, args, optionalStatus = null) {
  const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: MAX_BYTES,
    timeout: 30000,
  });
  if (result.error || result.signal || result.status !== 0 && result.status !== optionalStatus) {
    throw new Error('GIT_QUERY_FAILED: Git unavailable, query failed, timed out, or exceeded 16 MiB');
  }
  if (result.status === optionalStatus) return null;
  const output = result.stdout.toString('utf8');
  if (!Buffer.from(output, 'utf8').equals(result.stdout)) {
    throw new Error('UNSUPPORTED_PATH_ENCODING: Git output must be valid UTF-8');
  }
  return output;
}

function line(output) {
  return output === null ? null : output.replace(/\n$/, '');
}

function installedCommitPolicy() {
  const policy = path.join(__dirname, '..', 'references', '_dependencies', 'rules', 'execution-policy.md');
  let stat = null;
  try {
    stat = fs.lstatSync(policy);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('POLICY_MISSING: installed execution policy is required before staging or commit');
  }
  return policy;
}

function parseScope(argv) {
  if (argv.length === 0) return null;
  const value = argv.length === 2 && argv[0] === '--scope' ? argv[1]
    : argv.length === 1 && argv[0].startsWith('--scope=') ? argv[0].slice(8) : null;
  if (!value || value.includes('\0') || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error('INVALID_SCOPE: use --scope <repository-relative literal path>');
  }
  const normalized = path.posix.normalize(value.split(path.sep).join('/')).replace(/\/$/, '') || '.';
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('INVALID_SCOPE: scope must remain inside the repository');
  }
  return normalized;
}

function records(output) {
  if (!output) return [];
  if (!output.endsWith('\0')) throw new Error('INCOMPLETE_GIT_OUTPUT');
  return output.slice(0, -1).split('\0');
}

function parseStatus(output) {
  const entries = records(output);
  const files = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.length < 4 || entry[2] !== ' ') throw new Error('INVALID_STATUS_OUTPUT');
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const renamed = /[RC]/.test(indexStatus + worktreeStatus);
    const originalPath = renamed ? entries[++index] : null;
    if (renamed && !originalPath) throw new Error('INCOMPLETE_RENAME_OUTPUT');
    files.push({ path: entry.slice(3), originalPath, indexStatus, worktreeStatus });
  }
  return files;
}

function parseNumstat(output) {
  const entries = records(output);
  const counts = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(entries[index]);
    if (!match) throw new Error('INVALID_NUMSTAT_OUTPUT');
    let filename = match[3];
    if (filename === '') {
      const originalPath = entries[++index];
      filename = entries[++index];
      if (!originalPath || !filename) throw new Error('INCOMPLETE_RENAME_OUTPUT');
    }
    counts.set(filename, {
      added: match[1] === '-' ? null : Number(match[1]),
      deleted: match[2] === '-' ? null : Number(match[2]),
    });
  }
  return counts;
}

function inScope(file, scope) {
  if (scope === null || scope === '.') return true;
  return [file.path, file.originalPath].some(filename => filename !== null
    && (filename === scope || filename.startsWith(scope + '/')));
}

function staged(file) {
  return file.indexStatus !== ' ' && file.indexStatus !== '?';
}

function conflicted(file) {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(file.indexStatus + file.worktreeStatus);
}

function exists(filename) {
  try {
    fs.statSync(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw new Error('METADATA_UNAVAILABLE');
  }
}

function hookInfo(filename) {
  if (!exists(filename)) return { exists: false, executable: false };
  try {
    fs.accessSync(filename, fs.constants.X_OK);
    return { exists: true, executable: fs.statSync(filename).isFile() };
  } catch (error) {
    if (error.code === 'EACCES') return { exists: true, executable: false };
    throw new Error('HOOK_METADATA_UNAVAILABLE');
  }
}

function collect(scope) {
  if (REPOSITORY_ENV.some(name => process.env[name])) {
    throw new Error('UNSUPPORTED_GIT_ENV: repository/index redirection requires manual inspection');
  }
  const root = line(git(process.cwd(), ['rev-parse', '--show-toplevel']));
  const head = line(git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], 1));
  const branch = line(git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 1));
  const filterConfig = git(root, ['config', '--null', '--get-regexp', '^filter\\..*\\.(clean|process)$'], 1);
  if (records(filterConfig).some(entry => entry.slice(entry.indexOf('\n') + 1).trim() !== '')) {
    throw new Error('UNSUPPORTED_FILTER_CONFIG: external clean/process filters require manual inspection');
  }
  // Recursive status may run submodule-local filters not visible in root config.
  if (records(git(root, ['ls-files', '--stage', '-z'])).some(entry => entry.startsWith('160000 '))) {
    throw new Error('UNSUPPORTED_SUBMODULE: indexed submodules require manual inspection');
  }
  const statusArgs = [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--renames', '--ignore-submodules=none',
  ];
  const status = git(root, statusArgs);
  const files = parseStatus(status);
  const diffArgs = ['--numstat', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--find-renames'];
  const cachedOutput = git(root, ['diff', '--cached', ...diffArgs]);
  const workingOutput = git(root, ['diff', ...diffArgs]);
  const cached = parseNumstat(cachedOutput);
  const working = parseNumstat(workingOutput);
  const hooksDirectory = line(git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']));
  const operationPaths = [
    ['merge', 'MERGE_HEAD'], ['rebase', 'rebase-merge'], ['rebase', 'rebase-apply'],
    ['cherry-pick', 'CHERRY_PICK_HEAD'], ['revert', 'REVERT_HEAD'], ['sequencer', 'sequencer'],
  ];
  const operations = [...new Set(operationPaths.filter(([, marker]) => exists(line(git(root,
    ['rev-parse', '--path-format=absolute', '--git-path', marker])))).map(([operation]) => operation))];
  const result = {
    schemaVersion: 1,
    repoRoot: root,
    head,
    branch,
    scope,
    files: files.filter(file => inScope(file, scope)).map(file => ({
      ...file,
      staged: cached.get(file.path) || null,
      unstaged: working.get(file.path) || (file.indexStatus === '?' ? { added: null, deleted: null } : null),
    })),
    safety: {
      hasStaged: files.some(staged),
      hasPartialStaging: files.some(file => staged(file) && !conflicted(file) && file.worktreeStatus !== ' '),
      hasOutOfScopeStaged: files.some(file => staged(file) && !inScope(file, scope)),
      hasConflicts: files.some(conflicted),
      operations,
    },
    hooks: {
      directory: hooksDirectory,
      preCommit: hookInfo(path.join(hooksDirectory, 'pre-commit')),
      commitMsg: hookInfo(path.join(hooksDirectory, 'commit-msg')),
    },
  };
  // Compare observations only; unchanged status/counts do not prove identical content.
  if (git(root, statusArgs) !== status
    || git(root, ['diff', '--cached', ...diffArgs]) !== cachedOutput
    || git(root, ['diff', ...diffArgs]) !== workingOutput
    || line(git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], 1)) !== head) {
    throw new Error('SOURCE_DRIFT: HEAD, status, or numstat changed during collection');
  }
  return result;
}

try {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--require-policy') {
    process.stdout.write(`${installedCommitPolicy()}\n`);
  } else {
    const output = JSON.stringify(collect(parseScope(argv))) + '\n';
    if (Buffer.byteLength(output) > MAX_BYTES) throw new Error('OUTPUT_LIMIT: summary exceeds 16 MiB');
    process.stdout.write(output);
  }
} catch (error) {
  process.stderr.write('collect-changes: ' + error.message + '\n');
  process.exitCode = 1;
}
