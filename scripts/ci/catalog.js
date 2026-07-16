#!/usr/bin/env node
'use strict';

// Count SSOT for dhpk. Computes authoritative asset counts and enforces the
// EXACT numeric claims that appear in README.md / README.zh-TW.md / plugin.json
// / marketplace.json / rules/execution-policy.md / agents/INDEX.md / commands/do.md,
// so those numbers never silently drift from reality.
//
//   node scripts/ci/catalog.js            print the count table
//   node scripts/ci/catalog.js --check    fail (exit 1) if any exact claim drifts
//                                          or any script lacks a dedicated test
//   node scripts/ci/catalog.js --check all  same as --check (the trailing `all`
//                                          arg is accepted for callers that pass it)
//   node scripts/ci/catalog.js --write    rewrite drifted exact claims in place
//                                          (coverage is report-only, never auto-fixed)
//
// Only claims phrased as an exact number are enforced ("24 role-based agents",
// "27 opt-in stack modules", "23 root-level agents", "24 個角色導向 agent",
// "7-slot", "5 MCP-backed `codex-*` skills", "7 `/dhpk:codex-*` commands",
// "45 commands", "10 events" / "10 個事件"). Command count and hook-event count
// are now exact and enforced (previously "~73 commands" was an unenforced
// approximate claim). Other approximate claims ("~57 core skills") are printed
// for awareness but not enforced — the `~` signals deliberate rounding.

const fs = require('fs');
const path = require('path');
const { collectInventory, walkFiles } = require('../lib/asset-inventory');

const ROOT = path.join(__dirname, '..', '..');
const p = (...s) => path.join(ROOT, ...s);

function computeCounts() {
  return collectInventory(ROOT).counts;
}

// Files that carry numeric marketing/spec claims, and the exact claims enforced.
const CLAIM_FILES = [
  'README.md',
  'README.zh-TW.md',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'rules/execution-policy.md',
  'agents/INDEX.md',
  'commands/do.md',
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
    // Codex surface counts. Anchored to the full README phrasings so the table's
    // bare "5 skills" / "7 commands" cells and the "~51 other skills" approx are
    // never matched — only the prerequisite-row claims that spell out the surface.
    { label: 'MCP-backed codex skills (EN)', re: /(\d+)(\s+MCP-backed `codex-\*` skills)/g, expected: counts.mcpCodexSkills },
    { label: 'codex commands (EN)', re: /(\d+)(\s+`\/dhpk:codex-\*` commands)/g, expected: counts.codexCommands },
    { label: 'MCP-backed codex skills (ZH)', re: /(\d+)(\s*個 MCP-backed `codex-\*` skill)/g, expected: counts.mcpCodexSkills },
    { label: 'codex commands (ZH)', re: /(\d+)(\s*個 `\/dhpk:codex-\*` 指令)/g, expected: counts.codexCommands },
    { label: 'commands (do.md)', re: /(?<=dhpk's )(\d+)(\s+commands)/g, expected: counts.commands },
    { label: 'hook events (EN)', re: /(\d+)(\s+events)/g, expected: counts.hookEvents },
    { label: 'hook events (ZH)', re: /(\d+)(\s*個事件)/g, expected: counts.hookEvents },
  ];
}

// Explicit stem -> test-file overrides for scripts whose dedicated test uses a
// feature name rather than a name/name-aspect derived from the script's own
// basename (so the naming-convention check below can't find them automatically).
const COVERAGE_MAP = {
  'scripts/hooks/_lib/payload.sh': 'sentinel-slots.test.js',
  'scripts/ci/catalog.js': 'catalog-claims.test.js',
  'scripts/ci/_lib/report.js': 'ci-report.test.js',
  'scripts/codemaps/generate.ts': 'codemaps-generate.test.js',
  'scripts/hooks/pretool-git-gate.sh': 'pretool-branch-safety-dedup.test.js',
  'scripts/validate/test-hooks.sh': 'validate-test-hooks.test.js',
};

const SCRIPT_EXTS = new Set(['.sh', '.js', '.ts', '.py']);

// Every *.sh/*.js/*.ts/*.py under scripts/ (data files like .json excluded) must
// have a dedicated test: tests/<stem>.test.js, tests/<stem>-<aspect>.test.js, or
// an explicit COVERAGE_MAP entry for feature-named tests. Pure fs walk, no deps.
function findScriptCoverageGaps() {
  const scriptFiles = walkFiles(p('scripts'), (fp) => SCRIPT_EXTS.has(path.extname(fp)));
  const testsDir = p('tests');
  const testFiles = fs.existsSync(testsDir)
    ? fs.readdirSync(testsDir).filter((n) => n.endsWith('.test.js'))
    : [];
  const testFileSet = new Set(testFiles);

  const uncovered = [];
  for (const fp of scriptFiles) {
    const rel = path.relative(ROOT, fp).split(path.sep).join('/');
    const stem = path.basename(fp, path.extname(fp));
    const mapped = COVERAGE_MAP[rel];
    const covered =
      (mapped && testFileSet.has(mapped)) ||
      testFileSet.has(`${stem}.test.js`) ||
      testFiles.some((n) => n.startsWith(`${stem}-`));
    if (!covered) uncovered.push(rel);
  }
  return uncovered;
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

  // Coverage is report-only: --write never touches test files, so it's only
  // evaluated on the --check path.
  const uncovered = findScriptCoverageGaps();
  for (const rel of uncovered) {
    const stem = path.basename(rel, path.extname(rel));
    console.error(`UNCOVERED ${rel}: no dedicated tests/${stem}*.test.js`);
  }

  if (mismatches > 0 || uncovered.length > 0) {
    if (mismatches > 0) {
      console.error(`FAIL [catalog]: ${mismatches} exact claim(s) drifted from reality.`);
    }
    if (uncovered.length > 0) {
      console.error(`FAIL [catalog]: ${uncovered.length} script(s) lack a dedicated test.`);
    }
    return 1;
  }
  console.log(
    `PASS [catalog]: all exact numeric claims match reality; all scripts have dedicated tests (0 uncovered).`
  );
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
  console.log(`  codex:    ${c.mcpCodexSkills} MCP-backed skills + ${c.codexCommands} commands`);
  console.log(`  hooks:    ${c.hookEvents} events (hooks/hooks.json)`);
}

const args = process.argv.slice(2);
if (args.includes('--check')) process.exit(checkOrWrite({ write: false }));
else if (args.includes('--write')) process.exit(checkOrWrite({ write: true }));
else printTable();
