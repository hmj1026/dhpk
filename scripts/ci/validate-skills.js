#!/usr/bin/env node
'use strict';

// Validate skills/ — recursively discovers every SKILL.md (handles category
// containers like skills/gitnexus/ that nest multiple skills) and checks:
//   FAIL: a top-level skills/<x>/ that is neither a skill (has SKILL.md) nor a
//         container (descendants have SKILL.md); empty SKILL.md.
//   WARN: SKILL.md missing 'name'; description uses a literal block scalar (|)
//         which breaks flat-table renderers. (FAIL under --strict.)

const fs = require('fs');
const path = require('path');
const { extract, isEmpty } = require('./_lib/frontmatter');
const { createReporter } = require('./_lib/report');

const ROOT = path.join(__dirname, '..', '..');
const SKILLS_DIR = path.join(ROOT, 'skills');

const r = createReporter('skills');

if (!fs.existsSync(SKILLS_DIR)) {
  console.log('No skills/ directory — skipping.');
  process.exit(0);
}

const rel = (p) => path.relative(ROOT, p);

function hasDescendantSkill(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const child = path.join(dir, e.name);
    if (fs.existsSync(path.join(child, 'SKILL.md'))) return true;
    if (hasDescendantSkill(child)) return true;
  }
  return false;
}

function validateSkillMd(dir) {
  const skillMd = path.join(dir, 'SKILL.md');
  const content = fs.readFileSync(skillMd, 'utf8');
  if (content.trim().length === 0) {
    r.err(`${rel(skillMd)} — empty file`);
    return;
  }
  const fm = extract(content);
  if (!fm.present) return; // SKILL.md without frontmatter is allowed
  if (isEmpty(fm.values.name)) r.warn(`${rel(skillMd)} — frontmatter missing 'name'`);
  if (fm.descriptionIndicator && fm.descriptionIndicator.startsWith('|')) {
    r.warn(
      `${rel(skillMd)} — description uses literal block scalar '${fm.descriptionIndicator}'; ` +
        `use an inline or folded '>' scalar`
    );
  }
}

// Walk every SKILL.md anywhere under skills/ and validate its frontmatter.
let skillCount = 0;
(function walk(dir) {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    skillCount += 1;
    validateSkillMd(dir);
    return; // a leaf skill's subdirs (references/, scripts/...) are not skills
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.')) walk(path.join(dir, e.name));
  }
})(SKILLS_DIR);

// Orphan check: each immediate child of skills/ must be a skill or a container.
for (const e of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  const dir = path.join(SKILLS_DIR, e.name);
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
  if (!hasDescendantSkill(dir)) r.err(`${rel(dir)}/ — no SKILL.md and no nested skills`);
}

r.done(`${skillCount} skills`);
