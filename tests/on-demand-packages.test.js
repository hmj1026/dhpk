'use strict';

// Contract for the on-demand host packages (ADR 0040): the Agent, Cursor and
// AGY packages are built by `bin/dhpk distribution build <surface>`, archived,
// attached to the GitHub Release, and never committed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ON_DEMAND_SURFACES,
  isOnDemandSurface,
  onDemandPackageName,
  onDemandRelativeDir,
  onDemandArchiveName,
  archiveOnDemandPackage,
  withOnDemandSurfaceLock,
  withOnDemandLocks,
} = require('../scripts/lib/on-demand-packages');
const { parseRequest, SURFACES } = require('../scripts/lib/dhpk-distribution');

const ROOT = path.join(__dirname, '..');

function tracked(prefix) {
  const result = spawnSync('git', ['ls-files', '--', prefix], { cwd: ROOT, encoding: 'utf8' });
  return result.stdout.split('\n').filter(Boolean);
}

test('the on-demand surfaces are exactly the Agent, Cursor and AGY packages', () => {
  assert.deepStrictEqual([...ON_DEMAND_SURFACES].sort(), ['agent-plugin', 'agy-plugin', 'cursor-plugin']);
  assert.strictEqual(isOnDemandSurface('codex-native'), false);
  assert.strictEqual(onDemandPackageName('cursor-plugin'), 'dhpk-cursor');
  assert.strictEqual(onDemandRelativeDir('agy-plugin'), 'dist/on-demand/dhpk-agy');
  assert.strictEqual(onDemandArchiveName('agent-plugin', '1.2.3'), 'dhpk-agent-1.2.3.tar.gz');
  assert.throws(() => onDemandPackageName('codex-native'), /not an on-demand/);
});

test('distribution surfaces default to the ignored build directory, not plugins/', () => {
  for (const surface of ON_DEMAND_SURFACES) {
    assert.strictEqual(SURFACES[surface].output, onDemandRelativeDir(surface));
  }
  assert.strictEqual(SURFACES['codex-native'].output, 'plugins/dhpk');
});

test('build parses as an operation on an on-demand surface', () => {
  const request = parseRequest(['build', 'cursor-plugin', '--version', '1.2.3', '--json']);
  assert.strictEqual(request.ok, true);
  assert.strictEqual(request.operation, 'build');
  assert.strictEqual(request.surface, 'cursor-plugin');
  assert.strictEqual(request.options.version, '1.2.3');
});

test('build refuses committed and unknown surfaces', () => {
  for (const surface of ['codex-native', 'openai-submission', 'nope']) {
    const request = parseRequest(['build', surface]);
    assert.strictEqual(request.ok, false, surface);
    assert.strictEqual(request.status, 64);
  }
});

test('the classic surface-first form still parses', () => {
  const request = parseRequest(['codex-native', 'verify']);
  assert.strictEqual(request.ok, true);
  assert.strictEqual(request.operation, 'verify');
});

test('archiving writes <name>-<version>.tar.gz holding the package under its own name', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-archive-')));
  try {
    const packageDir = path.join(parent, 'dhpk-agent');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(path.join(packageDir, 'plugin.json'), '{}\n');
    const { archivePath, sha256 } = archiveOnDemandPackage({ surface: 'agent-plugin', packageDir, version: '1.2.3' });
    assert.strictEqual(archivePath, path.join(parent, 'dhpk-agent-1.2.3.tar.gz'));
    assert.match(sha256, /^[0-9a-f]{64}$/);
    const listing = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
    assert.strictEqual(listing.status, 0, listing.stderr);
    assert.ok(listing.stdout.split('\n').includes('dhpk-agent/plugin.json'), listing.stdout);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('the repository commits only the Published Packages', () => {
  for (const name of ['dhpk-agent', 'dhpk-cursor', 'dhpk-agy']) {
    assert.deepStrictEqual(tracked(`plugins/${name}`), [], `plugins/${name} must not be tracked`);
  }
  assert.deepStrictEqual(tracked('generated'), [], 'generated/ is renamed dist/');
  assert.ok(tracked('plugins/dhpk').length > 0, 'the Public Plugin stays committed');
  assert.ok(tracked('dist/claude-marketplace/package').length > 0, 'the Directory Plugin stays committed');
  assert.ok(tracked('dist/claude-marketplace/stacks-package').length > 0, 'dhpk-stacks stays committed');
  assert.deepStrictEqual(tracked('dist/on-demand'), [], 'on-demand builds are never committed');
});

test('the Claude marketplace sources point at dist/', () => {
  const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.deepStrictEqual(
    marketplace.plugins.map((entry) => entry.source).sort(),
    ['./dist/claude-marketplace/package', './dist/claude-marketplace/stacks-package'],
  );
});

test('the release workflow attaches an archive for every on-demand surface', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /dhpk-release-host-packages-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /gh release upload "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /gh release download "\$GITHUB_REF_NAME"/);
  const verify = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'release-verify.sh'), 'utf8');
  for (const surface of ON_DEMAND_SURFACES) assert.ok(verify.includes(surface), `release-verify.sh must build ${surface}`);
  assert.match(verify, /bin\/dhpk distribution build "\$surface"/);
});

test('archiveOnDemandPackage writes atomically and leaves no temp files on failure', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-atomic-')));
  try {
    const packageDir = path.join(parent, 'dhpk-agent');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(path.join(packageDir, 'plugin.json'), '{"v":1}\n');
    const first = archiveOnDemandPackage({ surface: 'agent-plugin', packageDir, version: '1.2.3' });
    assert.strictEqual(fs.readdirSync(parent).filter((name) => name.includes('.tmp-')).length, 0);

    // A failed archive build must preserve the previously valid archive and leave no temp artifact.
    fs.rmSync(packageDir, { recursive: true, force: true });
    assert.throws(() => archiveOnDemandPackage({ surface: 'agent-plugin', packageDir, version: '1.2.3' }), /archive failed/);
    assert.strictEqual(fs.existsSync(first.archivePath), true, 'existing archive must stay intact on failed rebuild');
    assert.strictEqual(fs.readdirSync(parent).filter((name) => name.includes('.tmp-')).length, 0);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('withOnDemandSurfaceLock supports re-entrancy and reclaims stale dead-PID locks', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-lock-')));
  try {
    const packageDir = path.join(parent, 'dhpk-cursor');
    const lockDir = path.join(parent, '.dhpk-cursor.build-lock');
    const exited = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.strictEqual(exited.status, 0);
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: exited.pid, createdAt: 1 }));
    let nestedRan = false;
    const result = withOnDemandSurfaceLock(packageDir, () => withOnDemandLocks([packageDir, packageDir], () => {
      nestedRan = true;
      return 'ok';
    }));
    assert.strictEqual(result, 'ok');
    assert.strictEqual(nestedRan, true);
    assert.strictEqual(fs.existsSync(lockDir), false, 'lock directory must be cleaned up on exit');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

run('on-demand-packages');
