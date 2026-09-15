'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { extract } = require('../scripts/ci/_lib/frontmatter');

const ROOT = path.join(__dirname, '..');

function read(name) {
  return fs.readFileSync(path.join(ROOT, 'commands', name + '.md'), 'utf8');
}

test('approved short flow front doors preserve canonical identity and invocation class', () => {
  const guide = read('flow-guide');
  const drive = read('flow-drive');
  assert.match(guide, /canonical `\$flow-guide` Skill/);
  assert.match(drive, /canonical `\$flow-drive` Skill/);
  assert.match(drive, /--worker-target=<provider>\/\<model>\[:<effort>\]/);
  assert.doesNotMatch(guide, /^(?:procedure|workflow steps|target authority)\s*$/im);
  assert.match(drive, /does not add a mode, route selection, proposal authoring/);
  assert.strictEqual(extract(guide).values['metadata.dhpk-invocation-class'] || 'implicit-eligible', 'implicit-eligible');
  assert.match(drive, /dhpk-invocation-class: explicit-only/);
  assert.match(drive, /disable-model-invocation: true/);
});

test('short front doors have no competing Usage Grammar', () => {
  for (const name of ['flow-guide', 'flow-drive']) {
    const text = read(name);
    assert.strictEqual((text.match(/argument-hint:/g) || []).length, 1);
    assert.match(text, /Forward[\s\S]*(?:arguments|options) unchanged/i);
    assert.match(text, /second\s+(?:usage\s+)?grammar/i);
  }
});

run('command-front-door-parity');
