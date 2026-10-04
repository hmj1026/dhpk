'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isolatedGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'GIT_CONFIG_COUNT' || key === 'GIT_CONFIG_PARAMETERS' || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete env[key];
  }
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_EXTERNAL_DIFF', 'TAR_OPTIONS']) delete env[key];
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_OPTIONAL_LOCKS = '0';
  return env;
}

function runGit(root, args, input = undefined, { binary = false } = {}) {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: root,
    input,
    env: isolatedGitEnv(),
    encoding: binary || input instanceof Buffer ? null : 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').toString().trim() || 'unknown error'}`);
  }
  return result.stdout;
}

function runGitToFile(root, args, output) {
  const separator = args.indexOf('--');
  const commandArgs = separator === -1
    ? [...args, `--output=${output}`]
    : [...args.slice(0, separator), `--output=${output}`, ...args.slice(separator)];
  const safeArgs = commandArgs[0] === 'diff' ? [commandArgs[0], '--no-ext-diff', ...commandArgs.slice(1)] : commandArgs;
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...safeArgs], {
    cwd: root,
    env: isolatedGitEnv(),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').toString().trim() || 'unknown error'}`);
  }
}

function parseStatus(root) {
  const raw = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  const records = raw.split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    if (status[0] === 'R' || status[1] === 'R') {
      const nextPath = records[++index];
      for (const pathValue of [firstPath, nextPath]) {
        if (!pathValue || path.isAbsolute(pathValue) || path.posix.normalize(pathValue) !== pathValue || pathValue.split('/').includes('..')) {
          throw new Error(`preview source status contains an unsafe path: ${pathValue}`);
        }
      }
      entries.push({ status: 'D ', path: nextPath });
      entries.push({ status: 'A ', path: firstPath });
    } else {
      if (!firstPath || path.isAbsolute(firstPath) || path.posix.normalize(firstPath) !== firstPath || firstPath.split('/').includes('..')) {
        throw new Error(`preview source status contains an unsafe path: ${firstPath}`);
      }
      entries.push({ status, path: firstPath });
    }
  }
  return entries;
}

function fileBytes(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) return Buffer.byteLength(fs.readlinkSync(file));
  if (stat.isFile()) return stat.size;
  return 0;
}

function copyUntrackedFile(sourceRoot, snapshotRoot, relative) {
  const source = path.join(sourceRoot, relative);
  const destination = path.join(snapshotRoot, relative);
  const stat = fs.lstatSync(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), destination);
  else if (stat.isFile()) {
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, stat.mode & 0o7777);
  } else {
    throw new Error(`preview source contains unsupported untracked entry: ${relative}`);
  }
}

function validateContainedSymlinks(root) {
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute);
        if (path.isAbsolute(target) || !inside(root, path.resolve(path.dirname(absolute), target))) {
          throw new Error(`preview source symlink escapes snapshot root: ${path.relative(root, absolute)}`);
        }
      } else if (entry.isDirectory()) visit(absolute);
    }
  };
  visit(root);
}

function changedBytes(sourceRoot, statusEntries) {
  const counts = { modified: 0, deleted: 0, added: 0, modeChanged: 0, bytes: 0 };
  for (const entry of statusEntries) {
    const status = entry.status;
    const source = path.join(sourceRoot, entry.path);
    const exists = fs.existsSync(source) || fs.lstatSync(source, { throwIfNoEntry: false });
    const isDeleted = status.includes('D') || !exists;
    const isAdded = status.includes('A') || status === '??';
    if (isDeleted) counts.deleted += 1;
    else if (isAdded) counts.added += 1;
    else counts.modified += 1;
    if (exists) counts.bytes += fileBytes(source);
    else {
      const blob = spawnSync('git', ['cat-file', '-s', `HEAD:${entry.path}`], {
        cwd: sourceRoot,
        env: isolatedGitEnv(),
        encoding: null,
      });
      if (blob.status === 0) counts.bytes += Number.parseInt(blob.stdout.toString().trim(), 10) || 0;
    }
  }
  const summary = runGit(sourceRoot, ['diff', '--no-textconv', '--summary', 'HEAD']);
  counts.modeChanged = summary.split('\n').filter((line) => /mode change|new mode|deleted file mode/.test(line)).length;
  return counts;
}

function createPreviewSourceSnapshot(sourceRoot) {
  const resolvedSource = fs.realpathSync(sourceRoot);
  const statusEntries = parseStatus(resolvedSource);
  const baseCommit = runGit(resolvedSource, ['rev-parse', 'HEAD']).trim();
  const baseTree = runGit(resolvedSource, ['rev-parse', `${baseCommit}^{tree}`]).trim();
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-preview-')));
  const snapshotRoot = path.join(parent, 'source');
  const archivePath = path.join(parent, 'source.tar');
  fs.mkdirSync(snapshotRoot);
  try {
    runGitToFile(resolvedSource, ['archive', '--format=tar', baseCommit], archivePath);
    const extracted = spawnSync('tar', ['-xf', archivePath, '-C', snapshotRoot], { env: isolatedGitEnv(), encoding: null });
    if (extracted.status !== 0) throw new Error(`unable to extract preview source archive: ${(extracted.stderr || '').toString().trim()}`);
    fs.rmSync(archivePath, { force: true });
    runGit(snapshotRoot, ['init', '-q', '--template=']);
    const patchPath = path.join(parent, 'source.patch');
    runGitToFile(resolvedSource, ['diff', '--no-textconv', '--binary', '--full-index', baseCommit, '--'], patchPath);
    if (fs.statSync(patchPath).size > 0) {
      runGit(snapshotRoot, ['apply', '--binary', '--directory', '.', patchPath]);
    }
    fs.rmSync(patchPath, { force: true });
    for (const entry of statusEntries.filter(({ status }) => status === '??' || status[0] === '?' || status[1] === '?')) {
      copyUntrackedFile(resolvedSource, snapshotRoot, entry.path);
    }
    validateContainedSymlinks(snapshotRoot);
    runGit(snapshotRoot, ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=dhpk preview', '-c', 'user.email=dhpk-preview@invalid', 'add', '-f', '-A', '--', '.']);
    runGit(snapshotRoot, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=dhpk preview', '-c', 'user.email=dhpk-preview@invalid', 'commit', '-qm', 'preview source snapshot']);
    const snapshotCommit = runGit(snapshotRoot, ['rev-parse', 'HEAD']).trim();
    const snapshotTree = runGit(snapshotRoot, ['rev-parse', 'HEAD^{tree}']).trim();
    return {
      root: snapshotRoot,
      baseCommit,
      baseTree,
      snapshotCommit,
      snapshotTree,
      changeCounts: changedBytes(resolvedSource, statusEntries),
      cleanup: () => fs.rmSync(parent, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { createPreviewSourceSnapshot };
