#!/usr/bin/env node
/**
 * scan_delta.js
 * Generic delta scanner: compare --base (default HEAD~1) to HEAD
 *
 * Output JSON includes:
 * - shouldRunFull: boolean
 * - reasons: string[]
 * - changedFiles: { added/modified/deleted/renamed: [...] }
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Resolve plugin root: validated env var → walk-up with marker → legacy fallback
const _pluginRoot = (() => {
  const sentinel = p => fs.existsSync(path.join(p, 'scripts', 'lib', 'utils.js'));
  const marker = p => fs.existsSync(path.join(p, '.claude-plugin', 'plugin.json'));
  const envRoot = process.env.PLUGIN_ROOT;
  if (envRoot && sentinel(envRoot) && marker(envRoot)) return envRoot;
  let d = __dirname;
  while (d !== path.dirname(d)) {
    if (sentinel(d) && marker(d)) return d;
    d = path.dirname(d);
  }
  return path.resolve(__dirname, '..', '..', '..');
})();

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
function loadIntakeConfig() {
  try {
    const p = path.join(_pluginRoot, 'scripts', 'config', 'repo-intake.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const INTAKE_CONFIG = loadIntakeConfig();
const TOPOLOGY_FILES = INTAKE_CONFIG?.topology_files ?? [
  'package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json',
  'tsconfig.json', 'tsconfig.build.json',
  'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock',
  'pyproject.toml', 'setup.py', 'requirements.txt',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
  'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'Makefile', 'justfile',
];
const TOPOLOGY_SET = new Set(TOPOLOGY_FILES.map(f => f.toLowerCase()));
const LARGE_DIFF_COUNT = INTAKE_CONFIG?.delta_thresholds?.large_diff_count ?? 80;

// ---------------------------------------------------------------------------
// Shell helper
// ---------------------------------------------------------------------------
function run(cmd, args, cwd = process.cwd()) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { format: 'md', base: 'HEAD~1' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--format' && v) out.format = v;
    if (k === '--base' && v) out.base = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diff classification
// ---------------------------------------------------------------------------
function classifyNameStatus(lines) {
  const res = { added: [], modified: [], deleted: [], renamed: [] };
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split('\t').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const code = parts[0];
    if (code.startsWith('R')) {
      res.renamed.push({ from: parts[1], to: parts[2] || '' });
      continue;
    }
    const p = parts[1];
    if (code === 'A') res.added.push(p);
    else if (code === 'M') res.modified.push(p);
    else if (code === 'D') res.deleted.push(p);
    else res.modified.push(p);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Topology detection (config-driven)
// ---------------------------------------------------------------------------
function isTopologyFile(p) {
  const low = (p || '').toLowerCase();
  if (TOPOLOGY_SET.has(low)) return true;
  // Also match by basename for monorepo nested paths (e.g. packages/api/package.json)
  const base = path.basename(low);
  if (base !== low && TOPOLOGY_SET.has(base)) return true;
  // Test directory structure changes also trigger full scan
  if (/(^|\/)test\/unit\//.test(low)) return true;
  if (/(^|\/)test\/integration\//.test(low)) return true;
  if (/(^|\/)test\/e2e\//.test(low)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function pickHighlights(files, limit = 20) {
  const uniq = Array.from(new Set(files)).sort();
  return uniq.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------
function renderMd(obj) {
  const lines = [];
  lines.push(`# Repo Intake Delta (base: ${obj.base} -> HEAD)`);
  lines.push(`- shouldRunFull: **${obj.shouldRunFull ? 'YES' : 'no'}**`);
  if (obj.reasons.length) {
    lines.push(`- reasons: ${obj.reasons.map(r => `\`${r}\``).join(', ')}`);
  }
  lines.push('');

  const cf = obj.changedFiles;
  const section = (title, arr) => {
    lines.push(`## ${title} (${arr.length})`);
    if (!arr.length) lines.push('- (none)');
    else for (const f of pickHighlights(arr, 30)) lines.push(`- \`${f}\``);
    lines.push('');
  };

  section('Added', cf.added);
  section('Modified', cf.modified);
  section('Deleted', cf.deleted);

  lines.push('## Renamed');
  if (!cf.renamed.length) lines.push('- (none)');
  else
    for (const r of cf.renamed.slice(0, 30))
      lines.push(`- \`${r.from}\` -> \`${r.to}\``);
  lines.push('');

  lines.push('## Recommendation');
  if (obj.shouldRunFull) {
    lines.push('- Recommend running full intake (entry/config/test topology changed, or large diff)');
  } else {
    lines.push('- Delta only: proceed to changed-file analysis or re-run affected tests');
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));

  const r = run('git', ['diff', '--name-status', `${args.base}..HEAD`]);
  if (!r.ok) {
    const fallback = {
      base: args.base,
      shouldRunFull: true,
      reasons: ['git-diff-failed'],
      changedFiles: { added: [], modified: [], deleted: [], renamed: [] },
      error: r.stderr || 'git diff failed',
    };
    process.stdout.write(
      args.format === 'json'
        ? JSON.stringify(fallback, null, 2)
        : renderMd(fallback)
    );
    process.exit(0);
  }

  const lines = r.stdout
    ? r.stdout.split('\n').map(s => s.trim()).filter(Boolean)
    : [];
  const changed = classifyNameStatus(lines);

  const allChanged = [
    ...changed.added,
    ...changed.modified,
    ...changed.deleted,
    ...changed.renamed.flatMap(x => [x.from, x.to]),
  ].filter(Boolean);

  const reasons = [];
  let shouldRunFull = false;

  const topoHits = allChanged.filter(isTopologyFile);
  if (topoHits.length) {
    shouldRunFull = true;
    reasons.push('topology-changed');
  }

  if (allChanged.length >= LARGE_DIFF_COUNT) {
    shouldRunFull = true;
    reasons.push('large-diff');
  }

  const isDocsOnly =
    allChanged.length > 0 &&
    allChanged.every(p => {
      const low = p.toLowerCase();
      return (
        low.endsWith('.md') ||
        low.endsWith('.mdx') ||
        low.startsWith('docs/') ||
        low.includes('/docs/')
      );
    });
  if (isDocsOnly) {
    shouldRunFull = false;
    reasons.push('docs-only');
  }

  const out = {
    base: args.base,
    shouldRunFull,
    reasons,
    changedFiles: changed,
  };

  process.stdout.write(
    args.format === 'json' ? JSON.stringify(out, null, 2) : renderMd(out)
  );
}

main();
