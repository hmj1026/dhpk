'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PYTHON3 = '/usr/bin/python3';
const HELPER = path.join(__dirname, 'physical-file.py');

function securityError(message) {
  const error = new Error(message);
  error.code = 'ESECURITY';
  return error;
}

function writePhysicalImmutable(parentDescriptor, fileName, payload) {
  if (!Number.isSafeInteger(parentDescriptor) || parentDescriptor < 0) {
    throw securityError('physical parent descriptor is invalid');
  }
  if (typeof fileName !== 'string' || fileName.length === 0
    || fileName === '.' || fileName === '..' || path.basename(fileName) !== fileName
    || fileName.includes('\0')) {
    throw securityError('physical context target must be a direct file name');
  }
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const temporary = `.${fileName}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const result = spawnSync(PYTHON3, [HELPER, fileName, temporary], {
    input: bytes,
    encoding: null,
    stdio: ['pipe', 'pipe', 'pipe', parentDescriptor],
  });
  if (result.error) throw result.error;
  if (result.status === 0) return;

  const stderr = result.stderr ? result.stderr.toString('utf8').trim() : '';
  if (stderr.startsWith('EEXIST:')) {
    const error = new Error(stderr.slice('EEXIST:'.length).trim() || 'context path already exists');
    error.code = 'EEXIST';
    throw error;
  }
  throw new Error(stderr || `physical context helper exited with status ${result.status}`);
}

module.exports = Object.freeze({ writePhysicalImmutable });
