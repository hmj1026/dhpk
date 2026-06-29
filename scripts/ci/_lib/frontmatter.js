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

module.exports = { extract, isEmpty };
