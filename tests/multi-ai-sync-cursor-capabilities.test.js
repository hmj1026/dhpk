'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const VALIDATOR = path.join(ROOT, 'skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py');

function installCursorProjection(repo, options = {}) {
  const modeArgs = options.copy === false ? [] : ['--copy'];
  const result = spawnSync('bash', [
    path.join(ROOT, 'scripts/hooks/install-cursor-harness.sh'),
    ...modeArgs, '--force',
  ], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      DHPK_HARNESS_KIND: 'cursor',
      DHPK_SRC_REL: 'cursor',
      DHPK_DEST_REL: '.cursor',
      DHPK_SOURCE_KINDS: 'skills,agents,rules,commands',
      DHPK_INSTALLER_NAME: 'install-cursor-harness',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  assert.ok(!fs.existsSync(path.join(repo, 'plugins')), 'fixture must not contain a package root');
}

function runCursorValidation(repo) {
  const result = spawnSync('python3', [
    '-B', VALIDATOR,
    '--root', repo,
    'validate', '--targets', 'cursor', '--format', 'json',
  ], { encoding: 'utf8' });
  assert.ok(result.stdout, result.stderr);
  const report = JSON.parse(result.stdout);
  const row = report.results.find((item) => item.platform === 'cursor');
  assert.ok(row, 'cursor result row is required');
  return { result, report, row };
}

function updateCursorReceipt(repo, update) {
  const receiptPath = path.join(repo, '.cursor/.dhpk-installed.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  update(receipt);
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

function projectLocalCapability(row) {
  return row.capabilities.find((item) => item.id === 'cursor.project_local.structure');
}

function fingerprintPath(target) {
  if (fs.lstatSync(target).isSymbolicLink()) return fingerprintPath(fs.realpathSync(target));
  const digest = crypto.createHash('sha256');
  if (fs.statSync(target).isFile()) {
    digest.update('file\0');
    digest.update(fs.readFileSync(target));
    return digest.digest('hex');
  }
  digest.update('dir\0');
  for (const name of fs.readdirSync(target).sort()) {
    if (name === '__pycache__' || name.endsWith('.pyc')) continue;
    digest.update(name);
    digest.update('\0');
    digest.update(fingerprintPath(path.join(target, name)));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function receiptSourceFingerprint(repo, receipt) {
  const digest = crypto.createHash('sha256');
  for (const kind of ['skills', 'agents', 'rules', 'commands', 'supporting_assets']) {
    for (const [name, entry] of Object.entries(receipt.managed_entries[kind]).sort(([left], [right]) => left.localeCompare(right))) {
      digest.update(kind === 'supporting_assets' ? entry.destination : `${kind}/${name}`);
      digest.update('\0');
      digest.update(fingerprintPath(path.join(repo, '.cursor', entry.destination)));
      digest.update('\0');
    }
  }
  return digest.digest('hex');
}

test('Cursor validates a current project-local receipt and projection without a package root', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-project-local-'));
  try {
    installCursorProjection(repo);
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'PASS', row.notes.join('\n'));
    assert.strictEqual(projectLocalCapability(row).status, 'PASS');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'cursor.portable.skills').status, 'NOT_CONFIGURED');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'cursor.native.hooks').status, 'SKIP_INCOMPATIBLE');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'cursor.runtime.launch').status, 'NOT_RUN');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor validates the documented symlink-mode project-local route', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-project-local-symlink-'));
  try {
    installCursorProjection(repo, { copy: false });
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'PASS', row.notes.join('\n'));
    assert.strictEqual(projectLocalCapability(row).status, 'PASS');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'cursor.runtime.launch').status, 'NOT_RUN');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor keeps an explicit request with no package or project-local marker BLOCKED', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-absent-'));
  try {
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'BLOCKED');
    assert.match(row.notes.join('\n'), /markers are absent.*explicitly requested/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor reports a malformed present project-local receipt as FAIL', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-malformed-receipt-'));
  try {
    fs.mkdirSync(path.join(repo, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.cursor/.dhpk-installed.json'), '{not-json');
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'FAIL');
    assert.strictEqual(projectLocalCapability(row).status, 'FAIL');
    assert.match(row.notes.join('\n'), /receipt.*invalid JSON/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor treats a dangling project-local receipt marker as present and FAIL', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-dangling-receipt-'));
  try {
    fs.mkdirSync(path.join(repo, '.cursor'), { recursive: true });
    fs.symlinkSync('missing-receipt.json', path.join(repo, '.cursor/.dhpk-installed.json'));
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'FAIL');
    assert.strictEqual(projectLocalCapability(row).status, 'FAIL');
    assert.match(row.notes.join('\n'), /receipt is not a regular file/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor reports stale project-local provenance as FAIL', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-stale-receipt-'));
  try {
    installCursorProjection(repo);
    updateCursorReceipt(repo, (receipt) => { receipt.plugin_version = '0.0.0'; });
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'FAIL');
    assert.strictEqual(projectLocalCapability(row).status, 'FAIL');
    assert.match(row.notes.join('\n'), /plugin version.*differs from source/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor rejects a self-consistent old copy projection when current source changed', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-stale-copy-'));
  try {
    installCursorProjection(repo);
    const receiptPath = path.join(repo, '.cursor/.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const skill = Object.values(receipt.managed_entries.skills)[0];
    fs.appendFileSync(path.join(repo, '.cursor', skill.destination, 'SKILL.md'), '\nold source fixture\n');
    const changedFingerprint = fingerprintPath(path.join(repo, '.cursor', skill.destination));
    skill.source_fingerprint = changedFingerprint;
    skill.destination_fingerprint = changedFingerprint;
    skill.fingerprint = changedFingerprint;
    receipt.source_fingerprint = receiptSourceFingerprint(repo, receipt);
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'FAIL');
    assert.match(row.notes.join('\n'), /fingerprint mismatch \(current source\)/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor rejects a receipt-owned symlink target outside an approved dhpk source root', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-symlink-escape-'));
  try {
    installCursorProjection(repo, { copy: false });
    const receiptPath = path.join(repo, '.cursor/.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const skill = Object.values(receipt.managed_entries.skills)[0];
    const projected = path.join(repo, '.cursor', skill.destination);
    fs.unlinkSync(projected);
    fs.symlinkSync('/etc/passwd', projected);
    skill.destination_target = '/etc/passwd';
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'FAIL');
    assert.match(row.notes.join('\n'), /symlink receipt has inconsistent source roots|symlink target escapes/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor bounds traversal of a deeply nested copy projection', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-depth-limit-'));
  try {
    installCursorProjection(repo);
    const receipt = JSON.parse(fs.readFileSync(path.join(repo, '.cursor/.dhpk-installed.json'), 'utf8'));
    const skill = Object.values(receipt.managed_entries.skills)[0];
    let nested = path.join(repo, '.cursor', skill.destination, 'depth-fixture');
    for (let depth = 0; depth < 70; depth += 1) nested = path.join(nested, String(depth));
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'leaf.txt'), 'bounded traversal fixture\n');
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'FAIL');
    assert.match(row.notes.join('\n'), /projection traversal depth limit exceeded/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor reports missing project-local managed entries as FAIL', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-missing-managed-'));
  try {
    installCursorProjection(repo);
    updateCursorReceipt(repo, (receipt) => { delete receipt.managed_entries.commands; });
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'FAIL');
    assert.strictEqual(projectLocalCapability(row).status, 'FAIL');
    assert.match(row.notes.join('\n'), /missing managed entries: commands/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor reports a project-local receipt/projection mismatch as FAIL', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-projection-mismatch-'));
  try {
    installCursorProjection(repo);
    const receipt = JSON.parse(fs.readFileSync(path.join(repo, '.cursor/.dhpk-installed.json'), 'utf8'));
    const skill = Object.values(receipt.managed_entries.skills)[0];
    fs.appendFileSync(path.join(repo, '.cursor', skill.destination, 'SKILL.md'), '\nfixture drift\n');
    const { row } = runCursorValidation(repo);
    assert.strictEqual(row.final_status, 'FAIL');
    assert.strictEqual(projectLocalCapability(row).status, 'FAIL');
    assert.match(row.notes.join('\n'), /fingerprint mismatch/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Cursor validation keeps portable and native capability rows independent', () => {
  const result = spawnSync('python3', [
    path.join(ROOT, 'skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py'),
    '--root', ROOT,
    'validate', '--targets', 'cursor', '--format', 'json',
  ], { encoding: 'utf8' });
  assert.ok(result.stdout, result.stderr);
  const report = JSON.parse(result.stdout);
  const row = report.results.find((item) => item.platform === 'cursor');
  assert.ok(row, 'cursor result row is required');
  const ids = row.capabilities.map((item) => item.id);
  assert.deepStrictEqual(ids, [
    'cursor.project_local.structure',
    'cursor.portable.skills',
    'cursor.portable.mcp',
    'cursor.native.rules',
    'cursor.native.agents',
    'cursor.native.commands',
    'cursor.native.hooks',
    'cursor.native.variables',
    'cursor.runtime.launch',
  ]);
  assert.ok(row.capabilities.every((item) => typeof item.fallback === 'string'));
});

test('Cursor validation reports malformed configured packages as FAIL rather than presence PASS', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-invalid-package-'));
  try {
    fs.mkdirSync(path.join(repo, 'plugins/dhpk-agent/skills/broken'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'plugins/dhpk-agent/plugin.json'), '{not-json');
    fs.writeFileSync(path.join(repo, 'plugins/dhpk-agent/skills/broken/SKILL.md'), 'not frontmatter');
    const result = spawnSync('python3', [
      path.join(ROOT, 'skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py'),
      '--root', repo, 'validate', '--targets', 'cursor', '--format', 'json',
    ], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'cursor');
    assert.strictEqual(row.final_status, 'FAIL');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'cursor.portable.skills').status, 'FAIL');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Projected Cursor validator fails closed when authoritative scripts are not installed', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-projected-validator-'));
  try {
    const projectedScripts = path.join(repo, 'plugins/dhpk/skills/dhpk-cross-agent-sync/scripts');
    fs.cpSync(path.join(ROOT, 'plugins/dhpk/skills/dhpk-cross-agent-sync/scripts'), projectedScripts, { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude/skills/demo'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude/commands'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude/agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude/settings.local.json'), '{}');
    fs.writeFileSync(path.join(repo, '.claude/skills/demo/SKILL.md'), '# demo');
    fs.writeFileSync(path.join(repo, '.claude/commands/demo.md'), '# demo');
    fs.writeFileSync(path.join(repo, '.claude/agents/demo.md'), '# demo');
    fs.mkdirSync(path.join(repo, 'plugins/dhpk-agent/skills/broken'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'plugins/dhpk-agent/plugin.json'), JSON.stringify({ name: 'dhpk-agent' }));
    fs.writeFileSync(path.join(repo, 'plugins/dhpk-agent/skills/broken/SKILL.md'), 'not frontmatter');
    const result = spawnSync('python3', [
      path.join(projectedScripts, 'multi_ai_sync.py'),
      '--root', repo, 'validate', '--targets', 'cursor', '--format', 'json',
    ], { encoding: 'utf8' });
    assert.ok(result.stdout, result.stderr);
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'cursor');
    assert.strictEqual(row.final_status, 'UNAVAILABLE');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'cursor.portable.skills').status, 'UNAVAILABLE');
    assert.strictEqual(report.gate, 'BLOCKED');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

run('multi-ai-sync-cursor-capabilities');
