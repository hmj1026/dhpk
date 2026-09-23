'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('canonical writers and installer document symlink-safe destinations', () => {
  const command = fs.readFileSync(path.join(ROOT, 'commands', 'setup.md'), 'utf8');
  const claudeSetup = fs.readFileSync(path.join(ROOT, 'skills', 'harness-setup', 'references', 'claude-setup.md'), 'utf8');
  assert.match(command, /thin Claude front door to the canonical `\$harness-setup` Skill/);
  assert.match(command, /Forward `\$ARGUMENTS` unchanged/);
  assert.ok(!command.includes('symlink component'), command);
  assert.match(claudeSetup, /Any destination\s+path with a symlink component is rejected even with `--force`\./);

  for (const file of ['skills/dhpk-project-setup/SKILL.md', 'skills/harness-govern/references/plugin-sync.md']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (file === 'skills/dhpk-project-setup/SKILL.md') {
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
