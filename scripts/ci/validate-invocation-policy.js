#!/usr/bin/env node
'use strict';

// Validate metadata.dhpk-invocation-class on every Distributed Skill and
// Distributed Command (openspec/changes/clarify-dhpk-skill-invocation-policy).
//   FAIL: missing/unknown class, dotted top-level substitute, `user-invocable:
//         false` on any distributed entry, an unpaired command missing its
//         own class, a paired command whose class conflicts with its skill.
// No inference or defaulting: every entry must carry a reviewed value.

const fs = require('fs');
const path = require('path');
const { collectInventory, relativePosix } = require('../lib/asset-inventory');
const { extract, extractInvocationClass, isEmpty } = require('./_lib/frontmatter');
const { createReporter } = require('./_lib/report');

const ROOT = path.join(__dirname, '..', '..');
const r = createReporter('invocation-policy');

function skillName(skillFile) {
  const fm = extract(fs.readFileSync(skillFile, 'utf8'));
  return isEmpty(fm.values.name) ? null : fm.values.name.replace(/^(['"])(.*)\1$/, '$2').trim();
}

function checkEntry(rel, content, reporter) {
  const fm = extract(content);
  if (fm.values['user-invocable'] === 'false') {
    reporter.err(`${rel} — 'user-invocable: false' is rejected; every distributed entry stays human-invocable`);
  }
  const ic = extractInvocationClass(content);
  if (ic.dottedSubstitute) {
    reporter.err(`${rel} — dotted top-level 'metadata.dhpk-invocation-class' key is not the canonical nested shape (expected 'metadata:' / '  dhpk-invocation-class: ...')`);
  }
  return ic;
}

function main(root) {
  const inventory = collectInventory(root);
  const reporter = { errors: [], warnings: [], err(m) { this.errors.push(m); }, warn(m) { this.warnings.push(m); } };

  const skillClassByName = new Map();
  for (const skillFile of inventory.paths.skills) {
    const rel = relativePosix(root, skillFile);
    const content = fs.readFileSync(skillFile, 'utf8');
    const ic = checkEntry(rel, content, reporter);
    const name = skillName(skillFile);
    if (!ic.present && !ic.dottedSubstitute) {
      reporter.err(`${rel} — missing metadata.dhpk-invocation-class`);
    } else if (ic.unknownValue) {
      reporter.err(`${rel} — unknown metadata.dhpk-invocation-class value '${ic.value}' (expected explicit-only or implicit-eligible)`);
    } else if (ic.present && name) {
      skillClassByName.set(name, { class: ic.value, path: rel });
    }
  }

  for (const cmdFile of inventory.paths.commands) {
    const rel = relativePosix(root, cmdFile);
    const content = fs.readFileSync(cmdFile, 'utf8');
    const ic = checkEntry(rel, content, reporter);
    const base = path.basename(rel, '.md');
    const paired = skillClassByName.get(base);

    if (paired) {
      // Paired command: inherits the skill's class. If it also declares its
      // own, it must be a known value and must agree — never a fabricated
      // Codex-parity requirement here, just the Claude-visible class itself.
      if (ic.present && ic.unknownValue) {
        reporter.err(`${rel} — unknown metadata.dhpk-invocation-class value '${ic.value}' (expected explicit-only or implicit-eligible)`);
      } else if (ic.present && !ic.unknownValue && ic.value !== paired.class) {
        reporter.err(`${rel} — paired command declares '${ic.value}' but its skill ${paired.path} is '${paired.class}'`);
      }
      continue;
    }

    // Unpaired command: owns its class outright.
    if (!ic.present && !ic.dottedSubstitute) {
      reporter.err(`${rel} — unpaired command missing metadata.dhpk-invocation-class`);
    } else if (ic.unknownValue) {
      reporter.err(`${rel} — unknown metadata.dhpk-invocation-class value '${ic.value}' (expected explicit-only or implicit-eligible)`);
    }
  }

  return reporter;
}

if (require.main === module) {
  const result = main(ROOT);
  for (const w of result.warnings) r.warn(w);
  for (const e of result.errors) r.err(e);
  r.done(`invocation-class checked across skills + commands`);
}

module.exports = { main };
