'use strict';

// Runs the installer's own Python hashing functions, extracted from the
// embedded program in scripts/hooks/install-codex-skills.sh, so a test can use
// the real installer recipe as an oracle without starting an install. Only
// top-level definitions named in WANTED are executed.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER = path.resolve(__dirname, '..', '..', 'scripts', 'hooks', 'install-codex-skills.sh');
const WANTED = ['is_ignored_distribution_name', 'hash_path', 'hash_fd_entry', 'hash_fd_directory'];

function extractTopLevel(lines, name) {
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start < 0) throw new Error(`installer function not found: ${name}`);
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end += 1;
  return lines.slice(start, end).join('\n');
}

function extractedSource() {
  const lines = fs.readFileSync(INSTALLER, 'utf8').split('\n');
  const flags = lines.find((line) => line.startsWith('_DIRECTORY_FLAGS = '));
  if (!flags) throw new Error('installer _DIRECTORY_FLAGS not found');
  return ['import hashlib', 'import os', 'import stat', 'import sys', flags,
    ...WANTED.map((name) => extractTopLevel(lines, name))].join('\n\n');
}

// kind: 'path' (hash_path), 'directory' (hash_fd_directory over an opened
// directory), 'entry' (hash_fd_entry of `name` beneath the directory).
function installerHash(kind, target, { includeIgnored = true, name = '' } = {}) {
  const driver = `
kind, target, include, name = sys.argv[1], sys.argv[2], sys.argv[3] == '1', sys.argv[4]
if kind == 'path':
    print(hash_path(target, include))
elif kind == 'directory':
    fd = os.open(target, _DIRECTORY_FLAGS)
    try:
        print(hash_fd_directory(fd, include))
    finally:
        os.close(fd)
else:
    fd = os.open(target, _DIRECTORY_FLAGS)
    try:
        print(hash_fd_entry(fd, name, include))
    finally:
        os.close(fd)
`;
  const result = spawnSync('python3', ['-I', '-c', `${extractedSource()}\n${driver}`, kind, target, includeIgnored ? '1' : '0', name], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`installer hash failed: ${result.stderr}`);
  return result.stdout.trim();
}

module.exports = { installerHash };
