'use strict';

// A deliberately narrow guard for Codex role handoffs.  The scanner only
// considers role-shaped identifiers in single-backtick inline code; ordinary
// prose, paths, tool names, and fenced code are not dispatch candidates.

const ROLE_TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const INLINE_TOKEN = /(?<!`)`([^`\r\n]+)`(?!`)/g;
const EXECUTION_CONTEXT_GLOBAL = /\b(dispatch|delegate|handoff|hand off|invoke|spawn)\b/g;
const FENCE_START = /^\s*(`{3,}|~{3,})/;
const FENCE_END = /^\s*(`{3,}|~{3,})\s*$/;
const LIST_ITEM = /^(\s*)(?:[-+*]|\d+[.)])\s+/;

function asSet(values) {
  return values instanceof Set ? values : new Set(Array.isArray(values) ? values : []);
}

function isEscaped(source, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

// Mark opening/closing fence lines and every line between them.  Supporting
// tildes as well as backticks keeps the exclusion aligned with Markdown while
// preserving the single-backtick inline-token contract.
function fencedLines(lines) {
  const excluded = lines.map(() => false);
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      excluded[index] = true;
      const closing = line.match(FENCE_END);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    const opening = line.match(FENCE_START);
    if (opening) {
      excluded[index] = true;
      fence = { character: opening[1][0], length: opening[1].length };
    }
  }
  return excluded;
}

function isTableRow(line) {
  if (line.trim().startsWith('|')) return true;
  let delimiters = 0;
  let escaped = false;
  for (const character of line) {
    if (character === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (character === '|' && !escaped) delimiters += 1;
    escaped = false;
  }
  return delimiters >= 2;
}

function splitTableCells(line) {
  const cells = [];
  let cell = '';
  let escaped = false;
  for (const character of line) {
    if (character === '\\' && !escaped) {
      cell += character;
      escaped = true;
      continue;
    }
    if (character === '|' && !escaped) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
    escaped = false;
  }
  cells.push(cell);
  return cells;
}

function listIndent(line) {
  const match = line.match(LIST_ITEM);
  if (!match) return null;
  return match[1].replace(/\t/g, '    ').length;
}

// Return logical Markdown units.  Plain lines stay independent; list items
// include indented continuations until a blank line or peer item; table rows
// are split into cells on unescaped delimiters.  Each unit retains its first
// source line so diagnostics are stable and actionable.
function logicalUnits(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const excluded = fencedLines(lines);
  const units = [];
  let index = 0;
  while (index < lines.length) {
    if (excluded[index]) {
      index += 1;
      continue;
    }
    const line = lines[index];
    if (isTableRow(line)) {
      for (const cell of splitTableCells(line)) {
        if (cell.trim()) units.push({ text: cell, lineNumber: index + 1 });
      }
      index += 1;
      continue;
    }
    const baseIndent = listIndent(line);
    if (baseIndent != null) {
      const parts = [line];
      const firstLine = index + 1;
      let next = index + 1;
      while (next < lines.length) {
        if (excluded[next]) {
          next += 1;
          continue;
        }
        const continuation = lines[next];
        if (continuation.trim() === '') break;
        const nestedIndent = listIndent(continuation);
        if (nestedIndent != null && nestedIndent <= baseIndent) break;
        if (/^\s+/.test(continuation) && nestedIndent == null) {
          parts.push(continuation);
          next += 1;
          continue;
        }
        // A nested list starts a separate logical item.  An unindented line
        // likewise ends this item instead of leaking its dispatch verb into
        // the following prose.
        break;
      }
      units.push({ text: parts.join('\n'), lineNumber: firstLine });
      index = next;
      continue;
    }
    units.push({ text: line, lineNumber: index + 1 });
    index += 1;
  }
  return units;
}

function inlineRoleTokens(text) {
  const tokens = [];
  const source = String(text == null ? '' : text);
  INLINE_TOKEN.lastIndex = 0;
  for (const match of source.matchAll(INLINE_TOKEN)) {
    if (isEscaped(source, match.index)) continue;
    const token = match[1];
    if (ROLE_TOKEN.test(token)) tokens.push({ token, index: match.index });
  }
  return tokens;
}

function hasExecutionContext(text) {
  const source = String(text == null ? '' : text);
  EXECUTION_CONTEXT_GLOBAL.lastIndex = 0;
  return source.match(EXECUTION_CONTEXT_GLOBAL) !== null;
}

function diagnostic({ file, sourceRole, token, status, lineNumber, detail }) {
  const location = file ? `${file}:${lineNumber}` : `${sourceRole}:${lineNumber}`;
  const suffix = detail ? ` (${detail})` : '';
  return `${location} — Codex role neighbor source role '${sourceRole}', token '${token}', status '${status}'; use a direct Codex role or an explicit manual fallback${suffix}`;
}

/**
 * Scan one final adapted role text value.
 *
 * `generatedRoles` is the ownership boundary.  `packageRoles` is the role-map
 * ownership set, while `resolvableTargets` is the complete role set available
 * at the caller (planned generator output plus hand-maintained roles, or the
 * physical committed/consumer projection).  The scanner never rewrites a
 * token and never infers a replacement target.
 */
function collectCodexRoleNeighborErrors({
  sourceRole,
  text,
  roleMap,
  generatedRoles,
  packageRoles,
  resolvableTargets,
  file,
}) {
  const generated = generatedRoles == null ? null : asSet(generatedRoles);
  if (generated && !generated.has(sourceRole)) return [];

  const roles = roleMap && roleMap.roles && typeof roleMap.roles === 'object'
    ? roleMap.roles
    : {};
  const packageSet = asSet(packageRoles);
  const resolvable = asSet(resolvableTargets);
  const errors = [];
  const seen = new Set();

  for (const unit of logicalUnits(text)) {
    for (const { token, index } of inlineRoleTokens(unit.text)) {
      const hasEntry = Object.prototype.hasOwnProperty.call(roles, token);
      const entry = hasEntry ? roles[token] : null;
      let status = 'unknown';
      let detail = null;
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        status = typeof entry.status === 'string' && entry.status.trim() ? entry.status.trim() : 'unknown';
        if (status === 'direct') {
          const target = typeof entry.target === 'string' ? entry.target.trim() : '';
          if (!target || !packageSet.has(target) || !resolvable.has(target)) {
            detail = target
              ? `direct target '${target}' is not a resolvable package role`
              : 'direct target is missing';
          }
        }
      }

      const knownNonDirect = hasEntry && status !== 'direct';
      const unresolvedDirect = hasEntry && status === 'direct' && detail;
      const unknownExecutable = !hasEntry && hasExecutionContext(unit.text);
      if (!knownNonDirect && !unresolvedDirect && !unknownExecutable) continue;

      const key = `${sourceRole}\u0000${token}\u0000${status}\u0000${detail || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(diagnostic({
        file,
        sourceRole,
        token,
        status,
        lineNumber: unit.lineNumber,
        detail,
      }));
    }
  }
  return errors;
}

module.exports = {
  ROLE_TOKEN,
  collectCodexRoleNeighborErrors,
  inlineRoleTokens,
  logicalUnits,
};
