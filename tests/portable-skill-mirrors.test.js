'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const CLI = path.join(__dirname, '../scripts/ci/reconcile-skill-mirrors.js');

test('mirror reconciliation accepts portable names independently of stable IDs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-portable-mirrors-'));
  try {
    fs.mkdirSync(path.join(root, 'skills/tdd-workflow'), { recursive: true });
    fs.mkdirSync(path.join(root, 'manifests'));
    fs.writeFileSync(path.join(root, 'skills/tdd-workflow/SKILL.md'), '---\nname: tdd-workflow\n---\n');
    fs.writeFileSync(path.join(root, 'manifests/distribution-inventory.json'), JSON.stringify({
      skills: [{ id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow',
        name_style: 'portable-skill', surfaces: ['codex-sync', 'cursor-sync'] }],
    }));
    const result = spawnSync(process.execPath, [CLI, '--repo-root', root, '--skill', 'tdd-workflow'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    for (const surface of ['codex', 'cursor']) {
      assert.strictEqual(fs.readlinkSync(path.join(root, surface, 'skills/tdd-workflow')), '../../skills/tdd-workflow');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('portable-skill-mirrors');
