#!/usr/bin/env node
'use strict';

// Content-aware parity evidence for sibling AI-CLI harnesses. The source
// harness is authoritative for shared relative paths; target-only files are
// allowed because each CLI can have native assets. Projects may add an
// explicit JSON allowlist at .cross-cli-allowlist.json with:
//   { ".codex": ["skills/native-only.md"] }

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MANAGED_DIRS = ['skills', 'commands', 'agents', 'hooks', 'rules'];

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(fp));
    else if (entry.isFile()) out.push(fp);
  }
  return out.sort();
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function managedFiles(root) {
  const files = [];
  for (const dir of MANAGED_DIRS) {
    const base = path.join(root, dir);
    for (const fp of walkFiles(base)) files.push([path.relative(root, fp).split(path.sep).join('/'), fp]);
  }
  return files;
}

function loadAllowlist(root, targetName) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, '.cross-cli-allowlist.json'), 'utf8'));
    const entries = raw && Array.isArray(raw[targetName]) ? raw[targetName] : [];
    return new Set(entries.filter((item) => typeof item === 'string'));
  } catch (_) {
    return new Set();
  }
}

function compareHarnesses(root, sourceName = '.claude', targetName = '.codex') {
  const repoRoot = path.resolve(root);
  const sourceRoot = path.join(repoRoot, sourceName.replace(/^\/+/, ''));
  const targetRoot = path.join(repoRoot, targetName.replace(/^\/+/, ''));
  const allowlist = loadAllowlist(repoRoot, targetName);
  const source = new Map(managedFiles(sourceRoot));
  const target = new Map(managedFiles(targetRoot));
  const missing = [];
  const different = [];

  for (const [relative, sourcePath] of source) {
    if (allowlist.has(relative)) continue;
    const targetPath = target.get(relative);
    if (!targetPath) {
      missing.push(relative);
      continue;
    }
    if (hashFile(sourcePath) !== hashFile(targetPath)) different.push(relative);
  }

  return {
    source: sourceName,
    target: targetName,
    source_files: source.size,
    target_files: target.size,
    missing: missing.sort(),
    different: different.sort(),
    allowlisted: [...allowlist].sort(),
    drift: missing.length > 0 || different.length > 0,
  };
}

function parseArgs(argv) {
  const opts = { root: process.cwd(), source: '.claude', target: '.codex', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--root': opts.root = argv[++i]; break;
      case '--source': opts.source = argv[++i]; break;
      case '--target': opts.target = argv[++i]; break;
      case '--json': opts.json = true; break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return opts;
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try { opts = parseArgs(argv); } catch (error) {
    console.error(`[cross-cli-parity] ${error.message}`);
    return 2;
  }
  const result = compareHarnesses(opts.root, opts.source, opts.target);
  if (opts.json) {
    console.log(JSON.stringify(result));
  } else if (result.drift) {
    const details = [];
    if (result.different.length) details.push(`different=${result.different.length}`);
    if (result.missing.length) details.push(`missing=${result.missing.length}`);
    console.log(`[session-start] cross-cli content drift: ${result.target} (${details.join(', ')}) — consider \`/multi-ai-sync\``);
  }
  return 0;
}

module.exports = { compareHarnesses, loadAllowlist, managedFiles, main };

if (require.main === module) process.exit(main());
