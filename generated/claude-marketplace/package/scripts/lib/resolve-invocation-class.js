#!/usr/bin/env node
'use strict';

// Resolve one routed target from canonical command/skill frontmatter or a
// shipped agent entry. This is intentionally a fail-closed CLI seam for shell
// hooks: no output means the target is missing, malformed, or unclassified.

const fs = require('node:fs');
const path = require('node:path');
const { extractInvocationClass, KNOWN_INVOCATION_CLASSES } = require('../ci/_lib/frontmatter');

function isContainedPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function canonicalDirectoryUnder(parent, candidate) {
  try {
    const canonical = fs.realpathSync(candidate);
    if (!fs.statSync(canonical).isDirectory()) return null;
    if (parent && !isContainedPath(parent, canonical)) return null;
    return canonical;
  } catch (_error) {
    return null;
  }
}

function canonicalRegularFileUnder(pluginRoot, assetRoot, candidate) {
  try {
    const canonical = fs.realpathSync(candidate);
    if (!fs.statSync(canonical).isFile()) return null;
    if (!isContainedPath(pluginRoot, canonical) || !isContainedPath(assetRoot, canonical)) return null;
    return canonical;
  } catch (_error) {
    return null;
  }
}

function resolveInvocationClass(root, rawTarget) {
  const pluginRoot = canonicalDirectoryUnder(null, root);
  if (!pluginRoot) return null;

  const target = String(rawTarget || '').trim();
  const agentMatch = target.match(/^agent:(.*)$/);
  if (agentMatch) {
    const agentName = agentMatch[1];
    if (!/^[a-z0-9][a-z0-9-]*$/.test(agentName)) return null;

    const agentRoots = [
      [path.join(pluginRoot, 'agents'), '.md'],
      [path.join(pluginRoot, 'codex', 'agents'), '.toml'],
    ];
    for (const [rootPath, extension] of agentRoots) {
      const assetRoot = canonicalDirectoryUnder(pluginRoot, rootPath);
      if (!assetRoot) continue;
      const candidate = canonicalRegularFileUnder(
        pluginRoot,
        assetRoot,
        path.join(rootPath, `${agentName}${extension}`),
      );
      if (candidate) return 'agent';
    }
    return null;
  }

  const bareTarget = target.replace(/^dhpk:/, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(bareTarget)) return null;

  const assetCandidates = [
    [path.join(pluginRoot, 'skills'), path.join(pluginRoot, 'skills', bareTarget, 'SKILL.md')],
    [path.join(pluginRoot, 'commands'), path.join(pluginRoot, 'commands', `${bareTarget}.md`)],
  ];
  let entry = null;
  for (const [rootPath, candidatePath] of assetCandidates) {
    const assetRoot = canonicalDirectoryUnder(pluginRoot, rootPath);
    if (!assetRoot) continue;
    entry = canonicalRegularFileUnder(pluginRoot, assetRoot, candidatePath);
    if (entry) break;
  }
  if (!entry) return null;

  try {
    const invocation = extractInvocationClass(fs.readFileSync(entry, 'utf8'));
    if (invocation.dottedSubstitute || !invocation.present || invocation.unknownValue
        || !KNOWN_INVOCATION_CLASSES.has(invocation.value)) return null;
    return invocation.value;
  } catch (_error) {
    return null;
  }
}

if (require.main === module) {
  const root = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
  const value = resolveInvocationClass(root, process.argv[2]);
  if (value) process.stdout.write(`${value}\n`);
  else process.exitCode = 1;
}

module.exports = { resolveInvocationClass };
