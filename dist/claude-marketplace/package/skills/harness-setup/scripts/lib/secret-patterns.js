'use strict';

// Secret-shaped content that must never be published (#1248, #1252). This is
// the shared base: the agents-skills generator, the project projection
// publisher, and the AGY generator use it as is; the Cursor and Agent MCP
// scans extend it with looser rules for connection settings. Every rule here
// is a precise token format, so adding it to a scan cannot flag ordinary text.

const SECRET_PATTERNS = Object.freeze([
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /-----BEGIN\s+(?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?(?!\$\{)[A-Za-z0-9._~+\/-]{16,}/i,
  /\b(?:https?|postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/i,
]);

function containsSecret(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

module.exports = { SECRET_PATTERNS, containsSecret };
