'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { ProjectionArtifactStore, safeRelative, safeLinkTarget } = require('../scripts/lib/projection-artifact-store');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-projection-store-'));
}

function plan(entries) {
  return { planFingerprint: 'plan-1', entries };
}

test('store stages planned bytes, publishes atomically, and reports fingerprints', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    const session = store.begin(plan([{ stableId: 'one', destination: 'skills/one.md', symlink: { policy: 'forbid' } }]));
    session.write({ stableId: 'one', destination: 'skills/one.md', content: 'hello\n' });
    const published = session.publish();
    assert.strictEqual(published.outputs.length, 1);
    assert.match(published.outputs[0].fingerprint, /^[a-f0-9]{64}$/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/skills/one.md'), 'utf8'), 'hello\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('store rejects an unplanned staged-tree entry before activation and preserves the published tree', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    const initial = store.begin(plan([{ stableId: 'one', destination: 'one', symlink: { policy: 'forbid' } }]));
    initial.write({ stableId: 'one', destination: 'one', content: 'old published bytes' });
    initial.publish();

    const replacement = store.begin(plan([{ stableId: 'one', destination: 'one', symlink: { policy: 'forbid' } }]));
    replacement.write({ stableId: 'one', destination: 'one', content: 'new candidate bytes' });
    fs.writeFileSync(path.join(replacement.stageRoot, 'unplanned.txt'), 'unplanned');

    assert.throws(() => replacement.stage(), /staged entry is absent from the compiled plan/);
    replacement.abort();
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/one'), 'utf8'), 'old published bytes');
    assert.strictEqual(fs.existsSync(path.join(replacement.stageRoot, 'unplanned.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('store rejects unplanned output and traversal before writing', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    const session = store.begin(plan([{ stableId: 'one', destination: 'skills/one.md' }]));
    assert.throws(() => session.write({ stableId: 'missing', destination: 'skills/missing', content: 'x' }), /absent from the plan/);
    assert.throws(() => session.write({ stableId: 'one', destination: '../outside', content: 'x' }), /does not match the plan/);
    session.abort();
    assert.deepStrictEqual(fs.readdirSync(root), []);

    const windowsTraversal = store.begin(plan([{ stableId: 'windows', destination: '..\\outside' }]));
    assert.throws(() => windowsTraversal.write({ stableId: 'windows', destination: '..\\outside', content: 'x' }), /safe/);
    windowsTraversal.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('store fails closed for forbidden and escaping links, while allowing contained relative links', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root, sourceRoot: path.join(root, 'source') });
    const forbidden = store.begin(plan([{ stableId: 'one', destination: 'one', symlink: { policy: 'forbid' } }]));
    assert.throws(() => forbidden.link({ stableId: 'one', destination: 'one', target: 'target' }), /forbidden/);
    forbidden.abort();

    const escaping = store.begin(plan([{ stableId: 'two', destination: 'two', symlink: { policy: 'contained-relative' } }]));
    assert.throws(() => escaping.link({ stableId: 'two', destination: 'two', target: '../outside' }), /escapes/);
    assert.throws(() => escaping.link({ stableId: 'two', destination: 'two', target: '..\\outside' }), /relative/);
    escaping.abort();

    const contained = store.begin(plan([{ stableId: 'three', destination: 'dir/three', symlink: { policy: 'contained-relative' } }]));
    contained.link({ stableId: 'three', destination: 'dir/three', target: '../target' });
    const published = contained.publish();
    assert.strictEqual(published.links[0].target, '../target');
    assert.strictEqual(fs.readlinkSync(path.join(root, 'published/dir/three')), '../target');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('failed staged sessions preserve the previously published tree', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    const initial = store.begin(plan([{ stableId: 'one', destination: 'one', symlink: { policy: 'forbid' } }]));
    initial.write({ stableId: 'one', destination: 'one', content: 'old' });
    initial.publish();
    const failed = store.begin(plan([{ stableId: 'one', destination: 'one', symlink: { policy: 'forbid' } }]));
    assert.throws(() => failed.write({ stableId: 'one', destination: 'one', content: { bad: true } }), /requires string or Buffer/);
    failed.abort();
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/one'), 'utf8'), 'old');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- Task 1.1 / REQ-6: shared path-safety predicates -----------------------

test('safeRelative rejects a bare drive prefix, dot segments, and empty segments', () => {
  for (const bad of ['C:', 'C:foo', 'c:x/y', '.', '..', 'a/./b', 'a/../b', 'a//b', 'a/', './a', '../a', '', 'a\\b', '/a', 'C:/a', 'a\0b']) {
    assert.strictEqual(safeRelative(bad), false, `expected unsafe: ${JSON.stringify(bad)}`);
  }
  for (const good of ['a', 'a/b', 'skills/one.md', '.hidden/file', 'a.b/c..d', 'dir/three']) {
    assert.strictEqual(safeRelative(good), true, `expected safe: ${JSON.stringify(good)}`);
  }
});

test('safeLinkTarget rejects bare drive prefixes and non-normalized targets', () => {
  for (const bad of ['C:', 'C:foo', '.', './a', 'a/./b', 'a//b', 'a/', 'a/../b', '', '/abs', 'a\\b', 'a\0b', 'C:/x']) {
    assert.strictEqual(safeLinkTarget(bad), false, `expected unsafe: ${JSON.stringify(bad)}`);
  }
  for (const good of ['a', '../a', '../../skills/x', 'a/b', '..']) {
    assert.strictEqual(safeLinkTarget(good), true, `expected safe: ${JSON.stringify(good)}`);
  }
});

test('store rejects a non-normalized link target at link() time', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    const session = store.begin(plan([{ stableId: 'l', destination: 'dir/l', symlink: { policy: 'contained-relative' } }]));
    assert.throws(() => session.link({ stableId: 'l', destination: 'dir/l', target: '../a/./b' }), /relative/);
    session.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('current plans of agent-plugin, codex-native, cursor-plugin, and claude profile stay valid under the shared predicates', () => {
  const ROOT = path.join(__dirname, '..');
  const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
  const inventory = readJson('manifests/distribution-inventory.json');
  const outDir = path.join(os.tmpdir(), 'dhpk-enumeration-out');
  const { compileAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');
  const { compileNativePackage, resolveCodexNativeProfileSelection } = require('../scripts/lib/codex-native-package');
  const { compileCursorPackage } = require('../scripts/lib/cursor-plugin-package');
  const { compileClaudeCapabilityBundle } = require('../scripts/lib/claude-capability-bundle');
  const sourceCommit = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const plans = {
    'agent-plugin': compileAgentPluginPackage({ inventory, root: ROOT, outDir, name: 'dhpk', version: '0.0.0', sourceCommit, manifestMetadata: readJson('.claude-plugin/plugin.json') }).plan,
    'codex-native': compileNativePackage({ inventory, root: ROOT, outDir, name: 'dhpk', version: '0.0.0', sourceCommit, profileSelection: resolveCodexNativeProfileSelection({ root: ROOT, inventory }) }).plan,
    'cursor-plugin': compileCursorPackage({ inventory, root: ROOT, outDir, version: '0.0.0', sourceCommit }).plan,
    'claude-profile': (() => {
      const compiled = compileClaudeCapabilityBundle({
        root: ROOT,
        inventory,
        profiles: readJson('manifests/install-profiles.json'),
        moduleCatalog: readJson('manifests/module-catalog.json'),
        profileId: 'common',
      });
      assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
      return compiled.value.plan;
    })(),
  };
  for (const [surface, compiledPlan] of Object.entries(plans)) {
    assert.ok(compiledPlan.entries.length > 0, `${surface} plan has entries`);
    for (const entry of compiledPlan.entries) {
      assert.strictEqual(safeRelative(entry.destination), true, `${surface}: destination newly rejected: ${entry.destination}`);
      const target = entry.symlink && entry.symlink.target;
      if (target) assert.strictEqual(safeLinkTarget(target), true, `${surface}: link target newly rejected: ${target}`);
    }
  }
});

// ---- Task 1.2 / REQ-3: ownership-gated replace -----------------------------

function snapshot(root) {
  const result = {};
  const walk = (directory, relative) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = path.join(directory, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) result[rel] = `link:${fs.readlinkSync(child)}`;
      else if (entry.isDirectory()) { result[rel] = 'dir'; walk(child, rel); }
      else result[rel] = `file:${fs.readFileSync(child).toString('base64')}`;
    }
  };
  walk(root, '');
  return result;
}

function stageOwnedTree(store, ownership, content = 'new bytes') {
  const entries = [
    { stableId: 'data', destination: 'data.txt', symlink: { policy: 'forbid' } },
    { stableId: 'prov', destination: 'provenance.json', symlink: { policy: 'forbid' } },
  ];
  const session = store.begin(plan(entries), ownership === undefined ? undefined : { ownership });
  session.write({ stableId: 'data', destination: 'data.txt', content });
  session.write({ stableId: 'prov', destination: 'provenance.json', content: `${JSON.stringify({ owner: 'surface-a' })}\n` });
  return session;
}

function expectRefused(fn) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  assert.ok(error, 'expected OWNERSHIP_REFUSED');
  assert.strictEqual(error.projectionCode, 'OWNERSHIP_REFUSED');
  return error;
}

test('ownership: foreign directory without an owner receipt is refused and left byte-unchanged', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    fs.mkdirSync(path.join(root, 'published/sub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'published/sub/keep.txt'), 'foreign');
    const before = snapshot(path.join(root, 'published'));
    const session = stageOwnedTree(store, { owner: 'surface-a' });
    expectRefused(() => session.publish());
    assert.deepStrictEqual(snapshot(path.join(root, 'published')), before);
    session.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ownership: receipt owned by another surface is refused', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    fs.mkdirSync(path.join(root, 'published'), { recursive: true });
    fs.writeFileSync(path.join(root, 'published/provenance.json'), JSON.stringify({ owner: 'someone-else' }));
    const before = snapshot(path.join(root, 'published'));
    const session = stageOwnedTree(store, { owner: 'surface-a' });
    expectRefused(() => session.publish());
    assert.deepStrictEqual(snapshot(path.join(root, 'published')), before);
    session.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ownership: symlink, dangling symlink, and regular file at the publish root are refused even with a permissive verifier', () => {
  const permissive = { verify: () => ({ ok: true }) };
  for (const kind of ['symlink', 'dangling', 'file']) {
    const root = tempRoot();
    try {
      const store = new ProjectionArtifactStore({ root });
      const published = path.join(root, 'published');
      const outside = path.join(root, 'outside');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'x'), 'x');
      if (kind === 'symlink') fs.symlinkSync(outside, published);
      else if (kind === 'dangling') fs.symlinkSync(path.join(root, 'nowhere'), published);
      else fs.writeFileSync(published, 'plain file');
      const before = fs.lstatSync(published).isSymbolicLink() ? fs.readlinkSync(published) : fs.readFileSync(published, 'utf8');
      const session = stageOwnedTree(store, permissive);
      expectRefused(() => session.publish());
      const after = fs.lstatSync(published).isSymbolicLink() ? fs.readlinkSync(published) : fs.readFileSync(published, 'utf8');
      assert.strictEqual(after, before, kind);
      assert.strictEqual(fs.readFileSync(path.join(outside, 'x'), 'utf8'), 'x');
      session.abort();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('ownership: owned root is replaced and first publish succeeds', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    const first = stageOwnedTree(store, { owner: 'surface-a' }, 'v1');
    first.publish();
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/data.txt'), 'utf8'), 'v1');
    const second = stageOwnedTree(store, { owner: 'surface-a' }, 'v2');
    second.publish();
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/data.txt'), 'utf8'), 'v2');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ownership: a surface-supplied verifier decides, receives the publish root, and its code and message surface', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    fs.mkdirSync(path.join(root, 'published'));
    fs.writeFileSync(path.join(root, 'published/a'), 'a');
    const seen = [];
    const refuse = stageOwnedTree(store, { verify: (existing) => { seen.push(existing); return { ok: false, code: 'CHANGED_OUTPUT', message: 'surface says no' }; } });
    const error = expectRefused(() => refuse.publish());
    assert.match(error.message, /surface says no/);
    assert.strictEqual(error.projectionDetails.reason, 'CHANGED_OUTPUT');
    assert.deepStrictEqual(seen, [path.join(root, 'published')]);
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/a'), 'utf8'), 'a');
    refuse.abort();

    const accept = stageOwnedTree(store, { verify: () => ({ ok: true }) });
    accept.publish();
    assert.strictEqual(fs.existsSync(path.join(root, 'published/a')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ownership: an existing root with no declared owner is refused, whether the store or begin declares it', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    fs.mkdirSync(path.join(root, 'published'));
    fs.writeFileSync(path.join(root, 'published/foreign'), 'f');
    const undeclared = stageOwnedTree(store, undefined);
    const error = expectRefused(() => undeclared.publish());
    assert.match(error.message, /no owner was declared/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/foreign'), 'utf8'), 'f');
    undeclared.abort();

    const declaredAtStore = new ProjectionArtifactStore({ root, ownership: { owner: 'surface-a' } });
    expectRefused(() => stageOwnedTree(declaredAtStore, undefined).publish());
    fs.writeFileSync(path.join(root, 'published/provenance.json'), JSON.stringify({ owner: 'surface-a' }));
    stageOwnedTree(declaredAtStore, undefined, 'owned now').publish();
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/data.txt'), 'utf8'), 'owned now');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ownership: a pre-created empty directory is replaceable without a receipt, but an empty-looking symlink is not', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    fs.mkdirSync(path.join(root, 'published'));
    stageOwnedTree(store, undefined, 'into empty').publish();
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/data.txt'), 'utf8'), 'into empty');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  const linked = tempRoot();
  try {
    fs.mkdirSync(path.join(linked, 'empty-target'));
    fs.symlinkSync(path.join(linked, 'empty-target'), path.join(linked, 'published'));
    const store = new ProjectionArtifactStore({ root: linked, ownership: { owner: 'surface-a' } });
    expectRefused(() => stageOwnedTree(store, undefined).publish());
  } finally { fs.rmSync(linked, { recursive: true, force: true }); }
});

// ---- Task 1.3 / REQ-2: links are judged at their final location --------------

function linkStore(layout) {
  const repo = tempRoot();
  fs.mkdirSync(path.join(repo, 'skills/alpha'), { recursive: true });
  const storeRoot = path.join(repo, layout.storeRoot);
  const publishRoot = path.join(repo, layout.publishRoot);
  fs.mkdirSync(path.dirname(publishRoot), { recursive: true });
  const store = new ProjectionArtifactStore({ root: storeRoot, sourceRoot: repo, publishRoot });
  return { repo, store, publishRoot };
}

function oneLink(store, destination, target, policy = 'declared-source-relative') {
  const session = store.begin(plan([{ stableId: 'l', destination, symlink: { policy } }]));
  try {
    session.link({ stableId: 'l', destination, target });
    return session;
  } catch (error) {
    session.abort();
    throw error;
  }
}

test('declared-source-relative accepts ../../skills/<name> from cursor/skills and publishes a working link', () => {
  const { repo, store, publishRoot } = linkStore({ storeRoot: 'cursor', publishRoot: 'cursor/skills' });
  try {
    const session = oneLink(store, 'alpha', '../../skills/alpha');
    session.publish();
    assert.strictEqual(fs.readlinkSync(path.join(publishRoot, 'alpha')), '../../skills/alpha');
    assert.ok(fs.statSync(path.join(publishRoot, 'alpha')).isDirectory());
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('declared-source-relative rejects a target that leaves the source root from the link final location', () => {
  const { repo, store } = linkStore({ storeRoot: 'cursor', publishRoot: 'cursor/skills' });
  try {
    assert.throws(() => oneLink(store, 'alpha', '../../../outside'), /escapes declared source root/);
    assert.throws(() => oneLink(store, 'alpha', '../../../skills/alpha'), /escapes declared source root/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('declared-source-relative judges by the final location when stage root and publish root differ in depth', () => {
  const { repo, store, publishRoot } = linkStore({ storeRoot: 'cursor', publishRoot: 'cursor/a/b' });
  try {
    // From cursor/a/b/<dest>, ../../../skills/alpha lands in <repo>/skills/alpha.
    oneLink(store, 'alpha', '../../../skills/alpha').publish();
    assert.ok(fs.statSync(path.join(publishRoot, 'alpha')).isDirectory());
    // One level too many from the final location leaves the repository.
    assert.throws(() => oneLink(store, 'alpha', '../../../../skills/alpha'), /escapes declared source root/);
    // A nested destination shifts the link directory down one more level.
    oneLink(store, 'deep/alpha', '../../../../skills/alpha').abort();
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('declared-source-relative keeps accepting a codex-sync style link to a sibling inside the source root', () => {
  const { repo, store } = linkStore({ storeRoot: 'project', publishRoot: 'project/.agents/skills' });
  try {
    oneLink(store, 'alpha', '../../../skills/alpha').abort();
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('contained-relative resolves at the final location and stays inside the publish root', () => {
  const { repo, store, publishRoot } = linkStore({ storeRoot: 'cursor', publishRoot: 'cursor/a/b' });
  try {
    oneLink(store, 'dir/three', '../target', 'contained-relative').publish();
    assert.strictEqual(fs.readlinkSync(path.join(publishRoot, 'dir/three')), '../target');
    assert.throws(() => oneLink(store, 'dir/three', '../../target', 'contained-relative'), /escapes artifact ownership root/);
    assert.throws(() => oneLink(store, 'top', '../top2', 'contained-relative'), /escapes artifact ownership root/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

// ---- Task 1.4 / REQ-4: cleanup failure never reverses a publish -------------

function seam(overrides) {
  return { ...fs, ...overrides };
}

test('backup removal failure leaves the new tree published and returns a cleanup warning', () => {
  const root = tempRoot();
  try {
    const seed = new ProjectionArtifactStore({ root, ownership: { verify: () => ({ ok: true }) } }).begin(plan([{ stableId: 'one', destination: 'one' }]));
    seed.write({ stableId: 'one', destination: 'one', content: 'old' });
    seed.publish();
    const store = new ProjectionArtifactStore({
      root,
      ownership: { verify: () => ({ ok: true }) },
      fs: seam({ rmSync: (target, options) => { if (path.basename(target).startsWith('.projection-backup-')) throw new Error('synthetic rm failure'); return fs.rmSync(target, options); } }),
    });
    const session = store.begin(plan([{ stableId: 'one', destination: 'one' }]));
    session.write({ stableId: 'one', destination: 'one', content: 'new' });
    const result = session.publish();
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/one'), 'utf8'), 'new');
    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /synthetic rm failure/);
    assert.strictEqual(result.warnings[0].code, 'BACKUP_CLEANUP_FAILED');
    assert.ok(result.outputs.length === 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('successful publish carries no warnings key', () => {
  const root = tempRoot();
  try {
    const session = new ProjectionArtifactStore({ root }).begin(plan([{ stableId: 'one', destination: 'one' }]));
    session.write({ stableId: 'one', destination: 'one', content: 'x' });
    assert.strictEqual('warnings' in session.publish(), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stage rename failure restores the previous tree and fails activation', () => {
  const root = tempRoot();
  try {
    const seed = new ProjectionArtifactStore({ root, ownership: { verify: () => ({ ok: true }) } }).begin(plan([{ stableId: 'one', destination: 'one' }]));
    seed.write({ stableId: 'one', destination: 'one', content: 'old' });
    seed.publish();
    const store = new ProjectionArtifactStore({
      root,
      ownership: { verify: () => ({ ok: true }) },
      fs: seam({ renameSync: (from, to) => { if (path.basename(from).startsWith('.projection-stage-')) throw new Error('synthetic rename failure'); return fs.renameSync(from, to); } }),
    });
    const session = store.begin(plan([{ stableId: 'one', destination: 'one' }]));
    session.write({ stableId: 'one', destination: 'one', content: 'new' });
    assert.throws(() => session.publish(), /synthetic rename failure/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/one'), 'utf8'), 'old');
    assert.deepStrictEqual(fs.readdirSync(root).filter((name) => name.startsWith('.projection-backup-')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- Task 1.5 / REQ-5: stale stage and backup cleanup by PID liveness -------

function deadPid() {
  return require('node:child_process').spawnSync(process.execPath, ['-e', '']).pid;
}

test('begin removes stage and backup directories of dead processes and keeps live and current ones', () => {
  const root = tempRoot();
  try {
    const dead = deadPid();
    const live = process.pid;
    fs.mkdirSync(path.join(root, 'published'));
    const names = {
      deadStage: `.projection-stage-${dead}-abc123`,
      deadBackup: `.projection-backup-${dead}-1700000000000`,
      liveStage: `.projection-stage-${live}-abc123`,
      liveBackup: `.projection-backup-${live}-1700000000000`,
      legacyStage: '.projection-stage-Zx81Qa',
      unrelated: '.projection-other',
    };
    for (const name of Object.values(names)) {
      fs.mkdirSync(path.join(root, name));
      fs.writeFileSync(path.join(root, name, 'marker'), name);
    }
    const store = new ProjectionArtifactStore({ root });
    const first = store.begin(plan([{ stableId: 'one', destination: 'one' }]));
    const remaining = fs.readdirSync(root).sort();
    assert.strictEqual(remaining.includes(names.deadStage), false);
    for (const kept of [names.deadBackup, names.liveStage, names.liveBackup, names.legacyStage, names.unrelated]) {
      assert.ok(remaining.includes(kept), `${kept} must be kept`);
    }
    assert.ok(fs.existsSync(first.stageRoot), 'current session stage survives');
    const second = store.begin(plan([{ stableId: 'one', destination: 'one' }]));
    assert.ok(fs.existsSync(first.stageRoot), 'an earlier live session of this process is not removed by a later begin');
    first.abort();
    second.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cleanup is by liveness not age, and never follows or removes a symlink named like a stage directory', () => {
  const root = tempRoot();
  try {
    const dead = deadPid();
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'keep');
    const longAgo = new Date(2000, 0, 1);
    const liveOld = path.join(root, `.projection-stage-${process.pid}-old123`);
    fs.mkdirSync(liveOld);
    fs.utimesSync(liveOld, longAgo, longAgo);
    const deadFresh = path.join(root, `.projection-stage-${dead}-new123`);
    fs.mkdirSync(deadFresh);
    const link = path.join(root, `.projection-backup-${dead}-1`);
    fs.symlinkSync(outside, link);
    const store = new ProjectionArtifactStore({ root });
    store.begin(plan([{ stableId: 'one', destination: 'one' }])).abort();
    assert.ok(fs.existsSync(liveOld), 'an old but live stage is kept');
    assert.strictEqual(fs.existsSync(deadFresh), false, 'a brand-new dead stage is removed');
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'keep');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('new stage directories encode the creating pid', () => {
  const root = tempRoot();
  try {
    const session = new ProjectionArtifactStore({ root }).begin(plan([{ stableId: 'one', destination: 'one' }]));
    assert.match(path.basename(session.stageRoot), new RegExp(`^\\.projection-stage-${process.pid}-[A-Za-z0-9]{6}$`));
    session.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- Task 1.7 / REQ-7 decision: stage-time digests, shared sha256Hex --------

test('session.fingerprintOf returns the stage-time sha256 of a written destination', () => {
  const root = tempRoot();
  try {
    const session = new ProjectionArtifactStore({ root }).begin(plan([
      { stableId: 'a', destination: 'dir/a.txt' },
      { stableId: 'l', destination: 'dir/l', symlink: { policy: 'contained-relative' } },
      { stableId: 'u', destination: 'unwritten' },
    ]));
    session.write({ stableId: 'a', destination: 'dir/a.txt', content: 'abc' });
    session.link({ stableId: 'l', destination: 'dir/l', target: 'a.txt' });
    // SHA-256("abc") from FIPS 180-2 Appendix B.1.
    assert.strictEqual(session.fingerprintOf('dir/a.txt'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const bad of ['unwritten', 'dir/l', 'missing', '../escape']) {
      let error = null;
      try { session.fingerprintOf(bad); } catch (caught) { error = caught; }
      assert.ok(error && error.projectionCode === 'FINGERPRINT_UNAVAILABLE', `expected FINGERPRINT_UNAVAILABLE for ${bad}`);
    }
    session.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fingerprintOf matches the published output fingerprint', () => {
  const root = tempRoot();
  try {
    const session = new ProjectionArtifactStore({ root }).begin(plan([{ stableId: 'a', destination: 'a.txt' }]));
    session.write({ stableId: 'a', destination: 'a.txt', content: Buffer.from([0, 255, 1]) });
    const early = session.fingerprintOf('a.txt');
    const published = session.publish();
    assert.strictEqual(published.outputs[0].fingerprint, early);
    const oracle = require('node:child_process').execFileSync('sha256sum', { input: Buffer.from([0, 255, 1]) }).toString().split(' ')[0];
    assert.strictEqual(early, oracle);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('artifactFingerprint keeps its recipe: sha256 of the emission-ordered outputs and links', () => {
  const root = tempRoot();
  try {
    const session = new ProjectionArtifactStore({ root }).begin(plan([
      { stableId: 'b', destination: 'b' },
      { stableId: 'a', destination: 'a' },
    ]));
    session.write({ stableId: 'b', destination: 'b', content: 'B' });
    session.write({ stableId: 'a', destination: 'a', content: 'A' });
    const staged = session.stage();
    const recipe = JSON.stringify({ outputs: staged.outputs, links: staged.links });
    assert.strictEqual(staged.artifactFingerprint, require('node:crypto').createHash('sha256').update(recipe).digest('hex'));
    assert.deepStrictEqual(staged.outputs.map((o) => o.destination), ['b', 'a']);
    session.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('store has no local digest helper: it delegates to the shared content-fingerprint module', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts/lib/projection-artifact-store.js'), 'utf8');
  assert.match(source, /require\('\.\/content-fingerprint'\)/);
  assert.doesNotMatch(source, /function digest\(/);
  assert.doesNotMatch(source, /require\('node:crypto'\)/);
});

// ---- Follow-up A: an interrupted activation is restored, never deleted -------

function interruptedActivation(root, content) {
  // Simulate a crash after the old tree moved to its backup: both the stage
  // rename and the rollback fail, leaving only the tagged backup directory.
  const seed = new ProjectionArtifactStore({ root }).begin(plan([{ stableId: 'one', destination: 'one' }]), { ownership: { verify: () => ({ ok: true }) } });
  seed.write({ stableId: 'one', destination: 'one', content });
  seed.publish();
  const crashing = new ProjectionArtifactStore({
    root,
    fs: seam({ renameSync: (from, to) => {
      if (path.basename(from).startsWith('.projection-stage-') || path.basename(from).startsWith('.projection-backup-')) throw new Error('simulated crash');
      return fs.renameSync(from, to);
    } }),
  });
  const next = crashing.begin(plan([{ stableId: 'one', destination: 'one' }]), { ownership: { verify: () => ({ ok: true }) } });
  next.write({ stableId: 'one', destination: 'one', content: 'never published' });
  assert.throws(() => next.publish(), /simulated crash/);
  assert.strictEqual(fs.existsSync(path.join(root, 'published')), false);
  const backups = fs.readdirSync(root).filter((name) => name.startsWith('.projection-backup-'));
  assert.strictEqual(backups.length, 1);
  return backups[0];
}

function asDeadProcess(root, backupName) {
  const dead = deadPid();
  const renamed = backupName.replace(/^(\.projection-backup-)\d+-/, `$1${dead}-`);
  fs.renameSync(path.join(root, backupName), path.join(root, renamed));
  return renamed;
}

test('begin restores the last accepted tree from a dead process backup when the publish root is missing', () => {
  const root = tempRoot();
  try {
    const name = asDeadProcess(root, interruptedActivation(root, 'last accepted'));
    const store = new ProjectionArtifactStore({ root });
    const session = store.begin(plan([{ stableId: 'one', destination: 'one' }]));
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/one'), 'utf8'), 'last accepted');
    assert.strictEqual(fs.existsSync(path.join(root, name)), false);
    session.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('begin refuses to guess when several dead backups could restore the missing publish root', () => {
  const root = tempRoot();
  try {
    const dead = deadPid();
    const tag = require('node:crypto').createHash('sha256').update(path.resolve(root, 'published')).digest('hex').slice(0, 8);
    for (const stamp of ['1700000000000', '1700000000001']) {
      const name = `.projection-backup-${dead}-${stamp}-${tag}`;
      fs.mkdirSync(path.join(root, name));
      fs.writeFileSync(path.join(root, name, 'one'), stamp);
    }
    const store = new ProjectionArtifactStore({ root });
    let error = null;
    try { store.begin(plan([{ stableId: 'one', destination: 'one' }])); } catch (caught) { error = caught; }
    assert.ok(error && error.projectionCode === 'AMBIGUOUS_BACKUP_RESTORE');
    assert.strictEqual(fs.readdirSync(root).filter((n) => n.startsWith('.projection-backup-')).length, 2);
    assert.strictEqual(fs.existsSync(path.join(root, 'published')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a dead backup tagged for another publish root is neither restored nor removed', () => {
  const root = tempRoot();
  try {
    const dead = deadPid();
    const other = `.projection-backup-${dead}-1700000000000-deadbeef`;
    fs.mkdirSync(path.join(root, other));
    const session = new ProjectionArtifactStore({ root }).begin(plan([{ stableId: 'one', destination: 'one' }]));
    assert.ok(fs.existsSync(path.join(root, other)));
    assert.strictEqual(fs.existsSync(path.join(root, 'published')), false);
    session.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a legacy untagged dead backup is never restored and stays in place, with a shared store root', () => {
  const root = tempRoot();
  try {
    const dead = deadPid();
    const legacy = `.projection-backup-${dead}-1700000000000`;
    fs.mkdirSync(path.join(root, legacy));
    fs.writeFileSync(path.join(root, legacy, 'one'), 'legacy');
    for (const publishRoot of ['agents', 'rules']) {
      const store = new ProjectionArtifactStore({ root, publishRoot: path.join(root, publishRoot) });
      store.begin(plan([{ stableId: 'one', destination: 'one' }])).abort();
      assert.strictEqual(fs.existsSync(path.join(root, publishRoot)), false, publishRoot + ' must not be restored from an untagged backup');
    }
    assert.ok(fs.existsSync(path.join(root, legacy, 'one')), 'legacy backup left in place');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- Follow-up B: every existing store caller refuses a foreign root ---------

function foreignRoot(parent) {
  const outDir = path.join(parent, 'out');
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, 'foreign.txt'), 'not ours');
  return outDir;
}

function assertForeignUntouched(outDir) {
  assert.deepStrictEqual(fs.readdirSync(outDir), ['foreign.txt']);
  assert.strictEqual(fs.readFileSync(path.join(outDir, 'foreign.txt'), 'utf8'), 'not ours');
}

const REPO = path.join(__dirname, '..');
function repoJson(relative) { return JSON.parse(fs.readFileSync(path.join(REPO, relative), 'utf8')); }
function headCommit() { return require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); }

test('caller agent-plugin refuses a foreign existing output root', () => {
  const parent = tempRoot();
  try {
    const outDir = foreignRoot(parent);
    const { materializeAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');
    assert.throws(() => materializeAgentPluginPackage({
      inventory: repoJson('manifests/distribution-inventory.json'), root: REPO, outDir, name: 'dhpk', version: '0.0.0', sourceCommit: headCommit(), manifestMetadata: repoJson('.claude-plugin/plugin.json'),
    }), /refusing to replace/);
    assertForeignUntouched(outDir);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('caller cursor-plugin refuses a foreign existing output root', () => {
  const parent = tempRoot();
  try {
    const outDir = foreignRoot(parent);
    const { materializeCursorPackage } = require('../scripts/lib/cursor-plugin-package');
    assert.throws(() => materializeCursorPackage({
      inventory: repoJson('manifests/distribution-inventory.json'), root: REPO, outDir, version: '0.0.0', sourceCommit: headCommit(),
    }), /refusing to replace/);
    assertForeignUntouched(outDir);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('caller codex-native refuses a foreign existing output root', () => {
  const parent = tempRoot();
  try {
    const outDir = foreignRoot(parent);
    const { materializeNativePackage, resolveCodexNativeProfileSelection } = require('../scripts/lib/codex-native-package');
    const inventory = repoJson('manifests/distribution-inventory.json');
    assert.throws(() => materializeNativePackage({
      inventory, root: REPO, outDir, name: 'dhpk', version: '0.0.0', sourceCommit: headCommit(), profileSelection: resolveCodexNativeProfileSelection({ root: REPO, inventory }),
    }), /refusing to replace/);
    assertForeignUntouched(outDir);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('caller claude profile bundles refuses a foreign existing output root', () => {
  const parent = tempRoot();
  try {
    const out = foreignRoot(parent);
    fs.mkdirSync(path.join(out, 'package'));
    fs.writeFileSync(path.join(out, 'package', 'foreign.txt'), 'not ours');
    const result = require('node:child_process').spawnSync(process.execPath, [path.join(REPO, 'scripts/ci/gen-claude-profile-bundles.js'), '--out', out], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0, result.stdout);
    assert.match(result.stderr + result.stdout, /refusing to replace/);
    assert.deepStrictEqual(fs.readdirSync(path.join(out, 'package')), ['foreign.txt']);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- Follow-up C: store cleanup warnings reach materializeDistribution callers

test('materializeDistribution returns store cleanup warnings and omits the key otherwise', () => {
  const { materializeDistribution } = require('../scripts/lib/distribution-compiler');
  const root = tempRoot();
  try {
    const entries = [{ stableId: 'one', destination: 'one' }];
    const adapter = { identity: { id: 't', version: '1' }, render: () => ({ adapter: { id: 't', version: '1' }, outputs: [{ stableId: 'one', destination: 'one', content: 'x' }], links: [] }) };
    const owned = { verify: () => ({ ok: true }) };
    const clean = materializeDistribution(plan(entries), adapter, new ProjectionArtifactStore({ root, ownership: owned }));
    assert.strictEqual(clean.ok, true, clean.error && clean.error.message);
    assert.strictEqual('warnings' in clean, false);
    const failingRm = new ProjectionArtifactStore({
      root,
      ownership: owned,
      fs: seam({ rmSync: (target, options) => { if (path.basename(target).startsWith('.projection-backup-')) throw new Error('synthetic rm failure'); return fs.rmSync(target, options); } }),
    });
    const warned = materializeDistribution(plan(entries), adapter, failingRm);
    assert.strictEqual(warned.ok, true, warned.error && warned.error.message);
    assert.strictEqual(warned.warnings.length, 1);
    assert.strictEqual(warned.warnings[0].code, 'BACKUP_CLEANUP_FAILED');
    assert.match(warned.warnings[0].message, /synthetic rm failure/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- Wave 3A follow-ups: verifier judges empty dirs, explicit modes, derived outputs

test('ownership: a supplied verify also judges an existing empty directory; no verify keeps accepting it', () => {
  const root = tempRoot();
  try {
    fs.mkdirSync(path.join(root, 'published'));
    const seen = [];
    const refusing = new ProjectionArtifactStore({ root, ownership: { verify: (existing) => { seen.push(existing); return { ok: false, code: 'EMPTY_REFUSED', message: 'empty is not ours' }; } } });
    const error = expectRefused(() => stageOwnedTree(refusing, undefined).publish());
    assert.strictEqual(error.projectionDetails.reason, 'EMPTY_REFUSED');
    assert.strictEqual(seen.length, 1);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, 'published')), []);
    const accepting = new ProjectionArtifactStore({ root, ownership: { verify: () => ({ ok: true }) } });
    stageOwnedTree(accepting, undefined, 'verified empty').publish();
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/data.txt'), 'utf8'), 'verified empty');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('modes: planned modes are applied exactly, independent of the process umask', () => {
  const root = tempRoot();
  const previous = process.umask(0o077);
  try {
    const entries = [
      { stableId: 'exec', destination: 'bin/run.sh', mode: 0o755 },
      { stableId: 'data', destination: 'data.txt', mode: 0o644 },
    ];
    const session = new ProjectionArtifactStore({ root }).begin(plan(entries));
    session.write({ stableId: 'exec', destination: 'bin/run.sh', content: '#!/bin/sh\n', mode: 0o755 });
    session.write({ stableId: 'data', destination: 'data.txt', content: 'x', mode: 0o644 });
    const published = session.publish();
    assert.strictEqual(fs.statSync(path.join(root, 'published/bin/run.sh')).mode & 0o7777, 0o755);
    assert.strictEqual(fs.statSync(path.join(root, 'published/data.txt')).mode & 0o7777, 0o644);
    assert.deepStrictEqual(published.outputs.map((o) => o.mode).sort(), [0o644, 0o755]);
  } finally { process.umask(previous); fs.rmSync(root, { recursive: true, force: true }); }
});

test('two-phase render: derived outputs are rendered after every data write with session.fingerprintOf', () => {
  const { materializeDistribution } = require('../scripts/lib/distribution-compiler');
  const root = tempRoot();
  try {
    const entries = [{ stableId: 'a', destination: 'a.txt' }, { stableId: 'b', destination: 'b.txt' }, { stableId: 'r', destination: 'receipt.json' }];
    const order = [];
    const adapter = {
      identity: { id: 't', version: '1' },
      render: () => {
        order.push('render');
        return { adapter: { id: 't', version: '1' }, outputs: [{ stableId: 'a', destination: 'a.txt', content: 'A' }, { stableId: 'b', destination: 'b.txt', content: 'B' }], links: [] };
      },
      renderDerived: (_plan, { session }) => {
        order.push('derived');
        const files = { 'a.txt': session.fingerprintOf('a.txt'), 'b.txt': session.fingerprintOf('b.txt') };
        return { outputs: [{ stableId: 'r', destination: 'receipt.json', content: JSON.stringify(files) }] };
      },
    };
    const store = new ProjectionArtifactStore({ root, ownership: { verify: () => ({ ok: true }) } });
    const result = materializeDistribution(plan(entries), adapter, store);
    assert.strictEqual(result.ok, true, result.error && result.error.message);
    assert.deepStrictEqual(order, ['render', 'derived']);
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'published/receipt.json'), 'utf8'));
    assert.match(receipt['a.txt'], /^[a-f0-9]{64}$/);
    assert.notStrictEqual(receipt['a.txt'], receipt['b.txt']);
    assert.strictEqual(result.value.outputs.length, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('projection-artifact-store');
