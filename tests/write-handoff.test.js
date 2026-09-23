'use strict';

// RED coverage for the explicit Save boundary. The writer must consume all of
// stdin, require an explicit destination, and revalidate every ancestor at the
// moment it creates or replaces the handoff.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const WRITE = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'write-handoff.sh');
const DETECT = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'detect-phase.sh');

function mkTmp(prefix = 'write-handoff-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function runWrite(cwd, handoffFile, input, env = {}) {
  const args = handoffFile ? [WRITE, handoffFile] : [WRITE];
  return spawnSync('/bin/bash', args, {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ...env },
  });
}

function runDetect(cwd, handoffFile) {
  return spawnSync('/bin/bash', [DETECT, handoffFile], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function assertWriterWasFound(result) {
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /write-handoff\.sh: No such file or directory/,
    'writer boundary is not installed');
}

function fullPayload() {
  return [
    'state: saved',
    'saved_at: 2020-01-01T00:00:00Z',
    'summary: explicit Save payload',
    `details: ${'安全な handoff 💾 '.repeat(2048)}`,
    '',
  ].join('\n');
}

test('write-handoff requires an explicit destination and does not use a default path', () => {
  const tmp = mkTmp();
  try {
    const result = runWrite(tmp, null, 'state: saved\n');
    assertWriterWasFound(result);
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /explicit|path|argument|handoff/i);
    assert.ok(!fs.existsSync(path.join(tmp, '.claude', 'artifacts', 'apply-resume', 'latest.md')),
      'missing explicit destination must not fall back to the legacy handoff');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('write-handoff creates the explicit destination and consumes the complete stdin payload', () => {
  const tmp = mkTmp();
  try {
    const handoff = path.join(tmp, 'explicit', 'nested', 'handoff.md');
    const payload = fullPayload();
    const result = runWrite(tmp, handoff, payload);
    assertWriterWasFound(result);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(fs.readFileSync(handoff, 'utf8'), payload);
    assert.ok(!fs.lstatSync(handoff).isSymbolicLink());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('write-handoff atomically replaces an existing explicit file on the same device', () => {
  const tmp = mkTmp();
  try {
    const handoff = path.join(tmp, 'explicit', 'handoff.md');
    fs.mkdirSync(path.dirname(handoff), { recursive: true });
    fs.writeFileSync(handoff, 'old payload\n');
    const before = fs.statSync(handoff);
    const payload = fullPayload();
    const result = runWrite(tmp, handoff, payload);
    assertWriterWasFound(result);
    const after = fs.statSync(handoff);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(fs.readFileSync(handoff, 'utf8'), payload);
    assert.strictEqual(after.dev, before.dev, 'replacement must remain on the selected filesystem');
    assert.notStrictEqual(after.ino, before.ino, 'replacement must publish a new inode atomically');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

for (const [label, parentRelative] of [
  ['.dhpk', '.dhpk'],
  ['.claude', '.claude'],
  ['an explicit nested parent', path.join('explicit', 'nested-parent')],
]) {
  test(`write-handoff rejects a missing leaf below a symlinked ${label}`, () => {
    const tmp = mkTmp();
    const external = mkTmp('write-handoff-external-');
    try {
      const symlinkParent = path.join(tmp, parentRelative);
      fs.mkdirSync(path.dirname(symlinkParent), { recursive: true });
      fs.symlinkSync(external, symlinkParent, 'dir');
      const handoff = path.join(symlinkParent, 'handoff', 'latest.md');
      const result = runWrite(tmp, path.relative(tmp, handoff), fullPayload());
      assertWriterWasFound(result);
      assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(`${result.stdout}\n${result.stderr}`, /symlink|ancestor|unsafe|destination/i);
      assert.ok(!fs.existsSync(path.join(external, 'handoff', 'latest.md')),
        'a rejected symlink ancestor must not receive the handoff');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  });
}

test('write-handoff rejects a destination symlink to a directory without touching its target', () => {
  const tmp = mkTmp();
  const external = mkTmp('write-handoff-destination-external-');
  try {
    const handoff = path.join(tmp, 'explicit', 'handoff.md');
    fs.mkdirSync(path.dirname(handoff), { recursive: true });
    fs.symlinkSync(external, handoff, 'dir');
    const result = runWrite(tmp, handoff, fullPayload());
    assertWriterWasFound(result);
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /symlink|unsafe|destination/i);
    assert.deepStrictEqual(fs.readdirSync(external), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('write-handoff revalidates ancestors after detect-phase reports a safe Save', () => {
  const tmp = mkTmp();
  const external = mkTmp('write-handoff-race-external-');
  try {
    const explicitRoot = path.join(tmp, 'explicit');
    const handoff = path.join(explicitRoot, 'nested', 'handoff.md');
    fs.mkdirSync(path.dirname(handoff), { recursive: true });
    const relative = path.relative(tmp, handoff);
    const detected = runDetect(tmp, relative);
    assert.strictEqual(detected.status, 0, detected.stderr);
    assert.strictEqual(detected.stdout.trim(), 'save');

    fs.rmSync(explicitRoot, { recursive: true, force: true });
    fs.symlinkSync(external, explicitRoot, 'dir');
    const written = runWrite(tmp, relative, fullPayload());
    assertWriterWasFound(written);
    assert.notStrictEqual(written.status, 0, `${written.stdout}\n${written.stderr}`);
    assert.match(`${written.stdout}\n${written.stderr}`, /symlink|ancestor|unsafe|destination/i);
    assert.ok(!fs.existsSync(path.join(external, 'nested', 'handoff.md')),
      'the writer must enforce the boundary again after detection');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('write-handoff reports an unavailable Python capability without a shell fallback', () => {
  const tmp = mkTmp();
  const commandPath = mkTmp('write-handoff-no-python-path-');
  try {
    for (const command of ['dirname', 'mkdir', 'rm', 'cat']) {
      fs.symlinkSync(`/usr/bin/${command}`, path.join(commandPath, command));
    }
    const handoff = path.join(tmp, 'explicit', 'handoff.md');
    const result = runWrite(tmp, handoff, fullPayload(), { PATH: commandPath });
    assertWriterWasFound(result);
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /python3|python|unavailable|required|capability/i);
    assert.ok(!fs.existsSync(handoff), 'unavailable Python must not trigger a guessed writer');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(commandPath, { recursive: true, force: true });
  }
});

run('write-handoff');
