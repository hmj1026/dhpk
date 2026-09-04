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

test('harness-govern sync Cursor discovery excludes navigation, receipts, and resource Markdown', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-discovery-'));
  try {
    const agents = path.join(repo, 'plugins/dhpk-cursor/agents');
    write(path.join(agents, 'reviewer.md'), '---\nname: reviewer\ndescription: Review\n---\n# Reviewer\n');
    write(path.join(agents, 'INDEX.md'), '# index\n');
    write(path.join(agents, 'README.md'), '# readme\n');
    write(path.join(agents, 'provenance.md'), '# receipt\n');
    write(path.join(agents, '_resource.md'), '# resource\n');
    const code = [
      'from multi_ai_sync_lib.agent_sync import cursor_agent_roles',
      'import json',
      `print(json.dumps(cursor_agent_roles(${JSON.stringify(repo)})))`,
    ].join('\n');
    const result = spawnSync('python3', ['-c', code], { cwd: SCRIPT_ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.deepStrictEqual(JSON.parse(result.stdout), ['reviewer']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('harness-govern-sync-cursor-discovery');
