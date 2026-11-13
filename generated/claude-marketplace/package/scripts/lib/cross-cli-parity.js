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
const {
  createTraversalBudget,
  readFileBounded,
  readDirectoryEntries,
  lstatOrNull,
  isInside,
} = require('./bounded-filesystem');

const MANAGED_DIRS = ['skills', 'commands', 'agents', 'hooks', 'rules'];
const NATIVE_AGENTS_SKILLS_TARGETS = new Set(['.codex', 'codex', '.cursor', 'cursor', '.agent', 'agent']);

function targetSupportsAgentsSkills(targetName) {
  const normalized = String(targetName || '').trim().replace(/^\/+|\/+$/g, '');
  return NATIVE_AGENTS_SKILLS_TARGETS.has(normalized);
}

function realpathOrNull(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch (_) {
    return null;
  }
}

function isSharedSkillsDirectory(repoRoot, skillsDir) {
  const stat = lstatOrNull(skillsDir);
  if (!stat || !stat.isSymbolicLink()) return false;
  const agentsRoot = path.join(repoRoot, '.agents');
  const sharedCandidates = [
    path.join(agentsRoot, 'skills'),
    path.join(agentsRoot, 'claude-skills'),
  ];
  const realSkillsDir = realpathOrNull(skillsDir);
  if (realSkillsDir) {
    for (const candidate of sharedCandidates) {
      const realCandidate = realpathOrNull(candidate);
      if (realCandidate && isInside(realCandidate, realSkillsDir)) return true;
    }
  }
  try {
    const resolvedLink = path.resolve(path.dirname(skillsDir), fs.readlinkSync(skillsDir));
    return sharedCandidates.some((candidate) => isInside(candidate, resolvedLink));
  } catch (_) {
    return false;
  }
}

function hasMatchingSharedSkill(repoRoot, relative, sourceHash) {
  if (!relative.startsWith('skills/')) return false;
  const subPath = relative.slice('skills/'.length);
  if (!subPath) return false;
  const candidates = [
    path.join(repoRoot, '.agents', 'skills', subPath),
    path.join(repoRoot, '.agents', 'claude-skills', subPath),
  ];
  for (const candidate of candidates) {
    const stat = lstatOrNull(candidate);
    if (stat && stat.isFile() && hashFile(candidate) === sourceHash) return true;
  }
  return false;
}

function walkFiles(dir, options = {}) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const budget = createTraversalBudget(options);
  const walk = (directory, depth) => {
    const realDirectory = budget.enterDirectory(directory, depth);
    try {
      for (const entry of readDirectoryEntries(directory, { budget })) {
        const fp = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fp, depth + 1);
        else if (entry.isFile()) {
          budget.accountFile(fp, fs.statSync(fp));
          out.push(fp);
        }
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  walk(dir, 0);
  return out.sort();
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(readFileBounded(filePath)).digest('hex');
}

function managedFiles(root, options = {}) {
  const files = [];
  const resolvedRoot = path.resolve(root);
  const repoRoot = path.resolve(options.repoRoot || path.dirname(resolvedRoot));
  const skipSharedSkills = options.skipSharedSkills !== false;
  for (const dir of MANAGED_DIRS) {
    const base = path.join(resolvedRoot, dir);
    if (dir === 'skills' && skipSharedSkills && isSharedSkillsDirectory(repoRoot, base)) continue;
    for (const fp of walkFiles(base)) files.push([path.relative(resolvedRoot, fp).split(path.sep).join('/'), fp]);
  }
  return files;
}

function loadAllowlist(root, targetName) {
  try {
    const raw = JSON.parse(readFileBounded(path.join(root, '.cross-cli-allowlist.json')).toString('utf8'));
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
  const sharedSkillsSupported = targetSupportsAgentsSkills(targetName);
  const sourceSkillsDir = path.join(sourceRoot, 'skills');
  const sourceSkillsShared = sharedSkillsSupported && isSharedSkillsDirectory(repoRoot, sourceSkillsDir);
  const source = new Map(managedFiles(sourceRoot, { repoRoot, skipSharedSkills: sourceSkillsShared }));
  const target = new Map(managedFiles(targetRoot, { repoRoot, skipSharedSkills: false }));
  const missing = [];
  const different = [];

  for (const [relative, sourcePath] of source) {
    if (allowlist.has(relative)) continue;
    const targetPath = target.get(relative);
    if (!targetPath) {
      const sourceHash = hashFile(sourcePath);
      if (sharedSkillsSupported && hasMatchingSharedSkill(repoRoot, relative, sourceHash)) continue;
      missing.push(relative);
      continue;
    }
    if (hashFile(sourcePath) !== hashFile(targetPath)) different.push(relative);
  }

  if (sourceSkillsShared) {
    for (const [relative, targetPath] of target) {
      if (!relative.startsWith('skills/') || source.has(relative) || allowlist.has(relative)) continue;
      const sharedSourcePath = path.join(sourceRoot, relative);
      const stat = lstatOrNull(sharedSourcePath);
      if (stat && stat.isFile() && hashFile(sharedSourcePath) !== hashFile(targetPath)) {
        different.push(relative);
      }
    }
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
    console.log(`[session-start] cross-cli content drift: ${result.target} (${details.join(', ')}) — consider syncing via \`dhpk-install\``);
  }
  return 0;
}

module.exports = { compareHarnesses, loadAllowlist, managedFiles, main };

if (require.main === module) process.exit(main());
