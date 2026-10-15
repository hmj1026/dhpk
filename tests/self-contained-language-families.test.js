'use strict';
// Deterministic resource/subprocess checks. Instruction behavior is evaluated
// separately with each family's evals/evals.json read/action/output oracles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test: registerTest, run } = require('./_lib/tinytest');
const root = path.resolve(__dirname, '..');
const only = process.argv[2];
function test(name, fn) { if (!only || name.startsWith(only)) registerTest(name, fn); }
function relocated(family, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-${family}-`));
  const copy = path.join(dir, family);
  try { fs.cpSync(path.join(root, 'skills', family), copy, { recursive: true }); fn(copy, dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
function closure(copy) {
  for (const file of files(copy).filter(f => f.endsWith('.md'))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /(?:skills\/dhpk-|modules\/|skills\/js-static-check-strategy)/, file);
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#|mailto:)/.test(match[1])) continue;
      const target = path.resolve(path.dirname(file), match[1].split('#')[0]);
      assert.ok(target.startsWith(copy + path.sep), `external link: ${file}: ${match[1]}`);
      assert.ok(fs.existsSync(target), `missing link: ${file}: ${match[1]}`);
    }
  }
}
function resources(copy, expected) { for (const name of expected) assert.ok(fs.existsSync(path.join(copy, name)), `missing ${name}`); }
function evals(copy) {
  const cases = JSON.parse(fs.readFileSync(path.join(copy, 'evals/evals.json'), 'utf8'));
  assert.ok(cases.evals.length >= 3);
  for (const item of cases.evals) {
    assert.ok(item.prompt && item.expected_output && item.expected_read_trace && item.expected_action_trace);
    for (const name of item.expected_read_trace.required) assert.ok(fs.existsSync(path.join(copy, name)), `eval requires missing ${name}`);
  }
}
test('swift isolated resource closure', () => relocated('swift', copy => {
  resources(copy, ['SKILL.md', 'references/language.md', 'references/ui.md', 'references/testing.md', 'references/platform.md', 'references/build.md', 'references/icon.md', 'scripts/iconify_gen.sh', 'scripts/generate_icons.swift']); closure(copy); evals(copy);
}));
test('swift icon subprocess writes three scales and catalog metadata', () => relocated('swift', (copy, dir) => {
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/bash\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then printf "<svg/>" > "$2"; exit 0; fi; shift; done\nprintf \'{"icons":["mdi:receipt"]}\'\n');
  fs.writeFileSync(path.join(bin, 'rsvg-convert'), '#!/bin/bash\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then printf "PNG" > "$2"; exit 0; fi; shift; done\n');
  for (const file of fs.readdirSync(bin)) fs.chmodSync(path.join(bin, file), 0o755);
  const output = path.join(dir, 'Assets.xcassets');
  const result = spawnSync('/bin/bash', [path.join(copy, 'scripts/iconify_gen.sh'), 'mdi:receipt', 'receipt', '--output', output, '--size', '24'], { cwd: dir, env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const imageset = path.join(output, 'receipt.imageset');
  const catalog = JSON.parse(fs.readFileSync(path.join(imageset, 'Contents.json'), 'utf8'));
  assert.deepEqual(catalog.images.map(i => i.scale), ['1x', '2x', '3x']);
  assert.deepEqual(catalog.images.map(i => i.filename), ['receipt.png', 'receipt@2x.png', 'receipt@3x.png']);
  for (const image of catalog.images) assert.ok(fs.statSync(path.join(imageset, image.filename)).size > 0);
}));
test('python isolated API/testing/static resource closure', () => relocated('python', copy => {
  resources(copy, ['SKILL.md', 'references/language.md', 'references/static.md', 'references/testing.md', 'references/fastapi.md']); closure(copy); evals(copy);
}));
test('js-static-checks isolated setup and rollout closure', () => relocated('js-static-checks', copy => {
  resources(copy, ['SKILL.md', 'references/setup.md', 'references/rollout.md', 'references/static-checks.md', 'references/frontend-review-patterns.md', 'scripts/status.js']); closure(copy); evals(copy);
}));
test('js-static-checks status subprocess preserves anchored buckets and read-only authority', () => relocated('js-static-checks', (copy, dir) => {
  const source = path.join(dir, 'consumer'); fs.mkdirSync(source);
  const input = { 'a.js': '// @ts-check\n', 'b.js': '// @ts-nocheck\n// TODO enable @ts-check\n', 'c.js': '// TODO enable @ts-check\n', 'd.js': '// @ts-check\n// @ts-nocheck\n' };
  for (const [name, body] of Object.entries(input)) fs.writeFileSync(path.join(source, name), body);
  fs.mkdirSync(path.join(source, 'nested')); fs.writeFileSync(path.join(source, 'nested/skip.js'), '// @ts-check\n');
  const run = target => spawnSync(process.execPath, [path.join(copy, 'scripts/status.js'), '--path', target], { cwd: dir, env: { PATH: '/usr/bin:/bin', HOME: dir }, encoding: 'utf8' });
  const result = run(source); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'PASS'); assert.deepEqual(report.counts, { total: 4, strict: 1, nocheck: 2, unmarked: 1 });
  assert.deepEqual(report.files, { strict: ['a.js'], nocheck: ['b.js','d.js'], unmarked: ['c.js'] });
  for (const [name, body] of Object.entries(input)) assert.equal(fs.readFileSync(path.join(source, name), 'utf8'), body);
  const missing = JSON.parse(run(path.join(dir, 'missing')).stdout); assert.equal(missing.status, 'UNAVAILABLE'); assert.equal(missing.counts, undefined);
}));
test('php isolated legacy modern and feature closure', () => relocated('php', copy => {
  resources(copy, ['SKILL.md', 'references/php56-legacy.md', 'references/7-4.md', 'references/8-x.md', 'references/feature-catalog.md', 'references/testing-quality.md', 'references/static-checks.md']); closure(copy); evals(copy);
  assert.equal(fs.existsSync(path.join(copy, 'references/yii1-1.md')), false, 'Yii framework owner remains separate');
}));
test('yii1 isolated development security and framework closure', () => relocated('yii1', copy => {
  resources(copy, ['SKILL.md', 'references/development.md', 'references/security.md', 'references/php56-php7-safe-subset.md', 'references/phpunit57-legacy-test-traps.md', 'references/yii1-backend-patterns.md', 'references/yii1-security-patterns.md']); closure(copy); evals(copy);
}));

for (const [family, required] of Object.entries({ swift: 'references/testing.md', python: 'references/fastapi.md', 'js-static-checks': 'references/setup.md', php: 'references/php56-legacy.md', yii1: 'references/security.md' })) {
  test(`${family} relocated missing and tampered resources fail closure`, () => relocated(family, copy => {
    const file = path.join(copy, required);
    const body = fs.readFileSync(file, 'utf8');
    fs.rmSync(file);
    assert.throws(() => resources(copy, [required]), /missing/);
    fs.writeFileSync(file, body + '\n[unexpected ambient resource](../../ambient/SKILL.md)\n');
    assert.throws(() => closure(copy), /external link/);
  }));
}
console.log('Host instruction behavior NOT_RUN by this test.');
run('self-contained-language-families');
