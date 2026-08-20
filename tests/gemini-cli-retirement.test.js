'use strict';

// Contract coverage for retiring the Gemini CLI adapter while retaining the
// native AGY plugin, whose package is discovered under .gemini/config/plugins.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SYNC = path.join(ROOT, 'skills', 'dhpk-cross-agent-sync', 'scripts', 'multi_ai_sync.py');
const CONSTANTS = path.join(ROOT, 'skills', 'dhpk-cross-agent-sync', 'scripts', 'multi_ai_sync_lib', 'constants.py');
const SOURCES = path.join(ROOT, 'skills', 'dhpk-cross-agent-sync', 'scripts', 'multi_ai_sync_lib', 'sources.py');
const AGY_ADAPTER = path.join(ROOT, 'scripts', 'agy-adapt-agents.js');
const RETIRED_ADAPTER = path.join(ROOT, 'scripts', 'gemini-adapt-agents.js');
const HARNESS_ROOT = path.join(ROOT, 'skills', 'dhpk-harness-revise');
const CURRENT_REFERENCE_ROOT = path.join(ROOT, 'skills', 'dhpk-cross-agent-sync', 'references');
const CURRENT_DOCS = [
  path.join(ROOT, 'docs', 'basic-operations.md'),
  path.join(ROOT, 'docs', 'basic-operations.zh-TW.md'),
  path.join(ROOT, 'RELEASE.md'),
  path.join(ROOT, 'RELEASE.zh-TW.md'),
];

function runSync(args) {
  return spawnSync('python3', [SYNC, '--root', ROOT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('does not advertise Gemini CLI as a sync target', () => {
  const source = fs.readFileSync(CONSTANTS, 'utf8');
  assert.ok(!source.includes('"gemini"'), source);

  const rejected = runSync(['plan', '--targets', 'gemini', '--format', 'json']);
  assert.notStrictEqual(rejected.status, 0, rejected.stdout);
  assert.ok(rejected.stderr.includes('invalid choice'), rejected.stderr);
});

test('removes Gemini CLI source evidence while retaining the AGY native marker', () => {
  const source = fs.readFileSync(SOURCES, 'utf8');
  assert.ok(!source.includes('google-gemini/gemini-cli'), source);
  assert.ok(source.includes('.gemini/config/plugins/dhpk/plugin.json'), source);
});

test('uses an AGY-named adapter and retires the Gemini-named entrypoint', () => {
  assert.ok(fs.existsSync(AGY_ADAPTER), `missing ${AGY_ADAPTER}`);
  assert.ok(!fs.existsSync(RETIRED_ADAPTER), `retired adapter remains: ${RETIRED_ADAPTER}`);

  const packageSource = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'agy-plugin-package.js'), 'utf8');
  assert.ok(packageSource.includes("require('../agy-adapt-agents')"), packageSource);
});

test('removes retired Gemini CLI support from the current harness and references', () => {
  const files = [
    ...fs.readdirSync(HARNESS_ROOT, { recursive: true })
      .map((relative) => path.join(HARNESS_ROOT, relative))
      .filter((candidate) => fs.statSync(candidate).isFile()),
    ...fs.readdirSync(CURRENT_REFERENCE_ROOT)
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join(CURRENT_REFERENCE_ROOT, name)),
  ];
  const retiredPatterns = /Gemini CLI|Gemini target|Gemini command|gemini-cli|google-gemini\/gemini-cli|\.gemini\/(?:skills|commands|hooks)|GEMINI\.md/;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!retiredPatterns.test(source), `${file} still advertises Gemini CLI support`);
  }
});

test('describes the retained AGY native package instead of a Gemini adapter', () => {
  for (const file of CURRENT_DOCS) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!/Gemini\s*\/\s*Antigravity sync|Gemini and Antigravity|Gemini\/Antigravity/.test(source), `${file} still advertises Gemini adapter support`);
    assert.ok(source.includes('AGY') || source.includes('agy'), `${file} must name the retained AGY surface`);
  }
});

run('gemini-cli-retirement');
