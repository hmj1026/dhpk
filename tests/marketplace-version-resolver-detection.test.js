'use strict';

// Project-file detection contracts for the laravel and phpunit family
// resolvers, exercised only through each family's public CLI
// (scripts/resolve-version.js --json) inside a fresh temporary project.
//
// Expected selectors and references are written out literally. Version
// strings deliberately carry real patch and suffix digits (v11.0.7,
// ^10.5.7, Mix ^5.0.9): an earlier scanner read those digits as extra majors
// and either asked on ordinary locks or loaded a nearby wrong reference.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const SKILLS_ROOT = path.join(__dirname, '..', 'skills');

function resolveInProject(family, files) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-resolver-detection-${family}-`));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const text = typeof contents === 'string' ? contents : JSON.stringify(contents);
      fs.writeFileSync(path.join(project, name), text);
    }
    const script = path.join(SKILLS_ROOT, family, 'scripts', 'resolve-version.js');
    const result = spawnSync(process.execPath, [script, '--json'], { cwd: project, encoding: 'utf8' });
    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`${family} resolver did not print JSON (exit ${result.status}): ${result.stdout}${result.stderr}`);
    }
    return { status: result.status, report };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function assertResolved(outcome, family, selector, source, reference) {
  const { status, report } = outcome;
  const summary = JSON.stringify({ status: report.status, selector: report.selector, source: report.source });
  assert.strictEqual(status, 0, `expected exit 0, got ${status}: ${summary}`);
  assert.strictEqual(report.status, 'resolved', summary);
  assert.strictEqual(report.family, family);
  assert.strictEqual(report.selector, selector, summary);
  assert.strictEqual(report.source, source, summary);
  assert.strictEqual(report.reference, reference);
  assert.deepStrictEqual(report.loadedReferences, [reference]);
  assert.strictEqual(report.guidance, fs.readFileSync(path.join(SKILLS_ROOT, family, reference), 'utf8'));
}

function assertAsk(outcome) {
  const { status, report } = outcome;
  const summary = JSON.stringify({ status: report.status, selector: report.selector, source: report.source });
  assert.strictEqual(status, 2, `expected exit 2, got ${status}: ${summary}`);
  assert.strictEqual(report.status, 'ask', summary);
  assert.strictEqual(report.selector, null);
  assert.strictEqual(report.reference, null);
  assert.deepStrictEqual(report.loadedReferences, []);
  assert.ok(!report.guidance, 'an ask must not load guidance');
  assert.ok(typeof report.question === 'string' && report.question.length > 0, 'an ask must carry a question');
}

const laravelLock = (version) => ({ packages: [{ name: 'laravel/framework', version }], 'packages-dev': [] });
const laravelJson = (constraint) => ({ require: { 'laravel/framework': constraint } });
const phpunitLock = (version, section = 'packages') => ({ [section]: [{ name: 'phpunit/phpunit', version }] });
const phpunitJson = (constraint, section = 'require') => ({ [section]: { 'phpunit/phpunit': constraint } });

// --- laravel --------------------------------------------------------------

test('laravel: a locked v11.0.7 framework wins over a composer.json ^10.0 constraint', () => {
  const outcome = resolveInProject('laravel', {
    'composer.lock': laravelLock('v11.0.7'),
    'composer.json': laravelJson('^10.0'),
  });
  assertResolved(outcome, 'laravel', '11', 'composer.lock', 'references/11.md');
});

test('laravel: a locked v10.48.7 framework resolves 10 from the lock', () => {
  const outcome = resolveInProject('laravel', { 'composer.lock': laravelLock('v10.48.7') });
  assertResolved(outcome, 'laravel', '10', 'composer.lock', 'references/10.md');
});

test('laravel: an unsupported locked v5.8.9 framework asks and does not fall back to composer.json', () => {
  const outcome = resolveInProject('laravel', {
    'composer.lock': laravelLock('v5.8.9'),
    'composer.json': laravelJson('^10.0'),
  });
  assertAsk(outcome);
});

test('laravel: a malformed composer.lock falls back to a valid composer.json constraint', () => {
  const outcome = resolveInProject('laravel', {
    'composer.lock': '{ "packages": [ malformed',
    'composer.json': laravelJson('^10.0'),
  });
  assertResolved(outcome, 'laravel', '10', 'composer.json', 'references/10.md');
});

test('laravel: a union of a supported and an unsupported major (^9.0 || ^12.0) asks', () => {
  assertAsk(resolveInProject('laravel', { 'composer.json': laravelJson('^9.0 || ^12.0') }));
});

test('laravel: a constraint with unconsumed text around the version (banana11.0) asks', () => {
  assertAsk(resolveInProject('laravel', { 'composer.json': laravelJson('banana11.0') }));
});

test('laravel: package.json laravel-mix ^5.0.9 selects the Mix 5 reference', () => {
  const outcome = resolveInProject('laravel', {
    'package.json': { devDependencies: { 'laravel-mix': '^5.0.9' } },
  });
  assertResolved(outcome, 'laravel', 'mix', 'package.json', 'references/mix.md');
});

test('laravel: package.json laravel-mix ^6.0.49 asks instead of loading a framework or Mix 5 reference', () => {
  assertAsk(resolveInProject('laravel', {
    'package.json': { devDependencies: { 'laravel-mix': '^6.0.49' } },
  }));
});

for (const constraint of ['^5.4.9', '^5.4.7', '^5.4', '~5.4']) {
  test(`laravel: ${constraint} spans unsupported 5.x minor versions and asks`, () => {
    assertAsk(resolveInProject('laravel', { 'composer.json': laravelJson(constraint) }));
  });
}

for (const constraint of ['~5.4.9', '5.4.9']) {
  test(`laravel: ${constraint} stays within the 5.4 reference`, () => {
    assertResolved(resolveInProject('laravel', { 'composer.json': laravelJson(constraint) }),
      'laravel', '5.4', 'composer.json', 'references/5-4.md');
  });
}

// --- phpunit --------------------------------------------------------------

test('phpunit: require-dev ^10.5.7 resolves 10 from composer.json', () => {
  const outcome = resolveInProject('phpunit', { 'composer.json': phpunitJson('^10.5.7', 'require-dev') });
  assertResolved(outcome, 'phpunit', '10', 'composer.json', 'references/10.md');
});

test('phpunit: the bounded interval >=9.6 <10.0 resolves 9', () => {
  const outcome = resolveInProject('phpunit', { 'composer.json': phpunitJson('>=9.6 <10.0') });
  assertResolved(outcome, 'phpunit', '9', 'composer.json', 'references/9.md');
});

for (const constraint of ['>=9.6 <=10.0', '>=9.6 <10.1']) {
  test(`phpunit: the interval ${constraint} crosses the family boundary and asks`, () => {
    assertAsk(resolveInProject('phpunit', { 'composer.json': phpunitJson(constraint) }));
  });
}

for (const constraint of ['<=10.0', '<10.1', '>=9.6']) {
  test(`phpunit: the open-ended or upper-only constraint ${constraint} asks`, () => {
    assertAsk(resolveInProject('phpunit', { 'composer.json': phpunitJson(constraint) }));
  });
}

for (const constraint of ['latest', 'banana10.0']) {
  test(`phpunit: the unparseable constraint ${constraint} asks`, () => {
    assertAsk(resolveInProject('phpunit', { 'composer.json': phpunitJson(constraint) }));
  });
}

test('phpunit: a union of a supported and an unsupported major (^10.0 || ^8.5) asks', () => {
  assertAsk(resolveInProject('phpunit', { 'composer.json': phpunitJson('^10.0 || ^8.5') }));
});

test('phpunit: a locked 11.0.1 wins over a composer.json ^10.0 constraint', () => {
  const outcome = resolveInProject('phpunit', {
    'composer.lock': phpunitLock('11.0.1'),
    'composer.json': phpunitJson('^10.0'),
  });
  assertResolved(outcome, 'phpunit', '11', 'composer.lock', 'references/11.md');
});

test('phpunit: a malformed composer.lock falls back to a valid composer.json constraint', () => {
  const outcome = resolveInProject('phpunit', {
    'composer.lock': '{ "packages": [ malformed',
    'composer.json': phpunitJson('^9.6'),
  });
  assertResolved(outcome, 'phpunit', '9', 'composer.json', 'references/9.md');
});

test('phpunit: an unsupported locked 8.5.36 asks and does not fall back to composer.json', () => {
  const outcome = resolveInProject('phpunit', {
    'composer.lock': phpunitLock('8.5.36'),
    'composer.json': phpunitJson('^10.0'),
  });
  assertAsk(outcome);
});

test('phpunit: a packages-dev lock entry 9.6.19 resolves 9 from the lock', () => {
  const outcome = resolveInProject('phpunit', { 'composer.lock': phpunitLock('9.6.19', 'packages-dev') });
  assertResolved(outcome, 'phpunit', '9', 'composer.lock', 'references/9.md');
});

run('marketplace-version-resolver-detection');
