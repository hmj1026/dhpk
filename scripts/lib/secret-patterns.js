'use strict';

// Secret-shaped content that must never be published from canonical skill
// sources (#1248). The agents-skills generator, the project projection
// publisher, and the AGY generator share this one list; the Cursor and Agent
// MCP scans keep their own lists because they inspect connection settings.

const SECRET_PATTERNS = Object.freeze([
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?(?!\$\{)[A-Za-z0-9._~+\/-]{16,}/i,
  /\b(?:https?|postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/i,
]);

function containsSecret(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

module.exports = { SECRET_PATTERNS, containsSecret };
