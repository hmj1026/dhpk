'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');

const source = path.resolve(__dirname, '../skills/change-verdict');
const required = [
  'SKILL.md',
  'references/actions/pending.md',
  'references/actions/deps.md',
  'references/shared/review-workflow.md',
  'references/shared/review-common.md',
  'references/shared/review-rubric.md',
  'references/security/codex-prompt-security.md',
  'templates/review_output.md',
];

// These tests establish delivery closure, not model decisions or Host behavior.
test('change-verdict delivers action procedures without sibling skills or ambient roots', () => {
  withIsolatedSkill({ source, env: {
    DHPK_SOURCE_ROOT: path.resolve(source, '../..'),
    NODE_PATH: path.resolve(source, '..'),
  } }, ({ skillDir, env, evidenceKind, hostStatus }) => {
    assert.equal(evidenceKind, 'fixture');
    assert.equal(hostStatus, 'NOT_RUN');
    assert.equal(env.DHPK_SOURCE_ROOT, undefined);
    assert.equal(env.NODE_PATH, undefined);
    assert.deepEqual(fs.readdirSync(path.dirname(skillDir)).filter((name) => name.includes('skill')),
      ['relocated skill']);
    for (const relative of required) {
      assert.deepEqual(fs.readFileSync(path.join(skillDir, relative)), fs.readFileSync(path.join(source, relative)));
    }
  });
});

function withCandidate(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-verdict-candidate-'));
  const candidate = path.join(directory, 'change-verdict');
  try {
    fs.cpSync(source, candidate, { recursive: true });
    callback(candidate);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('change-verdict rejects a missing action resource despite the ambient original', () => {
  withCandidate((candidate) => {
    fs.rmSync(path.join(candidate, 'references/actions/deps.md'));
    let executed = false;
    assert.throws(() => withIsolatedSkill({ source: candidate, files: required }, () => {
      executed = true;
    }), /ENOENT.*references\/actions\/deps\.md/);
    assert.equal(executed, false);
    assert.equal(fs.existsSync(path.join(source, 'references/actions/deps.md')), true);
  });
});

test('change-verdict rejects a tampered action symlink before a task can execute', () => {
  withCandidate((candidate) => {
    const local = path.join(candidate, 'references/actions/pending.md');
    fs.rmSync(local);
    fs.symlinkSync(path.join(source, 'references/actions/pending.md'), local);
    assert.throws(() => withIsolatedSkill({ source: candidate, files: required }, () => {
      assert.fail('tampered candidate must not execute');
    }), /symlink crosses Skill boundary: references\/actions\/pending\.md/);
  });
});

test('change-verdict resource selection rejects parent-path escape', () => {
  assert.throws(() => withIsolatedSkill({ source, files: ['SKILL.md', '../dep-audit/SKILL.md'] }, () => {
    assert.fail('escaping candidate must not execute');
  }), /resource escapes the Skill boundary/);
});
