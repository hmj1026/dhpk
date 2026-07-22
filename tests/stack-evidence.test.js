'use strict';

// Evidence collection for the session install-health gate (change:
// add-session-install-health-gate, tasks 2.1-2.3).
//
// Drives the real `dhpk_collect_stack_evidence` in scripts/hooks/_lib/detect-stack-hints.sh
// against scratch git repos, following the spawn-a-bash-shim pattern used by
// tests/session-start-advisories.test.js.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const DETECT = path.join(ROOT, 'scripts', 'hooks', '_lib', 'detect-stack-hints.sh');

function tempRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-stack-evidence-')));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

function write(repo, rel, content) {
  const fp = path.join(repo, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
}

// evidence(repo) -> array of detected family names.
function evidence(repo) {
  const res = spawnSync('bash', ['-c', '. "$1"; dhpk_collect_stack_evidence "$2"', '_', DETECT, repo], {
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, res.stderr);
  return res.stdout.trim().split(',').filter(Boolean);
}

function withRepo(fn) {
  const repo = tempRepo();
  try {
    return fn(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test('package.json alone yields the js family and no php', () => {
  withRepo((repo) => {
    write(repo, 'package.json', JSON.stringify({ name: 'x' }));
    const fams = evidence(repo);
    assert.ok(fams.includes('js'), `expected js in ${fams}`);
    assert.ok(!fams.includes('php'), `unexpected php in ${fams}`);
  });
});

test('composer.json alone yields the php family and no js', () => {
  withRepo((repo) => {
    write(repo, 'composer.json', JSON.stringify({ require: {} }));
    const fams = evidence(repo);
    assert.ok(fams.includes('php'), `expected php in ${fams}`);
    assert.ok(!fams.includes('js'), `unexpected js in ${fams}`);
  });
});

test('both manifests yield both families', () => {
  withRepo((repo) => {
    write(repo, 'package.json', JSON.stringify({ name: 'x' }));
    write(repo, 'composer.json', JSON.stringify({ require: {} }));
    const fams = evidence(repo);
    assert.ok(fams.includes('js'), `expected js in ${fams}`);
    assert.ok(fams.includes('php'), `expected php in ${fams}`);
  });
});

test('manifest framework signals survive alongside source-file evidence', () => {
  withRepo((repo) => {
    write(repo, 'package.json', JSON.stringify({ dependencies: { next: '^16', react: '^19' } }));
    write(repo, 'app/page.jsx', 'export default function Page() {}\n');
    const fams = evidence(repo);
    assert.ok(fams.includes('nextjs'), `expected nextjs in ${fams}`);
    assert.ok(fams.includes('react'), `expected react in ${fams}`);
    // The framework signal replaces the bare js family, exactly as the
    // manifest-only detector already behaved.
    assert.ok(!fams.includes('js'), `bare js should not stack with framework families: ${fams}`);
  });
});

// The motivating case: dhpk's own repository has neither manifest yet is full
// of .js. Manifest-only detection is blind to it.
test('no manifest but real js sources still yields the js family', () => {
  withRepo((repo) => {
    write(repo, 'scripts/hooks/thing.js', 'module.exports = {};\n');
    write(repo, 'tests/thing.test.js', "require('node:assert');\n");
    const fams = evidence(repo);
    assert.ok(fams.includes('js'), `expected js from source evidence, got ${fams}`);
  });
});

test('no manifest but real php sources still yields the php family', () => {
  withRepo((repo) => {
    write(repo, 'src/Controller.php', '<?php class Controller {}\n');
    const fams = evidence(repo);
    assert.ok(fams.includes('php'), `expected php from source evidence, got ${fams}`);
  });
});

test('a repository with neither manifests nor stack sources yields nothing', () => {
  withRepo((repo) => {
    write(repo, 'README.md', '# nothing here\n');
    assert.deepStrictEqual(evidence(repo), []);
  });
});

test('stack files only under vendored paths contribute no evidence', () => {
  withRepo((repo) => {
    write(repo, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
    write(repo, 'vendor/acme/lib/Thing.php', '<?php class Thing {}\n');
    write(repo, 'README.md', '# nothing here\n');
    assert.deepStrictEqual(evidence(repo), []);
  });
});

test('stack files only under version-control-ignored paths contribute no evidence', () => {
  withRepo((repo) => {
    write(repo, '.gitignore', 'build/\ngenerated/\n');
    write(repo, 'build/bundle.js', 'console.log(1);\n');
    write(repo, 'generated/Model.php', '<?php class Model {}\n');
    write(repo, 'README.md', '# nothing here\n');
    assert.deepStrictEqual(evidence(repo), []);
  });
});

test('evidence is bounded: a wide tree does not scan without limit', () => {
  withRepo((repo) => {
    for (let i = 0; i < 40; i += 1) write(repo, `pkg${i}/src/mod.js`, 'export default 1;\n');
    const started = Date.now();
    const fams = evidence(repo);
    const elapsed = Date.now() - started;
    assert.ok(fams.includes('js'), `expected js in ${fams}`);
    // Generous ceiling: the point is that the census is bounded, not fast-path
    // timing. An unbounded recursive scan of a real project blows past this.
    assert.ok(elapsed < 3000, `evidence collection took ${elapsed}ms`);
  });
});

test('deeply buried sources beyond the depth bound do not count', () => {
  withRepo((repo) => {
    write(repo, 'a/b/c/d/e/f/g/h/deep.js', 'export default 1;\n');
    write(repo, 'README.md', '# nothing here\n');
    assert.deepStrictEqual(evidence(repo), []);
  });
});

test('evidence collection works outside a git repository', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-stack-nogit-')));
  try {
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1;\n');
    const fams = evidence(dir);
    assert.ok(fams.includes('js'), `expected js in ${fams}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('stack-evidence');
