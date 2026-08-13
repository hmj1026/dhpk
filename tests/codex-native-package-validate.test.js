'use strict';

// Phase 4 characterization: reproduce GitHub issue #88's exact failure shape as
// static, pre-install checks: a parent-relative manifest `skills` field (the marketplace
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
const {
  validateNativeCandidate,
  validateNativeMembership,
  verifyNativePackage,
} = require('../scripts/lib/codex-native-package');

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
    // the package, exactly like codex/skills/dhpk-tdd-workflow -> ../../skills/dhpk-tdd-workflow today.
    fs.mkdirSync(path.join(dir, 'canonical-elsewhere', 'tdd'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'canonical-elsewhere', 'tdd', 'SKILL.md'), '---\nname: tdd\n---\n');
    fs.symlinkSync(path.join('..', '..', 'canonical-elsewhere', 'tdd'), path.join(dir, 'skills', 'dhpk-tdd-workflow'));

    const result = validateNativeCandidate({ manifestSkillsField: './skills/', packageRoot: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => /symlink/i.test(e) && /tdd/.test(e)), result.errors.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a symlinked skills root even when its lexical path is inside the package', () => {
  const dir = makeTempPackage();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-outside-skills-'));
  try {
    fs.rmSync(path.join(dir, 'skills'), { recursive: true, force: true });
    fs.mkdirSync(path.join(outside, 'hello-skill'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'hello-skill', 'SKILL.md'), '---\nname: hello-skill\n---\n');
    fs.symlinkSync(outside, path.join(dir, 'skills'), 'dir');
    const result = validateNativeCandidate({ manifestSkillsField: './skills/', packageRoot: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => /skills.*symlink|realpath.*inside/i.test(e)), result.errors.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
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

test('rejects a candidate containing a promoted-but-non-native skill, naming the extra skill', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'skill-judge', name: 'dhpk-skill-quality-judge', path: 'skills/dhpk-skill-quality-judge', lifecycle: 'promoted', surfaces: ['claude-core'] },
    ],
  };
  const result = validateNativeMembership({ candidateSkillNames: ['dhpk-tdd-workflow', 'dhpk-skill-quality-judge'], inventory });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => /skill-judge/.test(e) && /not in the codex-native/i.test(e)), result.errors.join('\n'));
});

test('accepts an approved optional-lifecycle native exception alongside promoted native skills', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'php-pro', name: 'dhpk-php-runtime-router', path: 'skills/dhpk-php-runtime-router', lifecycle: 'optional', surfaces: ['claude-module', 'codex-native'] },
    ],
  };
  const result = validateNativeMembership({ candidateSkillNames: ['dhpk-tdd-workflow', 'dhpk-php-runtime-router'], inventory });
  assert.deepStrictEqual(result.errors, []);
  assert.ok(result.ok);
});

test('rejects a candidate missing a codex-native skill that the inventory expects', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'skill-judge', name: 'dhpk-skill-quality-judge', path: 'skills/dhpk-skill-quality-judge', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
    ],
  };
  const result = validateNativeMembership({ candidateSkillNames: ['dhpk-tdd-workflow'], inventory });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => /skill-judge/.test(e) && /missing/i.test(e)), result.errors.join('\n'));
});

test('excludes a deprecated codex-native skill from the expected membership set', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      {
        id: 'old-skill',
        name: 'dhpk-old-skill',
        path: 'skills/old-skill',
        lifecycle: 'deprecated',
        surfaces: ['claude-core', 'codex-native'],
        deprecation: { since: '2026-01-01', compatibilityWindowEnds: '2026-04-01', migrationNote: 'retired' },
      },
    ],
  };
  const result = validateNativeMembership({ candidateSkillNames: ['dhpk-tdd-workflow'], inventory });
  assert.deepStrictEqual(result.errors, []);
  assert.ok(result.ok);
});

test('native structural verification returns stage-bound evidence instead of a lifecycle aggregate', () => {
  const dir = makeTempPackage();
  try {
    const inventory = {
      skills: [{
        id: 'hello',
        name: 'hello-skill',
        path: 'skills/hello-skill',
        lifecycle: 'promoted',
        surfaces: ['codex-native'],
      }],
    };
    const result = verifyNativePackage({
      packageRoot: dir,
      inventory,
      stage: 'structural',
      observedAt: '2026-08-13T00:00:00.000Z',
    });
    assert.strictEqual(result.ok, true, result.error && result.error.message);
    assert.strictEqual(result.evidence.stage, 'structural');
    assert.strictEqual(result.evidence.verdict, 'PASS');
    assert.strictEqual(result.evidence.observedAt, '2026-08-13T00:00:00.000Z');
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'lifecycle'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('codex-native-package-validate');
