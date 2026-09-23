'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const LIBRARY = path.join(__dirname, '..', 'scripts', 'lib', 'skill-resource-sync.js');

function synchronizer() {
  assert.ok(fs.existsSync(LIBRARY), 'resource synchronizer implementation is missing');
  return require(LIBRARY);
}

function fixture(callback) {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk copy security '));
  const root = path.join(outer, 'project');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(outer, 'outside.js'), 'external fixture source\n');
  const put = (relative, contents) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    return target;
  };
  const map = { schema: 'dhpk.skill-resources.v1', skills: {
    example: [{ source: 'shared/runtime.js', destination: 'scripts/runtime.js' }],
  } };
  const saveMap = () => put('manifests/skill-resources.json', JSON.stringify(map, null, 2) + '\n');
  put('manifests/distribution-inventory.json', JSON.stringify({
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'example', name: 'public-example', path: 'skills/example', legacy_names: ['old-example'] }],
  }));
  put('manifests/skill-resource-copies.json', JSON.stringify({ schema: 'dhpk.skill-resource-copies.v1', files: {} }) + '\n');
  put('skills/example/SKILL.md', '---\nname: public-example\ndescription: Fixture skill.\n---\n');
  put('shared/runtime.js', 'module.exports = "accepted";\n');
  saveMap();
  const output = path.join(root, 'skills/example/scripts/runtime.js');
  const ledger = path.join(root, 'manifests/skill-resource-copies.json');
  try { callback({ root, put, map, saveMap, output, ledger }); }
  finally { fs.rmSync(outer, { recursive: true, force: true }); }
}

function rejectWithoutPublishing(ctx) {
  const api = synchronizer();
  const beforeLedger = fs.readFileSync(ctx.ledger);
  const beforeOutput = fs.existsSync(ctx.output) ? fs.readFileSync(ctx.output) : null;
  assert.throws(() => api.writeSkillResources({ root: ctx.root }));
  assert.deepStrictEqual(fs.readFileSync(ctx.ledger), beforeLedger);
  if (beforeOutput === null) assert.ok(!fs.existsSync(ctx.output));
  else assert.deepStrictEqual(fs.readFileSync(ctx.output), beforeOutput);
}

for (const [label, source, destination] of [
  ['source escape', '../outside.js', 'scripts/runtime.js'],
  ['destination escape', 'shared/runtime.js', '../outside.js'],
  ['absolute source', '/outside.js', 'scripts/runtime.js'],
  ['backslash destination', 'shared/runtime.js', 'scripts\\runtime.js'],
  ['NUL destination', 'shared/runtime.js', 'scripts/bad\0.js'],
  ['ignored source directory', 'shared/__pycache__/runtime.js', 'scripts/runtime.js'],
  ['ignored source extension', 'shared/runtime.pyc', 'scripts/runtime.js'],
  ['ignored destination directory', 'shared/runtime.js', 'scripts/__pycache__/runtime.js'],
  ['ignored destination extension', 'shared/runtime.js', 'scripts/runtime.pyc'],
]) {
  test(`rejects ${label} before publishing any selected copy`, () => fixture((ctx) => {
    if (source.startsWith('shared/')) ctx.put(source, 'module.exports = "fixture";\n');
    const mappedSource = label === 'absolute source' ? path.join(ctx.root, 'shared/runtime.js') : source;
    const mappedDestination = destination === 'scripts/runtime.js' ? 'scripts/second.js' : destination;
    ctx.map.skills.example.push({ source: mappedSource, destination: mappedDestination });
    ctx.saveMap();
    rejectWithoutPublishing(ctx);
  }));
}

for (const identifier of ['unknown', 'public-example', 'old-example']) {
  test(`rejects non-stable inventory key ${identifier}`, () => fixture((ctx) => {
    ctx.map.skills[identifier] = ctx.map.skills.example;
    delete ctx.map.skills.example;
    ctx.saveMap();
    rejectWithoutPublishing(ctx);
  }));
}

for (const destination of ['scripts/runtime.js', 'scripts/runtime.js/child.js']) {
  test(`rejects destination collision ${destination}`, () => fixture((ctx) => {
    ctx.put('shared/second.js', 'second\n');
    ctx.map.skills.example.push({ source: 'shared/second.js', destination });
    ctx.saveMap();
    rejectWithoutPublishing(ctx);
  }));
}

test('rejects a source symlink without following it', () => fixture((ctx) => {
  const outside = ctx.put('outside.js', 'external source\n');
  fs.unlinkSync(path.join(ctx.root, 'shared/runtime.js'));
  fs.symlinkSync(outside, path.join(ctx.root, 'shared/runtime.js'));
  rejectWithoutPublishing(ctx);
  assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'external source\n');
}));

test('rejects a destination ancestor symlink without writing externally', () => fixture((ctx) => {
  const outside = path.join(ctx.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(ctx.root, 'skills/example/scripts'));
  rejectWithoutPublishing(ctx);
  assert.deepStrictEqual(fs.readdirSync(outside), []);
}));

test('rejects a source ancestor symlink', () => fixture((ctx) => {
  const real = path.join(ctx.root, 'real-shared');
  fs.renameSync(path.join(ctx.root, 'shared'), real);
  fs.symlinkSync(real, path.join(ctx.root, 'shared'));
  rejectWithoutPublishing(ctx);
}));

test('rejects a destination leaf symlink and preserves its target', () => fixture((ctx) => {
  const external = ctx.put('external.js', 'user bytes\n');
  fs.mkdirSync(path.dirname(ctx.output), { recursive: true });
  fs.symlinkSync(external, ctx.output);
  rejectWithoutPublishing(ctx);
  assert.ok(fs.lstatSync(ctx.output).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(external, 'utf8'), 'user bytes\n');
}));

test('rejects a directory used as a resource source', () => fixture((ctx) => {
  ctx.map.skills.example[0].source = 'shared';
  ctx.saveMap();
  rejectWithoutPublishing(ctx);
}));

test('rejects a copy chain whose maintained source is another managed destination', () => fixture((ctx) => {
  synchronizer().writeSkillResources({ root: ctx.root });
  ctx.map.skills.example.push({ source: 'skills/example/scripts/runtime.js', destination: 'scripts/second.js' });
  ctx.saveMap();
  rejectWithoutPublishing(ctx);
}));

test('staged byte mutation cannot publish under the original fingerprint', () => fixture((ctx) => {
  const api = synchronizer();
  api.writeSkillResources({ root: ctx.root });
  const accepted = fs.readFileSync(ctx.output);
  const receipt = fs.readFileSync(ctx.ledger);
  ctx.put('shared/runtime.js', 'module.exports = "candidate";\n');
  let tampered = false;
  const mutateCandidate = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) mutateCandidate(file);
      else if (entry.isFile() && fs.readFileSync(file, 'utf8') === 'module.exports = "candidate";\n') {
        fs.appendFileSync(file, '// unexpected staged mutation\n');
        tampered = true;
      }
    }
  };
  assert.throws(() => api.writeSkillResources({ root: ctx.root, hooks: {
    beforeCommit({ stagingRoot }) { mutateCandidate(stagingRoot); },
  } }));
  assert.strictEqual(tampered, true, 'fixture must mutate the actual staged candidate');
  assert.deepStrictEqual(fs.readFileSync(ctx.output), accepted);
  assert.deepStrictEqual(fs.readFileSync(ctx.ledger), receipt);
}));

test('an edited orphan is preserved when its mapping is removed', () => fixture((ctx) => {
  synchronizer().writeSkillResources({ root: ctx.root });
  fs.appendFileSync(ctx.output, '// user modification\n');
  ctx.map.skills.example = [];
  ctx.saveMap();
  rejectWithoutPublishing(ctx);
  assert.match(fs.readFileSync(ctx.output, 'utf8'), /user modification/);
}));

test('an independently changed executable mode is preserved as a conflict', () => fixture((ctx) => {
  synchronizer().writeSkillResources({ root: ctx.root });
  fs.chmodSync(ctx.output, 0o755);
  rejectWithoutPublishing(ctx);
  assert.strictEqual(fs.statSync(ctx.output).mode & 0o777, 0o755);
}));

test('explicit transitive resources execute using the synchronized local closure', () => fixture((ctx) => {
  const api = synchronizer();
  ctx.put('shared/runtime.js', 'console.log(require("./helper.js"));\n');
  ctx.put('shared/helper.js', 'module.exports = "local transitive result";\n');
  ctx.map.skills.example.push({ source: 'shared/helper.js', destination: 'scripts/helper.js' });
  ctx.saveMap();
  api.writeSkillResources({ root: ctx.root });
  fs.rmSync(path.join(ctx.root, 'shared'), { recursive: true });
  const result = spawnSync(process.execPath, [ctx.output], {
    cwd: ctx.root, encoding: 'utf8', timeout: 5000,
    env: { PATH: process.env.PATH },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'local transitive result\n');
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(ctx.ledger)).files).sort(), [
    'skills/example/scripts/helper.js', 'skills/example/scripts/runtime.js',
  ]);
}));

test('source mutation after staging preserves accepted output and ledger', () => fixture((ctx) => {
  const api = synchronizer();
  api.writeSkillResources({ root: ctx.root });
  const accepted = fs.readFileSync(ctx.output);
  const receipt = fs.readFileSync(ctx.ledger);
  ctx.put('shared/runtime.js', 'module.exports = "candidate";\n');
  let hookRan = false;
  assert.throws(() => api.writeSkillResources({ root: ctx.root, hooks: {
    beforeCommit() {
      hookRan = true;
      ctx.put('shared/runtime.js', 'module.exports = "changed after staging";\n');
    },
  } }));
  assert.strictEqual(hookRan, true);
  assert.deepStrictEqual(fs.readFileSync(ctx.output), accepted);
  assert.deepStrictEqual(fs.readFileSync(ctx.ledger), receipt);
}));

test('a late publication failure rolls back accepted files and ledger', () => fixture((ctx) => {
  const api = synchronizer();
  api.writeSkillResources({ root: ctx.root });
  const accepted = fs.readFileSync(ctx.output);
  const receipt = fs.readFileSync(ctx.ledger);
  ctx.put('shared/runtime.js', 'module.exports = "candidate";\n');
  const originalRename = fs.renameSync;
  let injected = false;
  let outputChanged = false;
  try {
    assert.throws(() => api.writeSkillResources({ root: ctx.root, hooks: {
      beforeCommit() {
        fs.renameSync = function renameWithOneFailure(source, destination) {
          if (!injected && path.resolve(String(destination)) === ctx.ledger) {
            outputChanged = fs.readFileSync(ctx.output, 'utf8') === 'module.exports = "candidate";\n';
            injected = true;
            throw new Error('fixture ledger promotion failure');
          }
          return originalRename.call(fs, source, destination);
        };
      },
    } }));
  } finally { fs.renameSync = originalRename; }
  assert.strictEqual(injected, true, 'fixture must reach ledger publication');
  assert.strictEqual(outputChanged, true, 'fixture must exercise rollback after file publication');
  assert.deepStrictEqual(fs.readFileSync(ctx.output), accepted);
  assert.deepStrictEqual(fs.readFileSync(ctx.ledger), receipt);
}));

test('a symlinked manifest directory cannot redirect ledger publication', () => fixture((ctx) => {
  const metadata = path.join(ctx.root, 'manifests');
  const outside = path.join(path.dirname(ctx.root), 'external manifests');
  fs.renameSync(metadata, outside);
  fs.symlinkSync(outside, metadata);
  rejectWithoutPublishing(ctx);
}));

for (const metadata of ['skill-resources.json', 'distribution-inventory.json']) {
  test(`changed ${metadata} after staging invalidates the entire plan`, () => fixture((ctx) => {
    const api = synchronizer();
    api.writeSkillResources({ root: ctx.root });
    const output = fs.readFileSync(ctx.output);
    const ledger = fs.readFileSync(ctx.ledger);
    ctx.put('shared/runtime.js', 'module.exports = "candidate";\n');
    let changed = false;
    assert.throws(() => api.writeSkillResources({ root: ctx.root, hooks: {
      beforeCommit() {
        fs.appendFileSync(path.join(ctx.root, 'manifests', metadata), '\n');
        changed = true;
      },
    } }));
    assert.strictEqual(changed, true);
    assert.deepStrictEqual(fs.readFileSync(ctx.output), output);
    assert.deepStrictEqual(fs.readFileSync(ctx.ledger), ledger);
  }));
}

test('a source ancestor changed into a symlink after staging is rejected', () => fixture((ctx) => {
  const api = synchronizer();
  api.writeSkillResources({ root: ctx.root });
  const output = fs.readFileSync(ctx.output);
  const ledger = fs.readFileSync(ctx.ledger);
  ctx.put('shared/runtime.js', 'module.exports = "candidate";\n');
  assert.throws(() => api.writeSkillResources({ root: ctx.root, hooks: {
    beforeCommit() {
      const original = path.join(ctx.root, 'shared original');
      fs.renameSync(path.join(ctx.root, 'shared'), original);
      fs.symlinkSync(original, path.join(ctx.root, 'shared'));
    },
  } }));
  assert.deepStrictEqual(fs.readFileSync(ctx.output), output);
  assert.deepStrictEqual(fs.readFileSync(ctx.ledger), ledger);
}));

test('stage tampering at promotion is rejected and restores accepted output', () => fixture((ctx) => {
  const api = synchronizer();
  api.writeSkillResources({ root: ctx.root });
  const output = fs.readFileSync(ctx.output);
  const ledger = fs.readFileSync(ctx.ledger);
  ctx.put('shared/runtime.js', 'module.exports = "candidate";\n');
  const originalRename = fs.renameSync;
  let tampered = false;
  try {
    assert.throws(() => api.writeSkillResources({ root: ctx.root, hooks: {
      beforeCommit({ stagingRoot }) {
        fs.renameSync = function tamperAtPromotion(source, destination) {
          if (!tampered && String(source).startsWith(stagingRoot + path.sep)
            && path.resolve(String(destination)) === ctx.output) {
            fs.appendFileSync(source, '// modified after final stage check\n');
            tampered = true;
          }
          return originalRename.call(fs, source, destination);
        };
      },
    } }));
  } finally { fs.renameSync = originalRename; }
  assert.strictEqual(tampered, true);
  assert.deepStrictEqual(fs.readFileSync(ctx.output), output);
  assert.deepStrictEqual(fs.readFileSync(ctx.ledger), ledger);
}));

test('the real CLI checks fixture drift without repairing output or its ledger', () => fixture((ctx) => {
  synchronizer();
  const sourceCli = path.join(__dirname, '..', 'scripts/ci/sync-skill-resources.js');
  assert.ok(fs.existsSync(sourceCli), 'resource synchronization CLI is missing');
  const cli = ctx.put('scripts/ci/sync-skill-resources.js', fs.readFileSync(sourceCli));
  // The authoring driver uses the real implementation; its repository input
  // root is the copied CLI's fixture directory. This is not a Skill Host probe.
  fs.symlinkSync(path.dirname(LIBRARY), path.join(ctx.root, 'scripts/lib'));
  const invoke = (args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: os.tmpdir(), encoding: 'utf8', timeout: 10000,
  });
  const created = invoke(['--write']);
  assert.strictEqual(created.status, 0, created.stderr);
  const clean = invoke(['--check']);
  assert.strictEqual(clean.status, 0, clean.stderr);
  ctx.put('shared/runtime.js', 'module.exports = "changed source";\n');
  const output = fs.readFileSync(ctx.output);
  const ledger = fs.readFileSync(ctx.ledger);
  const children = fs.readdirSync(ctx.root).sort();
  const drift = invoke(['--check']);
  assert.strictEqual(drift.status, 1, drift.stderr);
  assert.match(drift.stdout + drift.stderr, /runtime\.js/);
  assert.deepStrictEqual(fs.readFileSync(ctx.output), output);
  assert.deepStrictEqual(fs.readFileSync(ctx.ledger), ledger);
  assert.deepStrictEqual(fs.readdirSync(ctx.root).sort(), children);
}));

test('the CLI rejects missing, conflicting and unknown mode flags', () => {
  synchronizer();
  const cli = path.join(__dirname, '..', 'scripts/ci/sync-skill-resources.js');
  assert.ok(fs.existsSync(cli), 'resource synchronization CLI is missing');
  for (const args of [[], ['--check', '--write'], ['--check', '--unknown'], ['--check', '--check']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 });
    assert.strictEqual(result.status, 2, `invalid arguments ${JSON.stringify(args)}: ${result.stderr}`);
  }
});

test('a deprecated row still present in canonical inventory resolves by its stable ID', () => fixture((ctx) => {
  const file = path.join(ctx.root, 'manifests/distribution-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(file));
  inventory.skills[0].lifecycle = 'deprecated';
  fs.writeFileSync(file, JSON.stringify(inventory));
  assert.strictEqual(synchronizer().writeSkillResources({ root: ctx.root }).ok, true);
  assert.strictEqual(fs.readFileSync(ctx.output, 'utf8'), 'module.exports = "accepted";\n');
}));

test('foreign replacement after promotion is preserved with the accepted recovery backup', () => fixture((ctx) => {
  const api = synchronizer();
  api.writeSkillResources({ root: ctx.root });
  const accepted = fs.readFileSync(ctx.output);
  const ledger = fs.readFileSync(ctx.ledger);
  ctx.put('shared/runtime.js', 'module.exports = "candidate";\n');
  const foreign = ctx.put('foreign.js', 'external concurrent edit\n');
  const originalRename = fs.renameSync;
  let replaced = false;
  let failure;
  try {
    try {
      api.writeSkillResources({ root: ctx.root, hooks: {
        beforeCommit({ stagingRoot }) {
          fs.renameSync = function replaceAfterPromotion(source, destination) {
            const result = originalRename.call(fs, source, destination);
            if (!replaced && String(source).startsWith(stagingRoot + path.sep)
              && path.resolve(String(destination)) === ctx.output) {
              originalRename.call(fs, foreign, destination);
              replaced = true;
            }
            return result;
          };
        },
      } });
    } catch (error) { failure = error; }
  } finally { fs.renameSync = originalRename; }
  assert.strictEqual(replaced, true);
  assert.ok(failure, 'foreign inode must invalidate publication');
  assert.strictEqual(fs.readFileSync(ctx.output, 'utf8'), 'external concurrent edit\n');
  assert.deepStrictEqual(fs.readFileSync(ctx.ledger), ledger);
  const backups = fs.readdirSync(ctx.root).filter((name) => /backup/.test(name));
  assert.strictEqual(backups.length, 1, 'accepted backup must remain recoverable');
  const backupRoot = path.join(ctx.root, backups[0]);
  assert.ok(failure.message.includes(backupRoot), failure.message);
  const collect = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(file) : [fs.readFileSync(file)];
  });
  assert.ok(collect(backupRoot).some((bytes) => bytes.equals(accepted)), 'backup contains accepted bytes');
}));

test('ledger tampering during promotion rolls back all accepted resources and ledger', () => fixture((ctx) => {
  const api = synchronizer();
  api.writeSkillResources({ root: ctx.root });
  const accepted = fs.readFileSync(ctx.output);
  const ledger = fs.readFileSync(ctx.ledger);
  ctx.put('shared/runtime.js', 'module.exports = "candidate";\n');
  const originalRename = fs.renameSync;
  let tampered = false;
  try {
    assert.throws(() => api.writeSkillResources({ root: ctx.root, hooks: {
      beforeCommit({ stagingRoot }) {
        fs.renameSync = function tamperLedgerPromotion(source, destination) {
          if (!tampered && String(source).startsWith(stagingRoot + path.sep)
            && path.resolve(String(destination)) === ctx.ledger) {
            fs.appendFileSync(source, 'unexpected bytes\n');
            tampered = true;
          }
          return originalRename.call(fs, source, destination);
        };
      },
    } }));
  } finally { fs.renameSync = originalRename; }
  assert.strictEqual(tampered, true);
  assert.deepStrictEqual(fs.readFileSync(ctx.output), accepted);
  assert.deepStrictEqual(fs.readFileSync(ctx.ledger), ledger);
}));

run('skill-resource-sync-security');
