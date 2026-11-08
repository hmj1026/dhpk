'use strict';

// Rewrites relative Markdown links in projected skill content to the canonical
// repository URL, or to the bare label when the target is outside the
// canonical root or missing. Shared by the Cursor and AGY generators; the Agent
// generator keeps its own provenance-bound variant (#1248).

const fs = require('node:fs');
const path = require('node:path');
const { isInside } = require('./bounded-filesystem');

const CANONICAL_REPOSITORY_URL = 'https://github.com/hmj1026/dhpk/blob/main/';

function sanitizeMarkdownLinks(content, sourceFile, canonicalRoot) {
  return String(content).replace(/(\[[^\]]*\])\(([^)]+)\)/g, (whole, label, rawTarget) => {
    const target = rawTarget.trim();
    if (!target || target.startsWith('#') || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(target)) return whole;
    const pathPart = target.split('#', 1)[0].trim();
    if (!pathPart) return whole;
    const resolved = path.resolve(path.dirname(sourceFile), pathPart);
    if (!isInside(canonicalRoot, resolved) || !fs.existsSync(resolved)) return label;
    const relative = path.relative(canonicalRoot, resolved).split(path.sep).join('/');
    const fragment = target.includes('#') ? `#${target.split('#').slice(1).join('#')}` : '';
    return `${label}(${CANONICAL_REPOSITORY_URL}${relative}${fragment})`;
  });
}

module.exports = { CANONICAL_REPOSITORY_URL, sanitizeMarkdownLinks };
