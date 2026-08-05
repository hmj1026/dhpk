#!/usr/bin/env node
/**
 * scan_repo.js
 * Generic full repo intake scanner (framework-agnostic)
 *
 * Output:
 *  - --format md (default): human report
 *  - --format json: structured report for downstream tooling
 *
 * Notes:
 *  - Prefers `git ls-files` to avoid node_modules
 *  - Config-driven entry scoring via scripts/config/repo-intake.json
 *  - Shared classification via scripts/config/file-classification.json
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

const {
  detectPackageManager,
  readPackageJson,
} = require(path.join(_pluginRoot, 'scripts', 'lib', 'utils'));

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
function loadClassification() {
  try {
    const p = path.join(_pluginRoot, 'scripts', 'config', 'file-classification.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function loadIntakeConfig() {
  try {
    const p = path.join(_pluginRoot, 'scripts', 'config', 'repo-intake.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const CLASSIFICATION = loadClassification();
const INTAKE_CONFIG = loadIntakeConfig();

// Fallback values when config files are missing
const IGNORE_PREFIXES = CLASSIFICATION?.ignore_prefixes ?? [
  'node_modules/', 'vendor/', 'dist/', 'build/', 'out/',
  'target/', '.next/', '.nuxt/', '__pycache__/', '.pytest_cache/',
  'venv/', '.venv/', '.git/',
];
const IGNORE_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out',
  'target', '.venv', 'venv', '__pycache__', '.pytest_cache',
  '.next', '.turbo', '.cache', '.idea', '.vscode', 'coverage',
  '.coverage', '.mypy_cache',
]);

const ENTRY_PATTERNS = INTAKE_CONFIG?.entry_patterns ?? [];
const BUILD_FILES = INTAKE_CONFIG?.build_files ?? [
  'package.json', 'tsconfig.json', 'go.mod', 'Cargo.toml',
  'pyproject.toml', 'pom.xml', 'build.gradle', 'Gemfile',
  'composer.json', 'Dockerfile', 'docker-compose.yml', 'Makefile', 'justfile',
];
const ECOSYSTEM_MANIFESTS = INTAKE_CONFIG?.ecosystem_manifests ?? {
  node: ['package.json'],
  go: ['go.mod'],
  rust: ['Cargo.toml'],
  python: ['pyproject.toml', 'setup.py', 'requirements.txt'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  ruby: ['Gemfile'],
  php: ['composer.json'],
  dotnet: ['*.csproj', '*.sln'],
};

const DOC_EXTS = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc']);
const DOC_BASENAMES_PRIORITY = [
  'readme', 'architecture', 'design', 'spec', 'requirements',
  'rfc', 'adr', 'contributing', 'roadmap', 'overview', 'runbook',
];

// ---------------------------------------------------------------------------
// Shell helpers (sync only — intake_cached.js calls us via spawnSync)
// ---------------------------------------------------------------------------
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Repo / file listing
// ---------------------------------------------------------------------------
function detectRepoRoot(startCwd) {
  const r = run('git', ['rev-parse', '--show-toplevel'], startCwd);
  if (r.ok && r.stdout) return { root: r.stdout, hasGit: true };
  return { root: startCwd, hasGit: false };
}

function gitLsFiles(root) {
  const r = run('git', ['ls-files'], root);
  if (!r.ok) return null;
  if (!r.stdout) return [];
  return r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
}

function walkFiles(root) {
  const out = [];
  function walk(dirRel) {
    const abs = path.join(root, dirRel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = path.join(dirRel, ent.name);
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) continue;
        walk(rel);
      } else if (ent.isFile()) {
        out.push(rel.split(path.sep).join('/'));
      }
    }
  }
  walk('');
  return out.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Pattern matching (hand-written, zero deps)
// Supports only: {a,b,c} (alternation) and * (single-segment wildcard)
// ---------------------------------------------------------------------------
const _patternCache = new Map();

function compilePattern(pattern) {
  if (_patternCache.has(pattern)) return _patternCache.get(pattern);

  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '{') {
      const close = pattern.indexOf('}', i);
      if (close === -1) {
        re += '\\{';
        i++;
      } else {
        const alts = pattern.slice(i + 1, close).split(',');
        re += '(' + alts.map(a => a.replace(/[.*+?^$|\\[\]()]/g, '\\$&')).join('|') + ')';
        i = close + 1;
      }
    } else if (ch === '*') {
      re += '[^/]+';
      i++;
    } else {
      re += ch.replace(/[.*+?^$|\\[\](){}]/g, '\\$&');
      i++;
    }
  }
  const compiled = new RegExp('^' + re + '$');
  _patternCache.set(pattern, compiled);
  return compiled;
}

function matchPattern(pattern, filePath) {
  return compilePattern(pattern).test(filePath);
}

// ---------------------------------------------------------------------------
// Ecosystem detection (ported from project-audit/scripts/audit.js)
// ---------------------------------------------------------------------------
function findFileShallow(root, predicate) {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries.some(e => e.isFile() && predicate(e.name));
  } catch {
    return false;
  }
}

function detectEcosystems(root) {
  const detected = [];
  for (const [eco, files] of Object.entries(ECOSYSTEM_MANIFESTS)) {
    for (const pattern of files) {
      if (pattern.includes('*')) {
        const escaped = pattern.replace(/\./g, '\\.').replace('*', '.*');
        const re = new RegExp('^' + escaped + '$');
        if (findFileShallow(root, name => re.test(name))) {
          detected.push(eco);
          break;
        }
      } else {
        try {
          if (fs.statSync(path.join(root, pattern)).isFile()) {
            detected.push(eco);
            break;
          }
        } catch { /* skip */ }
      }
    }
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Entry scoring (config-driven)
// ---------------------------------------------------------------------------
function scoreEntries(files, patterns) {
  const scored = [];
  for (const f of files) {
    let bestScore = 0;
    let bestLabel = '';
    for (const p of patterns) {
      if (matchPattern(p.pattern, f) && p.score > bestScore) {
        bestScore = p.score;
        bestLabel = p.label;
      }
    }
    if (bestScore > 0) {
      scored.push({ file: f, score: bestScore, label: bestLabel });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return scored;
}

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------
function isProbablyDoc(p) {
  const low = p.toLowerCase();
  const ext = path.extname(low);
  if (!DOC_EXTS.has(ext)) return false;
  if (low === 'readme.md' || low.startsWith('readme.')) return true;
  if (low.startsWith('docs/') || low.includes('/docs/')) return true;
  if (low.startsWith('doc/') || low.includes('/doc/')) return true;
  const base = path.basename(low, ext);
  return DOC_BASENAMES_PRIORITY.some(k => base.includes(k));
}

function scoreDoc(p) {
  const low = p.toLowerCase();
  const ext = path.extname(low);
  const base = path.basename(low, ext);
  let score = 0;
  if (low === 'readme.md' || base.startsWith('readme')) score += 200;
  if (low.startsWith('docs/')) score += 120;
  if (low.includes('/docs/')) score += 90;
  if (['architecture', 'design', 'spec', 'requirements', 'rfc', 'adr', 'runbook']
    .some(k => base.includes(k))) score += 50;
  if (DOC_BASENAMES_PRIORITY.some(k => base.includes(k))) score += 20;
  return score;
}

function docBucketKey(p) {
  const parts = p.split('/').filter(Boolean);
  if (!parts.length) return null;
  return parts.slice(0, Math.min(3, parts.length)).join('/');
}

function summarizeDocs(docCandidates) {
  const buckets = new Map();
  for (const p of docCandidates) {
    const key = docBucketKey(p);
    if (!key) continue;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return { total: docCandidates.length, buckets };
}

function listReadmes(files) {
  const out = [];
  for (const p of files) {
    const base = path.basename(p).toLowerCase();
    if (base === 'readme' || base.startsWith('readme.')) out.push(p);
  }
  return [...new Set(out)].sort();
}

// ---------------------------------------------------------------------------
// Test grouping (path-based only, no content reading)
// ---------------------------------------------------------------------------
function isTestFile(p) {
  const low = p.toLowerCase();
  return (
    /(^|\/)test\/unit\//.test(low) ||
    /(^|\/)test\/integration\//.test(low) ||
    /(^|\/)test\/e2e\//.test(low) ||
    /(^|\/)tests\//.test(low) ||
    /(^|\/)__tests__\//.test(low) ||
    /(^|\/)spec\//.test(low)
  );
}

function groupTests(files, topN) {
  const groups = { unit: [], integration: [], e2e: [], other: [] };
  const buckets = { unit: new Map(), integration: new Map(), e2e: new Map() };

  function bucketKey(p) {
    const low = p.toLowerCase();
    const m = low.match(/(^|\/)test\/(unit|integration|e2e)\/([^/]+)/);
    if (m) return `test/${m[2]}/${m[3]}`;
    const m2 = low.match(/(^|\/)test\/(unit|integration|e2e)\//);
    if (m2) return `test/${m2[2]}/(root)`;
    return null;
  }

  for (const f of files) {
    if (!isTestFile(f)) continue;
    const low = f.toLowerCase();
    let kind = 'other';
    if (/(^|\/)test\/e2e\//.test(low)) kind = 'e2e';
    else if (/(^|\/)test\/integration\//.test(low)) kind = 'integration';
    else if (/(^|\/)test\/unit\//.test(low)) kind = 'unit';

    groups[kind].push(f);
    if (kind !== 'other') {
      const b = bucketKey(f);
      if (b) buckets[kind].set(b, (buckets[kind].get(b) || 0) + 1);
    }
  }

  const counts = {
    unit: groups.unit.length,
    integration: groups.integration.length,
    e2e: groups.e2e.length,
    other: groups.other.length,
  };

  for (const k of Object.keys(groups)) {
    groups[k].sort();
    groups[k] = groups[k].slice(0, topN);
  }

  return { groups, counts, buckets };
}

// ---------------------------------------------------------------------------
// Test runner detection (generalized)
// ---------------------------------------------------------------------------
function detectTestRunner(pkg, ecosystems) {
  if (!pkg) {
    // Non-Node ecosystems
    if (ecosystems.includes('go')) return { runner: 'go test', evidence: ['ecosystem:go'] };
    if (ecosystems.includes('rust')) return { runner: 'cargo test', evidence: ['ecosystem:rust'] };
    if (ecosystems.includes('python')) return { runner: 'pytest', evidence: ['ecosystem:python'] };
    if (ecosystems.includes('java')) return { runner: 'junit', evidence: ['ecosystem:java'] };
    if (ecosystems.includes('ruby')) return { runner: 'rspec', evidence: ['ecosystem:ruby'] };
    return { runner: 'unknown', evidence: [] };
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts || {};
  const evidence = [];
  const has = name => Object.prototype.hasOwnProperty.call(deps, name);

  if (has('jest') || has('ts-jest') || has('@types/jest')) evidence.push('deps:jest');
  if (has('mocha') || has('@types/mocha')) evidence.push('deps:mocha');
  if (has('vitest')) evidence.push('deps:vitest');

  const scriptVals = Object.values(scripts).join(' || ').toLowerCase();
  if (scriptVals.includes('jest')) evidence.push('scripts:jest');
  if (scriptVals.includes('mocha')) evidence.push('scripts:mocha');
  if (scriptVals.includes('vitest')) evidence.push('scripts:vitest');
  if (scriptVals.includes('node --test') || scriptVals.includes('node:test'))
    evidence.push('scripts:node:test');

  let runner = 'unknown';
  if (evidence.some(e => e.includes('vitest'))) runner = 'vitest';
  else if (evidence.some(e => e.includes('jest')) && !evidence.some(e => e.includes('mocha')))
    runner = 'jest';
  else if (evidence.some(e => e.includes('mocha')) && !evidence.some(e => e.includes('jest')))
    runner = 'mocha';
  else if (evidence.some(e => e.includes('jest')) && evidence.some(e => e.includes('mocha')))
    runner = 'mixed';
  else if (evidence.some(e => e.includes('node:test')))
    runner = 'node:test';

  // Also check non-Node ecosystems in monorepos
  if (ecosystems.includes('go')) evidence.push('ecosystem:go');
  if (ecosystems.includes('python')) evidence.push('ecosystem:python');

  return { runner, evidence };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------
function topDirs(files, topN) {
  const c = new Map();
  for (const f of files) {
    if (!f || f.startsWith('.')) continue;
    const parts = f.split('/');
    if (parts.length < 2) continue;
    const d = parts[0];
    if (IGNORE_DIRS.has(d)) continue;
    c.set(d, (c.get(d) || 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
}

function detectE2EToolMarkers(files) {
  const markers = [];
  for (const f of files) {
    const low = f.toLowerCase();
    if (low.includes('playwright.config')) markers.push(f);
    if (low.includes('cypress.config')) markers.push(f);
    if (low.includes('wdio.conf')) markers.push(f);
  }
  return [...new Set(markers)].sort().slice(0, 10);
}

function pickScripts(pkg) {
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== 'object') return null;
  const picked = {};
  for (const k of Object.keys(scripts).sort()) {
    const lk = k.toLowerCase();
    if (['dev', 'start', 'build', 'test', 'lint', 'cov'].includes(lk) ||
        lk.includes('test') || lk.startsWith('lint:') || lk.includes('lint')) {
      picked[k] = scripts[k];
    }
  }
  return picked;
}

function runScriptCmd(pm, name) {
  if (!name) return null;
  if (pm === 'yarn') return `yarn ${name}`;
  if (pm === 'pnpm') return `pnpm ${name}`;
  return `npm run ${name}`;
}

function detectPreCommitSuite(pm, pkg) {
  const s = pkg?.scripts || {};
  const trio = ['lint:fix', 'build', 'test:unit'];
  if (trio.every(k => typeof s[k] === 'string' && s[k].trim())) {
    return trio.map(k => runScriptCmd(pm, k)).join(' && ');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------
function renderMd(report) {
  const {
    now, root, hasGit, ecosystems, packageManager, testRunner,
    buildFiles, docs, docCounts, docBuckets, readmePaths, readmeCount,
    entrypoints, dirs, scripts, tests, preCommit,
    testCounts, testBuckets, e2eMarkers, topN,
  } = report;

  const lines = [];
  lines.push('# Repo Intake Report (Full)');
  lines.push(`- Generated: ${now}`);
  lines.push(`- Repo root: \`${root}\``);
  lines.push(`- Git: ${hasGit ? 'yes (git ls-files)' : 'no (fallback file walk)'}`);
  lines.push('');

  lines.push('## 1) Project Overview');
  if (preCommit) lines.push(`- Pre-commit suite: \`${preCommit}\``);
  lines.push(`- Ecosystems: ${ecosystems.length ? ecosystems.map(e => `\`${e}\``).join(', ') : 'unknown'}`);
  lines.push(`- Package manager: \`${packageManager}\``);
  lines.push(`- Test runner: \`${testRunner.runner}\` (evidence: ${(testRunner.evidence || []).join(', ') || 'none'})`);
  if (buildFiles.length)
    lines.push(`- Build/config files: ${buildFiles.map(f => `\`${f}\``).join(' ')}`);
  if (scripts && Object.keys(scripts).length) {
    lines.push('- package.json scripts (selected):');
    for (const [k, v] of Object.entries(scripts))
      lines.push(`  - \`${k}\`: \`${v}\``);
  }
  lines.push('');

  lines.push('## 2) Documentation Map');
  const docBucketList = (m, limit) => {
    if (!m) return [];
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([k, n]) => `\`${k}\` x ${n}`);
  };
  if (docCounts > 0) {
    lines.push(`- Doc count: ${docCounts}`);
    lines.push(`- README count: ${readmeCount}`);
    if (readmePaths?.length) {
      lines.push(`- README locations (Top ${topN}):`);
      for (const p of readmePaths.slice(0, topN)) lines.push(`  - \`${p}\``);
      if (readmePaths.length > topN)
        lines.push(`  - (${readmePaths.length - topN} more omitted)`);
    }
    const bkts = docBucketList(docBuckets, topN);
    if (bkts.length) {
      lines.push(`- Top folders (L3 / Top ${topN}):`);
      for (const b of bkts) lines.push(`  - ${b}`);
    }
    lines.push('');
    lines.push('Suggested reading order: README -> /docs specs -> architecture/ADR/RFC -> runbook/deploy');
  } else {
    lines.push('- **No docs/README/spec files found in standard locations**');
  }
  lines.push('');

  lines.push('## 3) Entry Points & Structure');
  lines.push('- Entry candidates (Top):');
  if (entrypoints.length)
    for (const e of entrypoints) lines.push(`  - \`${e.file}\` (score: ${e.score}, ${e.label})`);
  else lines.push('  - (no entry points detected)');
  lines.push('');
  lines.push('- Top directories:');
  for (const [d, n] of dirs) lines.push(`  - \`${d}/\` x ${n}`);
  lines.push('');

  lines.push('## 4) Test Map (unit / integration / e2e)');
  const bucketList = (m, limit) => {
    if (!m) return [];
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([k, n]) => `\`${k}\` x ${n}`);
  };
  for (const [k, title] of [['unit', 'Unit Tests'], ['integration', 'Integration Tests'], ['e2e', 'E2E Tests']]) {
    lines.push(`### ${title}`);
    const total = testCounts?.[k] || 0;
    const bkts = bucketList(testBuckets?.[k], topN);
    if (total) {
      lines.push(`- File count: ${total}`);
      if (bkts.length) {
        lines.push(`- Top folders (L3 / Top ${topN}):`);
        for (const b of bkts) lines.push(`  - ${b}`);
      }
    } else {
      lines.push('- (none found)');
    }
    lines.push('');
  }
  if (e2eMarkers.length) {
    lines.push('### E2E Tool Markers (Playwright/Cypress/etc.)');
    for (const m of e2eMarkers) lines.push(`- \`${m}\``);
    lines.push('');
  }

  lines.push('## 5) Suggested Next Steps');
  lines.push('1. Pick a doc (e.g. docs/xxx.md) -> I\'ll produce requirement breakdown + task list');
  lines.push('2. Pick an entry file -> I\'ll explain architecture and data flow');
  lines.push('3. Pick test type (unit/integration/e2e) -> I\'ll prepare commands and checkpoints');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  const getArg = (k, defVal) => {
    const idx = argv.indexOf(k);
    if (idx === -1) return defVal;
    return argv[idx + 1] || defVal;
  };
  const format = getArg('--format', 'md');
  const topN = parseInt(getArg('--top', '12'), 10) || 12;

  const startCwd = process.cwd();
  const { root, hasGit } = detectRepoRoot(startCwd);

  let files = hasGit ? gitLsFiles(root) : null;
  if (!files) files = walkFiles(root);
  files = files.map(f => f.replace(/\\/g, '/')).filter(Boolean);
  // Apply ignore_prefixes from classification config
  files = files.filter(f => !IGNORE_PREFIXES.some(pfx => f.startsWith(pfx)));
  const filesSet = new Set(files);

  const ecosystems = detectEcosystems(root);
  const pkg = readPackageJson(root);
  const packageManager = detectPackageManager(root);
  const testRunner = detectTestRunner(pkg, ecosystems);

  // Docs
  const docCandidates = files.filter(isProbablyDoc);
  docCandidates.sort((a, b) => scoreDoc(b) - scoreDoc(a) || a.localeCompare(b));
  const docs = docCandidates.slice(0, topN);
  const docSummary = summarizeDocs(docCandidates);
  const readmePaths = listReadmes(files);

  // Build files
  const buildFiles = BUILD_FILES.filter(f => filesSet.has(f));

  // Entry points (config-driven scoring)
  const entryScored = scoreEntries(files, ENTRY_PATTERNS);
  const entrypoints = entryScored.slice(0, topN);

  // Scripts
  const scripts = pickScripts(pkg);

  // Tests
  const { groups: testGroups, counts: testCounts, buckets: testBuckets } =
    groupTests(files, topN);
  const e2eMarkers = detectE2EToolMarkers(files);

  const preCommit = detectPreCommitSuite(packageManager, pkg);

  const report = {
    schemaVersion: 2,
    now: new Date().toISOString(),
    root,
    hasGit,
    ecosystems,
    packageManager,
    testRunner,
    buildFiles,
    docs,
    docCounts: docSummary.total,
    docBuckets: docSummary.buckets,
    readmePaths,
    readmeCount: readmePaths.length,
    entrypoints,
    dirs: topDirs(files, 8),
    scripts,
    preCommit,
    tests: testGroups,
    testCounts,
    testBuckets,
    e2eMarkers,
    topN,
  };

  if (format === 'json') {
    // Convert Maps to objects for JSON serialization
    const jsonReport = { ...report };
    jsonReport.docBuckets = Object.fromEntries(report.docBuckets);
    jsonReport.testBuckets = {};
    for (const [k, m] of Object.entries(report.testBuckets)) {
      jsonReport.testBuckets[k] = Object.fromEntries(m);
    }
    jsonReport.dirs = report.dirs.map(([d, n]) => ({ dir: d, count: n }));
    process.stdout.write(JSON.stringify(jsonReport, null, 2));
  } else {
    process.stdout.write(renderMd(report));
  }
}

// Export for testing
module.exports = { matchPattern, compilePattern, detectEcosystems, scoreEntries, loadIntakeConfig };

if (require.main === module) main();
