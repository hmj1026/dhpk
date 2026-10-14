'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const COLLECTOR = path.join(ROOT, 'skills', 'git-smart-commit', 'scripts', 'collect-changes.js');

function cleanGitEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra,
  };
}

function makeRepo() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-git-smart-commit-'));
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  const env = cleanGitEnv();
  const init = spawnSync('git', ['init', '--quiet', '-b', 'main'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(init.status, 0, init.stderr);
  git(root, ['config', 'user.name', 'Collector Test']);
  git(root, ['config', 'user.email', 'collector-test@example.invalid']);
  git(root, ['config', 'maintenance.auto', 'false']);
  git(root, ['config', 'gc.auto', '0']);
  return { parent, root };
}

function git(cwd, args, extraEnv = {}) {
  const result = spawnSync('git', args, {
    cwd,
    env: { ...repoEnv(cwd), ...extraEnv },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function runCollector(cwd, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [COLLECTOR, ...args], {
    cwd,
    env: { ...repoEnv(cwd), ...extraEnv },
    encoding: 'utf8',
    timeout: 15000,
  });
}

function collect(cwd, args = []) {
  const result = runCollector(cwd, args);
  assert.strictEqual(result.status, 0, result.stderr || result.error?.message || 'collector failed');
  assert.strictEqual(result.stderr, '');
  return JSON.parse(result.stdout);
}

function repoEnv(cwd) {
  return cleanGitEnv();
}

function commitAll(root, message = 'fixture commit', extraEnv = {}) {
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '--no-gpg-sign', '-m', message], extraEnv);
}

function captureTree(root) {
  const entries = [];
  function visit(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(relativeDirectory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (entry.isSymbolicLink()) {
        entries.push([relative, 'symlink', stat.mode & 0o777, fs.readlinkSync(absolute)]);
      } else if (entry.isDirectory()) {
        entries.push([relative, 'directory', stat.mode & 0o777]);
        visit(absolute, relative);
      } else {
        entries.push([relative, 'file', stat.mode & 0o777, fs.readFileSync(absolute).toString('base64')]);
      }
    }
  }
  visit(root, '');
  return entries;
}

function collectReadOnly(parent, cwd, args = []) {
  const before = captureTree(parent);
  const repoRoot = findRepoRoot(cwd);
  const indexLock = path.join(repoRoot, '.git', 'index.lock');
  assert.strictEqual(fs.existsSync(indexLock), false, 'fixture must begin without an index lock');
  const payload = collect(cwd, args);
  assert.deepStrictEqual(
    captureTree(parent),
    before,
    'collector must leave HEAD, index bytes, worktree, config, caches, and locks unchanged',
  );
  assert.strictEqual(fs.existsSync(indexLock), false, 'collector must not leave an index lock');
  return payload;
}

function findRepoRoot(cwd) {
  let current = path.resolve(cwd);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    current = path.dirname(current);
  }
  throw new Error(`no fixture repository above ${cwd}`);
}

function fileMap(payload) {
  return new Map(payload.files.map(file => [file.path, file]));
}

function expectFatal(cwd, args = [], env = repoEnv(cwd)) {
  const result = spawnSync(process.execPath, [COLLECTOR, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.ok(result.status !== 0, 'invalid collector input must exit nonzero');
  assert.strictEqual(result.stdout, '', 'fatal errors must not emit success JSON');
  assert.ok(result.stderr.trim().length > 0, 'fatal errors must explain the failure on stderr');
}

function installGitBoundaryFixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, 'git');
  fs.writeFileSync(executable, [
    '#!/usr/bin/env node',
    'if (process.env.GIT_SMART_COMMIT_FIXTURE_MODE === "oversize") {',
    '  process.stdout.write(Buffer.alloc(17 * 1024 * 1024, 0x61));',
    '} else {',
    '  process.stderr.write("fixture Git query failed\\n");',
    '  process.exit(71);',
    '}',
  ].join('\n'));
  fs.chmodSync(executable, 0o755);
  return executable;
}

test('collector reports an empty unborn repository with its root and default hooks', () => {
  const { parent, root } = makeRepo();
  try {
    const payload = collectReadOnly(parent, root);
    assert.deepStrictEqual(payload, {
      schemaVersion: 1,
      repoRoot: fs.realpathSync(root),
      head: null,
      branch: 'main',
      scope: null,
      files: [],
      safety: {
        hasStaged: false,
        hasPartialStaging: false,
        hasOutOfScopeStaged: false,
        hasConflicts: false,
        operations: [],
      },
      hooks: {
        directory: path.join(fs.realpathSync(root), '.git', 'hooks'),
        preCommit: { exists: false, executable: false },
        commitMsg: { exists: false, executable: false },
      },
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector fixture commits keep Git maintenance inactive', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'committed.txt'), 'stable\n');
    const tracePath = path.join(parent, 'git-trace2.jsonl');
    commitAll(root, 'fixture commit', { GIT_TRACE2_EVENT: tracePath });
    const events = fs.readFileSync(tracePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    const detachedMaintenance = events.filter(event => (
      event.event === 'child_start'
      && Array.isArray(event.argv)
      && event.argv.includes('maintenance')
      && event.argv.includes('--detach')
    ));

    assert.deepStrictEqual(detachedMaintenance, [], 'fixture commits must not start detached Git maintenance');
    assert.strictEqual(
      fs.existsSync(path.join(root, '.git', 'objects', 'maintenance.lock')),
      false,
      'fixture commits must not leave a Git maintenance lock in the object database',
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector reports a clean committed repository without inventing changes', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'committed.txt'), 'stable\n');
    commitAll(root);
    git(root, ['checkout', '--quiet', '--detach', 'HEAD']);
    const payload = collectReadOnly(parent, root);
    assert.strictEqual(payload.schemaVersion, 1);
    assert.strictEqual(payload.repoRoot, fs.realpathSync(root));
    assert.match(payload.head, /^[0-9a-f]{40,64}$/);
    assert.strictEqual(payload.branch, null);
    assert.strictEqual(payload.scope, null);
    assert.deepStrictEqual(payload.files, []);
    assert.deepStrictEqual(payload.safety, {
      hasStaged: false,
      hasPartialStaging: false,
      hasOutOfScopeStaged: false,
      hasConflicts: false,
      operations: [],
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector separates staged and unstaged text counts and marks binary and untracked counts unknown', () => {
  const { parent, root } = makeRepo();
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'app.txt'), 'alpha\nbeta\n');
    fs.writeFileSync(path.join(root, 'asset.bin'), Buffer.from([0, 1, 2, 255]));
    commitAll(root);

    fs.writeFileSync(path.join(root, 'src', 'app.txt'), 'ALPHA\nbeta\n');
    git(root, ['add', '--', 'src/app.txt']);
    fs.writeFileSync(path.join(root, 'src', 'app.txt'), 'ALPHA\nBETA\nextra\n');
    fs.writeFileSync(path.join(root, 'asset.bin'), Buffer.from([0, 255, 2, 254]));
    git(root, ['add', '--', 'asset.bin']);
    fs.writeFileSync(path.join(root, 'draft.txt'), 'untracked\ntext\n');

    const payload = collectReadOnly(parent, root);
    const files = fileMap(payload);
    assert.deepStrictEqual([...files.keys()].sort(), ['asset.bin', 'draft.txt', 'src/app.txt']);
    assert.deepStrictEqual(
      [files.get('src/app.txt').indexStatus, files.get('src/app.txt').worktreeStatus],
      ['M', 'M'],
    );
    assert.deepStrictEqual(files.get('src/app.txt').staged, { added: 1, deleted: 1 });
    assert.deepStrictEqual(files.get('src/app.txt').unstaged, { added: 2, deleted: 1 });
    assert.deepStrictEqual(
      [files.get('asset.bin').indexStatus, files.get('asset.bin').worktreeStatus],
      ['M', ' '],
    );
    assert.deepStrictEqual(files.get('asset.bin').staged, { added: null, deleted: null });
    assert.deepStrictEqual(files.get('asset.bin').unstaged, null);
    assert.deepStrictEqual(
      [files.get('draft.txt').indexStatus, files.get('draft.txt').worktreeStatus],
      ['?', '?'],
    );
    assert.deepStrictEqual(files.get('draft.txt').unstaged, { added: null, deleted: null });
    assert.strictEqual(payload.safety.hasStaged, true);
    assert.strictEqual(payload.safety.hasPartialStaging, true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector keeps global staged safety while filtering a normalized scope from a consumer subdirectory', () => {
  const { parent, root } = makeRepo();
  try {
    fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'inside.txt'), 'inside\n');
    fs.writeFileSync(path.join(root, 'outside.txt'), 'outside\n');
    commitAll(root);

    fs.writeFileSync(path.join(root, 'src', 'inside.txt'), 'inside staged\n');
    git(root, ['add', '--', 'src/inside.txt']);
    fs.writeFileSync(path.join(root, 'src', 'inside.txt'), 'inside worktree\n');
    fs.writeFileSync(path.join(root, 'outside.txt'), 'outside staged\n');
    git(root, ['add', '--', 'outside.txt']);

    const payload = collectReadOnly(
      parent,
      path.join(root, 'src', 'nested'),
      ['--scope', 'src/./nested/..'],
    );
    assert.strictEqual(payload.repoRoot, fs.realpathSync(root));
    assert.strictEqual(payload.scope, 'src');
    assert.deepStrictEqual([...fileMap(payload).keys()], ['src/inside.txt']);
    assert.strictEqual(payload.safety.hasStaged, true);
    assert.strictEqual(payload.safety.hasPartialStaging, true);
    assert.strictEqual(payload.safety.hasOutOfScopeStaged, true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector treats scope metacharacters literally with the equals-form option', () => {
  const { parent, root } = makeRepo();
  try {
    const literalDirectory = path.join(root, 'src', '[a]*');
    const globNeighbor = path.join(root, 'src', 'ax');
    fs.mkdirSync(literalDirectory, { recursive: true });
    fs.mkdirSync(globNeighbor, { recursive: true });
    fs.writeFileSync(path.join(literalDirectory, 'inside.txt'), 'literal\n');
    fs.writeFileSync(path.join(globNeighbor, 'neighbor.txt'), 'neighbor\n');
    commitAll(root);
    fs.appendFileSync(path.join(literalDirectory, 'inside.txt'), 'changed\n');
    fs.appendFileSync(path.join(globNeighbor, 'neighbor.txt'), 'changed\n');

    const payload = collectReadOnly(parent, root, ['--scope=src/[a]*']);
    assert.strictEqual(payload.scope, 'src/[a]*');
    assert.deepStrictEqual([...fileMap(payload).keys()], ['src/[a]*/inside.txt']);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector normalizes dot scope to the repository root', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
    commitAll(root);
    fs.appendFileSync(path.join(root, 'tracked.txt'), 'changed\n');

    const payload = collectReadOnly(parent, root, ['--scope=.']);
    assert.strictEqual(payload.scope, '.');
    assert.deepStrictEqual([...fileMap(payload).keys()], ['tracked.txt']);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector matches a staged rename by its old scope endpoint and preserves newline and Unicode paths', () => {
  const { parent, root } = makeRepo();
  try {
    fs.mkdirSync(path.join(root, 'old-dir'));
    fs.mkdirSync(path.join(root, 'new-dir'));
    const oldPath = 'old-dir/old name\n文.txt';
    const newPath = 'new-dir/new name\n文.txt';
    fs.writeFileSync(path.join(root, oldPath), 'same contents\n');
    fs.writeFileSync(path.join(root, 'removed.txt'), 'gone\n');
    commitAll(root);

    git(root, ['mv', '--', oldPath, newPath]);
    git(root, ['rm', '--', 'removed.txt']);

    const scoped = collectReadOnly(parent, root, ['--scope', 'old-dir']);
    assert.strictEqual(scoped.scope, 'old-dir');
    assert.strictEqual(scoped.safety.hasOutOfScopeStaged, true);
    assert.deepStrictEqual([...fileMap(scoped).keys()], [newPath]);
    assert.strictEqual(fileMap(scoped).get(newPath).originalPath, oldPath);
    assert.strictEqual(fileMap(scoped).get(newPath).indexStatus, 'R');

    const newEndpointScope = collectReadOnly(parent, root, ['--scope', 'new-dir']);
    assert.deepStrictEqual([...fileMap(newEndpointScope).keys()], [newPath]);

    const complete = collectReadOnly(parent, root);
    const allFiles = fileMap(complete);
    assert.strictEqual(allFiles.get('removed.txt').indexStatus, 'D');
    assert.strictEqual(allFiles.get('removed.txt').originalPath, null);
    assert.deepStrictEqual(allFiles.get('removed.txt').staged, { added: 0, deleted: 1 });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector reports an absolute custom hooks directory without executing either hook', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
    commitAll(root);
    const hooksDirectory = path.join(root, '.git', 'custom-hooks');
    fs.mkdirSync(hooksDirectory);
    const marker = path.join(root, 'hook-ran');
    const preCommit = path.join(hooksDirectory, 'pre-commit');
    fs.writeFileSync(preCommit, `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`);
    fs.chmodSync(preCommit, 0o755);
    fs.writeFileSync(path.join(hooksDirectory, 'commit-msg'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(hooksDirectory, 'commit-msg'), 0o644);
    git(root, ['config', 'core.hooksPath', hooksDirectory]);

    const payload = collectReadOnly(parent, root);
    assert.deepStrictEqual(payload.hooks, {
      directory: hooksDirectory,
      preCommit: { exists: true, executable: true },
      commitMsg: { exists: true, executable: false },
    });
    assert.strictEqual(fs.existsSync(marker), false, 'collecting hook metadata must never run hooks');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector reports conflict state and an in-progress merge', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'conflict.txt'), 'base\n');
    commitAll(root, 'base');
    git(root, ['switch', '--quiet', '-c', 'side']);
    fs.writeFileSync(path.join(root, 'conflict.txt'), 'side\n');
    commitAll(root, 'side change');
    git(root, ['switch', '--quiet', 'main']);
    fs.writeFileSync(path.join(root, 'conflict.txt'), 'main\n');
    commitAll(root, 'main change');
    const merge = spawnSync('git', ['merge', '--no-edit', 'side'], {
      cwd: root,
      env: repoEnv(root),
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.notStrictEqual(merge.status, 0, 'fixture merge must produce a conflict');

    const payload = collectReadOnly(parent, root);
    assert.strictEqual(payload.safety.hasConflicts, true);
    assert.ok(payload.safety.operations.some(operation => /merge/i.test(String(operation))));
    assert.strictEqual(fileMap(payload).get('conflict.txt').indexStatus, 'U');
    assert.strictEqual(fileMap(payload).get('conflict.txt').worktreeStatus, 'U');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector reports an in-progress rebase conflict', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'conflict.txt'), 'base\n');
    commitAll(root, 'base');
    git(root, ['switch', '--quiet', '-c', 'feature']);
    fs.writeFileSync(path.join(root, 'conflict.txt'), 'feature\n');
    commitAll(root, 'feature change');
    git(root, ['switch', '--quiet', 'main']);
    fs.writeFileSync(path.join(root, 'conflict.txt'), 'main\n');
    commitAll(root, 'main change');
    git(root, ['switch', '--quiet', 'feature']);
    const rebase = spawnSync('git', ['rebase', 'main'], {
      cwd: root,
      env: repoEnv(root),
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.notStrictEqual(rebase.status, 0, 'fixture rebase must produce a conflict');

    const payload = collectReadOnly(parent, root);
    assert.strictEqual(payload.safety.hasConflicts, true);
    assert.ok(payload.safety.operations.some(operation => /rebase/i.test(String(operation))));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector rejects a scope outside the repository, an unknown option, and a non-repository cwd', () => {
  const { parent, root } = makeRepo();
  try {
    const outside = path.join(parent, 'outside');
    fs.mkdirSync(outside);
    expectFatal(root, ['--scope', '../outside']);
    expectFatal(root, ['--scope', outside]);
    expectFatal(root, ['--scope']);
    expectFatal(root, ['--mystery']);
    expectFatal(outside);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector fails closed when Git fails or exceeds the output limit', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
    commitAll(root);
    const bin = path.join(parent, 'fake-bin');
    installGitBoundaryFixture(bin);
    const env = {
      ...repoEnv(root),
      PATH: bin + path.delimiter + process.env.PATH,
      GIT_SMART_COMMIT_FIXTURE_MODE: 'fail',
    };
    const before = captureTree(parent);
    expectFatal(root, [], env);
    assert.deepStrictEqual(captureTree(parent), before, 'failed Git queries must leave repository state unchanged');

    env.GIT_SMART_COMMIT_FIXTURE_MODE = 'oversize';
    expectFatal(root, [], env);
    assert.deepStrictEqual(captureTree(parent), before, 'oversized Git output must leave repository state unchanged');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector refuses configured clean filters before Git can execute their shell commands', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, '.gitattributes'), '*.txt filter=sideeffect\n');
    fs.writeFileSync(path.join(root, 'app.txt'), 'base\n');
    commitAll(root);
    const marker = path.join(root, 'filter-ran');
    git(root, ['config', 'filter.sideeffect.clean', `touch ${JSON.stringify(marker)}; cat`]);
    fs.writeFileSync(path.join(root, 'app.txt'), 'changed\n');

    const before = captureTree(parent);
    const result = runCollector(root);
    assert.strictEqual(
      fs.existsSync(marker),
      false,
      'collector must reject configured clean filters before they can execute',
    );
    assert.ok(result.status !== 0, 'collector must fail closed for configured clean filters');
    assert.strictEqual(result.stdout, '', 'filter rejection must not emit success JSON');
    assert.match(result.stderr, /filter/i, 'stderr should identify the unsupported clean filter');
    assert.deepStrictEqual(captureTree(parent), before, 'filter rejection must leave all fixture state unchanged');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector rejects ambient Git directory and index redirection without touching either repository', () => {
  const consumer = makeRepo();
  const alternate = makeRepo();
  try {
    fs.writeFileSync(path.join(consumer.root, 'consumer.txt'), 'consumer base\n');
    commitAll(consumer.root, 'consumer base');
    fs.writeFileSync(path.join(consumer.root, 'consumer-untracked.txt'), 'consumer only\n');
    fs.writeFileSync(path.join(alternate.root, 'alternate.txt'), 'alternate base\n');
    commitAll(alternate.root, 'alternate base');

    const cases = [
      {
        name: 'GIT_DIR and GIT_WORK_TREE',
        env: {
          GIT_DIR: path.join(alternate.root, '.git'),
          GIT_WORK_TREE: alternate.root,
        },
      },
      {
        name: 'GIT_INDEX_FILE',
        env: { GIT_INDEX_FILE: path.join(alternate.root, '.git', 'index') },
      },
    ];

    for (const item of cases) {
      const consumerBefore = captureTree(consumer.parent);
      const alternateBefore = captureTree(alternate.parent);
      expectFatal(consumer.root, [], { ...repoEnv(consumer.root), ...item.env });
      assert.deepStrictEqual(captureTree(consumer.parent), consumerBefore, `${item.name} case must preserve consumer state`);
      assert.deepStrictEqual(captureTree(alternate.parent), alternateBefore, `${item.name} case must preserve alternate state`);
    }
  } finally {
    fs.rmSync(consumer.parent, { recursive: true, force: true });
    fs.rmSync(alternate.parent, { recursive: true, force: true });
  }
});

function installObservationDriftProxy(directory, repoRoot, mutation) {
  const bin = path.join(directory, 'observation-drift-bin');
  fs.mkdirSync(bin, { recursive: true });
  const executable = path.join(bin, 'git');
  const marker = path.join(directory, 'observation-drift-fired');
  const config = path.join(directory, 'observation-drift.json');
  const realGit = process.env.PATH.split(path.delimiter)
    .map(entry => path.join(entry, process.platform === 'win32' ? 'git.exe' : 'git'))
    .find(candidate => fs.existsSync(candidate));
  assert.ok(realGit, 'the fixture must locate the real Git executable before installation');
  fs.writeFileSync(config, JSON.stringify({ ...mutation, repoRoot, marker }));
  fs.writeFileSync(executable, [
    '#!/usr/bin/env node',
    "'use strict';",
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const { spawnSync } = require("node:child_process");',
    'const config = JSON.parse(fs.readFileSync(process.env.GIT_SMART_COMMIT_DRIFT_CONFIG, "utf8"));',
    'const realGit = process.env.GIT_SMART_COMMIT_REAL_GIT;',
    'const args = process.argv.slice(2);',
    'const result = spawnSync(realGit, args, { cwd: process.cwd(), env: process.env, encoding: null, maxBuffer: 16 * 1024 * 1024, timeout: 30000 });',
    'if (result.error || result.signal) { process.stderr.write("fixture Git query failed\\n"); process.exit(71); }',
    'if (result.stdout && result.stdout.length) process.stdout.write(result.stdout);',
    'if (result.stderr && result.stderr.length) process.stderr.write(result.stderr);',
    'if (result.status !== 0) process.exit(result.status || 72);',
    'const atObservationBoundary = args.includes("--git-path") && args[args.indexOf("--git-path") + 1] === "hooks";',
    'if (atObservationBoundary && !fs.existsSync(config.marker)) {',
    '  const filename = config.filename ? path.join(config.repoRoot, config.filename) : null;',
    '  if (config.kind === "status") {',
    '    fs.writeFileSync(filename, "");',
    '  } else if (config.kind === "head") {',
    '    fs.writeFileSync(filename, config.content);',
    '    for (const gitArgs of [["add", "--", config.filename], ["commit", "--quiet", "--no-gpg-sign", "-m", "collection drift"]]) {',
    '      const mutation = spawnSync(realGit, gitArgs, { cwd: config.repoRoot, env: process.env, encoding: "utf8", timeout: 10000 });',
    '      if (mutation.error || mutation.status !== 0) { process.stderr.write("fixture repository mutation failed\\n"); process.exit(73); }',
    '    }',
    '  } else if (config.kind === "cached" || config.kind === "working") {',
    '    fs.writeFileSync(filename, config.content);',
    '    if (config.kind === "cached") {',
    '      const mutation = spawnSync(realGit, ["add", "--", config.filename], { cwd: config.repoRoot, env: process.env, encoding: "utf8", timeout: 10000 });',
    '      if (mutation.error || mutation.status !== 0) { process.stderr.write("fixture staging mutation failed\\n"); process.exit(74); }',
    '    }',
    '  } else {',
    '    process.stderr.write("unknown fixture mutation\\n");',
    '    process.exit(75);',
    '  }',
    '  fs.writeFileSync(config.marker, "mutation applied\\n");',
    '}',
  ].join('\n'));
  fs.chmodSync(executable, 0o755);
  return {
    marker,
    env: {
      PATH: bin + path.delimiter + process.env.PATH,
      GIT_SMART_COMMIT_REAL_GIT: realGit,
      GIT_SMART_COMMIT_DRIFT_CONFIG: config,
    },
  };
}

function driftObservations(root) {
  const diffArgs = ['--numstat', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--find-renames'];
  return {
    status: git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--renames', '--ignore-submodules=none']),
    cached: git(root, ['diff', '--cached', ...diffArgs]),
    working: git(root, ['diff', ...diffArgs]),
  };
}

function assertSourceDriftResult(result) {
  assert.ok(
    result.status !== 0,
    `collector must fail when its source changes during collection (exit ${result.status}, stdout ${JSON.stringify(result.stdout)})`,
  );
  assert.strictEqual(result.stdout, '', 'source drift must not emit success JSON');
  assert.match(result.stderr, /SOURCE_DRIFT/, 'stderr must identify SOURCE_DRIFT');
}

test('collector rejects HEAD movement made after its source observations', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'base.txt'), 'stable\n');
    commitAll(root);
    const beforeHead = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
    const proxy = installObservationDriftProxy(parent, root, {
      kind: 'head',
      filename: 'during-collection.txt',
      content: 'committed during collection\n',
    });

    const result = runCollector(root, [], proxy.env);
    assert.strictEqual(fs.existsSync(proxy.marker), true, 'the query-boundary mutation must run');
    assert.notStrictEqual(git(root, ['rev-parse', '--verify', 'HEAD']).trim(), beforeHead, 'the fixture must advance HEAD');
    assertSourceDriftResult(result);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector rejects a raw status change when an empty untracked file appears after observation', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'base.txt'), 'stable\n');
    commitAll(root);
    const before = driftObservations(root);
    const proxy = installObservationDriftProxy(parent, root, {
      kind: 'status',
      filename: 'empty-during-collection.txt',
    });

    const result = runCollector(root, [], proxy.env);
    const after = driftObservations(root);
    assert.strictEqual(fs.existsSync(proxy.marker), true, 'the query-boundary mutation must run');
    assert.strictEqual(fs.existsSync(path.join(root, 'empty-during-collection.txt')), true, 'the empty file must be created');
    assert.notStrictEqual(after.status, before.status, 'raw porcelain status must change');
    assert.strictEqual(after.cached, before.cached, 'an empty untracked file must not change cached numstat');
    assert.strictEqual(after.working, before.working, 'an empty untracked file must not change working numstat');
    assertSourceDriftResult(result);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector rejects staged line-count changes made after observation while status stays the same', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'staged.txt'), 'alpha\nbeta\n');
    commitAll(root);
    fs.writeFileSync(path.join(root, 'staged.txt'), 'ALPHA\nbeta\n');
    git(root, ['add', '--', 'staged.txt']);
    const before = driftObservations(root);
    const proxy = installObservationDriftProxy(parent, root, {
      kind: 'cached',
      filename: 'staged.txt',
      content: 'ALPHA\nBETA\nextra\n',
    });

    const result = runCollector(root, [], proxy.env);
    const after = driftObservations(root);
    assert.strictEqual(fs.existsSync(proxy.marker), true, 'the query-boundary mutation must run');
    assert.strictEqual(after.status, before.status, 'staging a further edit must keep the porcelain status unchanged');
    assert.notStrictEqual(after.cached, before.cached, 'cached numstat must change after restaging');
    assert.strictEqual(after.working, before.working, 'the worktree diff must remain empty after restaging');
    assertSourceDriftResult(result);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector rejects working line-count changes even when porcelain status stays the same', () => {
  const { parent, root } = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'working.txt'), 'alpha\nbeta\n');
    commitAll(root);
    fs.writeFileSync(path.join(root, 'working.txt'), 'ALPHA\nbeta\n');
    const before = driftObservations(root);
    const proxy = installObservationDriftProxy(parent, root, {
      kind: 'working',
      filename: 'working.txt',
      content: 'ALPHA\nBETA\nextra\n',
    });

    const result = runCollector(root, [], proxy.env);
    const after = driftObservations(root);
    assert.strictEqual(fs.existsSync(proxy.marker), true, 'the query-boundary mutation must run');
    assert.strictEqual(after.status, before.status, 'editing the same path must keep the porcelain status unchanged');
    assert.strictEqual(after.cached, before.cached, 'the cached diff must remain empty');
    assert.notStrictEqual(after.working, before.working, 'working numstat must change');
    assertSourceDriftResult(result);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('collector rejects a submodule before status can execute its local clean filter', () => {
  const { parent, root } = makeRepo();
  try {
    const source = path.join(parent, 'submodule-source');
    fs.mkdirSync(source);
    const init = spawnSync('git', ['init', '--quiet', '-b', 'main'], {
      cwd: source,
      env: repoEnv(source),
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(init.status, 0, init.stderr);
    git(source, ['config', 'user.name', 'Submodule Test']);
    git(source, ['config', 'user.email', 'submodule-test@example.invalid']);
    fs.writeFileSync(path.join(source, '.gitattributes'), '*.txt filter=effect\n');
    fs.writeFileSync(path.join(source, 'app.txt'), 'base\n');
    commitAll(source, 'submodule base');

    git(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', source, 'sub']);
    commitAll(root, 'add submodule');
    const submodule = path.join(root, 'sub');
    const marker = path.join(parent, 'filter-ran');
    git(submodule, ['config', 'filter.effect.clean', `touch ${JSON.stringify(marker)}; cat`]);

    const filename = path.join(submodule, 'app.txt');
    const original = fs.statSync(filename);
    fs.writeFileSync(filename, 'BASE\n');
    fs.utimesSync(filename, original.atime, new Date(original.mtimeMs - 5000));
    const changed = fs.statSync(filename);
    assert.strictEqual(changed.size, original.size, 'the submodule edit must preserve file size');
    assert.notStrictEqual(changed.mtimeMs, original.mtimeMs, 'the submodule edit must change mtime');
    assert.strictEqual(fs.existsSync(marker), false, 'the clean filter must not run during setup');

    const result = runCollector(root);
    assert.ok(
      result.status !== 0,
      `collector must reject repositories with a submodule gitlink (exit ${result.status}, stdout ${JSON.stringify(result.stdout)}, filter marker exists ${fs.existsSync(marker)})`,
    );
    assert.strictEqual(result.stdout, '', 'submodule rejection must not emit success JSON');
    assert.match(result.stderr, /UNSUPPORTED_SUBMODULE/, 'stderr must identify the unsupported submodule');
    assert.strictEqual(fs.existsSync(marker), false, 'collector must reject the gitlink before the local clean filter runs');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

run('git-smart-commit-collector');
