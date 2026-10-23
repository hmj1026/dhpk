'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'scripts/cli-dispatch/verify-handoff.js');
const WRITER_SNAPSHOT_SHA256 = '45ab7668ee0b4cb0ea0dc49ec4e638ac5285171f555fd4f66f737fbc455baf59';
const REPLACEMENT_SNAPSHOT_SHA256 = '75045885fd9006985e6e8a374dd1e221eb8fafe42c4d689c10c1b6480e4753ad';

function createFixture() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, 'dhpk-verify-handoff-'));
  const writerRoot = path.join(directory, 'writer');
  const consumerRoot = path.join(directory, 'consumer');
  const receiptPath = path.join(directory, 'handoff.json');
  fs.mkdirSync(writerRoot);
  fs.mkdirSync(consumerRoot);
  fs.mkdirSync(path.join(writerRoot, 'src'));
  fs.writeFileSync(path.join(writerRoot, 'src/owned.txt'), 'writer snapshot\n');

  return {
    directory,
    writerRoot,
    consumerRoot,
    receiptPath,
    writeReceipt(receipt) {
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    },
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function runGate(fixture, receipt, childArgv, assignedFiles = ['src/owned.txt']) {
  if (receipt !== undefined) fixture.writeReceipt(receipt);
  const argv = [
    CLI,
    '--root', fixture.writerRoot,
    '--handoff', fixture.receiptPath,
  ];
  for (const assignedFile of assignedFiles || []) argv.push('--assigned-file', assignedFile);
  argv.push(
    '--',
    ...childArgv,
  );
  return spawnSync(process.execPath, argv, {
    cwd: fixture.consumerRoot,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('help prints portable usage and succeeds without verification arguments', () => {
  const result = spawnSync(process.execPath, [CLI, '--help'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout: 10000,
  });

  assert.strictEqual(result.status, 0, diagnostic(result));
  assert.match(diagnostic(result), /--assigned-file/);
  assert.ok(!diagnostic(result).includes(ROOT), 'help must not leak the checkout path');
});

test('missing parent-assigned file scope fails before the downstream command runs', () => {
  const fixture = createFixture();
  const markerPath = path.join(fixture.consumerRoot, 'ran');
  try {
    const result = runGate(fixture, validReceipt(), markerCommand(markerPath), []);

    assert.notStrictEqual(result.status, 0);
    assert.match(diagnostic(result), /assigned-file|scope/i);
    assert.strictEqual(fs.existsSync(markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('duplicate parent-assigned paths fail before the downstream command runs', () => {
  const fixture = createFixture();
  const markerPath = path.join(fixture.consumerRoot, 'ran');
  try {
    const result = runGate(fixture, validReceipt(), markerCommand(markerPath), ['src/owned.txt', 'src/owned.txt']);

    assert.notStrictEqual(result.status, 0);
    assert.match(diagnostic(result), /duplicate.*assigned-file|assigned-file.*duplicate/i);
    assert.strictEqual(fs.existsSync(markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('receipt omissions fail exact parent-assignment comparison before the child runs', () => {
  const fixture = createFixture();
  const markerPath = path.join(fixture.consumerRoot, 'ran');
  try {
    fs.writeFileSync(path.join(fixture.writerRoot, 'src/other.txt'), 'replacement snapshot\n');
    const result = runGate(
      fixture,
      validReceipt({ 'src/owned.txt': WRITER_SNAPSHOT_SHA256 }),
      markerCommand(markerPath),
      ['src/owned.txt', 'src/other.txt'],
    );

    assert.notStrictEqual(result.status, 0);
    assert.match(diagnostic(result), /src\/other\.txt/);
    assert.doesNotMatch(diagnostic(result), /unknown option/);
    assert.strictEqual(fs.existsSync(markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('receipt extras fail exact parent-assignment comparison before the child runs', () => {
  const fixture = createFixture();
  const markerPath = path.join(fixture.consumerRoot, 'ran');
  try {
    fs.writeFileSync(path.join(fixture.writerRoot, 'src/other.txt'), 'replacement snapshot\n');
    const result = runGate(
      fixture,
      validReceipt({
        'src/owned.txt': WRITER_SNAPSHOT_SHA256,
        'src/other.txt': REPLACEMENT_SNAPSHOT_SHA256,
      }),
      markerCommand(markerPath),
      ['src/owned.txt'],
    );

    assert.notStrictEqual(result.status, 0);
    assert.match(diagnostic(result), /src\/other\.txt/);
    assert.doesNotMatch(diagnostic(result), /unknown option/);
    assert.strictEqual(fs.existsSync(markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

function validReceipt(files = { 'src/owned.txt': WRITER_SNAPSHOT_SHA256 }) {
  return { status: 'DONE', files };
}

function markerCommand(markerPath) {
  return [
    process.execPath,
    '-e',
    'require("node:fs").writeFileSync(process.argv[1], "ran")',
    markerPath,
  ];
}

function diagnostic(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

test('valid completion receipt runs argv literally in the consumer working directory', () => {
  const fixture = createFixture();
  const observedPath = path.join(fixture.consumerRoot, 'observed.json');
  const literalArgument = 'value with spaces; $HOME';
  try {
    const result = runGate(fixture, validReceipt(), [
      process.execPath,
      '-e',
      'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }))',
      observedPath,
      literalArgument,
    ]);

    assert.strictEqual(result.status, 0, diagnostic(result));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(observedPath, 'utf8')), {
      cwd: fixture.consumerRoot,
      args: [literalArgument],
    });
  } finally {
    fixture.cleanup();
  }
});

test('non-DONE receipts fail before the downstream command can create side effects', () => {
  for (const status of ['WRITING', 'PARTIAL']) {
    const fixture = createFixture();
    const markerPath = path.join(fixture.consumerRoot, 'ran');
    try {
      const result = runGate(fixture, { status, files: { 'src/owned.txt': WRITER_SNAPSHOT_SHA256 } }, markerCommand(markerPath));

      assert.notStrictEqual(result.status, 0, `status ${status} must fail closed`);
      assert.match(diagnostic(result), /DONE|completion/i);
      assert.strictEqual(fs.existsSync(markerPath), false, `status ${status} must not launch the child`);
    } finally {
      fixture.cleanup();
    }
  }
});

test('a missing receipt fails before the downstream command can create side effects', () => {
  const fixture = createFixture();
  const markerPath = path.join(fixture.consumerRoot, 'ran');
  try {
    const result = runGate(fixture, undefined, markerCommand(markerPath));

    assert.notStrictEqual(result.status, 0);
    assert.match(diagnostic(result), /receipt|ENOENT/i);
    assert.strictEqual(fs.existsSync(markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('empty or unsafe assigned-file maps fail before the downstream command runs', () => {
  for (const [files, expectedMessage] of [
    [{}, /file|empty|assigned/i],
    [{ '../outside.txt': WRITER_SNAPSHOT_SHA256 }, /path|relative|escape/i],
    [{ 'C:outside.txt': WRITER_SNAPSHOT_SHA256 }, /path|relative|escape/i],
  ]) {
    const fixture = createFixture();
    const markerPath = path.join(fixture.consumerRoot, 'ran');
    try {
      const result = runGate(fixture, { status: 'DONE', files }, markerCommand(markerPath));

      assert.notStrictEqual(result.status, 0);
      assert.match(diagnostic(result), expectedMessage);
      assert.strictEqual(fs.existsSync(markerPath), false);
    } finally {
      fixture.cleanup();
    }
  }
});

test('symbolic links in the assigned path fail before the downstream command runs', () => {
  const fixture = createFixture();
  const outsidePath = path.join(fixture.directory, 'outside.txt');
  const linkedPath = path.join(fixture.writerRoot, 'src/linked.txt');
  const markerPath = path.join(fixture.consumerRoot, 'ran');
  try {
    fs.writeFileSync(outsidePath, 'outside writer root\n');
    fs.symlinkSync(outsidePath, linkedPath);
    const result = runGate(
      fixture,
      validReceipt({ 'src/linked.txt': WRITER_SNAPSHOT_SHA256 }),
      markerCommand(markerPath),
      ['src/linked.txt'],
    );

    assert.notStrictEqual(result.status, 0);
    assert.match(diagnostic(result), /symbolic link/i);
    assert.strictEqual(fs.existsSync(markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('stale writer hashes fail before the downstream command can create side effects', () => {
  const fixture = createFixture();
  const markerPath = path.join(fixture.consumerRoot, 'ran');
  try {
    const result = runGate(fixture, validReceipt({ 'src/owned.txt': '0'.repeat(64) }), markerCommand(markerPath));

    assert.notStrictEqual(result.status, 0);
    assert.match(diagnostic(result), /hash|snapshot|match|changed/i);
    assert.strictEqual(fs.existsSync(markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('writer-scope changes made while the downstream command runs cannot produce PASS', () => {
  const fixture = createFixture();
  const ownedPath = path.join(fixture.writerRoot, 'src/owned.txt');
  try {
    const result = runGate(fixture, validReceipt(), [
      process.execPath,
      '-e',
      'require("node:fs").writeFileSync(process.argv[1], "replacement snapshot\\n")',
      ownedPath,
    ]);

    assert.notStrictEqual(result.status, 0, diagnostic(result));
    assert.match(diagnostic(result), /hash|snapshot|match|changed/i);
    assert.ok(diagnostic(result).includes(REPLACEMENT_SNAPSHOT_SHA256), 'post-check must report the independently known replacement SHA256');
    assert.strictEqual(fs.readFileSync(ownedPath, 'utf8'), 'replacement snapshot\n');
  } finally {
    fixture.cleanup();
  }
});

test('a file changed and restored during verification still invalidates the checked snapshot', () => {
  const fixture = createFixture();
  const ownedPath = path.join(fixture.writerRoot, 'src/owned.txt');
  try {
    const result = runGate(fixture, validReceipt(), [
      process.execPath,
      '-e',
      'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], "temporary change\\n"); fs.writeFileSync(process.argv[1], "writer snapshot\\n")',
      ownedPath,
    ]);

    assert.notStrictEqual(result.status, 0, diagnostic(result));
    assert.match(diagnostic(result), /snapshot|changed/i);
    assert.strictEqual(fs.readFileSync(ownedPath, 'utf8'), 'writer snapshot\n');
  } finally {
    fixture.cleanup();
  }
});

test('a null hash records an assigned file that the writer deleted', () => {
  const fixture = createFixture();
  const markerPath = path.join(fixture.consumerRoot, 'ran');
  try {
    fs.unlinkSync(path.join(fixture.writerRoot, 'src/owned.txt'));
    const result = runGate(fixture, validReceipt({ 'src/owned.txt': null }), markerCommand(markerPath));

    assert.strictEqual(result.status, 0, diagnostic(result));
    assert.strictEqual(fs.readFileSync(markerPath, 'utf8'), 'ran');
  } finally {
    fixture.cleanup();
  }
});

test('the downstream command failure remains nonzero after an unchanged snapshot check', () => {
  const fixture = createFixture();
  try {
    const result = runGate(fixture, validReceipt(), [process.execPath, '-e', 'process.exit(23)']);

    assert.strictEqual(result.status, 23, diagnostic(result));
  } finally {
    fixture.cleanup();
  }
});

run('verify-handoff');
