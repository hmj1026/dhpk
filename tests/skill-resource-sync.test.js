'use strict';

// Core RED contract for repository-only shared-resource synchronization.
// The result shape chosen for plan/check/write is { ok, changes, errors }:
// ok means the requested state is valid/clean, changes describes planned or
// observed drift, and errors carries human-readable diagnostics.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIBRARY = path.join(ROOT, 'scripts', 'lib', 'skill-resource-sync.js');
const ACTIVE_ID = 'active-id';
const ACTIVE_NAME = 'dhpk-active-skill';
const ACTIVE_PATH = `skills/${ACTIVE_NAME}`;
const SOURCE = 'shared/runtime.js';
const DESTINATION = `${ACTIVE_PATH}/scripts/runtime.js`;

function loadLibrary() {
  try {
    return require(LIBRARY);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND'
      && String(error.message || '').includes('skill-resource-sync')) {
      assert.fail(`skill-resource-sync library is missing: ${LIBRARY}`);
    }
    throw error;
  }
}

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-resource-sync-core-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function inventoryFixture() {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: ACTIVE_ID, name: ACTIVE_NAME, path: ACTIVE_PATH, lifecycle: 'promoted' }],
  };
}

function mapFixture(mappings = [{ source: SOURCE, destination: 'scripts/runtime.js' }]) {
  return { schema: 'dhpk.skill-resources.v1', skills: { [ACTIVE_ID]: mappings } };
}

function ledgerFixture(files = {}) {
  return { schema: 'dhpk.skill-resource-copies.v1', files };
}

function createFixture() {
  const root = temporaryRoot();
  const inventory = inventoryFixture();
  const map = mapFixture();
  const ledger = ledgerFixture();
  fs.mkdirSync(path.join(root, ACTIVE_PATH), { recursive: true });
  fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
  fs.writeFileSync(
    path.join(root, ACTIVE_PATH, 'SKILL.md'),
    `---\nname: ${ACTIVE_NAME}\ndescription: sync fixture\n---\n`,
  );
  fs.writeFileSync(path.join(root, SOURCE), '#!/usr/bin/env node\nconsole.log("literal fixture");\n');
  fs.chmodSync(path.join(root, SOURCE), 0o755);
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'preserve this file\n');
  fs.writeFileSync(path.join(root, ACTIVE_PATH, 'unrelated.txt'), 'consumer-owned\n');
  writeJson(path.join(root, 'manifests', 'distribution-inventory.json'), inventory);
  writeJson(path.join(root, 'manifests', 'skill-resources.json'), map);
  writeJson(path.join(root, 'manifests', 'skill-resource-copies.json'), ledger);
  return { root, inventory, map, ledger };
}

function readLedger(root) {
  return JSON.parse(fs.readFileSync(
    path.join(root, 'manifests', 'skill-resource-copies.json'),
    'utf8',
  ));
}

function replaceMap(root, map) {
  writeJson(path.join(root, 'manifests', 'skill-resources.json'), map);
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function mode(file) {
  return (fs.statSync(file).mode & 0o777).toString(8).padStart(4, '0');
}

function snapshot(root) {
  const rows = [];
  function visit(directory, relative) {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const child = relative ? path.join(relative, name) : name;
      const stat = fs.lstatSync(absolute);
      const row = {
        path: child.split(path.sep).join('/'),
        type: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file',
        mode: (stat.mode & 0o777).toString(8),
      };
      if (stat.isSymbolicLink()) row.value = fs.readlinkSync(absolute);
      else if (stat.isFile()) row.value = fs.readFileSync(absolute).toString('base64');
      rows.push(row);
      if (stat.isDirectory()) visit(absolute, child);
    }
  }
  visit(root, '');
  return JSON.stringify(rows);
}

function assertResult(result, label, expectedOk) {
  assert.ok(result && typeof result === 'object', `${label} must return an object`);
  assert.strictEqual(typeof result.ok, 'boolean', `${label}.ok must be boolean`);
  assert.ok(Array.isArray(result.changes), `${label}.changes must be an array`);
  assert.ok(Array.isArray(result.errors), `${label}.errors must be an array`);
  if (expectedOk !== undefined) assert.strictEqual(result.ok, expectedOk, label);
  return result;
}

function mentions(result, relative) {
  return result.changes.some((change) => JSON.stringify(change).includes(relative));
}

async function expectFailure(action) {
  let error;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'operation must fail explicitly');
  return error;
}

async function writeFixture(api, fixture) {
  assert.strictEqual(typeof api.writeSkillResources, 'function', 'writeSkillResources API is required');
  return api.writeSkillResources({ root: fixture.root });
}

test('skill-resource-sync exports the four foundation API functions', () => {
  const api = loadLibrary();
  for (const name of [
    'validateSkillResourceMap',
    'planSkillResourceSync',
    'checkSkillResources',
    'writeSkillResources',
  ]) {
    assert.strictEqual(typeof api[name], 'function', `${name} must be exported`);
  }
});

test('write copies one source with literal bytes and mode 0755 into the ledger', async () => {
  const fixture = createFixture();
  try {
    const api = loadLibrary();
    const result = assertResult(await writeFixture(api, fixture), 'writeSkillResources', true);
    assert.ok(result.changes.length >= 1, 'first write must report the copied resource');
    const source = path.join(fixture.root, SOURCE);
    const destination = path.join(fixture.root, DESTINATION);
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), fs.readFileSync(source, 'utf8'));
    assert.strictEqual(mode(destination), '0755', 'executable mode must be preserved');
    const ledger = readLedger(fixture.root);
    assert.deepStrictEqual(Object.keys(ledger.files), [DESTINATION]);
    assert.deepStrictEqual(ledger.files[DESTINATION], {
      skill_id: ACTIVE_ID,
      source: SOURCE,
      sha256: `sha256:${digest(source)}`,
      mode: '0755',
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('check reports missing and stale resources read-only', async () => {
  const fixture = createFixture();
  try {
    const api = loadLibrary();
    await writeFixture(api, fixture);
    const destination = path.join(fixture.root, DESTINATION);
    fs.rmSync(destination);
    const beforeMissing = snapshot(fixture.root);
    const missing = assertResult(await api.checkSkillResources({ root: fixture.root }), 'missing check', false);
    assert.ok(mentions(missing, 'scripts/runtime.js'));
    assert.strictEqual(snapshot(fixture.root), beforeMissing, 'check must not repair missing output');

    await writeFixture(api, fixture);
    fs.appendFileSync(path.join(fixture.root, SOURCE), '// stale source\n');
    const beforeStale = snapshot(fixture.root);
    const stale = assertResult(await api.checkSkillResources({ root: fixture.root }), 'stale check', false);
    assert.ok(mentions(stale, 'scripts/runtime.js'));
    assert.strictEqual(snapshot(fixture.root), beforeStale, 'check must not rewrite stale output');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('second write is idempotent in bytes, modes, ledger, and reported changes', async () => {
  const fixture = createFixture();
  try {
    const api = loadLibrary();
    await writeFixture(api, fixture);
    const before = snapshot(fixture.root);
    const beforeLedger = fs.readFileSync(path.join(fixture.root, 'manifests', 'skill-resource-copies.json'), 'utf8');
    const second = assertResult(await writeFixture(api, fixture), 'second writeSkillResources', true);
    assert.deepStrictEqual(second.changes, []);
    assert.strictEqual(snapshot(fixture.root), before);
    assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'manifests', 'skill-resource-copies.json'), 'utf8'), beforeLedger);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('edited and unowned destinations are rejected without changing accepted files', async () => {
  const unowned = createFixture();
  const edited = createFixture();
  try {
    const api = loadLibrary();
    const unownedDestination = path.join(unowned.root, DESTINATION);
    fs.mkdirSync(path.dirname(unownedDestination), { recursive: true });
    fs.copyFileSync(path.join(unowned.root, SOURCE), unownedDestination);
    const unownedBefore = snapshot(unowned.root);
    await expectFailure(() => writeFixture(api, unowned));
    assert.strictEqual(snapshot(unowned.root), unownedBefore, 'unowned destination must not be adopted');

    await writeFixture(api, edited);
    fs.appendFileSync(path.join(edited.root, DESTINATION), '// consumer edit\n');
    const editedBefore = snapshot(edited.root);
    const ledgerBefore = fs.readFileSync(path.join(edited.root, 'manifests', 'skill-resource-copies.json'), 'utf8');
    await expectFailure(() => writeFixture(api, edited));
    assert.strictEqual(snapshot(edited.root), editedBefore, 'edited destination must be preserved');
    assert.strictEqual(fs.readFileSync(path.join(edited.root, 'manifests', 'skill-resource-copies.json'), 'utf8'), ledgerBefore);
  } finally {
    fs.rmSync(unowned.root, { recursive: true, force: true });
    fs.rmSync(edited.root, { recursive: true, force: true });
  }
});

test('removing a map entry reports an owned orphan in check and removes it on write', async () => {
  const fixture = createFixture();
  try {
    const api = loadLibrary();
    await writeFixture(api, fixture);
    replaceMap(fixture.root, mapFixture([]));
    const beforeCheck = snapshot(fixture.root);
    const orphan = assertResult(await api.checkSkillResources({ root: fixture.root }), 'orphan check', false);
    assert.ok(mentions(orphan, 'scripts/runtime.js'));
    assert.strictEqual(snapshot(fixture.root), beforeCheck, 'check must not remove an orphan');
    const result = assertResult(await writeFixture(api, fixture), 'orphan removal write', true);
    assert.ok(result.changes.length >= 1, 'write must report orphan removal');
    assert.strictEqual(fs.existsSync(path.join(fixture.root, DESTINATION)), false);
    assert.deepStrictEqual(readLedger(fixture.root).files, {});
    assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'unrelated.txt'), 'utf8'), 'preserve this file\n');
    assert.strictEqual(fs.readFileSync(path.join(fixture.root, ACTIVE_PATH, 'unrelated.txt'), 'utf8'), 'consumer-owned\n');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('write supports distinct sibling parents under one newly created nested prefix', async () => {
  const fixture = createFixture();
  try {
    const api = loadLibrary();
    const secondSource = path.join(fixture.root, 'shared', 'second.js');
    const promptDestination = `${ACTIVE_PATH}/references/execution-bundle/docs/subagent-prompt-template.md`;
    const reviewDestination = `${ACTIVE_PATH}/references/execution-bundle/docs/contracts/review-lifecycle.md`;
    fs.mkdirSync(path.join(fixture.root, ACTIVE_PATH, 'references'), { recursive: true });
    fs.writeFileSync(secondSource, 'console.log("second fixture");\n');
    fs.chmodSync(secondSource, 0o644);
    replaceMap(fixture.root, mapFixture([
      { source: SOURCE, destination: 'references/execution-bundle/docs/subagent-prompt-template.md' },
      { source: 'shared/second.js', destination: 'references/execution-bundle/docs/contracts/review-lifecycle.md' },
    ]));

    const result = assertResult(await writeFixture(api, fixture), 'nested sibling write', true);
    assert.ok(result.changes.length >= 2, 'first nested write must report both copied resources');
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.root, promptDestination), 'utf8'),
      '#!/usr/bin/env node\nconsole.log("literal fixture");\n',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.root, reviewDestination), 'utf8'),
      'console.log("second fixture");\n',
    );
    assert.strictEqual(mode(path.join(fixture.root, promptDestination)), '0755');
    assert.strictEqual(mode(path.join(fixture.root, reviewDestination)), '0644');
    const firstLedger = readLedger(fixture.root);
    assert.deepStrictEqual(Object.keys(firstLedger.files).sort(), [promptDestination, reviewDestination].sort());
    assert.deepStrictEqual(firstLedger.files[promptDestination], {
      skill_id: ACTIVE_ID,
      source: SOURCE,
      sha256: `sha256:${digest(path.join(fixture.root, SOURCE))}`,
      mode: '0755',
    });
    assert.deepStrictEqual(firstLedger.files[reviewDestination], {
      skill_id: ACTIVE_ID,
      source: 'shared/second.js',
      sha256: `sha256:${digest(secondSource)}`,
      mode: '0644',
    });

    const beforeSecondWrite = snapshot(fixture.root);
    const beforeSecondLedger = fs.readFileSync(
      path.join(fixture.root, 'manifests', 'skill-resource-copies.json'),
      'utf8',
    );
    const second = assertResult(await writeFixture(api, fixture), 'nested second write', true);
    assert.deepStrictEqual(second.changes, []);
    assert.strictEqual(snapshot(fixture.root), beforeSecondWrite);
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.root, 'manifests', 'skill-resource-copies.json'), 'utf8'),
      beforeSecondLedger,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

run('skill-resource-sync');
