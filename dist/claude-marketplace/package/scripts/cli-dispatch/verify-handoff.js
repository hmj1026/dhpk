#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const USAGE = 'usage: node verify-handoff.js --root <writer-repo> --handoff <receipt.json> --assigned-file <path> [--assigned-file <path> ...] -- <command> [args...]';

function usageError(message) {
  return new Error(`${message}\n${USAGE}`);
}

function validateRelativePath(relativePath, label) {
  if (relativePath.length === 0 || relativePath.includes('\\')) {
    throw new Error(`${label} path must be a portable relative path: ${relativePath || '(empty)'}`);
  }
  if (path.posix.isAbsolute(relativePath) || path.win32.parse(relativePath).root !== '') {
    throw new Error(`${label} path must be relative to the writer root: ${relativePath}`);
  }
  const components = relativePath.split('/');
  if (components.some((component) => component === '' || component === '.' || component === '..')) {
    throw new Error(`${label} path cannot escape or alias the writer root: ${relativePath}`);
  }
  return components;
}

function parseArguments(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0) throw usageError('missing -- before the downstream command');

  let rootArgument;
  let handoffArgument;
  const assignedFiles = [];
  const assignedFileSet = new Set();
  const options = argv.slice(0, separator);
  for (let index = 0; index < options.length;) {
    const option = options[index];
    if (option !== '--root' && option !== '--handoff' && option !== '--assigned-file') {
      throw usageError(`unknown option: ${option}`);
    }
    const value = options[index + 1];
    if (value === undefined || value === '--') {
      throw usageError(`missing value for ${option}`);
    }
    if (value.length === 0) throw usageError(`missing value for ${option}`);
    if (option === '--root') {
      if (rootArgument !== undefined) throw usageError('duplicate --root option');
      rootArgument = value;
    } else if (option === '--handoff') {
      if (handoffArgument !== undefined) throw usageError('duplicate --handoff option');
      handoffArgument = value;
    } else {
      validateRelativePath(value, 'assigned-file');
      if (assignedFileSet.has(value)) throw usageError(`duplicate --assigned-file path: ${value}`);
      assignedFileSet.add(value);
      assignedFiles.push(value);
    }
    index += 2;
  }

  const commandArgv = argv.slice(separator + 1);
  if (rootArgument === undefined) throw usageError('missing --root');
  if (handoffArgument === undefined) throw usageError('missing --handoff');
  if (assignedFiles.length === 0) throw usageError('missing required --assigned-file scope from the parent assignment');
  if (commandArgv.length === 0 || commandArgv[0] === '') {
    throw usageError('missing downstream command');
  }

  return {
    rootPath: path.resolve(rootArgument),
    handoffPath: path.resolve(handoffArgument),
    assignedFiles,
    command: commandArgv[0],
    commandArguments: commandArgv.slice(1),
  };
}

function readReceipt(receiptPath) {
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read handoff receipt '${receiptPath}': ${error.message}`);
  }

  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('handoff receipt must be a JSON object');
  }
  if (receipt.status !== 'DONE') {
    throw new Error('handoff receipt status must be "DONE" before verification can run');
  }
  if (receipt.files === null || typeof receipt.files !== 'object' || Array.isArray(receipt.files)) {
    throw new Error('handoff receipt files must be a non-empty object');
  }

  const fileEntries = Object.keys(receipt.files).sort().map((relativePath) => {
    const components = validateRelativePath(relativePath, 'assigned file');

    const expectedHash = receipt.files[relativePath];
    if (expectedHash !== null && (typeof expectedHash !== 'string' || !/^[\da-f]{64}$/i.test(expectedHash))) {
      throw new Error(`assigned file hash must be a 64-character SHA256 or null for a deleted file: ${relativePath}`);
    }
    return {
      relativePath,
      components,
      expectedHash: expectedHash === null ? null : expectedHash.toLowerCase(),
    };
  });

  if (fileEntries.length === 0) throw new Error('handoff receipt files must not be empty');
  return fileEntries;
}

function assertExactAssignment(assignedFiles, fileEntries) {
  const assignedSet = new Set(assignedFiles);
  const receiptSet = new Set(fileEntries.map(({ relativePath }) => relativePath));
  const missing = assignedFiles.filter((relativePath) => !receiptSet.has(relativePath));
  const extra = fileEntries
    .map(({ relativePath }) => relativePath)
    .filter((relativePath) => !assignedSet.has(relativePath));
  if (missing.length > 0 || extra.length > 0) {
    const details = [];
    if (missing.length > 0) details.push(`missing from receipt: ${missing.join(', ')}`);
    if (extra.length > 0) details.push(`not in parent assignment: ${extra.join(', ')}`);
    throw new Error(`receipt files must exactly match the parent-assigned scope (${details.join('; ')})`);
  }
}

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs]
    .map((value) => value.toString())
    .join(':');
}

function inspectAssignedPath(rootPath, entry) {
  let currentPath = rootPath;
  for (let index = 0; index < entry.components.length; index += 1) {
    currentPath = path.join(currentPath, entry.components[index]);
    let stat;
    try {
      stat = fs.lstatSync(currentPath, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') return { exists: false };
      throw error;
    }

    if (stat.isSymbolicLink()) {
      throw new Error(`assigned file path contains a symbolic link: ${entry.relativePath}`);
    }
    if (index < entry.components.length - 1) {
      if (!stat.isDirectory()) {
        throw new Error(`assigned file parent is not a directory: ${entry.relativePath}`);
      }
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`assigned path is not a regular file: ${entry.relativePath}`);
    }
    return { exists: true, stat, absolutePath: currentPath };
  }

  throw new Error(`assigned file path is invalid: ${entry.relativePath}`);
}

function hashOpenFile(descriptor) {
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(128 * 1024);
  while (true) {
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
  }
  return digest.digest('hex');
}

function snapshotEntry(rootPath, entry) {
  const beforePathStat = inspectAssignedPath(rootPath, entry);
  if (!beforePathStat.exists) return { sha256: null, identity: null };

  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(beforePathStat.absolutePath, fs.constants.O_RDONLY | noFollow);
    const beforeReadStat = fs.fstatSync(descriptor, { bigint: true });
    if (statIdentity(beforeReadStat) !== statIdentity(beforePathStat.stat)) {
      throw new Error(`assigned file changed before hashing: ${entry.relativePath}`);
    }

    const sha256 = hashOpenFile(descriptor);
    const afterReadStat = fs.fstatSync(descriptor, { bigint: true });
    const afterPathStat = inspectAssignedPath(rootPath, entry);
    if (!afterPathStat.exists
      || statIdentity(beforeReadStat) !== statIdentity(afterReadStat)
      || statIdentity(afterReadStat) !== statIdentity(afterPathStat.stat)) {
      throw new Error(`assigned file changed while it was being hashed: ${entry.relativePath}`);
    }

    return { sha256, identity: statIdentity(afterReadStat) };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function sameSnapshot(left, right, fileEntries) {
  return fileEntries.every(({ relativePath }) => (
    left.get(relativePath).sha256 === right.get(relativePath).sha256
    && left.get(relativePath).identity === right.get(relativePath).identity
  ));
}

function captureSnapshot(rootPath, fileEntries) {
  const snapshot = new Map();
  for (const entry of fileEntries) snapshot.set(entry.relativePath, snapshotEntry(rootPath, entry));
  return snapshot;
}

function verifyStableSnapshot(rootPath, fileEntries) {
  const first = captureSnapshot(rootPath, fileEntries);
  const second = captureSnapshot(rootPath, fileEntries);
  if (!sameSnapshot(first, second, fileEntries)) {
    throw new Error('assigned-file snapshot changed while verification was running');
  }

  for (const entry of fileEntries) {
    const actualHash = second.get(entry.relativePath).sha256;
    if (actualHash !== entry.expectedHash) {
      const expected = entry.expectedHash === null ? 'deleted (null)' : entry.expectedHash;
      const actual = actualHash === null ? 'deleted (null)' : actualHash;
      throw new Error(`assigned file hash mismatch for '${entry.relativePath}': expected ${expected}, got ${actual}`);
    }
  }
  return second;
}

function runCommand(command, commandArguments) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, commandArguments, {
        cwd: process.cwd(),
        env: process.env,
        shell: false,
        stdio: 'inherit',
      });
    } catch (error) {
      finish({ error });
      return;
    }

    child.once('error', (error) => finish({ error }));
    child.once('close', (code, signal) => finish({ code, signal }));
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(USAGE);
    return 0;
  }

  let options;
  let fileEntries;
  let rootPath;
  let beforeSnapshot;
  try {
    options = parseArguments(argv);
    rootPath = fs.realpathSync(options.rootPath);
    if (!fs.statSync(rootPath).isDirectory()) throw new Error(`writer root is not a directory: ${options.rootPath}`);
    fileEntries = readReceipt(options.handoffPath);
    assertExactAssignment(options.assignedFiles, fileEntries);
    beforeSnapshot = verifyStableSnapshot(rootPath, fileEntries);
  } catch (error) {
    console.error(`verify-handoff: ${error.message}`);
    return 1;
  }

  const childResult = await runCommand(options.command, options.commandArguments);
  let postCheckError;
  try {
    const afterSnapshot = verifyStableSnapshot(rootPath, fileEntries);
    if (!sameSnapshot(beforeSnapshot, afterSnapshot, fileEntries)) {
      throw new Error('assigned-file snapshot changed during downstream verification');
    }
  } catch (error) {
    postCheckError = error;
  }

  if (postCheckError) {
    console.error(`verify-handoff: ${postCheckError.message}`);
    return 1;
  }
  if (childResult.error) {
    console.error(`verify-handoff: cannot run downstream command: ${childResult.error.message}`);
    return 1;
  }
  if (childResult.signal) {
    console.error(`verify-handoff: downstream command ended with signal ${childResult.signal}`);
    return 1;
  }
  return childResult.code === null ? 1 : childResult.code;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`verify-handoff: ${error.message}`);
  process.exitCode = 1;
});
