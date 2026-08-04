#!/usr/bin/env node
'use strict';

// Resolve one routed target from its canonical command/skill frontmatter.
// This is intentionally a fail-closed CLI seam for shell hooks: no output means
// the target is missing, malformed, or unclassified.

const fs = require('node:fs');
const path = require('node:path');
const { extractInvocationClass, KNOWN_INVOCATION_CLASSES } = require('../ci/_lib/frontmatter');

function resolveInvocationClass(root, rawTarget) {
  const bareTarget = String(rawTarget || '').trim().replace(/^dhpk:/, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(bareTarget)) return null;

  const candidates = [
    path.join(root, 'skills', bareTarget, 'SKILL.md'),
    path.join(root, 'commands', `${bareTarget}.md`),
  ];
  const entry = candidates.find((file) => fs.existsSync(file));
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
