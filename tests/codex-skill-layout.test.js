'use strict';

// Keep the Codex mirror single-sourced: common skills must point at the
// canonical root skill, while only module mirrors remain explicit physical
// directories.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const ROOT_SKILLS = path.join(ROOT, 'skills');
const CODEX_SKILLS = path.join(ROOT, 'codex', 'skills');
const PHYSICAL_SKILLS = new Set([
  'legacy-code-characterization',
  'php-pro',
  'php56-yii-dev',
  'yii1-security-audit',
]);

function directoryEntries(dir) {
  return fs.readdirSync(dir).filter((name) => {
    const entry = path.join(dir, name);
    return fs.lstatSync(entry).isDirectory() || fs.lstatSync(entry).isSymbolicLink();
  });
}

test('every non-physical Codex skill uses the root canonical skill', () => {
  const rootNames = new Set(directoryEntries(ROOT_SKILLS));

  for (const name of directoryEntries(CODEX_SKILLS)) {
    if (PHYSICAL_SKILLS.has(name) || !rootNames.has(name)) continue;

    const codexEntry = path.join(CODEX_SKILLS, name);
    const canonicalEntry = path.join(ROOT_SKILLS, name);
    assert.ok(fs.lstatSync(codexEntry).isSymbolicLink(), `${name} must be a symlink`);
    assert.strictEqual(fs.realpathSync(codexEntry), fs.realpathSync(canonicalEntry));
  }
});

test('physical Codex skills stay limited to documented module mirrors', () => {
  const physicalNames = directoryEntries(CODEX_SKILLS)
    .filter((name) => !fs.lstatSync(path.join(CODEX_SKILLS, name)).isSymbolicLink())
    .sort();

  assert.deepStrictEqual(physicalNames, [...PHYSICAL_SKILLS].sort());
});

test('Codex plugin README reports the actual mirror entry count', () => {
  const count = directoryEntries(CODEX_SKILLS).length;
  const readme = fs.readFileSync(path.join(ROOT, '.codex-plugin', 'README.md'), 'utf8');
  assert.match(readme, new RegExp('`codex/skills/` mirror \\(' + count + ' entries\\)'));
});

run('codex-skill-layout');
