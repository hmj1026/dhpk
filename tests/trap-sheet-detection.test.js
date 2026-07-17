'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const loader = fs.readFileSync(
  path.join(ROOT, 'agent-traps', '_common', 'trap-sheet-loader.md'),
  'utf8'
);
const fixtures = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'trap-sheet-detection', 'cases.json'),
  'utf8'
));

function detectFixtureSignals(fixture) {
  if (fixture.activeModules) return fixture.activeModules.split(',').map((item) => item.trim());
  const signals = [];
  if (fixture.package) {
    signals.push('js');
    const dependencyGroups = ['dependencies', 'devDependencies', 'peerDependencies'];
    if (dependencyGroups.some((group) => fixture.package[group] && fixture.package[group].vue)) {
      signals.push('vue');
    }
  }
  if (fixture.composer || (fixture.rootFiles || []).some((file) => /^[^/]+\.php$/.test(file))) {
    signals.push('php');
  }
  return signals;
}

test('root package.json emits the generic js signal', () => {
  assert.ok(
    /root[^\n]*package\.json[^\n]*generic[^\n]*\bjs\b/i.test(loader),
    'loader contract missing root package.json -> generic js detection'
  );
});

test('vue dependency keys additionally emit vue', () => {
  assert.ok(
    /vue[^\n]*(?:dependencies|devDependencies|peerDependencies)[^\n]*(?:also|additionally)[^\n]*vue/i.test(loader),
    'loader contract missing vue dependency-key -> vue detection'
  );
});

test('next and react remain covered by generic js', () => {
  assert.ok(
    /(?:next[^\n]*react|react[^\n]*next)[^\n]*generic[^\n]*\bjs\b[^\n]*(?:not|never|explicitly configured)/i.test(loader),
    'loader contract missing next/react generic-js fallback wording'
  );
});

test('root composer.json or root PHP files emit php', () => {
  assert.ok(
    /root[^\n]*(?:composer\.json|\.\/\*\.php)[^\n]*(?:or|and)[^\n]*(?:composer\.json|\.\/\*\.php)[^\n]*\bphp\b/i.test(loader),
    'loader contract missing root composer.json or ./*.php -> php detection'
  );
});

test('fallback detection forbids vendored-tree recursion', () => {
  assert.ok(
    /(?:must not|do not|never)[^\n]*(?:recurse|recursive)[^\n]*(?:node_modules|vendor)[^\n]*(?:node_modules|vendor|vendored)/i.test(loader),
    'loader contract missing node_modules/vendor recursion prohibition'
  );
});

test('configured active modules take precedence', () => {
  assert.ok(
    /DHPK_ACTIVE_MODULES[^\n]*(?:precedence|takes precedence)/i.test(loader),
    'loader contract missing DHPK_ACTIVE_MODULES precedence'
  );
});

test('root-only fallback fixtures produce the specified signals', () => {
  for (const fixture of fixtures) {
    assert.deepStrictEqual(
      detectFixtureSignals(fixture),
      fixture.expected,
      fixture.name
    );
  }
});

run('trap-sheet-detection');
