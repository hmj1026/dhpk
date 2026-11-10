'use strict';

// Python-compatible primitives for the JS port of the Codex/Cursor installer
// (js-projection-journal stage 3). The port keeps the Python program's
// messages and file formats byte-for-byte, so it needs Python's exception
// classes, sys.exit unwinding, repr(), json.dumps, json.loads with finite-only
// numbers, code-point string ordering, and os.path helpers.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

// ---------------------------------------------------------------------------
// Python-compatible primitives

class ValueError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValueError';
  }
}

// An OSError raised by the installer itself (the Python raised OSError for
// conditions that are not errno failures).
class OSError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OSError';
  }
}

class ReceiptCommitError extends OSError {
  constructor(message, committed = false) {
    super(message);
    this.name = 'ReceiptCommitError';
    this.committed = committed;
  }
}

class AdoptionCommittedError extends OSError {
  constructor(message) {
    super(message);
    this.name = 'AdoptionCommittedError';
  }
}

class ProviderReceiptTooLarge extends ValueError {}

// sys.exit(): unwinds through every handler; only the entry point catches it.
class InstallerExit extends Error {
  constructor(code) {
    super(`installer exit ${code}`);
    this.name = 'InstallerExit';
    this.code = code;
  }
}

function isExit(error) {
  return error instanceof InstallerExit;
}

// `except OSError`: installer OSErrors and errno failures from node:fs.
function isOSError(error) {
  return error instanceof OSError || Boolean(error && typeof error.code === 'string' && typeof error.errno === 'number');
}

function isValueError(error) {
  return error instanceof ValueError;
}

function isOSOrValueError(error) {
  return isOSError(error) || isValueError(error);
}

// `except Exception` in Python never catches SystemExit.
function rethrowExit(error) {
  if (isExit(error)) throw error;
}

function errnoIs(error, code) {
  return Boolean(error && error.code === code);
}

// str(error) as Python prints it: errno errors render "[Errno N] strerror: 'path'".
function errorText(error) {
  if (error instanceof Error && !(typeof error.code === 'string' && typeof error.errno === 'number')) return error.message;
  if (error && typeof error.code === 'string' && typeof error.errno === 'number') {
    const errno = Math.abs(error.errno);
    const strerror = OS_STRERROR[error.code] || error.message;
    const file = error.path !== undefined ? `: ${pyRepr(error.path)}` : '';
    const dest = error.dest !== undefined ? ` -> ${pyRepr(error.dest)}` : '';
    return `[Errno ${errno}] ${strerror}${file}${dest}`;
  }
  return String(error);
}

const OS_STRERROR = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  ENOTEMPTY: 'Directory not empty',
  ELOOP: 'Too many levels of symbolic links',
  EXDEV: 'Cross-device link',
  ENOSPC: 'No space left on device',
  EINVAL: 'Invalid argument',
  EBUSY: 'Resource busy',
  EROFS: 'Read-only file system',
  EIO: 'Input/output error',
};

// repr() of a str, as Python prints it.
function pyRepr(value) {
  if (typeof value !== 'string') return String(value);
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return out + quote;
}

// json.dumps(value, indent, sort_keys, ensure_ascii=True) byte-for-byte.
function pyJsonDumps(value, { indent = null, sortKeys = false, ensureAscii = true } = {}) {
  const encodeString = (text) => {
    let out = '"';
    for (let index = 0; index < text.length; index += 1) {
      const ch = text[index];
      const code = text.charCodeAt(index);
      if (ch === '"') out += '\\"';
      else if (ch === '\\') out += '\\\\';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (ch === '\b') out += '\\b';
      else if (ch === '\f') out += '\\f';
      else if (code < 0x20 || (ensureAscii && code > 0x7e)) out += `\\u${code.toString(16).padStart(4, '0')}`;
      else out += ch;
    }
    return `${out}"`;
  };
  const encodeNumber = (number) => {
    if (!Number.isFinite(number)) throw new ValueError(`Out of range float values are not JSON compliant: ${number}`);
    if (Number.isInteger(number) && !Object.is(number, -0) && !(number instanceof PyFloat)) return String(number);
    return pyFloatRepr(number);
  };
  const walk = (node, level) => {
    if (node === null || node === undefined) return 'null';
    if (node instanceof PyFloat) return pyFloatRepr(node.value);
    if (typeof node === 'boolean') return node ? 'true' : 'false';
    if (typeof node === 'number') return encodeNumber(node);
    if (typeof node === 'string') return encodeString(node);
    const pad = indent === null ? '' : `\n${' '.repeat(indent * (level + 1))}`;
    const close = indent === null ? '' : `\n${' '.repeat(indent * level)}`;
    const itemSeparator = indent === null ? ', ' : ',';
    const keySeparator = ': ';
    if (Array.isArray(node)) {
      if (node.length === 0) return '[]';
      return `[${node.map((item) => `${pad}${walk(item, level + 1)}`).join(itemSeparator)}${close}]`;
    }
    const keys = Object.keys(node).filter((key) => node[key] !== undefined);
    if (sortKeys) keys.sort(pyStringCompare);
    if (keys.length === 0) return '{}';
    return `{${keys.map((key) => `${pad}${encodeString(key)}${keySeparator}${walk(node[key], level + 1)}`).join(itemSeparator)}${close}}`;
  };
  return walk(value, 0);
}

// Python orders str by code point; JS sorts UTF-16 code units.
function pyStringCompare(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function pySorted(values) {
  return Array.from(values).sort(pyStringCompare);
}

// A JSON float that Python keeps as a float (1.0 stays "1.0").
class PyFloat {
  constructor(value) {
    this.value = value;
  }
  valueOf() {
    return this.value;
  }
  toJSON() {
    return this.value;
  }
}

// repr(float): the shortest round-trip digits (shared with JS), laid out the
// way Python does: fixed notation for 1e-4 <= |x| < 1e16, otherwise
// scientific with a signed, at-least-two-digit exponent.
function pyFloatRepr(number) {
  if (Object.is(number, -0)) return '-0.0';
  if (number === 0) return '0.0';
  const sign = number < 0 ? '-' : '';
  const [mantissa, exponentText] = Math.abs(number).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const exponent = Number(exponentText);
  if (exponent >= -4 && exponent < 16) {
    if (exponent >= digits.length - 1) return `${sign}${digits}${'0'.repeat(exponent - digits.length + 1)}.0`;
    if (exponent >= 0) return `${sign}${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
    return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
  }
  const scientificMantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  const exponentSign = exponent < 0 ? '-' : '+';
  return `${sign}${scientificMantissa}e${exponentSign}${String(Math.abs(exponent)).padStart(2, '0')}`;
}

// json.loads with parse_constant / parse_float that reject non-finite values.
// Floats survive as PyFloat so a rewritten receipt keeps Python's spelling.
function pyJsonLoads(text) {
  if (/(^|[^"\w])(NaN|-?Infinity)(?![\w"])/.test(stripJsonStrings(text))) {
    const match = /(NaN|-?Infinity)/.exec(stripJsonStrings(text));
    throw new ValueError(`non-finite JSON constant is not allowed: ${match[1]}`);
  }
  const floats = [];
  const marked = text.replace(/("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (whole, string, number) => {
    if (string) return string;
    if (!/[.eE]/.test(number)) return number;
    const parsed = Number(number);
    if (!Number.isFinite(parsed)) throw new ValueError(`non-finite JSON number is not allowed: ${number}`);
    floats.push(parsed);
    return `{"__dhpk_py_float__":${floats.length - 1}}`;
  });
  let parsed;
  try {
    parsed = JSON.parse(marked);
  } catch (error) {
    throw new ValueError(error.message);
  }
  const restore = (node) => {
    if (Array.isArray(node)) return node.map(restore);
    if (node && typeof node === 'object') {
      const keys = Object.keys(node);
      if (keys.length === 1 && keys[0] === '__dhpk_py_float__' && typeof node.__dhpk_py_float__ === 'number') return new PyFloat(floats[node.__dhpk_py_float__]);
      return Object.fromEntries(keys.map((key) => [key, restore(node[key])]));
    }
    return node;
  };
  return restore(parsed);
}

function stripJsonStrings(text) {
  return text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

// isinstance(value, dict)
function isDict(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof PyFloat);
}

function isStr(value) {
  return typeof value === 'string';
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (errnoIs(error, 'ENOENT') || errnoIs(error, 'ENOTDIR')) return null;
    throw error;
  }
}

// os.path.lexists
function lexists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    return false;
  }
}

function pathExists(target) {
  try {
    fs.statSync(target);
    return true;
  } catch (error) {
    return false;
  }
}

function isLink(target) {
  const stat = lstatOrNull(target);
  return Boolean(stat && stat.isSymbolicLink());
}

function isDirFollow(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch (error) {
    return false;
  }
}

function isFileFollow(target) {
  try {
    return fs.statSync(target).isFile();
  } catch (error) {
    return false;
  }
}

// os.path.realpath: resolves what exists and keeps the rest lexically.
function realpath(target) {
  const absolute = path.resolve(target);
  const missing = [];
  let current = absolute;
  while (true) {
    try {
      const resolved = fs.realpathSync(current);
      return missing.length ? path.join(resolved, ...missing.reverse()) : resolved;
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function utcStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function uuidHex() {
  return crypto.randomUUID().replace(/-/g, '');
}

module.exports = {
  ValueError,
  OSError,
  ReceiptCommitError,
  AdoptionCommittedError,
  ProviderReceiptTooLarge,
  InstallerExit,
  PyFloat,
  isExit,
  isOSError,
  isValueError,
  isOSOrValueError,
  rethrowExit,
  errnoIs,
  errorText,
  pyRepr,
  pyJsonDumps,
  pyJsonLoads,
  pyStringCompare,
  pySorted,
  isDict,
  isStr,
  lstatOrNull,
  lexists,
  pathExists,
  isLink,
  isDirFollow,
  isFileFollow,
  realpath,
  sha256,
  utcStamp,
  uuidHex,
  fs,
  path,
  childProcess,
};
