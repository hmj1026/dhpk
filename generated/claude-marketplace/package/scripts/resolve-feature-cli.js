#!/usr/bin/env node
'use strict';

/**
 * resolve-feature-cli.js — thin CLI shim over scripts/lib/feature-resolver.js.
 *
 * Usage:
 *   node scripts/resolve-feature-cli.js [--feature <key>]
 *
 * Prints the resolver result as pretty JSON and always exits 0 — even when
 * no feature is found (key: null) — so shell fallbacks such as
 * `node scripts/resolve-feature-cli.js 2>/dev/null || echo '{}'` behave.
 */

const { resolveFeature } = require('./lib/feature-resolver');

function parseArgs(argv) {
  let feature;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--feature') {
      feature = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--feature=')) {
      feature = arg.slice('--feature='.length);
    }
  }
  return { feature };
}

function main() {
  const { feature } = parseArgs(process.argv.slice(2));
  const result = resolveFeature({ feature });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

try {
  main();
} catch (err) {
  // Fail soft: emit a valid (empty) result and still exit 0 so callers'
  // `|| echo '{}'` fallbacks and JSON parsers keep working.
  process.stderr.write(`resolve-feature-cli: ${err && err.message ? err.message : String(err)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        key: null,
        source: null,
        confidence: null,
        docs_path: null,
        doc_inventory: [],
        canonical_docs: { tech_spec: null, architecture: null, feasibility: null, requirements: null },
        has_tech_spec: false,
        has_requirements: false,
        has_requests: false,
      },
      null,
      2
    )}\n`
  );
  process.exit(0);
}
