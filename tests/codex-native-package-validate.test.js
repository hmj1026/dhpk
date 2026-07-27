'use strict';

// RED (task 3.1, curate-dhpk-distribution-surfaces): scripts/lib/codex-native-package.js
// does not exist yet. Reproduces GitHub issue #88's exact failure shape as static,
// pre-install checks: a parent-relative manifest `skills` field (the marketplace
// wrapper's actual bug — `plugins/dhpk/.codex-plugin/plugin.json` resolves
// `../../codex/skills/`, escaping its own package directory) and a same-directory
// field whose package tree still contains a symlink (the native manifest's actual
// bug — `codex/skills/*` symlinks back to `../../skills/<name>`, which a clean
// marketplace cache install does not preserve). Both must be rejected BEFORE a
// candidate is ever staged for install, distinguishing static/repo-local manifest
// resolution (these checks) from installed-cache materialization proof (task 3.3).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test, run, assert } = require('./_lib/tinytest');
const { validateNativeCandidate } = require('../scripts/lib/codex-native-package');

function makeTempPackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-candidate-'));
  fs.mkdirSync(path.join(dir, 'skills', 'hello-skill'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'hello-skill', 'SKILL.md'), '---\nname: hello-skill\n---\n');
  return dir;
}

test('rejects a parent-relative manifest skills field (the wrapper bug: ../../codex/skills/)', () => {
  const dir = makeTempPackage();
  try {
    const result = validateNativeCandidate({ manifestSkillsField: '../../codex/skills/', packageRoot: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => /parent-relative/i.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an absolute manifest skills field escaping the package root', () => {
  const dir = makeTempPackage();
  try {
    const result = validateNativeCandidate({ manifestSkillsField: '/etc/skills/', packageRoot: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => /escapes|parent-relative|absolute/i.test(e)), result.errors.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a same-directory candidate that still contains a symlink (the native mirror bug)', () => {
  const dir = makeTempPackage();
  try {
    // Reproduce the real bug shape: a skill entry that is a symlink back out of
    // the package, exactly like codex/skills/tdd -> ../../skills/tdd today.
    fs.mkdirSync(path.join(dir, 'canonical-elsewhere', 'tdd'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'canonical-elsewhere', 'tdd', 'SKILL.md'), '---\nname: tdd\n---\n');
    fs.symlinkSync(path.join('..', '..', 'canonical-elsewhere', 'tdd'), path.join(dir, 'skills', 'tdd'));

    const result = validateNativeCandidate({ manifestSkillsField: './skills/', packageRoot: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => /symlink/i.test(e) && /tdd/.test(e)), result.errors.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a same-directory candidate whose package tree is entirely physical files', () => {
  const dir = makeTempPackage();
  try {
    const result = validateNativeCandidate({ manifestSkillsField: './skills/', packageRoot: dir });
    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.ok);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('codex-native-package-validate');
