'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');
let registered = false;

function registerLocalToolFixtures() {
  if (registered) return getFixtures();
  for (const [family, selector] of [['laravel', '10'], ['phpunit', '11']]) {
    registerFixture({
      id: `${family}-local-version-guidance`, skill: family,
      entry: 'scripts/resolve-version.js', args: ['--version', selector, '--json'],
      expected: { status: 0, output: '"status":"resolved"' },
      assert(result, context) {
        assert.strictEqual(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        assert.strictEqual(report.family, family);
        assert.strictEqual(report.selector, selector);
        assert.strictEqual(report.source, 'explicit');
        assert.deepStrictEqual(report.loadedReferences, [`references/${selector}.md`]);
        assert.strictEqual(report.guidance, fs.readFileSync(path.join(context.skillDir, report.reference), 'utf8'));
        assert.ok(report.guidance.length > 100, 'local version guidance must contain substantive content');
      },
    });
    registerFixture({
      id: `${family}-missing-version-blocked`, skill: family,
      entry: 'scripts/resolve-version.js', args: ['--json'],
      expected: { status: 2, output: '"status":"ask"' },
      assert(result) {
        assert.strictEqual(result.status, 2, result.stderr);
        const report = JSON.parse(result.stdout);
        assert.strictEqual(report.status, 'ask');
        assert.ok(report.question.length > 0);
        assert.ok(!report.guidance, 'missing version must not silently load arbitrary guidance');
      },
    });
  }
  registerFixture({
    id: 'js-status-local-classification', skill: 'js-static-check-strategy',
    entry: 'scripts/status.js', args: ['--path', 'js'],
    expected: { status: 0, output: 'total=3 strict=1 nocheck=1 unmarked=1' },
    assert(result) {
      assert.strictEqual(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.summary, 'total=3 strict=1 nocheck=1 unmarked=1');
      for (const name of ['strict.js', 'transition.js', 'plain.js']) assert.ok(result.stdout.includes(name));
      assert.ok(!result.stdout.includes('nested.js'), 'status scans only immediate leaves');
    },
  });
  registerFixture({
    id: 'js-status-missing-directory', skill: 'js-static-check-strategy',
    entry: 'scripts/status.js', args: ['--path', 'missing'],
    expected: { status: 0, output: '"status":"UNAVAILABLE"' },
    assert(result) {
      assert.strictEqual(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.status, 'UNAVAILABLE');
      assert.ok(report.diagnostic);
    },
  });
  registered = true;
  return getFixtures();
}

module.exports = { registerLocalToolFixtures };
