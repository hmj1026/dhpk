'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('canonical writers and installer document symlink-safe destinations', () => {
  for (const file of ['commands/setup.md', 'skills/dhpk-project-setup/SKILL.md', 'skills/harness-govern/references/plugin-sync.md']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (file === 'commands/setup.md') {
      assert.ok(text.includes('rejects any destination path containing a symlink'), `${file} missing installer symlink rejection`);
    } else if (file === 'skills/dhpk-project-setup/SKILL.md') {
      assert.ok(text.includes('realpath'), `${file} missing realpath guidance`);
      assert.ok(text.includes('Write tool refuses symlinks'), `${file} missing Write-tool rationale`);
    } else {
      assert.ok(text.includes('realpath'), `${file} missing realpath guidance`);
      assert.ok(text.includes('Write tool refuses symlinked targets'), `${file} missing Write-tool rationale`);
    }
  }
  assert.ok(!fs.readFileSync(path.join(ROOT, 'commands', 'install-rules.md'), 'utf8').includes('realpath'), 'forwarding aliases must not duplicate canonical write guidance');
});

run('symlink-write-guidance');
