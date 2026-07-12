'use strict';

// Behavioral guard for scripts/codemaps/generate.ts. This is a TypeScript
// file with no build step in this repo, so it can only be exercised if a
// TypeScript-capable runner is available in the environment. We probe for
// Node's native type-stripping (`--experimental-strip-types`, available on
// recent Node without any install) first, since it needs no network/package
// install; if unavailable, we skip cleanly rather than fail the suite.
//
// generate.ts resolves ROOT from process.cwd() and writes to
// <cwd>/docs/CODEMAPS/, so each run happens with cwd pointed at a disposable
// temp directory.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GENERATE_TS = path.join(ROOT, 'scripts', 'codemaps', 'generate.ts');

function probeStripTypesRunner() {
  const res = spawnSync('node', ['--experimental-strip-types', '-e', 'const x: number = 1; x;'], {
    encoding: 'utf8',
  });
  return res.status === 0;
}

const hasRunner = probeStripTypesRunner();

if (!hasRunner) {
  console.log('skip: no TypeScript runner available (node --experimental-strip-types unsupported)');
  process.exit(0);
}

function runGenerate(cwd, srcDir) {
  const args = ['--experimental-strip-types', GENERATE_TS];
  if (srcDir) args.push(srcDir);
  const res = spawnSync('node', args, { encoding: 'utf8', cwd });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

function makeFixtureSrc(tmp) {
  const srcDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(srcDir, 'components'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'components', 'Foo.tsx'), 'export const Foo = () => null;\n');
  fs.mkdirSync(path.join(srcDir, 'api', 'routes'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'api', 'routes', 'index.ts'), 'export const routes = [];\n');
  fs.mkdirSync(path.join(srcDir, 'models'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'models', 'user.model.ts'), 'export interface User {}\n');
  return srcDir;
}

test('generates docs/CODEMAPS/INDEX.md and per-area files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codemaps-'));
  try {
    const srcDir = makeFixtureSrc(tmp);
    const { status, out } = runGenerate(tmp, srcDir);
    assert.strictEqual(status, 0, `expected generate.ts to exit 0, got:\n${out}`);

    const outDir = path.join(tmp, 'docs', 'CODEMAPS');
    for (const f of ['INDEX.md', 'frontend.md', 'backend.md', 'database.md', 'integrations.md', 'workers.md']) {
      assert.ok(fs.existsSync(path.join(outDir, f)), `expected ${f} to be written`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('classifies fixture files into the expected codemap areas', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codemaps-'));
  try {
    const srcDir = makeFixtureSrc(tmp);
    const { status, out } = runGenerate(tmp, srcDir);
    assert.strictEqual(status, 0, out);

    const frontend = fs.readFileSync(path.join(tmp, 'docs', 'CODEMAPS', 'frontend.md'), 'utf8');
    assert.match(frontend, /components\/Foo\.tsx/, 'a .tsx under components/ should classify as frontend');

    const backend = fs.readFileSync(path.join(tmp, 'docs', 'CODEMAPS', 'backend.md'), 'utf8');
    assert.match(backend, /api\/routes\/index\.ts/, 'a file under api/routes/ should classify as backend');

    const database = fs.readFileSync(path.join(tmp, 'docs', 'CODEMAPS', 'database.md'), 'utf8');
    assert.match(database, /models\/user\.model\.ts/, 'a .model.ts file should classify as database');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an empty source tree still produces all six output files with zero counts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codemaps-'));
  try {
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const { status } = runGenerate(tmp, srcDir);
    assert.strictEqual(status, 0);

    const index = fs.readFileSync(path.join(tmp, 'docs', 'CODEMAPS', 'INDEX.md'), 'utf8');
    assert.match(index, /Total Files Scanned:\*\* 0/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('codemaps-generate');
