#!/usr/bin/env node
'use strict';

/**
 * skill-lint.js — Automated skill health checker
 *
 * Validates all skills against routing, progressive loading, and structural criteria.
 *
 * Usage:
 *   node skill-lint.js [--skills-dir <path>] [--agents-dir <path>] [--commands-dir <path>] [--json] [--fix-hint]
 *
 * Exit codes:
 *   0 = all pass
 *   1 = warnings only (P2)
 *   2 = errors found (P0/P1)
 */

const { readdirSync, readFileSync, existsSync, statSync, lstatSync } = require('node:fs');
const { join, basename, dirname, resolve, relative, isAbsolute, sep, posix } = require('node:path');

const PORTABLE_FAMILY_NAMES = new Set([
  'skill-scope', 'skill-forge', 'flow-guide', 'flow-drive', 'change-verdict', 'code-trace',
]);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function argVal(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const jsonOutput = args.includes('--json');
const fixHint = args.includes('--fix-hint');

const cwd = process.cwd();
const skillsDir = resolve(argVal('--skills-dir', join(cwd, 'skills')));
const agentsDir = resolve(argVal('--agents-dir', join(cwd, 'agents')));
const commandsDir = resolve(argVal('--commands-dir', join(cwd, 'commands')));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeContent(raw) {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function safeReadFile(filePath) {
  try {
    return { ok: true, content: readFileSync(filePath, 'utf8') };
  } catch (error) {
    return { ok: false, error };
  }
}

function safeReadDir(dirPath) {
  try {
    return { ok: true, entries: readdirSync(dirPath) };
  } catch (error) {
    return { ok: false, error };
  }
}

function safeLstat(filePath) {
  try {
    return { ok: true, stat: lstatSync(filePath) };
  } catch (error) {
    return { ok: false, error };
  }
}

function malformedEntryFinding(kind, fileName, reason, fix) {
  return {
    check: `${kind}-entry`,
    path: fileName,
    pass: false,
    severity: 'P1',
    message: `${kind[0].toUpperCase()}${kind.slice(1)} entry "${fileName}" ${reason}`,
    fix,
  };
}

function invalidFrontmatterFinding(kind, fileName, missing) {
  return {
    check: `${kind}-frontmatter`,
    path: fileName,
    pass: false,
    severity: 'P1',
    message: `${kind[0].toUpperCase()}${kind.slice(1)} "${fileName}" has invalid frontmatter (missing ${missing.join(', ')})`,
    fix: `Add the required frontmatter fields to ${fileName}`,
  };
}

function readDiscoverableEntry(dirPath, fileName, kind, displayName = fileName) {
  const filePath = join(dirPath, fileName);
  const lstatResult = safeLstat(filePath);
  if (!lstatResult.ok) {
    return {
      finding: malformedEntryFinding(
        kind,
        displayName,
        `could not be inspected (${lstatResult.error.code || 'filesystem error'})`,
        `Restore or remove ${displayName}, then run the health check again`,
      ),
    };
  }
  if (lstatResult.stat.isSymbolicLink() && !existsSync(filePath)) {
    return {
      finding: malformedEntryFinding(
        kind,
        displayName,
        'is a dangling symlink',
        `Restore the symlink target or remove ${displayName}`,
      ),
    };
  }
  if (!lstatResult.stat.isFile() && !lstatResult.stat.isSymbolicLink()) {
    return {
      finding: malformedEntryFinding(
        kind,
        displayName,
        'is not a regular file',
        `Replace ${displayName} with a regular markdown file or remove it`,
      ),
    };
  }
  const readResult = safeReadFile(filePath);
  if (!readResult.ok) {
    return {
      finding: malformedEntryFinding(
        kind,
        displayName,
        `could not be read (${readResult.error.code || 'filesystem error'})`,
        `Restore read access to ${displayName} or remove it`,
      ),
    };
  }
  return { content: normalizeContent(readResult.content) };
}

function requiredFrontmatterFields(content, required) {
  const fm = parseFrontmatter(content);
  if (!fm) return required;
  return required.filter((field) => !fm[field]);
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    if (!finding || finding.pass) return true;
    const key = [finding.check, finding.path || finding.skill || '', finding.target || finding.message || ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    fm[key] = val;
  }
  return fm;
}

function bodyAfterFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : content;
}

function countLines(content) {
  return content.split('\n').length;
}

function hasHeading(body, pattern) {
  return new RegExp(`^##+ .*${pattern}`, 'im').test(body);
}

function similarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capabilitySkip(check, reason) {
  return { check, reason };
}

// ---------------------------------------------------------------------------
// Check functions — each returns { pass, severity, message, fix? }
// ---------------------------------------------------------------------------

function checkFrontmatterExists(fm, skillName) {
  const skillPath = `${skillName}/SKILL.md`;
  if (!fm) return { pass: false, severity: 'P1', path: skillPath, message: 'Missing YAML frontmatter', fix: 'Add YAML frontmatter with name and description' };
  if (!fm.name)
    return { pass: false, severity: 'P1', path: skillPath, message: 'Frontmatter missing `name` field', fix: 'Add the required name field to YAML frontmatter' };
  if (!fm.description)
    return { pass: false, severity: 'P1', path: skillPath, message: 'Frontmatter missing `description` field', fix: 'Add the required description field to YAML frontmatter' };
  return { pass: true };
}

function checkRoutingSignature(fm) {
  if (!fm || !fm.description) return { pass: false, severity: 'P1', message: 'No description to check' };
  const desc = fm.description.toLowerCase();

  const hasUseCue =
    /\buse when\b/.test(desc) ||
    /\btrigger/.test(desc) ||
    /\buse for\b/.test(desc) ||
    /\buse this\b/.test(desc);
  const hasAvoidCue =
    /\bavoid\b/.test(desc) ||
    /\bnot for\b/.test(desc) ||
    /\bdon'?t use\b/.test(desc) ||
    /\binstead use\b/.test(desc);
  const hasOutputCue =
    /\boutput/.test(desc) ||
    /\bproduc/.test(desc) ||
    /\breport/.test(desc) ||
    /\bgenerat/.test(desc);

  const cueCount = [hasUseCue, hasAvoidCue, hasOutputCue].filter(Boolean).length;

  if (cueCount === 0) {
    return {
      pass: false,
      severity: 'P1',
      message: 'Description lacks routing cues (Use/Avoid/Output)',
      fix: 'Add routing cues: "Use when: X. Not for: Y. Output: Z."',
    };
  }
  if (cueCount < 2) {
    return {
      pass: false,
      severity: 'P2',
      message: `Description has ${cueCount}/3 routing cues (missing: ${!hasUseCue ? 'Use' : ''}${!hasAvoidCue ? ' Avoid' : ''}${!hasOutputCue ? ' Output' : ''})`.trim(),
      fix: 'Add missing routing cues to description',
    };
  }
  return { pass: true };
}

function extractWhenNotSection(body) {
  const heading = body.match(/^(#{2,})\s+.*(?:When NOT|NOT to Use|Don't Use).*$/im);
  if (!heading || heading.index === undefined) return null;
  const sectionStart = heading.index + heading[0].length;
  const remainder = body.slice(sectionStart);
  const level = heading[1].length;
  const headingPattern = /^(#{2,})\s+/gm;
  let nextHeading = -1;
  let candidate;
  while ((candidate = headingPattern.exec(remainder)) !== null) {
    if (candidate[1].length <= level) {
      nextHeading = candidate.index;
      break;
    }
  }
  return (nextHeading === -1 ? remainder : remainder.slice(0, nextHeading)).trim();
}

function normalizeRouteToken(token) {
  if (token.startsWith('@skills/')) return token.slice('@skills/'.length);
  if (token.startsWith('/dhpk:')) {
    const route = token.slice('/dhpk:'.length);
    return PORTABLE_FAMILY_NAMES.has(route) || route.startsWith('dhpk-') ? route : `dhpk-${route}`;
  }
  if (token.startsWith('dhpk:')) {
    const route = token.slice('dhpk:'.length);
    return PORTABLE_FAMILY_NAMES.has(route) || route.startsWith('dhpk-') ? route : `dhpk-${route}`;
  }
  return token;
}

function checkWhenNotSection(body, knownSkillNames = null) {
  const section = extractWhenNotSection(body);
  if (section === null) {
    return {
      pass: false,
      severity: 'P1',
      message: 'Missing "When NOT to Use" section in body',
      fix: 'Add a non-empty ## When NOT to Use section with a neighboring route or explicit exclusion',
    };
  }

  const meaningful = section
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*[-*]\s*$/gm, '')
    .trim();
  if (!meaningful) {
    return {
      pass: false,
      severity: 'P1',
      message: 'Empty "When NOT to Use" section in body',
      fix: 'Name a neighboring route or state an explicit exclusion under ## When NOT to Use',
    };
  }

  if (knownSkillNames) {
    const known = new Set(knownSkillNames);
    const routePattern = /@skills\/[A-Za-z0-9][A-Za-z0-9-]*|\/dhpk:[A-Za-z0-9][A-Za-z0-9-]*|\bdhpk:[A-Za-z0-9][A-Za-z0-9-]*|\bdhpk-[A-Za-z0-9][A-Za-z0-9-]*/g;
    const unresolved = [...new Set(
      [...meaningful.matchAll(routePattern)].map((match) => normalizeRouteToken(match[0])),
    )].filter((token) => !known.has(token));
    if (unresolved.length > 0) {
      return {
        pass: false,
        severity: 'P1',
        message: `When NOT to Use names unresolvable route(s): ${unresolved.join(', ')}`,
        fix: 'Use a shipped canonical route identifier or describe the exclusion without a stale route token',
      };
    }
  }

  return { pass: true };
}

function checkOutputSection(body) {
  if (hasHeading(body, 'Output') || hasHeading(body, 'Deliverable') || hasHeading(body, 'Report')) {
    return { pass: true };
  }
  return {
    pass: false,
    severity: 'P2',
    message: 'Missing "Output" section defining expected deliverable format',
    fix: 'Add ## Output section with expected format',
  };
}

function checkVerificationSection(body) {
  if (hasHeading(body, 'Verification') || hasHeading(body, 'Checklist') || hasHeading(body, 'Gate')) {
    return { pass: true };
  }
  return {
    pass: false,
    severity: 'P2',
    message: 'Missing "Verification" section',
    fix: 'Add ## Verification section',
  };
}

function pathEscapes(root, target) {
  const targetRelative = relative(root, target);
  return targetRelative === '..'
    || targetRelative.startsWith(`..${sep}`)
    || isAbsolute(targetRelative);
}

function inspectPhysicalFile(root, fileRelative) {
  if (typeof fileRelative !== 'string' || fileRelative.length === 0) {
    return { ok: false, reason: 'is not a valid relative path' };
  }
  const target = resolve(root, fileRelative);
  if (pathEscapes(root, target)) return { ok: false, reason: 'escapes its Skill boundary' };

  const rootRelative = relative(root, target);
  const parts = rootRelative.split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    const result = safeLstat(current);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.error && result.error.code === 'ENOENT'
          ? 'is missing'
          : `could not be inspected (${result.error?.code || 'filesystem error'})`,
      };
    }
    if (result.stat.isSymbolicLink()) return { ok: false, reason: 'is a symlink' };
    if (index < parts.length - 1 && !result.stat.isDirectory()) {
      return { ok: false, reason: 'has a non-directory ancestor' };
    }
    if (index === parts.length - 1 && !result.stat.isFile()) {
      return { ok: false, reason: 'is not a regular file' };
    }
  }
  return { ok: true, path: target };
}

function listFiles(root, include) {
  const files = [];
  function walk(directory, prefix = '') {
    const readResult = safeReadDir(directory);
    if (!readResult.ok) return;
    for (const entry of readResult.entries.sort()) {
      const fileRelative = prefix ? posix.join(prefix, entry) : entry;
      const filePath = join(directory, entry);
      const lstatResult = safeLstat(filePath);
      if (!lstatResult.ok) continue;
      if (lstatResult.stat.isDirectory() && !lstatResult.stat.isSymbolicLink()) {
        walk(filePath, fileRelative);
      } else if (!lstatResult.stat.isSymbolicLink() && include(fileRelative, lstatResult.stat)) {
        files.push(fileRelative);
      }
    }
  }
  if (isDir(root)) walk(root);
  return files;
}

// Mirror of listFiles that returns only symlinked leaf entries, so callers can
// distinguish "no such script" from "a script exists but is a symlink" — the
// latter must be reported, not silently treated as absent.
function listSymlinkedFiles(root, include) {
  const files = [];
  function walk(directory, prefix = '') {
    const readResult = safeReadDir(directory);
    if (!readResult.ok) return;
    for (const entry of readResult.entries.sort()) {
      const fileRelative = prefix ? posix.join(prefix, entry) : entry;
      const filePath = join(directory, entry);
      const lstatResult = safeLstat(filePath);
      if (!lstatResult.ok) continue;
      if (lstatResult.stat.isDirectory() && !lstatResult.stat.isSymbolicLink()) {
        walk(filePath, fileRelative);
      } else if (lstatResult.stat.isSymbolicLink() && include(fileRelative, lstatResult.stat)) {
        files.push(fileRelative);
      }
    }
  }
  if (isDir(root)) walk(root);
  return files;
}

function markdownTargets(content, documentRelative = 'SKILL.md') {
  const links = [];
  const markdownSpans = [];
  const add = (raw, documentRelativeTarget) => {
    if (typeof raw !== 'string') return;
    const value = raw.replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
    if (!value || /^(?:[a-z]+:|\/|#)/i.test(value) || !/\.md$/i.test(value)) return;
    const candidate = posix.normalize(posix.join(
      posix.dirname(documentRelativeTarget),
      value,
    ));
    links.push({ path: candidate, raw: value, document: documentRelativeTarget });
  };

  const markdown = /\]\(\s*<?([^\s)>]+)>?/g;
  let match;
  while ((match = markdown.exec(String(content))) !== null) {
    add(match[1], documentRelative);
    markdownSpans.push([match.index, markdown.lastIndex]);
  }

  const maskedContent = String(content).split('');
  for (const [start, end] of markdownSpans) {
    for (let index = start; index < end; index += 1) {
      if (maskedContent[index] !== '\n' && maskedContent[index] !== '\r') maskedContent[index] = ' ';
    }
  }
  const textual = /(?<![A-Za-z0-9_@./-])references\/[A-Za-z0-9._/-]+\.md\b/g;
  while ((match = textual.exec(maskedContent.join(''))) !== null) add(match[0], 'SKILL.md');
  return links;
}

function collectReachableMarkdown(skillDir, body) {
  const referencesRoot = join(skillDir, 'references');
  const files = listFiles(referencesRoot, (fileRelative) => /\.md$/i.test(fileRelative))
    .map((fileRelative) => posix.join('references', fileRelative));
  const reachable = new Set();
  const links = [];
  const escapes = [];
  const queue = [];
  const queued = new Set();

  const enqueue = (link) => {
    if (!link || typeof link.path !== 'string') return;
    // A normalized target that climbs above the Skill root (e.g. `../../outside.md`)
    // is a boundary escape, not merely "outside references/" — flag it instead of
    // silently dropping it, so a Skill cannot depend on an ambient file it doesn't own.
    if (link.path === '..' || link.path.startsWith('../')) {
      escapes.push(link);
      return;
    }
    links.push(link);
    if (!link.path.startsWith('references/')) {
      return;
    }
    if (!queued.has(link.path)) {
      queued.add(link.path);
      queue.push(link.path);
    }
  };

  const initialLinks = markdownTargets(body, 'SKILL.md');
  for (const file of files) {
    const fileName = basename(file);
    if (body.includes(file) || body.includes(fileName)) {
      enqueue({ path: file, raw: file, document: 'SKILL.md' });
    }
  }
  for (const link of initialLinks) enqueue(link);

  // A documented directory (e.g. `references/modes/`) routes every Markdown
  // file beneath it; the reader chooses among them by the documented mode.
  const corpus = [body];
  const routedDirectories = new Set();
  const noteDirectories = (content) => {
    const pattern = /(?<![A-Za-z0-9_@./-])(references\/(?:[A-Za-z0-9._-]+\/)+)(?![A-Za-z0-9._-])/g;
    let match;
    while ((match = pattern.exec(String(content))) !== null) routedDirectories.add(match[1]);
  };
  noteDirectories(body);
  for (;;) {
    while (queue.length > 0) {
      const document = queue.shift();
      if (reachable.has(document)) continue;
      reachable.add(document);
      const physical = inspectPhysicalFile(skillDir, document);
      if (!physical.ok) continue;
      const readResult = safeReadFile(physical.path);
      if (!readResult.ok) continue;
      corpus.push(readResult.content);
      noteDirectories(readResult.content);
      for (const link of markdownTargets(readResult.content, document)) enqueue(link);
    }
    const routed = files.filter((file) => !reachable.has(file) && !queued.has(file)
      && [...routedDirectories].some((directory) => file.startsWith(directory)));
    if (routed.length === 0) break;
    for (const file of routed) enqueue({ path: file, raw: file, document: 'SKILL.md' });
  }

  return { files, reachable, links, escapes, corpus: corpus.join('\n') };
}

function scriptImportSpecifiers(content) {
  const specifiers = [];
  const patterns = [
    /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /(?:^|[;\n])\s*(?:source|\.)\s+['"]?([./][^\s'";]+)/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(String(content))) !== null) specifiers.push(match[1]);
  }
  return [...new Set(specifiers)];
}

function resolveScriptImport(importer, specifier, knownFiles) {
  if (typeof specifier !== 'string' || !specifier.startsWith('.')) return null;
  const candidate = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (candidate === '..' || candidate.startsWith('../')) return null;
  const candidates = [candidate];
  if (!posix.extname(candidate)) {
    for (const extension of ['.js', '.mjs', '.cjs', '.sh', '.py']) candidates.push(`${candidate}${extension}`);
    for (const extension of ['.js', '.mjs', '.cjs', '.sh', '.py']) candidates.push(posix.join(candidate, `index${extension}`));
  }
  return candidates.find((value) => knownFiles.has(value)) || null;
}

// Textual evidence that `importer` loads `target` when no static import names
// it: a path/basename mention (shell `"$DIR/lib/x.sh"`), an exact quoted
// module stem (`loadRuntimeModule('runner-utils')`), or a Python package /
// relative module import.  Mirrors the repository coverage validator.
function scriptMentions(importerRelative, content, targetRelative) {
  const text = String(content);
  const p = posix;
  const base = p.basename(targetRelative);
  const extension = p.extname(targetRelative);
  const relativePath = p.relative(p.dirname(importerRelative), targetRelative);
  const relativeStem = relativePath.slice(0, relativePath.length - extension.length);
  const stem = base.slice(0, base.length - extension.length);
  const quote = `['"\`]`;
  const before = '(?<![A-Za-z0-9_.-])';
  const after = '(?![A-Za-z0-9_-])';
  // 1. The basename or caller-relative path, extension included, as a token.
  if (new RegExp(`${before}${escapeRegExp(base)}${after}`).test(text)) return true;
  if (relativePath !== base && new RegExp(`${before}${escapeRegExp(relativePath)}${after}`).test(text)) return true;
  // 2. An extensionless relative specifier such as require('./helper').
  const specifier = relativeStem.startsWith('../') ? relativeStem : `./${relativeStem}`;
  if (new RegExp(`${quote}${escapeRegExp(specifier)}${quote}`).test(text)) return true;
  // 3. The exact stem as a quoted call argument, e.g. loadRuntimeModule('x')
  //    or path.join('scripts', 'lib', 'x'); a bare quoted word is not enough.
  if (stem.length > 1 && new RegExp(`[A-Za-z_$][\\w$]*\\s*\\([^()]*${quote}${escapeRegExp(stem)}${quote}`).test(text)) return true;
  // 4. Python modules require import syntax, never a bare identifier.
  if (extension === '.py') {
    const parts = (base === '__init__.py' ? p.dirname(relativePath) : relativeStem).split('/').filter(Boolean);
    if (parts.length > 0 && !parts.includes('..') && !parts.includes('.')) {
      const dotted = escapeRegExp(parts.join('.'));
      const moduleStem = escapeRegExp(parts[parts.length - 1]);
      if (new RegExp(`^\\s*(?:from\\s+${dotted}(?:\\.[\\w.]+)?\\s+import\\b|import\\s+${dotted}(?![\\w]))`, 'm').test(text)) return true;
      if (new RegExp(`^\\s*from\\s+\\.+${dotted}(?:\\.[\\w.]+)?\\s+import\\b`, 'm').test(text)) return true;
      if (new RegExp(`^\\s*from\\s+\\.+\\s+import\\s+[^\\n]*\\b${moduleStem}\\b`, 'm').test(text)) return true;
    }
  }
  return false;
}

function checkReferencesRouting(skillDir, body) {
  const refsDir = join(skillDir, 'references');
  if (!isDir(refsDir)) return { pass: true };

  const { files: refFiles, reachable } = collectReachableMarkdown(skillDir, body);
  if (refFiles.length === 0) return { pass: true };

  const missing = refFiles.filter((file) => !reachable.has(file));
  if (missing.length === 0) return { pass: true };

  return {
    pass: false,
    severity: 'P2',
    message: `References not mentioned in SKILL.md: ${missing.join(', ')}`,
    fix: 'Add ## References section mapping when to read each file',
  };
}

function checkScriptsContract(skillDir, body) {
  const scriptsDir = join(skillDir, 'scripts');
  if (!isDir(scriptsDir)) return { pass: true };

  const scriptPattern = (fileRelative) => /\.(?:js|mjs|cjs|sh|py)$/i.test(fileRelative);
  const scripts = listFiles(scriptsDir, scriptPattern);

  // A symlinked script is never a legitimate public entry — a Skill directory
  // must be physically self-contained. Flag it as soon as SKILL.md documents
  // it, rather than letting listFiles() quietly drop it from `scripts` and
  // pass by omission.
  // Public entries may be documented in SKILL.md or any Markdown reachable
  // from it (e.g. a phase procedure under references/).
  const documentation = collectReachableMarkdown(skillDir, body).corpus;
  const documentedSymlinkedScripts = listSymlinkedFiles(scriptsDir, scriptPattern)
    .filter((file) => documentation.includes(file) || documentation.includes(basename(file)));
  if (documentedSymlinkedScripts.length > 0) {
    return {
      pass: false,
      severity: 'P1',
      message: `Documented script(s) are symlinks, not physically local regular files: ${documentedSymlinkedScripts.join(', ')}`,
      fix: 'Replace the symlink with a physically local regular file under scripts/',
    };
  }

  if (scripts.length === 0) return { pass: true };

  // A bare basename in SKILL.md only documents a script when that basename is
  // unique under scripts/ — otherwise two different scripts sharing a name in
  // different subdirectories (e.g. scripts/a/run.js and scripts/b/run.js)
  // would both be misclassified as documented from a single mention.
  const basenameCounts = new Map();
  for (const file of scripts) {
    const name = basename(file);
    basenameCounts.set(name, (basenameCounts.get(name) || 0) + 1);
  }
  const publicScripts = new Set(
    scripts.filter((file) => {
      if (documentation.includes(file)) return true;
      const name = basename(file);
      return basenameCounts.get(name) === 1 && documentation.includes(name);
    }),
  );
  const importedHelpers = new Set();
  const queue = [...publicScripts];
  const knownScripts = new Set(scripts);
  // Imports may also resolve to symlinked leaves; those are never followed,
  // only reported, because a Skill must not execute code outside its tree.
  const symlinkedScripts = new Set(listSymlinkedFiles(scriptsDir, scriptPattern));
  const resolvable = new Set([...knownScripts, ...symlinkedScripts]);
  const importedSymlinks = new Set();
  while (queue.length > 0) {
    const importer = queue.shift();
    const readResult = safeReadFile(join(scriptsDir, importer));
    if (!readResult.ok) continue;
    const imports = new Set();
    for (const specifier of scriptImportSpecifiers(readResult.content)) {
      const imported = resolveScriptImport(importer, specifier, resolvable);
      if (imported) imports.add(imported);
    }
    for (const candidate of resolvable) {
      if (candidate !== importer && scriptMentions(importer, readResult.content, candidate)) imports.add(candidate);
    }
    for (const imported of imports) {
      if (symlinkedScripts.has(imported)) {
        importedSymlinks.add(imported);
      } else if (!publicScripts.has(imported) && !importedHelpers.has(imported)) {
        importedHelpers.add(imported);
        queue.push(imported);
      }
    }
  }
  if (importedSymlinks.size > 0) {
    return {
      pass: false,
      severity: 'P1',
      message: `Imported helper script(s) are symlinks, not physically local regular files: ${[...importedSymlinks].sort().join(', ')}`,
      fix: 'Replace the symlink with a physically local regular file under scripts/',
    };
  }

  const missing = scripts.filter((file) => !publicScripts.has(file) && !importedHelpers.has(file));
  if (missing.length === 0) return { pass: true };

  return {
    pass: false,
    severity: 'P2',
    message: `Scripts not documented in SKILL.md: ${missing.join(', ')}`,
    fix: 'Document each script with usage, inputs, outputs, and exit codes',
  };
}

function checkLineCount(content) {
  const lines = countLines(content);
  if (lines > 250) {
    return {
      pass: false,
      severity: 'P2',
      message: `SKILL.md is ${lines} lines (threshold: 250). Consider extracting to references/`,
    };
  }
  if (lines > 150) {
    return {
      pass: true,
      warning: `SKILL.md is ${lines} lines — review for extractable content`,
    };
  }
  return { pass: true };
}

// checkAllowedToolsSync removed (Phase B — skills-only architecture)

function checkAgentEntitlement(body, fm) {
  if (!fm) return { pass: true };
  // Only match explicit Agent( calls — subagent_type alone may be Task dispatch
  const mentions = /\bAgent\s*\(/.test(body);
  if (!mentions) return { pass: true };
  const tools = (fm['allowed-tools'] || '').replace(/^["']|["']$/g, '');
  if (/\bAgent\b/.test(tools)) return { pass: true };
  return {
    pass: false,
    severity: 'P2',
    message: 'Body describes Agent() dispatch but allowed-tools lacks Agent',
    fix: 'Add Agent to allowed-tools in SKILL.md',
  };
}

function checkTaskEntitlement(body, fm) {
  if (!fm) return { pass: true };
  const mentions = /\bTask\s*\(/.test(body) || /\bTaskCreate\b/.test(body);
  if (!mentions) return { pass: true };
  const tools = (fm['allowed-tools'] || '').replace(/^["']|["']$/g, '');
  if (/\bTask\b/.test(tools)) return { pass: true };
  return {
    pass: false,
    severity: 'P2',
    message: 'Body describes Task() dispatch but allowed-tools lacks Task',
    fix: 'Add Task to allowed-tools in SKILL.md',
  };
}

function skillsRootForSkill(skillDir) {
  const absoluteSkillDir = resolve(skillDir);
  const configuredRoot = resolve(skillsDir);
  if (absoluteSkillDir === configuredRoot || absoluteSkillDir.startsWith(`${configuredRoot}${sep}`)) {
    return configuredRoot;
  }
  let current = absoluteSkillDir;
  while (current !== dirname(current)) {
    if (basename(current) === 'skills') return current;
    current = dirname(current);
  }
  return dirname(absoluteSkillDir);
}

function checkCrossSkillRefPaths(skillName, skillDir, body) {
  const rootSkillsDir = skillsRootForSkill(skillDir);
  const graph = collectReachableMarkdown(skillDir, body);
  const mismatches = [];
  const seen = new Set();
  const addMismatch = (mismatch) => {
    const key = [mismatch.qualified ? 'qualified' : 'local', mismatch.parentSkill || '', mismatch.refFile || '', mismatch.reason || ''].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    mismatches.push(mismatch);
  };

  for (const escape of graph.escapes) {
    addMismatch({ refFile: escape.raw || escape.path, reason: 'escapes the Skill boundary', escape: true });
  }

  for (const link of graph.links) {
    if (!link.path.startsWith('references/')) continue;
    const localPath = inspectPhysicalFile(skillDir, link.path);
    if (localPath.ok) continue;
    const refFile = link.path.slice('references/'.length);
    const parentSkill = localPath.reason === 'is missing'
      ? findRefInOtherSkills(refFile, skillName, rootSkillsDir)
      : null;
    addMismatch({ refFile, parentSkill, reason: localPath.reason });
  }

  const qualifiedPattern = /(?:@skills\/([^/`\s)]+)\/references\/([^`\s]+\.md)|\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/([^/`\s)]+)\/references\/([^`\s]+\.md))/g;
  const documents = [body, ...[...graph.reachable]
    .map((document) => {
      const physical = inspectPhysicalFile(skillDir, document);
      if (!physical.ok) return null;
      const readResult = safeReadFile(physical.path);
      return readResult.ok ? readResult.content : null;
    })
    .filter(Boolean)];
  for (const content of documents) {
    let qualified;
    while ((qualified = qualifiedPattern.exec(content)) !== null) {
      const parentSkill = qualified[1] || qualified[3];
      const refFile = qualified[2] || qualified[4];
      const parentRoot = resolve(rootSkillsDir, parentSkill);
      const target = resolve(parentRoot, 'references', refFile);
      let physical;
      if (pathEscapes(rootSkillsDir, parentRoot)) {
        physical = { ok: false, reason: 'escapes the Skills boundary' };
      } else if (pathEscapes(parentRoot, target)) {
        physical = { ok: false, reason: 'escapes the parent Skill boundary' };
      } else {
        physical = inspectPhysicalFile(rootSkillsDir, relative(rootSkillsDir, target));
      }
      if (!physical.ok) addMismatch({ refFile, parentSkill, qualified: true, reason: physical.reason });
    }
    qualifiedPattern.lastIndex = 0;
  }

  if (mismatches.length === 0) return { pass: true };

  const details = mismatches
    .map((m) => m.escape
      ? `reference ${m.refFile} escapes the Skill boundary`
      : m.qualified
        ? `qualified reference ${m.parentSkill}/references/${m.refFile} ${m.reason || 'is invalid'}`
        : m.parentSkill
          ? `references/${m.refFile} → @skills/${m.parentSkill}/references/${m.refFile}`
          : `local reference references/${m.refFile} ${m.reason || 'is invalid'}`)
    .join('; ');
  return {
    pass: false,
    severity: 'P1',
    message: `Non-local reference(s) need cross-skill path: ${details}`,
    fix: 'Use an existing @skills/<parent>/references/<file>.md or plugin-root-qualified reference',
  };
}

function findRefInOtherSkills(refFile, excludeSkill, root = skillsDir) {
  if (!isDir(root)) return null;
  const matches = [];
  for (const p of findSkillDirs(root)) {
    if (basename(p) === excludeSkill) continue;
    if (inspectPhysicalFile(p, join('references', refFile)).ok) matches.push(basename(p));
  }
  // Ambiguous if 2+ skills share the same filename — not clearly cross-skill
  return matches.length === 1 ? matches[0] : null;
}

// Recursively find leaf skill directories (a dir containing SKILL.md). Supports
// nested layouts like skills/gitnexus/<sub-skill>/SKILL.md so every skill is
// linted, matching Claude Code's recursive skill discovery.
function findSkillDirs(root) {
  if (!isDir(root)) return [];
  const hasSkillEntry = (dir) => {
    const entry = safeLstat(join(dir, 'SKILL.md'));
    return entry.ok || entry.error.code !== 'ENOENT';
  };
  if (hasSkillEntry(root)) return [root];
  const SKIP = new Set(['references', 'scripts', 'templates', 'node_modules']);
  // lstat (not stat) so symlinked dirs are NOT descended into — avoids cyclic-
  // symlink stack overflow and double-counting linked skills.
  const isRealDir = (p) => {
    try {
      return lstatSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const out = [];
  function walk(dir) {
    if (hasSkillEntry(dir)) {
      out.push(dir); // leaf skill — do not descend further
      return;
    }
    const readResult = safeReadDir(dir);
    if (!readResult.ok) return;
    for (const e of readResult.entries) {
      if (SKIP.has(e)) continue;
      const p = join(dir, e);
      if (isRealDir(p)) walk(p);
    }
  }
  const rootEntries = safeReadDir(root);
  if (!rootEntries.ok) return out;
  for (const e of rootEntries.entries) {
    if (SKIP.has(e)) continue;
    const p = join(root, e);
    if (isRealDir(p)) walk(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Skill-level checks
// ---------------------------------------------------------------------------

function lintSkill(skillName, skillDir, knownSkillNames = null) {
  const skillPath = join(skillDir, 'SKILL.md');
  const entry = readDiscoverableEntry(skillDir, 'SKILL.md', 'skill', `${skillName}/SKILL.md`);
  if (entry.finding) {
    return {
      name: skillName,
      path: skillPath,
      findings: [entry.finding],
    };
  }
  const content = entry.content;
  const fm = parseFrontmatter(content);
  const body = bodyAfterFrontmatter(content);
  const findings = [];

  findings.push({ check: 'frontmatter', ...checkFrontmatterExists(fm, skillName) });
  findings.push({ check: 'routing-signature', ...checkRoutingSignature(fm) });
  findings.push({ check: 'when-not', ...checkWhenNotSection(body, knownSkillNames) });
  findings.push({ check: 'output', ...checkOutputSection(body) });
  findings.push({ check: 'verification', ...checkVerificationSection(body) });
  findings.push({ check: 'references-routing', ...checkReferencesRouting(skillDir, body) });
  findings.push({ check: 'scripts-contract', ...checkScriptsContract(skillDir, body) });
  findings.push({ check: 'line-count', ...checkLineCount(content) });
  findings.push({ check: 'agent-entitlement', ...checkAgentEntitlement(body, fm) });
  findings.push({ check: 'task-entitlement', ...checkTaskEntitlement(body, fm) });
  findings.push({ check: 'cross-skill-ref-path', ...checkCrossSkillRefPaths(skillName, skillDir, body) });

  return { name: skillName, path: skillPath, fm, body, findings };
}

// ---------------------------------------------------------------------------
// Cross-skill checks
// ---------------------------------------------------------------------------

function detectOrphans(skillNames, commandFiles, _commandsDir = commandsDir) {
  const findings = [];
  if (commandFiles.length === 0) return findings;
  const knownSkills = new Set(skillNames);
  const explicitSkillPatterns = [
    /@skills\/([A-Za-z0-9][A-Za-z0-9-]*)(?=\/|[`\s)]|$)/g,
    /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/([A-Za-z0-9][A-Za-z0-9-]*)(?=\/|[`\s)]|$)/g,
  ];
  for (const cmdFile of commandFiles) {
    const readResult = safeReadFile(join(_commandsDir, cmdFile));
    if (!readResult.ok) continue;
    const targets = new Set();
    for (const pattern of explicitSkillPatterns) {
      let match;
      while ((match = pattern.exec(readResult.content)) !== null) {
        targets.add(match[1]);
      }
      pattern.lastIndex = 0;
    }
    for (const target of targets) {
      if (knownSkills.has(target)) continue;
      findings.push({
        check: 'orphan-command',
        pass: false,
        severity: 'P1',
        message: `Command "${basename(cmdFile, '.md')}" references missing Skill "${target}"`,
        fix: `Add ${target} to the discovered Skills or remove the explicit command target`,
      });
    }
  }
  return findings;
}

function detectCommandFrontmatter(commandFiles, _commandsDir) {
  const findings = [];
  for (const cmdFile of commandFiles) {
    const entry = readDiscoverableEntry(_commandsDir, cmdFile, 'command');
    if (entry.finding) {
      findings.push(entry.finding);
      continue;
    }
    const missing = requiredFrontmatterFields(entry.content, ['description']);
    if (missing.length > 0) findings.push(invalidFrontmatterFinding('command', cmdFile, missing));
  }
  return findings;
}

function skillNameFromCommandContent(content, skillNames) {
  const candidates = [...skillNames].sort((a, b) => b.length - a.length);
  for (const skillName of candidates) {
    const escaped = escapeRegExp(skillName);
    const patterns = [
      new RegExp('`dhpk:' + escaped + '`', 'i'),
      new RegExp('`' + escaped + '`\\s+skill\\b', 'i'),
      new RegExp('\\bskill\\s+`' + escaped + '`', 'i'),
    ];
    if (patterns.some((pattern) => pattern.test(content))) return skillName;
  }
  return null;
}

function detectDescriptionOverlap(skillResults) {
  const findings = [];
  const descs = skillResults
    .filter((r) => r.fm && r.fm.description)
    .map((r) => ({ name: r.name, desc: r.fm.description }));

  for (let i = 0; i < descs.length; i++) {
    for (let j = i + 1; j < descs.length; j++) {
      const sim = similarity(descs[i].desc, descs[j].desc);
      if (sim > 0.6) {
        findings.push({
          check: 'description-overlap',
          pass: false,
          severity: 'P2',
          message: `High description overlap (${(sim * 100).toFixed(0)}%) between "${descs[i].name}" and "${descs[j].name}"`,
          fix: 'Differentiate descriptions with distinct routing cues',
        });
      }
    }
  }
  return findings;
}

function detectMissingArgumentHints(skillNames) {
  // argument-hint check removed (Phase B — skills-only architecture)
  const argHintStatus = {};
  for (const skillName of skillNames) {
    argHintStatus[skillName] = null;
  }
  return { findings: [], argHintStatus };
}

function detectInvalidAgentRefs(skillResults, _agentsDir) {
  if (!isDir(_agentsDir)) {
    return {
      findings: [],
      skipped: [
        capabilitySkip(
          'agent-ref-validity',
          'Agents directory not found or not a directory'
        ),
      ],
    };
  }
  const readResult = safeReadDir(_agentsDir);
  if (!readResult.ok) {
    return {
      findings: [],
      skipped: [capabilitySkip('agent-ref-validity', `Agents directory could not be read (${readResult.error.code || 'filesystem error'})`)],
    };
  }
  const knownAgents = new Set(
    readResult.entries.filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md'))
  );
  const BUILTINS = new Set(['Explore', 'general-purpose', 'Plan']);
  const findings = [];
  // Intentionally requires quotes — bare/backtick forms in markdown tables are not code dispatch
  const refPattern = /subagent_type[:\s]*["']([^"']+)["']/g;
  const seen = new Set();

  for (const result of skillResults) {
    if (!result.body) continue;
    for (const m of result.body.matchAll(refPattern)) {
      const name = m[1];
      if (BUILTINS.has(name) || name.includes(':') || knownAgents.has(name)) continue;
      const key = `${result.name}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        check: 'agent-ref-validity',
        pass: false,
        severity: 'P1',
        message: `subagent_type "${name}" not found in agents/ (skill: ${result.name})`,
        fix: `Create agents/${name}.md or fix the reference`,
      });
    }
  }

  return { findings, skipped: [] };
}

function detectAgentToolsSyntax(_agentsDir) {
  if (!isDir(_agentsDir)) {
    return {
      findings: [],
      skipped: [
        capabilitySkip(
          'agent-tools-syntax',
          'Agents directory not found or not a directory'
        ),
      ],
    };
  }
  const CANONICAL_BARE = new Set([
    'Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'AskUserQuestion',
    'Agent', 'Task', 'Skill', 'WebSearch', 'WebFetch', 'NotebookEdit',
  ]);
  const SCOPED_RE = /^Bash\([a-z-]+:\*\)$/;
  // MCP tools are namespaced: mcp__<server>__<tool> (e.g. mcp__gitnexus__impact,
  // mcp__context7__resolve-library-id, mcp__claude_ai_Context7__query-docs).
  // Each segment may contain single underscores/hyphens but not the "__"
  // delimiter, so exactly two segments are accepted (no trailing __extra).
  const MCP_RE = /^mcp__[a-z0-9-]+(?:_[a-z0-9-]+)*__[a-z0-9-]+(?:_[a-z0-9-]+)*$/i;
  const findings = [];
  const nonInvocableDocs = new Set(['INDEX.md', 'README.md']);
  const readResult = safeReadDir(_agentsDir);
  if (!readResult.ok) {
    return {
      findings: [],
      skipped: [capabilitySkip('agent-tools-syntax', 'Agents directory could not be read')],
    };
  }
  for (const f of readResult.entries.filter((x) => x.endsWith('.md') && !nonInvocableDocs.has(x)).sort()) {
    const entry = readDiscoverableEntry(_agentsDir, f, 'agent');
    if (entry.finding) {
      findings.push(entry.finding);
      continue;
    }
    const content = entry.content;
    const missing = requiredFrontmatterFields(content, ['name', 'description']);
    if (missing.length > 0) {
      findings.push(invalidFrontmatterFinding('agent', f, missing));
      continue;
    }
    const fm = parseFrontmatter(content);
    if (!fm.tools) continue;
    const agentName = basename(f, '.md');
    const tools = String(fm.tools).split(/,\s*/);
    for (const t of tools) {
      const trimmed = t.trim();
      if (!trimmed) continue;
      if (CANONICAL_BARE.has(trimmed) || SCOPED_RE.test(trimmed) || MCP_RE.test(trimmed)) continue;
      findings.push({
        check: 'agent-tools-syntax',
        pass: false,
        severity: 'P2',
        message: `Agent "${agentName}" has non-canonical tool: "${trimmed}"`,
        fix: 'Use canonical format: ToolName or Bash(<prefix>:*)',
      });
    }
  }
  return { findings, skipped: [] };
}

function commandFilesForDir(_commandsDir) {
  if (!isDir(_commandsDir)) return { commandFiles: [], skipped: true };
  const nonInvocableDocs = new Set(['INDEX.md', 'README.md']);
  const readResult = safeReadDir(_commandsDir);
  if (!readResult.ok) return { commandFiles: [], skipped: true };
  return {
    commandFiles: readResult.entries
      .filter((f) => f.endsWith('.md') && !nonInvocableDocs.has(f))
      .sort(),
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function isDir(p) {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function main() {
  if (!isDir(skillsDir)) {
    console.error(`Skills directory not found or not a directory: ${skillsDir}`);
    process.exitCode = 2;
    return;
  }

  // Recursive discovery — finds nested skills (e.g. skills/gitnexus/<sub>/SKILL.md)
  const skillDirPaths = findSkillDirs(skillsDir);
  const skillNames = skillDirPaths.map((p) => basename(p));
  const skillResults = skillDirPaths.map((p) => lintSkill(basename(p), p, skillNames));
  const skillDirs = skillResults.map((r) => r.name);
  const { commandFiles, skipped: skippedCommands } = commandFilesForDir(commandsDir);
  const commandFrontmatterFindings = detectCommandFrontmatter(commandFiles, commandsDir);

  // Cross-skill checks
  const orphanFindings = detectOrphans(skillDirs, commandFiles);
  const overlapFindings = detectDescriptionOverlap(skillResults);
  const { findings: argHintFindings, argHintStatus } = detectMissingArgumentHints(skillDirs);
  const { findings: agentRefFindings, skipped: agentRefSkips } = detectInvalidAgentRefs(skillResults, agentsDir);
  const { findings: agentToolsSyntaxFindings, skipped: agentToolsSyntaxSkips } = detectAgentToolsSyntax(agentsDir);
  const capabilitySkips = [
    ...(skippedCommands
      ? [
          capabilitySkip(
            'orphan-command-skill-pairing',
            'Commands directory not found or not a directory'
          ),
        ]
      : []),
    ...agentRefSkips,
    ...agentToolsSyntaxSkips,
  ];

  // Aggregate
  const collectedFindings = [];
  let p0Count = 0;
  let p1Count = 0;
  let p2Count = 0;
  let passCount = 0;
  let warnCount = 0;

  for (const result of skillResults) {
    for (const f of result.findings) {
      if (f.pass) {
        passCount++;
        if (f.warning) warnCount++;
      } else {
        const skillPath = f.path || relative(skillsDir, result.path).split(sep).join('/');
        collectedFindings.push({ skill: result.name, path: skillPath, ...f });
      }
    }
  }

  const crossFindings = dedupeFindings([
    ...orphanFindings,
    ...overlapFindings,
    ...argHintFindings,
    ...agentRefFindings,
    ...agentToolsSyntaxFindings,
    ...commandFrontmatterFindings,
  ]);
  for (const f of crossFindings) {
    collectedFindings.push({ skill: '(cross-skill)', ...f });
  }

  const allFindings = dedupeFindings(collectedFindings);
  for (const f of allFindings) {
    if (f.severity === 'P0') p0Count++;
    else if (f.severity === 'P1') p1Count++;
    else p2Count++;
  }

  const overallPass = p0Count === 0 && p1Count === 0;
  const exitCode = p0Count > 0 || p1Count > 0 ? 2 : p2Count > 0 ? 1 : 0;

  // JSON output
  if (jsonOutput) {
    const report = {
      overallPass,
      stats: {
        skills: skillDirs.length,
        commands: commandFiles.length,
        skipped: capabilitySkips.length,
        checks: passCount + allFindings.length,
        pass: passCount,
        warnings: warnCount,
        p0: p0Count,
        p1: p1Count,
        p2: p2Count,
      },
      findings: allFindings,
      skipped: capabilitySkips,
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = exitCode;
    return;
  }

  // Markdown output
  console.log('# Skill Health Check Report\n');
  console.log('## Summary\n');
  console.log(`| Metric | Value |`);
  console.log(`|--------|-------|`);
  console.log(`| Skills scanned | ${skillDirs.length} |`);
  console.log(`| Commands scanned | ${commandFiles.length} |`);
  console.log(`| Capability checks skipped | ${capabilitySkips.length} |`);
  console.log(`| Checks passed | ${passCount} |`);
  console.log(`| P0 (Must Fix) | ${p0Count} |`);
  console.log(`| P1 (Should Fix) | ${p1Count} |`);
  console.log(`| P2 (Suggestion) | ${p2Count} |`);
  console.log();

  // Per-skill summary
  console.log('## Per-Skill Results\n');
  console.log('| Skill | Routing | When-NOT | Output | Verification | Refs | AgEnt | TskEnt | Lines | Status |');
  console.log('|-------|---------|----------|--------|--------------|------|-------|--------|-------|--------|');
  for (const result of skillResults) {
    const get = (check) => {
      const f = result.findings.find((x) => x.check === check);
      if (!f) return '—';
      return f.pass ? '✅' : f.severity === 'P0' ? '🔴' : f.severity === 'P1' ? '🟡' : '⚪';
    };
    const lineRead = result.path ? safeReadFile(result.path) : { ok: false };
    const lines = lineRead.ok ? countLines(lineRead.content) : 0;
    const issues = result.findings.filter((f) => !f.pass);
    const status = issues.length === 0 ? '✅' : issues.some((f) => f.severity === 'P0') ? '🔴' : issues.some((f) => f.severity === 'P1') ? '🟡' : '⚪';
    console.log(
      `| ${result.name} | ${get('routing-signature')} | ${get('when-not')} | ${get('output')} | ${get('verification')} | ${get('references-routing')} | ${get('agent-entitlement')} | ${get('task-entitlement')} | ${lines} | ${status} |`
    );
  }
  console.log();

  // Findings
  if (allFindings.length > 0) {
    const p0s = allFindings.filter((f) => f.severity === 'P0');
    const p1s = allFindings.filter((f) => f.severity === 'P1');
    const p2s = allFindings.filter((f) => f.severity === 'P2');

    if (p0s.length > 0) {
      console.log('## P0 (Must Fix)\n');
      for (const f of p0s) {
        console.log(`- **${f.skill}**: ${f.message}${fixHint && f.fix ? ` → ${f.fix}` : ''}`);
      }
      console.log();
    }
    if (p1s.length > 0) {
      console.log('## P1 (Should Fix)\n');
      for (const f of p1s) {
        console.log(`- **${f.skill}**: ${f.message}${fixHint && f.fix ? ` → ${f.fix}` : ''}`);
      }
      console.log();
    }
    if (p2s.length > 0) {
      console.log('## P2 (Suggestion)\n');
      for (const f of p2s) {
        console.log(`- **${f.skill}**: ${f.message}${fixHint && f.fix ? ` → ${f.fix}` : ''}`);
      }
      console.log();
    }
  }

  if (capabilitySkips.length > 0) {
    console.log('## Capability-Dependent Skips\n');
    for (const skip of capabilitySkips) {
      console.log(`- **${skip.check}**: ${skip.reason}`);
    }
    console.log();
  }

  // Gate
  console.log(`## Gate: ${overallPass ? '✅ All Pass' : `⛔ ${p0Count + p1Count} issues need fixing`}`);

  process.exitCode = exitCode;
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    argVal,
    bodyAfterFrontmatter,
    checkAgentEntitlement,
    checkCrossSkillRefPaths,
    checkFrontmatterExists,
    checkLineCount,
    checkOutputSection,
    checkReferencesRouting,
    checkRoutingSignature,
    checkScriptsContract,
    checkTaskEntitlement,
    checkVerificationSection,
    checkWhenNotSection,
    commandFilesForDir,
    scriptMentions,
    countLines,
    capabilitySkip,
    detectAgentToolsSyntax,
    detectDescriptionOverlap,
    detectInvalidAgentRefs,
    detectMissingArgumentHints,
    detectOrphans,
    escapeRegExp,
    findRefInOtherSkills,
    findSkillDirs,
    lintSkill,
    main,
    normalizeContent,
    parseFrontmatter,
    similarity,
    skillNameFromCommandContent,
  };
}
