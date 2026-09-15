'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { deriveArgumentHint } = require('../scripts/lib/skill-usage');

const ROOT = path.join(__dirname, '..');
const CARD = path.join(ROOT, 'skills/flow-guide/scripts/usage-card.js');
const GENERATOR = path.join(ROOT, 'scripts/ci/gen-skill-usage.js');

function help(args = []) {
  return spawnSync(process.execPath, [CARD, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function jsonHelp(name) {
  const result = help(['--json', name]);
  assert.strictEqual(result.status, 0, (result.stdout || '') + (result.stderr || ''));
  return JSON.parse(result.stdout);
}

test('$flow-guide help cards disclose inputs, enums, defaults, and retired markers', () => {
  const card = jsonHelp('flow-drive');
  assert.deepStrictEqual(card.inputs.map((input) => input.id), ['confirmed-spec-or-change-id']);
  const worker = card.options.find((option) => option.id === 'worker');
  assert.deepStrictEqual(worker.enum_values, ['claude', 'codex', 'agy', 'auto']);
  const crossProvider = card.options.find((option) => option.id === 'cross-provider');
  assert.strictEqual(crossProvider.default, false);
  const retired = card.options.find((option) => option.id === 'codex');
  assert.strictEqual(retired.legacy.diagnostic_only, true);
  assert.strictEqual(retired.legacy.replacement_id, 'worker');
});

test('$flow-guide help variants remain metadata-only and deterministic', () => {
  const list = help([]);
  assert.strictEqual(list.status, 0, (list.stdout || '') + (list.stderr || ''));
  const names = (list.stdout || '').split(/\r?\n/)
    .map((line) => line.match(/^[-*] ([a-z][a-z0-9-]*):/))
    .filter(Boolean)
    .map((match) => match[1]);
  assert.deepStrictEqual(names, [...names].sort((left, right) => left.localeCompare(right)));

  for (const name of ['flow-guide', 'flow-drive']) {
    const result = help([name]);
    assert.strictEqual(result.status, 0, (result.stdout || '') + (result.stderr || ''));
    assert.match(result.stdout, new RegExp('\\$' + name));
    assert.doesNotMatch(result.stdout, /execute target|load target procedure|workspace-write granted/i);
  }
  assert.match(help(['flow-drive']).stdout, /--worker-target=<provider>\/\\?<model>|--worker-target=<provider>\/\\?\<model>/i);
});

test('generated usage artifacts bind to one catalog revision and derive Argument Hints', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/flow-guide/references/codex-usage-catalog.json'), 'utf8'));
  assert.ok(catalog.sourceInventoryRevision);
  assert.match(fs.readFileSync(path.join(ROOT, 'docs/codex-skill-usage.md'), 'utf8'), new RegExp(catalog.sourceInventoryRevision));
  const flowDrive = inventory.skills.find((skill) => skill.id === 'flow-drive');
  const frontmatter = fs.readFileSync(path.join(ROOT, 'skills/flow-drive/SKILL.md'), 'utf8');
  assert.match(frontmatter, new RegExp("^argument-hint: '" + deriveArgumentHint(flowDrive.name, flowDrive.usage.syntax).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'm'));
});

test('generator check detects manual edits to generated usage documentation', () => {
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-usage-projection-')));
  try {
    fs.mkdirSync(path.join(fixture, 'manifests'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'skills/flow-guide/references'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'docs'), { recursive: true });
    for (const relative of ['manifests/distribution-inventory.json', 'skills/flow-guide/references/codex-usage-catalog.json', 'docs/codex-skill-usage.md', 'docs/codex-skill-usage.zh-TW.md']) {
      const destination = path.join(fixture, relative);
      fs.copyFileSync(path.join(ROOT, relative), destination);
    }
    fs.appendFileSync(path.join(fixture, 'docs/codex-skill-usage.md'), 'manual edit\n');
    const result = spawnSync(process.execPath, [GENERATOR, '--check', '--root', fixture], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.notStrictEqual(result.status, 0);
    assert.match((result.stdout || '') + (result.stderr || ''), /documentation|drift/i);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('Codex metadata keeps the narrow OpenAI interface without custom argument schema', () => {
  for (const name of ['flow-guide', 'flow-drive']) {
    const metadata = fs.readFileSync(path.join(ROOT, 'skills', name, 'agents/openai.yaml'), 'utf8');
    assert.doesNotMatch(metadata, /argument_schema|input_schema|parameters:|arguments:/i);
    assert.match(metadata, new RegExp('default_prompt: "Use \\$' + name));
  }
});

run('skill-usage-projections');
