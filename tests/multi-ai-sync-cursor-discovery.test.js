'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT_ROOT = path.join(ROOT, 'skills/harness-govern/scripts');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('harness-govern sync Cursor discovery unions all roots and filters metadata', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-discovery-'));
  try {
    const roots = [
      path.join(repo, 'plugins/dhpk-cursor/agents'),
      path.join(repo, '.cursor/plugins/local/dhpk-cursor/agents'),
      path.join(repo, '.cursor/agents'),
    ];
    const filesByRoot = [
      ['reviewer.md', 'architect.md'],
      ['writer.md'],
      ['reviewer.md', 'security.md'],
    ];
    for (let index = 0; index < roots.length; index += 1) {
      for (const role of filesByRoot[index]) {
        const name = path.basename(role, '.md');
        write(path.join(roots[index], role), `---\nname: ${name}\ndescription: Test role\n---\n# Test role\n`);
      }
      for (const metadata of ['INDEX.md', 'README.md', 'provenance.md', 'fingerprints.md', 'receipt.md', 'receipts.md', '_resource.md']) {
        write(path.join(roots[index], metadata), '# metadata, not a role\n');
      }
    }
    const code = [
      'from multi_ai_sync_lib.agent_sync import cursor_agent_roles',
      'import json',
      `print(json.dumps(cursor_agent_roles(${JSON.stringify(repo)})))`,
    ].join('\n');
    const result = spawnSync('python3', ['-c', code], { cwd: SCRIPT_ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.deepStrictEqual(JSON.parse(result.stdout), ['architect', 'reviewer', 'security', 'writer']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('harness-govern-sync-cursor-discovery');
