'use strict';

// Fail-closed path, object and evidence checks shared by the marketplace
// review contract versions. Moved unchanged from skill-purpose-decisions.js.

const fs = require('node:fs');
const path = require('node:path');

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function reviewObject(errors, value, allowed, prefix) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${prefix} must be an object`);
    return false;
  }
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) errors.push(`${prefix}.${field} is not allowed`);
  }
  return true;
}

function reviewFile(errors, value, prefix, root) {
  if (!nonEmptyString(value) || value.includes('\\') || path.posix.isAbsolute(value)
    || /^[a-z]:/i.test(value) || value.includes('\0') || value.includes('*')
    || value.split('/').some((segment) => ['', '.', '..'].includes(segment))) {
    errors.push(`${prefix} contains an unsafe repository file path '${value}'`);
    return false;
  }
  let realFile;
  try {
    const realRoot = fs.realpathSync(root);
    realFile = fs.realpathSync(path.join(realRoot, value));
    const relative = path.relative(realRoot, realFile);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative) || !fs.statSync(realFile).isFile()) {
      errors.push(`${prefix} must resolve to a contained repository file: '${value}'`);
      return false;
    }
  } catch (error) {
    errors.push(`${prefix} cannot resolve repository file '${value}': ${error.code || 'unreadable'}`);
    return false;
  }
  return realFile;
}

function reviewEvidence(errors, value, prefix, root, { test = false } = {}) {
  if (!reviewObject(errors, value, ['source', 'status'], prefix)) return;
  if (value.status !== 'PASS') errors.push(`${prefix}.status must be PASS`);
  const realSource = reviewFile(errors, value.source, `${prefix}.source`, root);
  if (realSource && test && (!value.source.startsWith('tests/')
    || !path.relative(fs.realpathSync(root), realSource).split(path.sep).join('/').startsWith('tests/'))) {
    errors.push(`${prefix}.source must identify evidence under tests/`);
  }
}

module.exports = { nonEmptyString, reviewEvidence, reviewFile, reviewObject };
