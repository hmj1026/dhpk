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

const KNOWN_METADATA_KEYS = new Set(['dhpk-invocation-class', 'dhpk-name-style', 'dhpk-capability-id', 'dhpk-next', 'dhpk-modes']);
const NEXT_IDENTITY = /^(?:none|[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?::[a-z][a-z0-9]*(?:-[a-z0-9]+)*)?)$/;
const unquote = value => value.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Parse the supported nested metadata shape; this is the shared CI/runtime source. */
function extractMetadata(content) {
  const match = content.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const values = {};
  const errors = [];
  if (!match) return { present: false, values, errors, dottedKeys: [] };
  const lines = match[1].split(/\r?\n/);
  const dottedKeys = lines.filter(line => /^metadata\.dhpk-[\w-]+:/.test(line)).map(line => line.split(':')[0]);
  for (const key of dottedKeys) errors.push(`${key}: use a nested metadata mapping`);
  let inMetadata = false;
  let next = false;
  for (const raw of lines) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    if (!/^\s/.test(raw)) {
      inMetadata = /^metadata:\s*$/.test(raw);
      next = false;
      continue;
    }
    if (!inMetadata) continue;
    const entry = raw.match(/^  ([a-z][a-z0-9-]*):\s*(.*)$/);
    if (entry) {
      const [, key, source] = entry;
      next = false;
      if (Object.prototype.hasOwnProperty.call(values, key)) errors.push(`metadata.${key}: duplicate key`);
      if (key.startsWith('dhpk-') && !KNOWN_METADATA_KEYS.has(key) && !key.startsWith('dhpk-handoff-')) {
        errors.push(`metadata.${key}: unknown nested dhpk key`);
      }
      if (key === 'dhpk-next') {
        values[key] = {};
        next = true;
        if (source.trim()) errors.push('metadata.dhpk-next: must be a nested mapping');
      } else if (key === 'dhpk-modes') {
        const list = source.trim().match(/^\[([^]*)\]$/);
        values[key] = list ? list[1].split(',').map(unquote).filter(Boolean) : [];
        if (!list || values[key].some(mode => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(mode)) || new Set(values[key]).size !== values[key].length) {
          errors.push('metadata.dhpk-modes: must be a unique inline list of mode names');
        }
      } else {
        values[key] = unquote(source);
      }
      continue;
    }
    if (next) {
      const edge = raw.match(/^    ([A-Za-z][A-Za-z0-9_-]*(?::[A-Z_]+)?):\s*(.*)$/);
      if (!edge) { errors.push('metadata.dhpk-next: malformed state mapping'); continue; }
      const [, key, source] = edge;
      const value = unquote(source);
      if (Object.prototype.hasOwnProperty.call(values['dhpk-next'], key)) errors.push(`metadata.dhpk-next: duplicate state ${key}`);
      values['dhpk-next'][key] = value;
      if (!NEXT_IDENTITY.test(value)) errors.push(`metadata.dhpk-next.${key}: invalid target identity ${value}`);
    } else if (/^\s+dhpk-/.test(raw)) {
      errors.push('metadata: dhpk keys must use two-space indentation');
    }
  }
  return { present: true, values, errors, dottedKeys };
}

/** Retain the established invocation-policy result shape. */
function extractInvocationClass(content) {
  const metadata = extractMetadata(content);
  const present = Object.prototype.hasOwnProperty.call(metadata.values, 'dhpk-invocation-class');
  const value = present ? metadata.values['dhpk-invocation-class'] : null;
  return {
    present,
    value,
    unknownValue: present && value != null && !KNOWN_INVOCATION_CLASSES.has(value),
    dottedSubstitute: metadata.dottedKeys.includes('metadata.dhpk-invocation-class'),
  };
}

module.exports = { extract, isEmpty, extractInvocationClass, extractMetadata, KNOWN_INVOCATION_CLASSES, KNOWN_METADATA_KEYS };
