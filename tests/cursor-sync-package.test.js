'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  selectCursorSyncSkills,
  materializeCursorSyncTree,
  validateCursorSyncTree,
} = require('../scripts/lib/cursor-sync-package');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('declared empty cursor-sync membership does not fall back to agent-plugin', () => {
  const selected = selectCursorSyncSkills({
    skills: [
      {
        id: 'portable',
        name: 'dhpk-portable',
        path: 'skills/dhpk-portable',
        lifecycle: 'promoted',
        surfaces: ['agent-plugin'],
      },
    ],
    surface_membership: { 'cursor-sync': [] },
  });
  assert.deepStrictEqual(selected, []);
});

test('missing cursor-sync membership falls back to agent-plugin skills', () => {
  const selected = selectCursorSyncSkills({
    skills: [
      {
        id: 'portable',
        name: 'dhpk-portable',
        path: 'skills/dhpk-portable',
        lifecycle: 'promoted',
        surfaces: ['agent-plugin'],
      },
    ],
  });
  assert.strictEqual(selected.length, 1);
  assert.strictEqual(selected[0].id, 'portable');
});

test('cursor-sync validator rejects a missing skills tree and native hooks.json', () => {
  const out = tmpDir('dhpk-cursor-sync-validate-');
  try {
    fs.mkdirSync(path.join(out, 'agents'), { recursive: true });
    const missingSkills = validateCursorSyncTree({
      root: out,
      outDir: out,
      inventory: { skills: [], surface_membership: { 'cursor-sync': [] } },
    });
    assert.strictEqual(missingSkills.ok, false);
    assert.ok(missingSkills.errors.some((error) => /cursor\/skills is missing/.test(error)));

    fs.mkdirSync(path.join(out, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(out, 'hooks.json'), '{}\n');
    const withHooks = validateCursorSyncTree({
      root: out,
      outDir: out,
      inventory: { skills: [], surface_membership: { 'cursor-sync': [] } },
    });
    assert.strictEqual(withHooks.ok, false);
    assert.ok(withHooks.errors.some((error) => /hooks\.json/.test(error)));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('cursor-sync generator refuses output that overlaps canonical source trees', () => {
  const root = tmpDir('dhpk-cursor-sync-overlap-');
  try {
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    assert.throws(
      () => materializeCursorSyncTree({
        inventory: { skills: [], surface_membership: { 'cursor-sync': [] } },
        root,
        outDir: path.join(root, 'skills'),
      }),
      /overlaps canonical source tree/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('cursor-sync-package');
