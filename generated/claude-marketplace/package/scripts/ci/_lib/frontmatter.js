'use strict';

// Zero-dep YAML frontmatter parsing for dhpk CI validators.
//
// Tolerant of UTF-8 BOM and CRLF line endings. Extracts top-level keys, flags
// duplicate keys, and detects literal block-scalar (`|`) `description:` values
// — these preserve internal newlines and break flat-table renderers that key
// off `description`. We deliberately do NOT strip `#` "comments": skill/agent
// descriptions legitimately contain `#` (e.g. `C#`, `#[Attr]`, `#expect`), and
// those values are single-quoted in this repo, so naive comment-stripping would
// corrupt them.

/**
 * @param {string} content
 * @returns {{present:boolean, values:Record<string,string>, duplicates:string[], descriptionIndicator:string|null}}
 */
function extract(content) {
  const clean = content.replace(/^﻿/, '');
  const m = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) {
    return { present: false, values: {}, duplicates: [], descriptionIndicator: null };
  }

  const lines = m[1].split(/\r?\n/);
  const values = Object.create(null);
  const seen = new Set();
  const duplicates = [];
  let descriptionIndicator = null;
  let inBlock = false;
  let blockIndent = -1;

  for (const raw of lines) {
    if (inBlock) {
      // Stay inside the block scalar until a line de-indents to the opener.
      const indent = raw.match(/^(\s*)/)[1].length;
      if (raw.trim() === '' || indent > blockIndent) continue;
      inBlock = false;
      blockIndent = -1;
    }

    if (/^\s/.test(raw)) continue; // nested value line — only top-level keys count
    const km = raw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!km) continue;

    const key = km[1];
    const val = km[2].trim();
    if (seen.has(key)) duplicates.push(key);
    else seen.add(key);
    values[key] = val;

    // Block-scalar indicator (`|`, `|-`, `>`, `>2-`, ...) with optional chomp /
    // indent modifiers per YAML 1.2.
    if (/^[|>](?:[+-]?\d+|\d+[+-]?|[+-])?$/.test(val)) {
      if (key === 'description') descriptionIndicator = val;
      inBlock = true;
      blockIndent = raw.match(/^(\s*)/)[1].length;
    }
  }

  return { present: true, values, duplicates, descriptionIndicator };
}

/**
 * True when a frontmatter value is absent or semantically empty (incl. empty
 * quoted strings like `''` / `""`).
 * @param {string|undefined} val
 */
function isEmpty(val) {
  if (val == null) return true;
  return val.replace(/^(['"])(.*)\1$/, '$2').trim() === '';
}

const KNOWN_INVOCATION_CLASSES = new Set(['explicit-only', 'implicit-eligible']);

/**
 * Reads the invocation-class policy field from a SKILL.md/command frontmatter
 * block. This is a separate, additive reader — it does not use or change
 * `extract()`'s flat top-level contract, because the canonical shape is a
 * nested mapping under `metadata:`, and `extract()` deliberately skips
 * indented (nested) lines.
 *
 * @param {string} content
 * @returns {{present:boolean, value:string|null, unknownValue:boolean, dottedSubstitute:boolean}}
 */
function extractInvocationClass(content) {
  const clean = content.replace(/^﻿/, '');
  const m = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) {
    return { present: false, value: null, unknownValue: false, dottedSubstitute: false };
  }

  const lines = m[1].split(/\r?\n/);
  let dottedSubstitute = false;
  let present = false;
  let value = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (/^\s/.test(raw)) continue; // only scanning top-level lines in this pass

    const dotted = raw.match(/^metadata\.dhpk-invocation-class:\s*(.*)$/);
    if (dotted) {
      dottedSubstitute = true;
      continue;
    }

    if (!/^metadata:\s*$/.test(raw)) continue;

    // Nested block: collect indented lines until a dedent back to top level.
    let j = i + 1;
    while (j < lines.length && /^\s+\S/.test(lines[j])) {
      const nested = lines[j].match(/^\s+dhpk-invocation-class:\s*(.*)$/);
      if (nested) {
        present = true;
        value = nested[1].trim().replace(/^(['"])(.*)\1$/, '$2');
      }
      j += 1;
    }
  }

  return {
    present,
    value,
    unknownValue: present && value != null && !KNOWN_INVOCATION_CLASSES.has(value),
    dottedSubstitute,
  };
}

module.exports = { extract, isEmpty, extractInvocationClass, KNOWN_INVOCATION_CLASSES };
