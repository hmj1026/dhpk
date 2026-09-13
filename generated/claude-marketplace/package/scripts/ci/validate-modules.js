#!/usr/bin/env node
'use strict';

// Validate modules/*/module.yaml structure and cross-references.
//   FAIL: missing module.yaml; name missing or != directory name; a `requires:`
//         entry that points to a non-existent module (dependency-chain breakage
//         — dhpk-specific, the highest-value check here).
//   WARN: missing version / description / triggers; a `provides.skills` entry
//         that resolves to no skill directory. (FAIL under --strict.)
//
// module.yaml is simple, flat YAML; we parse only the fields we check with line
// regexes rather than pulling in a YAML dependency (zero-dep constraint).

const fs = require('fs');
const path = require('path');
const { createReporter } = require('./_lib/report');

const ROOT = path.join(__dirname, '..', '..');
const MODULES_DIR = path.join(ROOT, 'modules');

const r = createReporter('modules');

if (!fs.existsSync(MODULES_DIR)) {
  console.log('No modules/ directory — skipping.');
  process.exit(0);
}

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

function topScalar(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`^${escaped}:\\s*(.*)$`, 'm'));
  return m ? unquote(m[1]) : null;
}

function inlineArrayFrom(line) {
  if (!line) return [];
  const m = line.match(/\[(.*)\]/);
  if (!m) return [];
  return m[1].split(',').map(unquote).filter((s) => s.length > 0);
}

const moduleDirs = fs
  .readdirSync(MODULES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
const moduleSet = new Set(moduleDirs);

for (const id of moduleDirs) {
  const yamlPath = path.join(MODULES_DIR, id, 'module.yaml');
  if (!fs.existsSync(yamlPath)) {
    r.err(`${id} — missing module.yaml`);
    continue;
  }
  const text = fs.readFileSync(yamlPath, 'utf8');

  const name = topScalar(text, 'name');
  if (!name) r.err(`${id}/module.yaml — missing 'name'`);
  else if (name !== id) r.err(`${id}/module.yaml — name '${name}' != directory '${id}'`);

  if (!topScalar(text, 'version')) r.warn(`${id}/module.yaml — missing 'version'`);
  if (!topScalar(text, 'description')) r.warn(`${id}/module.yaml — missing 'description'`);

  // requires: top-level inline array — each must be an existing module.
  const requiresLine = text.match(/^requires:\s*(.*)$/m);
  for (const dep of inlineArrayFrom(requiresLine && requiresLine[1])) {
    if (!moduleSet.has(dep)) r.err(`${id}/module.yaml — requires non-existent module '${dep}'`);
  }

  // provides.skills: nested inline array — each should resolve to a skill dir,
  // either module-local (modules/<id>/skills/<name>) or a base skill.
  const skillsLine = text.match(/^\s+skills:\s*(.*)$/m);
  const providedSkills = inlineArrayFrom(skillsLine && skillsLine[1]);
  for (const skill of providedSkills) {
    const local = path.join(MODULES_DIR, id, 'skills', skill, 'SKILL.md');
    const base = path.join(ROOT, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(local) && !fs.existsSync(base)) {
      r.warn(`${id}/module.yaml — provides skill '${skill}' but no SKILL.md found`);
    }
  }

  // A module must do something: wire review triggers OR ship skills. triggers
  // is legitimately absent for skills-only modules (e.g. pytest).
  if (!/^triggers:/m.test(text) && providedSkills.length === 0) {
    r.warn(`${id}/module.yaml — no 'triggers' and no provided skills (module is a no-op?)`);
  }
}

r.done(`${moduleDirs.length} modules`);
