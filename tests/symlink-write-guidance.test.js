'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('every consumer CLAUDE.md writer resolves symlinks before Write', () => {
  for (const file of ['commands/install-rules.md', 'skills/dhpk-project-setup/SKILL.md', 'skills/dhpk-harness-fill/SKILL.md']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(text.includes('realpath'), `${file} missing realpath guidance`);
    assert.ok(text.includes('Write tool refuses symlinks'), `${file} missing Write-tool rationale`);
  }
});

run('symlink-write-guidance');
