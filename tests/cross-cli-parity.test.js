'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const { compareHarnesses, main } = require('../scripts/lib/cross-cli-parity');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cross-cli-parity-'));
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
  return root;
}

test('reports content differences and source-only files', () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'same.md'), 'canonical\n');
    fs.writeFileSync(path.join(root, '.codex', 'skills', 'same.md'), 'stale\n');
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'missing.md'), 'new\n');
    const result = compareHarnesses(root);
    assert.deepStrictEqual(result.different, ['skills/same.md']);
    assert.deepStrictEqual(result.missing, ['skills/missing.md']);
    assert.strictEqual(result.drift, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('target-only files and explicit allowlist entries do not create false drift', () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'shared.md'), 'canonical\n');
    fs.writeFileSync(path.join(root, '.codex', 'skills', 'shared.md'), 'stale\n');
    fs.writeFileSync(path.join(root, '.codex', 'skills', 'native.md'), 'native\n');

    const unallowlisted = compareHarnesses(root);
    assert.deepStrictEqual(unallowlisted.different, ['skills/shared.md']);
    assert.deepStrictEqual(unallowlisted.missing, []);
    assert.strictEqual(unallowlisted.drift, true);

    fs.writeFileSync(path.join(root, '.cross-cli-allowlist.json'), JSON.stringify({ '.codex': ['skills/shared.md'] }));
    const result = compareHarnesses(root);
    assert.deepStrictEqual(result.different, []);
    assert.deepStrictEqual(result.missing, []);
    assert.strictEqual(result.source_files, 1);
    assert.strictEqual(result.target_files, 2);
    assert.strictEqual(result.drift, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('symlinked .claude/skills -> ../.agents/skills does not report shared skills missing in .codex while preserving other dir drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cross-cli-parity-ssot-'));
  try {
    fs.mkdirSync(path.join(root, '.agents', 'skills', 'shared-skill'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'skills', 'shared-skill', 'SKILL.md'), '# Shared Skill\n');
    fs.mkdirSync(path.join(root, '.claude', 'commands'), { recursive: true });
    fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
    fs.symlinkSync('../.agents/skills', path.join(root, '.claude', 'skills'));

    fs.writeFileSync(path.join(root, '.claude', 'commands', 'cmd.md'), 'command v2\n');
    fs.writeFileSync(path.join(root, '.claude', 'agents', 'a.md'), 'agent v1\n');
    fs.writeFileSync(path.join(root, '.claude', 'hooks', 'h.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(root, '.claude', 'rules', 'r.md'), 'rule v1\n');

    fs.mkdirSync(path.join(root, '.codex', 'commands'), { recursive: true });
    fs.mkdirSync(path.join(root, '.codex', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(root, '.codex', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codex', 'commands', 'cmd.md'), 'command v1\n');
    fs.writeFileSync(path.join(root, '.codex', 'agents', 'a.md'), 'agent v1\n');
    fs.writeFileSync(path.join(root, '.codex', 'rules', 'r.md'), 'rule v1\n');

    const result = compareHarnesses(root);
    assert.deepStrictEqual(result.missing, ['hooks/h.sh']);
    assert.deepStrictEqual(result.different, ['commands/cmd.md']);
    assert.strictEqual(result.drift, true);

    // Matching all non-skill files leaves zero drift even without .codex/skills.
    fs.mkdirSync(path.join(root, '.codex', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codex', 'commands', 'cmd.md'), 'command v2\n');
    fs.writeFileSync(path.join(root, '.codex', 'hooks', 'h.sh'), '#!/bin/sh\n');
    const clean = compareHarnesses(root);
    assert.deepStrictEqual(clean.missing, []);
    assert.deepStrictEqual(clean.different, []);
    assert.strictEqual(clean.drift, false);

    // A stale physical override in .codex/skills still flags content drift unless allowlisted.
    fs.mkdirSync(path.join(root, '.codex', 'skills', 'shared-skill'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codex', 'skills', 'shared-skill', 'SKILL.md'), '# Stale Override\n');
    const staleOverride = compareHarnesses(root);
    assert.deepStrictEqual(staleOverride.missing, []);
    assert.deepStrictEqual(staleOverride.different, ['skills/shared-skill/SKILL.md']);
    assert.strictEqual(staleOverride.drift, true);

    fs.writeFileSync(path.join(root, '.cross-cli-allowlist.json'), JSON.stringify({ '.codex': ['skills/shared-skill/SKILL.md'] }));
    const allowlisted = compareHarnesses(root);
    assert.deepStrictEqual(allowlisted.different, []);
    assert.strictEqual(allowlisted.drift, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('physical .claude/skills matching .agents/skills does not report missing in .codex', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'skills', 'shared.md'), 'canonical\n');
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'shared.md'), 'canonical\n');
    const result = compareHarnesses(root);
    assert.deepStrictEqual(result.missing, []);
    assert.deepStrictEqual(result.different, []);
    assert.strictEqual(result.drift, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('main() drift advisory replaces retired /multi-ai-sync with dhpk-install', () => {
  const root = fixture();
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'only-claude.md'), 'new\n');
    const code = main(['--root', root, '--source', '.claude', '--target', '.codex']);
    assert.strictEqual(code, 0);
    assert.strictEqual(logs.length, 1);
    assert.ok(!logs[0].includes('/multi-ai-sync'), logs[0]);
    assert.ok(logs[0].includes('dhpk-install'), logs[0]);
  } finally {
    console.log = origLog;
    fs.rmSync(root, { recursive: true, force: true });
  }
});



// Consolidated source suite: check-cross-cli-drift (tests/check-cross-cli-drift.test.js).
{
  // Coverage for scripts/check-cross-cli-drift.sh — advisory drift detector
  // comparing newest-file mtimes under .claude/ versus sibling .codex/
  // harness dirs. Always exits 0; only stdout content varies.

  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');

  const ROOT = path.join(__dirname, '..');
  const SCRIPT = path.join(ROOT, 'scripts', 'check-cross-cli-drift.sh');

  function mkTmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cross-cli-drift-'));
  }

  function touch(file, mtimeSeconds) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    const t = new Date(mtimeSeconds * 1000);
    fs.utimesSync(file, t, t);
  }

  function runScript(projectDir, extraEnv) {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...extraEnv };
    return spawnSync('bash', [SCRIPT], { cwd: projectDir, env, encoding: 'utf8', timeout: 10000 });
  }

  test('bash -n syntax check passes', () => {
    const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
  });

  test('no .claude dir at all: exits 0 silently', () => {
    const tmp = mkTmp();
    try {
      const res = runScript(tmp);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), '');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('.claude present but no sibling .codex: exits 0 silently', () => {
    const tmp = mkTmp();
    try {
      touch(path.join(tmp, '.claude', 'skills', 'a.md'), Math.floor(Date.now() / 1000));
      const res = runScript(tmp);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), '');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('does not treat a retired .gemini project harness as a drift target', () => {
    const tmp = mkTmp();
    try {
      const now = Math.floor(Date.now() / 1000);
      touch(path.join(tmp, '.claude', 'skills', 'a.md'), now);
      touch(path.join(tmp, '.gemini', 'skills', 'a.md'), now - 3 * 3600 - 60);
      const res = runScript(tmp, { DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), '');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('drift under threshold: no advisory printed', () => {
    const tmp = mkTmp();
    try {
      const now = Math.floor(Date.now() / 1000);
      touch(path.join(tmp, '.claude', 'skills', 'a.md'), now);
      touch(path.join(tmp, '.codex', 'skills', 'a.md'), now - 100);
      const res = runScript(tmp, { DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), '');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('drift over threshold: prints advisory naming the stale sibling with hour delta', () => {
    const tmp = mkTmp();
    try {
      const now = Math.floor(Date.now() / 1000);
      touch(path.join(tmp, '.claude', 'skills', 'a.md'), now);
      touch(path.join(tmp, '.codex', 'skills', 'a.md'), now - 3 * 3600 - 60);
      const res = runScript(tmp, { DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.ok(res.stdout.includes('cross-cli drift'), res.stdout);
      assert.ok(res.stdout.includes('.codex(+3h)'), res.stdout);
      assert.ok(!res.stdout.includes('/multi-ai-sync'), res.stdout);
      assert.ok(res.stdout.includes('dhpk-install'), res.stdout);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('symlinked .claude/skills -> ../.agents/skills produces no false content or mtime drift', () => {
    const tmp = mkTmp();
    try {
      const now = Math.floor(Date.now() / 1000);
      touch(path.join(tmp, '.agents', 'skills', 'shared', 'SKILL.md'), now);
      fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
      fs.symlinkSync('../.agents/skills', path.join(tmp, '.claude', 'skills'));
      touch(path.join(tmp, '.claude', 'rules', 'r.md'), now - 3 * 3600 - 60);
      touch(path.join(tmp, '.codex', 'rules', 'r.md'), now - 3 * 3600 - 60);
      const res = runScript(tmp, { DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), '');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

run('cross-cli-parity');
