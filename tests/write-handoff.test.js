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

{
  // F47 source block: set-handoff-state.test.js
  'use strict';

  // Coverage for skills/opsx-apply-resume/scripts/set-handoff-state.sh — atomically
  // updates the `state:` frontmatter field in .claude/artifacts/apply-resume/latest.md.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const SCRIPT = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'set-handoff-state.sh');

  function mkTmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'set-handoff-state-'));
  }

  function latestPath(dir) {
    return path.join(dir, '.claude', 'artifacts', 'apply-resume', 'latest.md');
  }

  function writeLatest(dir, state) {
    const p = latestPath(dir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `state: ${state}\nsaved_at: 2020-01-01T00:00:00Z\n`);
    return p;
  }

  function runScript(cwd, args) {
    return spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
  }

  test('valid state transition updates the state field in place', () => {
    const tmp = mkTmp();
    try {
      const p = writeLatest(tmp, 'saved');
      const before = fs.readFileSync(p, 'utf8');
      const res = runScript(tmp, ['consuming']);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.ok(res.stdout.includes('state updated to: consuming'));
      assert.strictEqual(
        fs.readFileSync(p, 'utf8'),
        before.replace(/^state: saved$/m, 'state: consuming'),
        'the state field changes while the rest of the handoff remains byte-identical',
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('invalid state value is rejected before touching the file', () => {
    const tmp = mkTmp();
    try {
      const p = writeLatest(tmp, 'saved');
      const before = fs.readFileSync(p, 'utf8');
      const res = runScript(tmp, ['bogus-state']);
      assert.strictEqual(res.status, 1);
      assert.ok(res.stdout.includes("invalid state 'bogus-state'"));
      assert.strictEqual(fs.readFileSync(p, 'utf8'), before, 'file must be unchanged on rejection');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('missing state argument → error, exit 1', () => {
    const tmp = mkTmp();
    try {
      writeLatest(tmp, 'saved');
      const res = runScript(tmp, []);
      assert.strictEqual(res.status, 1);
      assert.ok(res.stdout.includes('state argument required'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('missing latest.md file → error, exit 1', () => {
    const tmp = mkTmp();
    try {
      const res = runScript(tmp, ['saved']);
      assert.strictEqual(res.status, 1);
      assert.ok(res.stdout.includes('latest.md not found'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('existing leaf symlink is rejected without changing the external handoff', () => {
    const tmp = mkTmp();
    const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'set-handoff-external-')));
    try {
      const externalFile = path.join(external, 'latest.md');
      fs.writeFileSync(externalFile, 'state: saved\nsaved_at: 2020-01-01T00:00:00Z\n');
      const explicit = path.join(tmp, 'explicit', 'latest.md');
      fs.mkdirSync(path.dirname(explicit), { recursive: true });
      fs.symlinkSync(externalFile, explicit);
      const before = fs.readFileSync(externalFile, 'utf8');
      const res = runScript(tmp, ['consuming', path.relative(tmp, explicit)]);
      assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.match(`${res.stdout}\n${res.stderr}`, /symlink|unsafe|handoff/i);
      assert.strictEqual(fs.readFileSync(externalFile, 'utf8'), before,
        'a leaf symlink must not redirect the state update');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  test('existing symlinked parent is rejected without changing the external handoff', () => {
    const tmp = mkTmp();
    const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'set-handoff-parent-external-')));
    try {
      const externalFile = path.join(external, 'latest.md');
      fs.writeFileSync(externalFile, 'state: saved\nsaved_at: 2020-01-01T00:00:00Z\n');
      const explicitParent = path.join(tmp, 'explicit');
      fs.symlinkSync(external, explicitParent, 'dir');
      const explicit = path.join(explicitParent, 'latest.md');
      const before = fs.readFileSync(externalFile, 'utf8');
      const res = runScript(tmp, ['consuming', path.relative(tmp, explicit)]);
      assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.match(`${res.stdout}\n${res.stderr}`, /symlink|ancestor|unsafe|handoff/i);
      assert.strictEqual(fs.readFileSync(externalFile, 'utf8'), before,
        'a parent symlink must not redirect the state update');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  });
}

{
  // F47 source block: detect-phase.test.js
  'use strict';

  // Coverage for skills/opsx-apply-resume/scripts/detect-phase.sh — determines the
  // opsx-apply-resume phase from .claude/artifacts/apply-resume/latest.md.
  // The script reads a CWD-relative path, so each case runs from a scratch dir.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const SCRIPT = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'detect-phase.sh');

  function mkTmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'detect-phase-'));
  }

  function latestPath(dir) {
    return path.join(dir, '.claude', 'artifacts', 'apply-resume', 'latest.md');
  }

  function writeLatest(dir, state, savedAt) {
    const p = latestPath(dir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `state: ${state}\nsaved_at: ${savedAt}\n`);
  }

  function runScript(cwd, handoffFile) {
    const args = handoffFile ? [SCRIPT, handoffFile] : [SCRIPT];
    return spawnSync('bash', args, { cwd, encoding: 'utf8', timeout: 10000 });
  }

  test('no latest.md → save', () => {
    const tmp = mkTmp();
    try {
      const res = runScript(tmp);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), 'save');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('state: saved, old timestamp → resume', () => {
    const tmp = mkTmp();
    try {
      writeLatest(tmp, 'saved', '2020-01-01T00:00:00Z');
      const res = runScript(tmp);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), 'resume');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('state: saved, very recent timestamp → warn-recent', () => {
    const tmp = mkTmp();
    try {
      const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      writeLatest(tmp, 'saved', now);
      const res = runScript(tmp);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), 'warn-recent');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('state: consuming → consuming', () => {
    const tmp = mkTmp();
    try {
      writeLatest(tmp, 'consuming', '2020-01-01T00:00:00Z');
      const res = runScript(tmp);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), 'consuming');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('unknown/corrupt state → save', () => {
    const tmp = mkTmp();
    try {
      writeLatest(tmp, 'garbled', '2020-01-01T00:00:00Z');
      const res = runScript(tmp);
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout.trim(), 'save');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  for (const [label, parentRelative] of [
    ['.dhpk', '.dhpk'],
    ['.claude', '.claude'],
    ['an explicit nested parent', path.join('explicit', 'nested-parent')],
  ]) {
    test(`missing explicit handoff below symlinked ${label} fails before Save`, () => {
      const tmp = mkTmp();
      const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'detect-phase-external-')));
      try {
        const symlinkParent = path.join(tmp, parentRelative);
        fs.mkdirSync(path.dirname(symlinkParent), { recursive: true });
        fs.symlinkSync(external, symlinkParent, 'dir');
        const handoff = path.join(symlinkParent, 'handoff', 'latest.md');
        const relativeHandoff = path.relative(tmp, handoff);
        const res = runScript(tmp, relativeHandoff);
        assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
        assert.doesNotMatch(res.stdout, /^save\s*$/m, 'unsafe missing leaf must not select Save');
        assert.ok(!fs.existsSync(path.join(external, 'handoff', 'latest.md')),
          'detector must not create or touch a handoff beneath the external target');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(external, { recursive: true, force: true });
      }
    });
  }
}

{
  // F47 source block: portable-workflow-runtime.test.js
  'use strict';

  // RED contract for portable workflow helpers and the JS static-check status
  // entrypoint.  These tests exercise the caller-facing shell/CLI interfaces so
  // a Codex handoff path cannot silently alter the legacy Claude path.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const DETECT = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'detect-phase.sh');
  const SET_STATE = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'set-handoff-state.sh');
  const STATUS = path.join(ROOT, 'skills', 'js-static-check-strategy', 'scripts', 'status.js');

  function makeTemp(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  function legacyPath(root) {
    return path.join(root, '.claude', 'artifacts', 'apply-resume', 'latest.md');
  }

  function writeHandoff(file, state, savedAt = '2020-01-01T00:00:00Z') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `state: ${state}\nsaved_at: ${savedAt}\n`);
  }

  function runDetect(cwd, handoffFile) {
    const args = handoffFile ? [DETECT, handoffFile] : [DETECT];
    return spawnSync('bash', args, { cwd, encoding: 'utf8', timeout: 10000 });
  }

  function runSet(cwd, state, handoffFile) {
    const args = handoffFile ? [SET_STATE, state, handoffFile] : [SET_STATE, state];
    return spawnSync('bash', args, { cwd, encoding: 'utf8', timeout: 10000 });
  }

  test('detect-phase accepts an explicit handoff file without reading the legacy file', () => {
    const tmp = makeTemp('portable-detect-');
    try {
      const legacy = legacyPath(tmp);
      const explicit = path.join(tmp, 'codex', 'handoff.md');
      writeHandoff(legacy, 'consuming');
      writeHandoff(explicit, 'saved');
      const result = runDetect(tmp, explicit);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout.trim(), 'resume');
      assert.match(fs.readFileSync(legacy, 'utf8'), /^state: consuming$/m);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('detect-phase keeps the legacy relative path as the default interface', () => {
    const tmp = makeTemp('portable-detect-default-');
    try {
      writeHandoff(legacyPath(tmp), 'consuming');
      const result = runDetect(tmp);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout.trim(), 'consuming');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('set-handoff-state updates only the explicit file when one is supplied', () => {
    const tmp = makeTemp('portable-set-state-');
    try {
      const legacy = legacyPath(tmp);
      const explicit = path.join(tmp, 'codex', 'handoff.md');
      writeHandoff(legacy, 'saved');
      writeHandoff(explicit, 'consuming');
      const result = runSet(tmp, 'consumed', explicit);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(fs.readFileSync(explicit, 'utf8'), /^state: consumed$/m);
      assert.match(fs.readFileSync(legacy, 'utf8'), /^state: saved$/m);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('set-handoff-state retains the legacy path when no explicit file is supplied', () => {
    const tmp = makeTemp('portable-set-state-default-');
    try {
      const legacy = legacyPath(tmp);
      writeHandoff(legacy, 'saved');
      const result = runSet(tmp, 'consuming');
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(fs.readFileSync(legacy, 'utf8'), /^state: consuming$/m);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('JS status counts only immediate files and only anchored directives', () => {
    const tmp = makeTemp('portable-ts-status-');
    try {
      fs.writeFileSync(path.join(tmp, 'strict.js'), '// @ts-check\nconst strict = true;\n');
      fs.writeFileSync(path.join(tmp, 'transition.js'), '// @ts-nocheck\nconst transition = true;\n');
      fs.writeFileSync(path.join(tmp, 'comment-only.js'), '// TODO: enable @ts-check after cleanup\n');
      fs.mkdirSync(path.join(tmp, 'nested'));
      fs.writeFileSync(path.join(tmp, 'nested', 'ignored.js'), '// @ts-check\n');

      const result = spawnSync('node', [STATUS, '--path', tmp], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /total=3\s+strict=1\s+nocheck=1\s+unmarked=1/);
      assert.match(result.stdout, /strict\.js/);
      assert.match(result.stdout, /transition\.js/);
      assert.match(result.stdout, /comment-only\.js/);
      assert.doesNotMatch(result.stdout, /ignored\.js/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('JS status reports a missing scan path without fabricating counts', () => {
    const tmp = makeTemp('portable-ts-status-missing-');
    const missing = path.join(tmp, 'does-not-exist');
    try {
      const result = spawnSync('node', [STATUS, '--path', missing], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /scan path .*does-not-exist.*does not exist/i);
      assert.doesNotMatch(result.stdout, /total=\d+\s+strict=\d+/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

run('write-handoff');
