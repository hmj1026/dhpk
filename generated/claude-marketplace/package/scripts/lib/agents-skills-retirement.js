'use strict';

const path = require('node:path');
const { createTraversalBudget, readDirectoryEntries } = require('./bounded-filesystem');

// Plan only. The compatibility publisher owns all mutations and recovery.
function planRetiredAgentSkills(options) {
  const { inventory, previous, selected, outputRoot, safeName, assertSafeRelative,
    pathInOutput, lstatOrNull, digest, treeFingerprint } = options;
  const ids = new Set();
  const paths = new Set();
  const activeIds = new Set(selected.map((entry) => entry.id));
  const activeNames = new Set(selected.map((entry) => entry.name));
  const fail = (name, reason) => { throw new Error(`retirement conflict/orphan for ${name}: ${reason}`); };

  for (const retired of inventory.retired_skills || []) {
    safeName(retired.name, 'retired skill name');
    if (activeIds.has(retired.id) || activeNames.has(retired.name)) {
      fail(retired.name, 'retirement ledger overlaps active selection');
    }
    const candidates = (previous ? previous.entries : []).filter((entry) => (
      entry.id === retired.id || entry.name === retired.name || entry.source === retired.canonicalPath
    ));
    if (!candidates.length) {
      if (lstatOrNull(pathInOutput(outputRoot, retired.name)) ||
          lstatOrNull(pathInOutput(outputRoot, `${retired.name}.md`))) {
        fail(retired.name, 'installed output lacks receipt ownership');
      }
      continue;
    }
    const entry = candidates[0];
    if (candidates.length !== 1 || entry.id !== retired.id || entry.name !== retired.name ||
        retired.canonicalPath !== `skills/${retired.name}` || entry.source !== retired.canonicalPath ||
        entry.cursorPath !== `${entry.name}/SKILL.md` || entry.agyPath !== `${entry.name}.md`) {
      fail(retired.name, 'ledger identity/canonical mapping mismatch');
    }
    if (ids.has(entry.id)) fail(entry.name, 'ambiguous duplicate retirement ledger');
    if (!Array.isArray(entry.sourceFiles) || !entry.sourceFiles.length) {
      fail(entry.name, 'missing complete receipt source manifest');
    }
    const manifest = new Map();
    for (const file of entry.sourceFiles) {
      if (!file || typeof file.path !== 'string' || !/^[a-f0-9]{64}$/.test(file.digest)) {
        fail(entry.name, 'invalid receipt source manifest');
      }
      assertSafeRelative(file.path, 'retired receipt source path');
      if (manifest.has(file.path)) fail(entry.name, 'duplicate receipt source path');
      manifest.set(file.path, file.digest);
    }
    if (!manifest.has('SKILL.md')) fail(entry.name, 'missing complete receipt source manifest');
    const expected = new Set([`${entry.name}.md`, ...[...manifest.keys()].map((file) => `${entry.name}/${file}`)]);
    const recorded = previous.managedPaths.filter((file) => file === `${entry.name}.md` || file.startsWith(`${entry.name}/`));
    if (recorded.length !== expected.size || recorded.some((file) => !expected.has(file))) {
      fail(entry.name, 'receipt managed paths do not match complete source manifest');
    }
    const budget = createTraversalBudget();
    const observed = new Set();
    const physicalFiles = [];
    function walk(directory, relative = '', depth = 0) {
      const stat = lstatOrNull(directory);
      if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) fail(entry.name, 'missing or symlinked retired directory');
      const realDirectory = budget.enterDirectory(directory, depth);
      try {
        for (const child of readDirectoryEntries(directory, { budget, sort: true })) {
          const childRelative = relative ? `${relative}/${child.name}` : child.name;
          const absolute = path.join(directory, child.name);
          const childStat = lstatOrNull(absolute);
          if (!childStat || childStat.isSymbolicLink()) fail(entry.name, `symlink/retargeted output: ${childRelative}`);
          if (childStat.isDirectory()) {
            if (![...manifest.keys()].some((file) => file.startsWith(`${childRelative}/`))) {
              fail(entry.name, `unrecorded directory: ${childRelative}`);
            }
            walk(absolute, childRelative, depth + 1);
          } else {
            if (!childStat.isFile() || !manifest.has(childRelative)) fail(entry.name, `unrecorded/unowned output: ${childRelative}`);
            const content = budget.readFile(absolute, childStat, childRelative);
            const fingerprint = digest(content);
            if (fingerprint !== manifest.get(childRelative) ||
                fingerprint !== previous.generatedFingerprints[`${entry.name}/${childRelative}`]) {
              fail(entry.name, `modified fingerprint: ${childRelative}`);
            }
            observed.add(childRelative);
            physicalFiles.push({ relative: childRelative, absolute });
          }
        }
      } finally {
        budget.leaveDirectory(realDirectory);
      }
    }
    walk(pathInOutput(outputRoot, entry.name));
    if (observed.size !== manifest.size) fail(entry.name, 'missing receipt-owned retired output');
    const shim = pathInOutput(outputRoot, `${entry.name}.md`);
    const shimStat = lstatOrNull(shim);
    if (!shimStat || !shimStat.isFile() || shimStat.isSymbolicLink()) fail(entry.name, 'missing or symlinked retired shim');
    if (digest(budget.readFile(shim, shimStat, entry.agyPath)) !== previous.generatedFingerprints[entry.agyPath]) {
      fail(entry.name, 'modified retired shim fingerprint');
    }
    physicalFiles.sort((left, right) => left.relative.localeCompare(right.relative));
    if (treeFingerprint(physicalFiles, createTraversalBudget()) !== entry.sourceFingerprint) {
      fail(entry.name, 'source fingerprint mismatch');
    }
    ids.add(entry.id);
    for (const file of expected) paths.add(file);
  }
  return { ids, paths };
}

module.exports = { planRetiredAgentSkills };
