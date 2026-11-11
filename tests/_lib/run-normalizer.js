'use strict';

// Replaces the run-specific tokens in a text so two runs on separate fixtures
// can be compared: the project and plugin paths, backup-run stamps, process
// ids, timestamps, and random names. Used by the adapter journal sweeps to
// compare a recovered project with its previous state.

const fs = require('node:fs');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Paths first (longest first), then stamps and random identifiers.
function normalizer(roots) {
  const replacements = roots
    .filter(Boolean)
    .flatMap(([value, token]) => [[value, token], [fs.realpathSync(value), token]])
    .sort((left, right) => right[0].length - left[0].length);
  return (text) => {
    let out = String(text);
    for (const [value, token] of replacements) out = out.replace(new RegExp(escapeRegExp(value), 'g'), token);
    return out
      .replace(/\d{8}T\d{6}Z-\d+/g, '<RUN>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, '<TIME>')
      .replace(/\.dhpk-(adopt|remove|quarantine|stage|publish)-[0-9a-f]{32}/g, '.dhpk-$1-<ID>')
      .replace(/\.(transaction|snapshot|recovery)\.json\.[0-9a-f]{32}|\.json\.(snapshot|recovery)\.[0-9a-f]{32}/g, '.<TMP>')
      .replace(/"pid": \d+/g, '"pid": <PID>')
      .replace(/\b(pid|process)[ =:]+\d+/gi, '$1 <PID>');
  };
}

module.exports = { normalizer };
