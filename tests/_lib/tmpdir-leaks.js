'use strict';

// Leak detection for issue #1322. The runner hands each test file a private
// TMPDIR; whatever is still inside it after the file exits was leaked.

const fs = require('node:fs');

// fs.mkdtemp appends six random [A-Za-z0-9] characters.
function leakPrefix(name) {
  const match = /^(.*-)[A-Za-z0-9]{6}$/.exec(name);
  return match ? match[1] : name;
}

// Created by the Node runtime itself (NODE_COMPILE_CACHE), not by a test.
const RUNTIME_ENTRIES = new Set(['node-compile-cache']);

function scanLeaks(root) {
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  const byPrefix = {};
  for (const name of entries) {
    if (RUNTIME_ENTRIES.has(name)) continue;
    const prefix = leakPrefix(name);
    byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
  }
  return byPrefix;
}

function formatLeakReport(file, leaks) {
  const parts = Object.entries(leaks).map(([prefix, count]) => `${prefix} x${count}`);
  if (parts.length === 0) return '';
  return `TMPDIR LEAK in ${file}: ${parts.join(', ')}`;
}

module.exports = { leakPrefix, scanLeaks, formatLeakReport };
