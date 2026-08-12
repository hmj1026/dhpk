'use strict';

// Canonical capability registry shared by reference-integrity validation and
// natural-language handoff checks. Directory names and frontmatter names are
// discovered from the checkout; aliases are deliberately small and explicit so
// a legacy spelling can never silently become a new capability.

const fs = require('node:fs');
const path = require('node:path');

const ALIASES = Object.freeze({
  'opsx-apply-goal': 'dhpk-opsx-apply-goal',
  'opsx-load-context': 'dhpk-opsx-load-context',
  'opsx-post-obs': 'dhpk-opsx-post-observation',
  'opsx-post-observation': 'dhpk-opsx-post-observation',
  'opsx-apply-resume': 'opsx-apply-resume',
  'next-step': 'dhpk-next-step',
  'risk-assess': 'dhpk-risk-assess',
  'compact-save': null,
});

const EXTERNAL_CAPABILITIES = Object.freeze(new Set([
  'openspec-apply-change',
  'openspec-new-change',
  'openspec-continue-change',
  'openspec-ff-change',
  'openspec-verify-change',
  'openspec-sync-specs',
  'openspec-archive-change',
  // OpenSpec's human-facing aliases are not shipped as local files, but they
  // are stable external capabilities used by the apply/resume handoff.
  'opsx-archive',
  'opsx-verify',
  'opsx-sync',
]));

function readFrontmatterName(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const match = text.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m);
    return match ? match[1].trim() : null;
  } catch (_) {
    return null;
  }
}

function listNames(root, folder, extension) {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (extension === 'skill' && entry.isDirectory()) {
      const file = path.join(dir, entry.name, 'SKILL.md');
      return fs.existsSync(file) ? [entry.name, readFrontmatterName(file)].filter(Boolean) : [];
    }
    if (extension === 'command' && entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md') {
      return [entry.name.slice(0, -3), readFrontmatterName(path.join(dir, entry.name))].filter(Boolean);
    }
    return [];
  });
}

function buildReferenceRegistry(root) {
  const canonical = new Set([
    ...listNames(root, 'skills', 'skill'),
    ...listNames(root, 'commands', 'command'),
    ...EXTERNAL_CAPABILITIES,
  ]);
  const aliasMap = new Map(Object.entries(ALIASES));
  for (const [alias, target] of aliasMap) {
    if (target && !canonical.has(target) && target !== alias) aliasMap.delete(alias);
  }
  return Object.freeze({ canonical, aliases: aliasMap });
}

function resolveReference(registry, name) {
  if (!registry || typeof name !== 'string') return null;
  const clean = name.replace(/^\$?dhpk:/, '').replace(/^\//, '').trim();
  if (registry.canonical.has(clean)) return { input: name, canonical: clean, kind: 'canonical' };
  if (registry.aliases.has(clean)) {
    const target = registry.aliases.get(clean);
    return target ? { input: name, canonical: target, kind: 'alias' } : null;
  }
  return null;
}

function extractNaturalLanguageReferences(text) {
  const refs = [];
  const lines = String(text || '').split('\n');
  const action = /\b(?:invoke|invoking|run|running|use|using|load|resume\s+with)\b/i;
  // This validator owns the opsx/registered-skill handoff vocabulary. Agent
  // role prose and programming identifiers are intentionally not inferred as
  // Skill/command references merely because they are backticked.
  const capabilityMarker = /(?:dhpk[-:]|opsx[-:]|openspec[-:])|(?:compact-save|missing-[a-z0-9-]+)/i;
  const generic = new Set(['skill', 'tool', 'command', 'workflow', 'capability', 'the', 'same', 'right']);
  lines.forEach((line, index) => {
    if (!action.test(line)) return;
    const seen = new Set();
    const add = (name, optional) => {
      const clean = String(name || '').replace(/^\//, '').replace(/^\$?dhpk:/, '').trim();
      if (!clean || generic.has(clean.toLowerCase()) || seen.has(clean)) return;
      seen.add(clean);
      refs.push({ name: clean, line: index + 1, optional: Boolean(optional) });
    };
    const optional = /\boptional(?:\s+capability|\s+provider)?\b/i.test(line);
    // Backticks alone are code/examples, not handoffs. Require a target-local
    // handoff cue or a capability-looking name so ordinary prose such as
    // "use `normal`" is not treated as routing.
    for (const match of line.matchAll(/`([a-z][a-z0-9-]{2,})`/gi)) {
      if (capabilityMarker.test(match[1]) || (optional && match[1] === 'compact-save')) {
        add(match[1], optional);
      }
    }
    for (const match of line.matchAll(/\bSkill\(\s*([a-z][a-z0-9-]{2,})\s*\)/gi)) add(match[1], optional);
    for (const match of line.matchAll(/\b(?:invoke|run|use|load)\s+(?:the\s+)?`?([a-z][a-z0-9-]{2,})`?(?=\s+(?:skill|command|workflow|capability|provider)\b)/gi)) {
      const target = match[1];
      if (capabilityMarker.test(target) || target === 'risk-assess' || target === 'next-step' || target === 'compact-save') {
        add(target, optional);
      }
    }
  });
  return refs;
}

module.exports = {
  ALIASES,
  EXTERNAL_CAPABILITIES,
  buildReferenceRegistry,
  resolveReference,
  extractNaturalLanguageReferences,
};
