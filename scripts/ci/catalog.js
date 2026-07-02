#!/usr/bin/env node
'use strict';

// Count SSOT for dhpk. Computes authoritative asset counts and enforces the
// EXACT numeric claims that appear in README.md / README.zh-TW.md / plugin.json
// / marketplace.json / rules/execution-policy.md / agents/INDEX.md, so those
// numbers never silently drift from reality.
//
//   node scripts/ci/catalog.js            print the count table
//   node scripts/ci/catalog.js --check    fail (exit 1) if any exact claim drifts
//   node scripts/ci/catalog.js --write    rewrite drifted exact claims in place
//
// Only claims phrased as an exact number are enforced ("24 role-based agents",
// "27 opt-in stack modules", "23 root-level agents", "24 個角色導向 agent",
// "7-slot"). Approximate claims ("~57 core skills", "~73 commands") are printed
// for awareness but not enforced — the `~` signals deliberate rounding.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const p = (...s) => path.join(ROOT, ...s);

function walk(dir, test) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp, test));
    else if (test(fp)) out.push(fp);
  }
  return out;
}

// Parse the sentinel-slot count from the SENTINEL_NAMES=(...) array in
// payload.sh — the single SSOT for review slots, so a "N-slot" claim can never
// diverge from the array. Returns 0 if the file/array is absent (test asserts > 0).
function slotCountFromPayload() {
  const fp = p('scripts', 'hooks', '_lib', 'payload.sh');
  if (!fs.existsSync(fp)) return 0;
  const m = fs.readFileSync(fp, 'utf8').match(/SENTINEL_NAMES=\(([^)]*)\)/);
  if (!m) return 0;
  return (m[1].match(/\.pending-[a-z-]+/g) || []).length;
}

function computeCounts() {
  const rootAgents = walk(p('agents'), (f) => f.endsWith('.md') && !f.endsWith('INDEX.md'));
  const moduleAgents = walk(p('modules'), (f) => /\/agents\/.+\.md$/.test(f));
  const baseSkills = walk(p('skills'), (f) => f.endsWith('SKILL.md'));
  const moduleSkills = walk(p('modules'), (f) => /\/skills\/.+\/SKILL\.md$/.test(f));
  const commands = walk(p('commands'), (f) => f.endsWith('.md') && !f.endsWith('INDEX.md'));
  const modules = fs.existsSync(p('modules'))
    ? fs.readdirSync(p('modules'), { withFileTypes: true }).filter((e) => e.isDirectory())
    : [];

  return {
    agentsTotal: rootAgents.length + moduleAgents.length,
    agentsRoot: rootAgents.length,
    agentsModule: moduleAgents.length,
    skillsTotal: baseSkills.length + moduleSkills.length,
    skillsBase: baseSkills.length,
    skillsModule: moduleSkills.length,
    commands: commands.length,
    modules: modules.length,
    slotCount: slotCountFromPayload(),
  };
}

// Files that carry numeric marketing/spec claims, and the exact claims enforced.
const CLAIM_FILES = [
  'README.md',
  'README.zh-TW.md',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'rules/execution-policy.md',
  'agents/INDEX.md',
];

function claimSpecs(counts) {
  return [
    { label: 'role-based agents', re: /(\d+)(\s+role-based agents)/g, expected: counts.agentsTotal },
    { label: 'opt-in stack modules', re: /(\d+)(\s+opt-in stack modules)/g, expected: counts.modules },
    { label: '個角色導向 agent (ZH total)', re: /(\d+)(\s*個角色導向 agent)/g, expected: counts.agentsTotal },
    { label: 'root-level agents', re: /(\d+)(\s+root-level agent)/g, expected: counts.agentsRoot },
    // `-slot` is intentionally broader than the phrase-anchored specs above: in these
    // claim files "N-slot" is reserved vocabulary for the sentinel review slots and appears
    // in several phrasings ("N-slot sentinel", "N-slot reviewer dispatch", "N-slot 預設 agent").
    // Anchoring to "-slot sentinel" would silently drop the non-"sentinel" phrasings from
    // enforcement — the drift this guard exists to catch. Keep it broad on purpose.
    { label: 'sentinel slots', re: /(\d+)(-slot)/g, expected: counts.slotCount },
  ];
}

function checkOrWrite({ write }) {
  const counts = computeCounts();
  const specs = claimSpecs(counts);
  let mismatches = 0;
  let rewrites = 0;

  for (const rel of CLAIM_FILES) {
    const fp = p(rel);
    if (!fs.existsSync(fp)) continue;
    const original = fs.readFileSync(fp, 'utf8');
    let text = original;

    for (const spec of specs) {
      let m;
      const re = new RegExp(spec.re.source, 'g');
      while ((m = re.exec(text)) !== null) {
        const found = Number(m[1]);
        if (found !== spec.expected) {
          mismatches += 1;
          console[write ? 'log' : 'error'](
            `${write ? 'FIX' : 'DRIFT'} ${rel}: "${m[0].trim()}" -> expected ${spec.expected} ${spec.label}`
          );
        }
      }
      if (write) {
        const replaced = text.replace(
          new RegExp(spec.re.source, 'g'),
          `${spec.expected}$2`
        );
        if (replaced !== text) {
          text = replaced;
          rewrites += 1;
        }
      }
    }
    if (write && text !== original) fs.writeFileSync(fp, text);
  }

  if (write) {
    console.log(`catalog --write: updated ${rewrites} claim group(s).`);
    return 0;
  }
  if (mismatches > 0) {
    console.error(`FAIL [catalog]: ${mismatches} exact claim(s) drifted from reality.`);
    return 1;
  }
  console.log('PASS [catalog]: all exact numeric claims match reality.');
  return 0;
}

function printTable() {
  const c = computeCounts();
  console.log('dhpk catalog:');
  console.log(`  agents:   ${c.agentsTotal}  (root ${c.agentsRoot} + module ${c.agentsModule})`);
  console.log(`  skills:   ${c.skillsTotal}  (base ${c.skillsBase} + module ${c.skillsModule})`);
  console.log(`  commands: ${c.commands}`);
  console.log(`  modules:  ${c.modules}`);
  console.log(`  slots:    ${c.slotCount}  (sentinel review slots from payload.sh)`);
}

const args = process.argv.slice(2);
if (args.includes('--check')) process.exit(checkOrWrite({ write: false }));
else if (args.includes('--write')) process.exit(checkOrWrite({ write: true }));
else printTable();
