'use strict';

// Regression coverage for validating the dhpk checkout itself as Claude source.
// The source marker must claim the root layout before any consumer fallback.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');
const SOURCE_MANIFEST_MAX_BYTES = 1024 * 1024;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-${prefix}-`));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function runValidate(root, extraArgs = []) {
  return spawnSync('python3', ['-B', SCRIPT, '--root', root, 'validate', '--format', 'json', ...extraArgs], {
    encoding: 'utf8',
    timeout: 2000,
  });
}

function reportFor(root, extraArgs = []) {
  const result = runValidate(root, extraArgs);
  assert.ifError(result.error);
  assert.ok(result.stdout, `expected JSON stdout, stderr=${result.stderr}`);
  return JSON.parse(result.stdout);
}

function claudeRow(report) {
  const row = report.results.find((item) => item.platform === 'claude');
  assert.ok(row, 'validation report must include the Claude row');
  return row;
}

function buildSource(root) {
  writeFile(path.join(root, '.claude-plugin/plugin.json'), '{"name":"dhpk"}\n');
  writeFile(path.join(root, 'skills/demo/SKILL.md'), '# Demo\n');
  writeFile(path.join(root, 'commands/nested/demo.md'), '# Demo command\n');
  writeFile(path.join(root, 'hooks/noop.sh'), '#!/bin/sh\n');
  writeFile(path.join(root, 'agents/architect.md'), '---\nname: architect\n---\nRole\n');
}

function buildConsumer(root) {
  writeFile(path.join(root, '.claude/settings.local.json'), '{}\n');
  writeFile(path.join(root, '.claude/skills/demo/SKILL.md'), '# Demo\n');
  writeFile(path.join(root, '.claude/commands/demo.md'), '# Demo command\n');
  writeFile(path.join(root, '.claude/agents/architect.md'), '---\nname: architect\n---\nRole\n');
}

function validManifestPaddedTo(bytes) {
  const manifest = '{"name":"dhpk"}';
  return manifest + ' '.repeat(bytes - Buffer.byteLength(manifest));
}

test('source checkout passes from its root layout for every validation target mode', () => {
  const cases = [
    { args: [], gate: 'PASS', exit: 0, codex: 'NOT_CONFIGURED' },
    { args: ['--targets', 'codex'], gate: 'BLOCKED', exit: 2, codex: 'BLOCKED' },
    { args: ['--all-targets'], gate: 'BLOCKED', exit: 2, codex: 'BLOCKED' },
  ];
  for (const { args, gate, exit, codex } of cases) {
    const root = mkTmp('source-valid');
    try {
      buildSource(root);
      const result = runValidate(root, args);
      assert.strictEqual(result.status, exit, `unexpected CLI exit for ${args.join(' ') || 'auto-discovery'}`);
      assert.ok(result.stdout, `expected JSON stdout, stderr=${result.stderr}`);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.gate, gate, `unexpected gate for ${args.join(' ') || 'auto-discovery'}`);
      assert.strictEqual(claudeRow(report).final_status, 'PASS', `Claude source failed for ${args.join(' ') || 'auto-discovery'}`);
      assert.strictEqual(report.results.find((item) => item.platform === 'codex').final_status, codex);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('claimed source with an invalid marker fails without falling back to a valid consumer tree', () => {
  const markerCases = [
    ['malformed JSON', '{'],
    ['non-object JSON', '[]\n'],
    ['missing name', '{"version":"1.0.0"}\n'],
    ['wrong name', '{"name":"other"}\n'],
    ['nested name', '{"metadata":{"name":"dhpk"}}\n'],
    ['invalid UTF-8', Buffer.from([0xc3, 0x28])],
    ['broken marker', null],
  ];
  for (const [label, content] of markerCases) {
    for (const args of [[], ['--targets', 'codex'], ['--all-targets']]) {
      const root = mkTmp('source-invalid');
      try {
        buildSource(root);
        buildConsumer(root);
        const marker = path.join(root, '.claude-plugin/plugin.json');
        if (content === null) {
          fs.rmSync(marker, { force: true });
          fs.mkdirSync(path.dirname(marker), { recursive: true });
          fs.symlinkSync('missing-plugin.json', marker);
        } else {
          writeFile(marker, content);
        }
        const report = reportFor(root, args);
        const row = claudeRow(report);
        assert.strictEqual(row.config_load_ok, false, `${label} must fail source identity validation`);
        assert.strictEqual(row.smoke_ok, true, `${label} fixture must retain valid source smoke components`);
        assert.strictEqual(row.hook_case_state, 'PASS', `${label} fixture must retain valid source hooks`);
        assert.strictEqual(row.multi_agent_case_state, 'PASS', `${label} fixture must retain valid source agents`);
        assert.strictEqual(row.final_status, 'FAIL', `${label} must fail for ${args.join(' ') || 'auto-discovery'}`);
        assert.strictEqual(report.gate, 'FAIL', `${label} must fail the gate without consumer fallback`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('device source marker fails promptly without falling back to a valid consumer tree', () => {
  const root = mkTmp('source-device-marker');
  try {
    buildSource(root);
    buildConsumer(root);
    const marker = path.join(root, '.claude-plugin/plugin.json');
    fs.rmSync(marker, { force: true });
    fs.symlinkSync('/dev/zero', marker);

    const result = runValidate(root);
    assert.ifError(result.error);
    assert.ok(result.stdout, `expected JSON stdout, stderr=${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(claudeRow(report).config_load_ok, false, 'device marker must fail source identity validation');
    assert.strictEqual(claudeRow(report).final_status, 'FAIL', 'device marker must fail Claude validation');
    assert.strictEqual(report.gate, 'FAIL', 'device marker must fail the validation gate');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('FIFO source marker fails promptly without falling back to a valid consumer tree', () => {
  const root = mkTmp('source-fifo-marker');
  try {
    buildSource(root);
    buildConsumer(root);
    const marker = path.join(root, '.claude-plugin/plugin.json');
    fs.rmSync(marker, { force: true });
    const fifo = spawnSync('mkfifo', [marker], { encoding: 'utf8', timeout: 2000 });
    assert.ifError(fifo.error);
    assert.strictEqual(fifo.status, 0, `mkfifo failed: ${fifo.stderr}`);

    const result = runValidate(root);
    assert.ifError(result.error);
    assert.ok(result.stdout, `expected JSON stdout, stderr=${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(claudeRow(report).config_load_ok, false, 'FIFO marker must fail source identity validation');
    assert.strictEqual(claudeRow(report).final_status, 'FAIL', 'FIFO marker must fail Claude validation');
    assert.strictEqual(report.gate, 'FAIL', 'FIFO marker must fail the validation gate');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source marker larger than 1 MiB fails without falling back to a valid consumer tree', () => {
  const root = mkTmp('source-oversized-marker');
  try {
    buildSource(root);
    buildConsumer(root);
    writeFile(
      path.join(root, '.claude-plugin/plugin.json'),
      validManifestPaddedTo(SOURCE_MANIFEST_MAX_BYTES + 1),
    );
    const report = reportFor(root);
    assert.strictEqual(claudeRow(report).config_load_ok, false, 'oversized marker must fail source identity validation');
    assert.strictEqual(claudeRow(report).final_status, 'FAIL', 'oversized marker must fail Claude validation');
    assert.strictEqual(report.gate, 'FAIL', 'oversized marker must fail the validation gate');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source marker exactly 1 MiB with valid dhpk JSON passes source validation', () => {
  const root = mkTmp('source-boundary-marker');
  try {
    buildSource(root);
    buildConsumer(root);
    writeFile(
      path.join(root, '.claude-plugin/plugin.json'),
      validManifestPaddedTo(SOURCE_MANIFEST_MAX_BYTES),
    );
    const report = reportFor(root);
    assert.strictEqual(claudeRow(report).config_load_ok, true, 'exactly 1 MiB marker must be accepted');
    assert.strictEqual(claudeRow(report).final_status, 'PASS', 'exactly 1 MiB marker must pass Claude validation');
    assert.strictEqual(report.gate, 'PASS', 'exactly 1 MiB marker must pass the validation gate');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('claimed source fails when any required root component is missing, including hooks', () => {
  for (const component of ['skills', 'commands', 'hooks', 'agents']) {
    const root = mkTmp('source-missing');
    try {
      buildSource(root);
      buildConsumer(root);
      fs.rmSync(path.join(root, component), { recursive: true, force: true });
      const row = claudeRow(reportFor(root));
      assert.strictEqual(row.final_status, 'FAIL', `missing ${component} must fail source validation`);
      if (component === 'hooks') assert.strictEqual(row.hook_case_state, 'FAIL', 'missing source hooks must be FAIL, not SKIP_INCOMPATIBLE');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('valid source marker and component symlinks are followed, while root lookalikes remain consumer layout', () => {
  const source = mkTmp('source-links-target');
  const root = mkTmp('source-links');
  try {
    buildSource(source);
    fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    fs.symlinkSync(path.join(source, '.claude-plugin/plugin.json'), path.join(root, '.claude-plugin/plugin.json'));
    for (const component of ['skills', 'commands', 'hooks', 'agents']) {
      fs.symlinkSync(path.join(source, component), path.join(root, component));
    }
    assert.strictEqual(claudeRow(reportFor(root)).final_status, 'PASS', 'valid source symlinks must be accepted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }

  const lookalike = mkTmp('source-lookalike');
  try {
    buildConsumer(lookalike);
    writeFile(path.join(lookalike, 'plugin.json'), '{"name":"dhpk"}\n');
    writeFile(path.join(lookalike, 'skills/root/SKILL.md'), '# Root lookalike\n');
    writeFile(path.join(lookalike, 'commands/demo.md'), '# Root lookalike\n');
    writeFile(path.join(lookalike, 'hooks/noop.sh'), '#!/bin/sh\n');
    writeFile(path.join(lookalike, 'agents/root.md'), '# Root lookalike\n');
    const row = claudeRow(reportFor(lookalike));
    assert.strictEqual(row.final_status, 'PASS', 'root lookalikes must retain consumer validation');
    assert.strictEqual(row.hook_case_state, 'SKIP_INCOMPATIBLE', 'consumer hook semantics must remain unchanged');
  } finally {
    fs.rmSync(lookalike, { recursive: true, force: true });
  }
});

test('source marker directories, invalid UTF-8, and excessive JSON nesting fail without consumer fallback', () => {
  for (const kind of ['directory', 'invalid-utf8', 'deep-json']) {
    const root = mkTmp('source-bounded');
    try {
      buildSource(root);
      buildConsumer(root);
      const marker = path.join(root, '.claude-plugin/plugin.json');
      fs.rmSync(marker);
      if (kind === 'directory') fs.mkdirSync(marker);
      if (kind === 'invalid-utf8') fs.writeFileSync(marker, Buffer.from([0xff]));
      if (kind === 'deep-json') fs.writeFileSync(marker, '['.repeat(2000) + ']'.repeat(2000));
      const result = spawnSync('python3', ['-B', SCRIPT, '--root', root, 'validate', '--format', 'json'], {
        encoding: 'utf8', timeout: 2000,
      });
      assert.ok(!result.error, `${kind} must return promptly: ${result.error}`);
      assert.strictEqual(result.status, 2, `${kind} must exit with validation failure`);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(claudeRow(report).config_load_ok, false, kind);
      assert.strictEqual(claudeRow(report).final_status, 'FAIL', kind);
      assert.strictEqual(report.gate, 'FAIL', kind);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

run('harness-govern-sync-source-validation');
