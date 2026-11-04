'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { runHook } = require('./_lib/hookharness');

test('broad grep extraction from a protected file is blocked', () => {
  const result = runHook('pre-bash-guard.sh', {
    payload: { tool_input: { command: "grep -o 'host=[^;]*' .env" } },
  });
  assert.strictEqual(result.status, 2);
});



const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const python = fs.realpathSync(spawnSync('which', ['python3'], { encoding: 'utf8' }).stdout.trim());
const helper = path.resolve(__dirname, '../scripts/hooks/credential-extract.py');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'credential-extract-')));
const fixture = path.join(root, '.env');
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

function invoke(args) {
  const result = spawnSync(python, ['-I', '-S', helper, ...args], { encoding: 'utf8' });
  assert.ok(!result.error, String(result.error));
  assert.doesNotMatch(result.stdout + result.stderr, /FAKE_SECRET/);
  return result;
}

function withInput(data, fields = 'host,dbname') {
  fs.writeFileSync(fixture, data);
  return invoke(['--file', fixture, '--fields', fields]);
}

test('valid DSN emits exactly the requested fields after validating optional values', () => {
  const dsn = 'mysql:charset=utf8mb4;host=db.example.test;port=3306;dbname=shop_1\n';
  for (const [fields, expected] of [
    ['host', '{"host":"db.example.test"}\n'],
    ['dbname', '{"dbname":"shop_1"}\n'],
    ['host,dbname', '{"host":"db.example.test","dbname":"shop_1"}\n'],
  ]) {
    const result = withInput(dsn, fields);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, expected);
    assert.strictEqual(result.stderr, '');
  }
});

test('ambiguous, untrusted or oversized input fails without content or partial output', () => {
  const invalid = [
    'mysql:host=db;dbname=shop;password=FAKE_SECRET_PASSWORD',
    'mysql:host=db;dbname=shop;host=FAKE_SECRET_HOST',
    'mysql:host=db;dbname=shop;port=65536',
    'mysql:host=db;dbname=shop;port=0',
    'mysql:host=db;dbname=shop;charset=utf-8',
    'mysql:host=db;dbname=shop;other=FAKE_SECRET_TOKEN',
    'mysql:host=db;dbname=shop;',
    'mysql:host=db;dbname=shop\nFAKE_SECRET_TOKEN',
    'mysql:host=db;dbname=${FAKE_SECRET_TOKEN}',
    'mysql:host=db;dbname=shop\\FAKE_SECRET_TOKEN',
    'mysql:host=db',
    'mysql:host=db;dbname=' + 'a'.repeat(1025),
    "<?php return 'mysql:host=db;dbname=shop'; // FAKE_SECRET_TOKEN",
    'mysql:host=db;dbname=shop\r\n',
  ];
  for (const data of invalid) {
    const result = withInput(data, 'host');
    assert.strictEqual(result.status, 2);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, 'Credential extraction rejected.\n');
  }
});

test('extra, reordered, and widening arguments are rejected without echo', () => {
  fs.writeFileSync(fixture, 'mysql:host=db;dbname=shop');
  for (const args of [
    ['--file', fixture, '--fields', 'host', '--verbose'],
    ['--file', fixture, '--fields', 'host,password'],
    ['--file', fixture, '--fields', 'dbname,host'],
    ['--fields', 'host', '--file', fixture],
    ['--file', fixture, '--fields', 'FAKE_SECRET_TOKEN'],
    ['--help'],
  ]) {
    const result = invoke(args);
    assert.strictEqual(result.status, 2);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, 'Credential extraction rejected.\n');
  }
});

test('symlinks, directories, relative paths and missing files fail closed', () => {
  fs.writeFileSync(fixture, 'mysql:host=db;dbname=shop');
  const link = path.join(root, 'link');
  fs.symlinkSync(fixture, link);
  const dirlink = path.join(root, 'dirlink');
  fs.symlinkSync(root, dirlink);
  for (const target of [link, path.join(dirlink, '.env'), root, '.env', path.join(root, 'missing')]) {
    const result = invoke(['--file', target, '--fields', 'host']);
    assert.strictEqual(result.status, 2);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, 'Credential extraction rejected.\n');
  }
});

run('credential-extract');
