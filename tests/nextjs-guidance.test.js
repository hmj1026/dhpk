'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GUIDE = 'skills/nextjs/references/15.5.md';
const NEEDLES = [
  'ends at v15.5.19',
  '止於 v15.5.19',
  'end-of-life at v15.5.19',
  '15.x line ends at',
  '15.x ends at v15.5.19',
];
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function write(root, relative, contents) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

function recursiveFiles(root, dir = root, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      recursiveFiles(root, full, files);
      continue;
    }
    if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return files;
}

function trackedFiles(root) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function forbiddenClaims(root, hits) {
  const files = trackedFiles(root) ?? recursiveFiles(root);
  for (const relative of files) {
    if (relative === 'tests/nextjs-guidance.test.js') continue;
    const full = path.join(root, relative);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const bytes = fs.readFileSync(full);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8').replace(/\*\*/g, '').replace(/\s+/g, ' ');
    for (const needle of NEEDLES) {
      if (text.includes(needle)) hits.push(`${relative}: ${needle}`);
    }
  }
}

test('claim scan includes tracked active files and ignores local backups and archives', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nextjs-guidance-tracked-'));
  try {
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(initialized.status, 0, initialized.stderr);
    write(root, '.gitignore', [
      '.claude/artifacts/',
      '.codex/.dhpk-backups/',
      '.cursor/.dhpk-backups/',
      'openspec/changes/',
      '',
    ].join('\n'));
    write(root, 'README.md', 'Next.js ends at v15.5.19\n');
    write(root, '.claude/settings.json', '{"claim":"Next.js ends at v15.5.19"}\n');

    const localArtifacts = [
      '.claude/artifacts/release-backup/README.md',
      '.codex/.dhpk-backups/README.md',
      '.cursor/.dhpk-backups/README.md',
      'openspec/changes/archive/old-claim.md',
    ];
    for (const relative of localArtifacts) {
      write(root, relative, 'Next.js ends at v15.5.19\n');
      const ignored = spawnSync('git', ['check-ignore', '--quiet', relative], { cwd: root });
      assert.strictEqual(ignored.status, 0, `${relative} should be ignored in the fixture`);
    }

    const added = spawnSync('git', ['add', '-f', 'README.md', '.claude/settings.json'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.strictEqual(added.status, 0, added.stderr);

    const hits = [];
    forbiddenClaims(root, hits);
    assert.deepStrictEqual(hits.sort(), [
      '.claude/settings.json: ends at v15.5.19',
      'README.md: ends at v15.5.19',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('claim scan keeps its recursive fallback outside a Git checkout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nextjs-guidance-no-git-'));
  try {
    write(root, 'README.md', 'Next.js ends at v15.5.19\n');
    const hits = [];
    forbiddenClaims(root, hits);
    assert.deepStrictEqual(hits, ['README.md: ends at v15.5.19']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Next.js 15.5 is not described as ending at v15.5.19', () => {
  const hits = [];
  forbiddenClaims(ROOT, hits);
  assert.deepStrictEqual(hits, []);

  const guide = read(GUIDE);
  assert.match(guide, /no `nextjs-15\.6` module/);
  assert.match(guide, /2026-10-21/);
  assert.match(guide, /https:\/\/nextjs\.org\/support-policy/);
  assert.match(guide, /Maintenance LTS/);
  assert.match(guide, /two years following the initial release/);
  assert.match(guide, /Re-check the page before treating that status as current\./);
  assert.match(guide, /v15\.5\.20/);
  assert.match(guide, /v15\.5\.21/);
  assert.match(guide, /security fixes/);
  assert.match(guide, /not a minimum patched version/);
  assert.match(guide, /v15\.5\.28/);
  assert.match(guide, /not a final 15\.x patch/);
  assert.match(guide, /v15\.5\.19 is not the last 15\.x patch/);
  const plain = guide.replace(/\*\*/g, '').replace(/\s+/g, ' ');
  assert.ok(!/ends at v15\.5\.\d+/.test(plain));
  assert.ok(!/end-of-life at v15\.5\.\d+/.test(plain));
  assert.ok(!fs.existsSync(path.join(ROOT, 'modules', 'nextjs-15.6')));

  for (const relative of [
    'modules/nextjs-15.5/module.yaml',
    'README.md',
    'manifests/module-catalog.json',
    'skills/harness-setup/data/module-catalog.json',
    'codex/supporting/manifests/module-catalog.json',
    'cursor/dhpk/manifests/module-catalog.json',
  ]) {
    assert.match(read(relative), /after v15\.5\.19/, relative);
  }
  assert.match(read('README.zh-TW.md'), /v15\.5\.19 之後/);
});

run('nextjs-guidance');
