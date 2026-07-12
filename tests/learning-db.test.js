'use strict';

// Coverage for scripts/hooks/_lib/learning-db.sh: ldb_enabled, ldb_path,
// ldb_record, ldb_aggregate, ldb_top, ldb_graduation_candidates, and the
// size-based rotation in ldb_rotate_if_needed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'learning-db.sh');

const jqCheck = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' });
const hasJq = jqCheck.status === 0;

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ldb-'));
}

function sh(root, cmd, extraEnv) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root, ...(extraEnv || {}) };
  delete env.DHPK_LEARNING_DB;
  Object.assign(env, extraEnv || {});
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000, env });
}

test('ldb_enabled is false by default (no env, no plugin option)', () => {
  const res = sh(tmpProject(), 'ldb_enabled; echo "EXIT:$?"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'EXIT:1');
});

test('DHPK_LEARNING_DB=1 force-enables regardless of plugin option', () => {
  const res = sh(tmpProject(), 'ldb_enabled; echo "EXIT:$?"', { DHPK_LEARNING_DB: '1' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'EXIT:0');
});

test('DHPK_LEARNING_DB=0 force-disables even if plugin option is true', () => {
  const res = sh(tmpProject(), 'ldb_enabled; echo "EXIT:$?"', {
    DHPK_LEARNING_DB: '0',
    CLAUDE_PLUGIN_OPTION_LEARNING_DB_ENABLED: 'true',
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'EXIT:1');
});

test('ldb_path echoes .claude/artifacts/learning.jsonl under CLAUDE_PROJECT_DIR', () => {
  const root = tmpProject();
  const res = sh(root, 'ldb_path');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), path.join(root, '.claude/artifacts/learning.jsonl'));
});

test('ldb_record is a no-op when the learning DB is disabled (no file created)', () => {
  const root = tmpProject();
  const res = sh(root, 'ldb_record success "sig:test" "detail" ; echo "EXIT:$?"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'EXIT:0');
  assert.ok(!fs.existsSync(path.join(root, '.claude/artifacts/learning.jsonl')));
});

test('ldb_record appends a JSON line with expected fields when enabled', () => {
  const root = tmpProject();
  const res = sh(root, 'ldb_record success "sig:test" "detail-text"', { DHPK_LEARNING_DB: '1' });
  assert.strictEqual(res.status, 0, res.stderr);
  const file = path.join(root, '.claude/artifacts/learning.jsonl');
  assert.ok(fs.existsSync(file), 'learning.jsonl not created');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.strictEqual(rec.kind, 'success');
  assert.strictEqual(rec.sig, 'sig:test');
  assert.strictEqual(rec.detail, 'detail-text');
  assert.strictEqual(rec.weight, 0.05);
});

test('ldb_record defaults failure weight to -0.1', () => {
  const root = tmpProject();
  sh(root, 'ldb_record failure "sig:fail"', { DHPK_LEARNING_DB: '1' });
  const file = path.join(root, '.claude/artifacts/learning.jsonl');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.strictEqual(rec.weight, -0.1);
});

test('ldb_record no-ops when kind or sig missing (edge case)', () => {
  const root = tmpProject();
  const res = sh(root, 'ldb_record "" "sig" ; echo "EXIT:$?"', { DHPK_LEARNING_DB: '1' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'EXIT:0');
  assert.ok(!fs.existsSync(path.join(root, '.claude/artifacts/learning.jsonl')));
});

if (hasJq) {
  test('ldb_aggregate + ldb_top surface a high-confidence signature after repeated successes', () => {
    const root = tmpProject();
    let cmd = '';
    for (let i = 0; i < 3; i += 1) {
      cmd += `ldb_record success "sig:stable" "obs${i}"; `;
    }
    cmd += 'ldb_top 5 2';
    const res = sh(root, cmd, { DHPK_LEARNING_DB: '1' });
    assert.strictEqual(res.status, 0, res.stderr);
    const line = res.stdout.trim();
    assert.ok(line.includes('sig:stable'), `expected sig in top output: ${line}`);
    const cols = line.split('\t');
    assert.strictEqual(cols[1], '3', `expected obs=3, got: ${line}`);
  });

  test('ldb_graduation_candidates excludes signatures below the confidence/obs threshold', () => {
    const root = tmpProject();
    const res = sh(root, 'ldb_record success "sig:once"; ldb_graduation_candidates', { DHPK_LEARNING_DB: '1' });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '', `expected no graduation candidates yet: ${res.stdout}`);
  });
} else {
  test('jq unavailable: ldb_aggregate no-ops without error (edge case)', () => {
    const root = tmpProject();
    const res = sh(root, 'ldb_record success "sig:x"; ldb_aggregate; echo "EXIT:$?"', { DHPK_LEARNING_DB: '1' });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.trim().endsWith('EXIT:0'));
  });
}

test('ldb_rotate_if_needed archives the log once it exceeds the byte cap', () => {
  const root = tmpProject();
  const file = path.join(root, '.claude/artifacts/learning.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x'.repeat(200));
  const res = sh(root, `ldb_rotate_if_needed "${file}"`, { DHPK_LEARNING_CAP_BYTES: '100' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(!fs.existsSync(file), 'original file should have been moved');
  const archiveDir = path.join(root, '.claude/artifacts/learning-archive');
  assert.ok(fs.existsSync(archiveDir), 'archive dir not created');
  const archived = fs.readdirSync(archiveDir);
  assert.strictEqual(archived.length, 1, `expected 1 archived file, got: ${archived.join(',')}`);
});

test('ldb_rotate_if_needed is a no-op when file is under the cap (edge case)', () => {
  const root = tmpProject();
  const file = path.join(root, '.claude/artifacts/learning.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'small');
  const res = sh(root, `ldb_rotate_if_needed "${file}"`, { DHPK_LEARNING_CAP_BYTES: '52428800' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(file), 'file should remain in place');
});

run('learning-db');
