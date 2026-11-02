'use strict';

// Loads one module-private top-level function from a script so a test can
// characterize a fingerprint recipe the script does not export. The function
// text is taken verbatim; its free names are supplied through `scope`.

const fs = require('node:fs');
const path = require('node:path');

function loadPrivateFunction(relativeFile, name, scope = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', relativeFile), 'utf8');
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`function ${name}(`));
  if (start < 0) throw new Error(`function ${name} not found in ${relativeFile}`);
  const end = lines.findIndex((line, index) => index > start && line === '}');
  if (end < 0) throw new Error(`function ${name} has no closing brace in ${relativeFile}`);
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `${lines.slice(start, end + 1).join('\n')}\nreturn ${name};`)(...names.map((key) => scope[key]));
}

module.exports = { loadPrivateFunction };
