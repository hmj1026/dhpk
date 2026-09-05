'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { materializeAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'install-agy-plugin.js');
const SOURCE = path.join(ROOT, 'plugins', 'dhpk-agy');
const SCRATCH_COMMIT = 'c'.repeat(40);

function invoke(action, target) {
  return spawnSync(process.execPath, [SCRIPT, action, '--source', SOURCE, '--target', target, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function invokeReport(action, target) {
  const result = invoke(action, target);
  return { result, report: JSON.parse(result.stdout) };
}

function invokeForSource(action, source, target) {
  return spawnSync(process.execPath, [SCRIPT, action, '--source', source, '--target', target, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function invokeReportForSource(action, source, target) {
  const result = invokeForSource(action, source, target);
  return { result, report: JSON.parse(result.stdout) };
}

function scratchPackage(root, name, version, body) {
  const canonical = path.join(root, `${name}-canonical`);
  const output = path.join(root, `${name}-package`);
  fs.mkdirSync(path.join(canonical, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(canonical, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(canonical, 'skills', 'dhpk-sample'), { recursive: true });
  fs.writeFileSync(path.join(canonical, 'agents', 'sample.md'), [
    '---',
    'name: sample',
    'description: Sample',
    'tools: ["read_file"]',
    'model: inherit',
    '---',
    '',
    body,
  ].join('\n'));
  fs.writeFileSync(path.join(canonical, 'rules', 'sample.md'), '# Rule\n');
  fs.writeFileSync(path.join(canonical, 'skills', 'dhpk-sample', 'SKILL.md'), [
    '---',
    'name: dhpk-sample',
    'description: Sample',
    '---',
    '# Skill',
    '',
  ].join('\n'));
  materializeAgyPluginPackage({
    root: canonical,
    inventory: {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{ id: 'sample', path: 'skills/dhpk-sample', surfaces: ['agy-plugin'] }],
      modules: [],
      surface_membership: { 'agy-plugin': ['sample'] },
      agy_plugin: { agents: ['sample.md'], rules: ['rules/sample.md'] },
    },
    outDir: output,
    version,
    sourceVersion: version,
    sourceCommit: SCRATCH_COMMIT,
  });
  return output;
}

function snapshotFiles(root) {
  const files = {};
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files[relative] = fs.readFileSync(absolute);
      else files[relative] = `non-regular:${entry.name}`;
    }
  };
  walk(root);
  return files;
}

test('CLI installs and rolls back the receipt-owned AGY package', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-install-'));
  const target = path.join(temp, 'target');
  try {
    const installed = invoke('install', target);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    assert.ok(fs.existsSync(path.join(target, 'provenance.json')));

    const rolledBack = invoke('rollback', target);
    assert.strictEqual(rolledBack.status, 0, `${rolledBack.stdout}\n${rolledBack.stderr}`);
    assert.ok(!fs.existsSync(path.join(target, 'provenance.json')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('CLI plan and status report a foreign checkout without mutation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-plan-'));
  const target = path.join(temp, 'target');
  try {
    fs.mkdirSync(path.join(target, '.git'), { recursive: true });
    fs.writeFileSync(path.join(target, 'plugin.json'), '{"name":"dhpk","version":"0.38.0"}\n');
    for (const action of ['plan', 'status']) {
      const { result, report } = invokeReport(action, target);
      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.classification, 'FOREIGN_CHECKOUT');
      assert.strictEqual(report.mutation.performed, false);
    }
    assert.ok(!fs.existsSync(path.join(target, 'provenance.json')));
    assert.deepStrictEqual(fs.readdirSync(target).sort(), ['.git', 'plugin.json']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('CLI plan and status pass equivalently without mutating source or target', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-current-'));
  const target = path.join(temp, 'target');
  try {
    const installed = invoke('install', target);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const sourceBefore = snapshotFiles(SOURCE);
    const targetBefore = snapshotFiles(target);
    assert.deepStrictEqual(targetBefore, sourceBefore);

    const plan = invokeReport('plan', target);
    const status = invokeReport('status', target);
    assert.strictEqual(plan.result.status, 0, `${plan.result.stdout}\n${plan.result.stderr}`);
    assert.strictEqual(status.result.status, 0, `${status.result.stdout}\n${status.result.stderr}`);
    assert.deepStrictEqual({ ...plan.report, action: undefined }, { ...status.report, action: undefined });
    assert.strictEqual(plan.report.status, 'PASS');
    assert.strictEqual(plan.report.state, 'CURRENT');
    assert.strictEqual(plan.report.classification, 'AGY_OWNED');
    assert.deepStrictEqual(snapshotFiles(SOURCE), sourceBefore);
    assert.deepStrictEqual(snapshotFiles(target), targetBefore);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('CLI plan and status pass for a stale owned upgrade without mutation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-stale-'));
  const target = path.join(temp, 'target');
  try {
    const sourceN = scratchPackage(temp, 'version-n', '0.39.0', '# Version N\n');
    const sourceNext = scratchPackage(temp, 'version-next', '0.40.0', '# Version N+1\n');
    const installed = invokeForSource('install', sourceN, target);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const sourceBefore = snapshotFiles(sourceNext);
    const targetBefore = snapshotFiles(target);

    const plan = invokeReportForSource('plan', sourceNext, target);
    const status = invokeReportForSource('status', sourceNext, target);
    assert.strictEqual(plan.result.status, 0, `${plan.result.stdout}\n${plan.result.stderr}`);
    assert.strictEqual(status.result.status, 0, `${status.result.stdout}\n${status.result.stderr}`);
    assert.deepStrictEqual({ ...plan.report, action: undefined }, { ...status.report, action: undefined });
    assert.strictEqual(plan.report.status, 'PASS');
    assert.strictEqual(plan.report.state, 'STALE');
    assert.strictEqual(plan.report.classification, 'AGY_OWNED');
    assert.match(plan.report.next_action, /update/i);
    assert.deepStrictEqual(snapshotFiles(sourceNext), sourceBefore);
    assert.deepStrictEqual(snapshotFiles(target), targetBefore);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

run('install-agy-plugin');
