'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerLocalToolFixtures } = require('./_lib/skill-local-tool-fixtures');
const fixtures = registerLocalToolFixtures();

for (const id of [
  'laravel-local-version-guidance', 'laravel-missing-version-blocked',
  'phpunit-local-version-guidance', 'phpunit-missing-version-blocked',
  'js-status-local-classification', 'js-status-missing-directory',
]) {
  test(id, () => {
    const fixture = fixtures[id];
    withIsolatedSkill({ source: path.join(__dirname, '../skills', fixture.skill) }, (context) => {
      if (id === 'js-status-local-classification') {
        fs.mkdirSync(path.join(context.projectDir, 'js/nested'), { recursive: true });
        for (const [name, contents] of Object.entries({
          'strict.js': '// @ts-check\nconst x=1;\n',
          'transition.js': '// @ts-check\n// @ts-nocheck transitional\nconst x=2;\n',
          'plain.js': 'const x=3;\n', 'nested/nested.js': '// @ts-check\n',
        })) fs.writeFileSync(path.join(context.projectDir, 'js', name), contents);
      } else if (id.endsWith('-local-version-guidance')) {
        fs.writeFileSync(path.join(context.projectDir, 'composer.json'), JSON.stringify({
          require: { 'laravel/framework': '^9.0' }, 'require-dev': { 'phpunit/phpunit': '^9.0' },
        }));
      }
      fixture.assert(context.run(fixture.entry, fixture.args), context);
      assert.strictEqual(context.hostStatus, 'NOT_RUN');
    });
  });
}

run('skill-local-tool-isolation');
