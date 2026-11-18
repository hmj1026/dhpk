'use strict';

// The Skill frontmatter reader shared by the agent plugin packager and the
// Shared Project Projection publisher. It is a leaf (no repository imports) so
// the single-file installer bundle does not pull the packaging pipeline in
// through it.

function unquote(value) {
  const trimmed = String(value == null ? '' : value).trim();
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    try { return JSON.parse(trimmed); } catch (_) { return trimmed.slice(1, -1); }
  }
  if (trimmed.length >= 2 && trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'") {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseFrontmatter(content) {
  const clean = String(content).replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { present: false, values: {}, metadata: {}, unknown: [], duplicates: [], body: clean };

  const lines = match[1].split(/\r?\n/);
  const values = {};
  const metadata = {};
  const unknown = [];
  const duplicates = [];
  const seen = new Set();
  let inMetadata = false;
  let metadataIndent = null;
  for (const line of lines) {
    if (/^\s+/.test(line)) {
      if (inMetadata) {
        const nested = line.match(/^(\s+)([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (nested) {
          if (metadataIndent === null) metadataIndent = nested[1].length;
          if (nested[1].length === metadataIndent) metadata[nested[2]] = unquote(nested[3]);
        }
      }
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const raw = keyMatch[2];
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
    if (key === 'metadata' && raw.trim() === '') {
      inMetadata = true;
      metadataIndent = null;
      values[key] = metadata;
    } else {
      inMetadata = false;
      values[key] = unquote(raw);
      if (key !== 'name' && key !== 'description' && key !== 'license' && key !== 'compatibility' && key !== 'metadata') unknown.push(key);
    }
  }
  return {
    present: true,
    values,
    metadata,
    unknown,
    duplicates,
    body: clean.slice(match[0].length),
  };
}

module.exports = { parseFrontmatter, unquote };
