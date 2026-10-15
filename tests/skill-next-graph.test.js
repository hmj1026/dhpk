'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { renderProgressionTable, checkProgressionTable } = require('../scripts/ci/gen-skill-progression-tables');
const { validateNextGraph } = require('../scripts/lib/skill-next-map');

const terminal = { PASS: 'none', FAIL: 'none', BLOCKED: 'none', NOT_RUN: 'none', UNAVAILABLE: 'none' };
function fixture(next = {}, modes = ['code']) {
  return {
    source: { values: { 'dhpk-next': { ...terminal, ...next } } },
    target: { values: { 'dhpk-next': terminal, 'dhpk-modes': modes } },
  };
}

test('one graph-integrity suite accepts closed maps and rejects invalid edges', () => {
  const valid = fixture({ PASS: 'target:code' });
  assert.deepStrictEqual(validateNextGraph(valid), []);
  const ownConstructor = fixture({ PASS: 'constructor' });
  ownConstructor.constructor = { values: { 'dhpk-next': terminal } };
  assert.deepStrictEqual(validateNextGraph(ownConstructor), []);
  const openModes = fixture({ PASS: 'target:fast' });
  delete openModes.target.values['dhpk-modes'];
  assert.deepStrictEqual(validateNextGraph(openModes), []);
  const table = renderProgressionTable(valid);
  assert.match(table, /source.*PASS.*target:code/);
  assert.deepStrictEqual(checkProgressionTable(valid, table), []);
  assert.ok(checkProgressionTable(valid, 'stale table').length > 0);
  const invalid = [
    [fixture({ PARTIAL: 'none' }), /state/i],
    [fixture({ PASS: 'missing' }), /target|skill/i],
    [fixture({ PASS: 'constructor' }), /target|skill/i],
    [fixture({ PASS: 'target:missing' }), /mode/i],
    [fixture({ PASS: '/target' }), /identity|target|value/i],
    [fixture({ PASS: '$target' }), /identity|target|value/i],
    [fixture({ 'unknown:PASS': 'none' }), /mode/i],
  ];
  for (const [skills, message] of invalid) {
    const errors = validateNextGraph(skills);
    assert.ok(errors.length > 0, JSON.stringify(skills));
    assert.match(errors.join('\n'), message);
  }
  assert.ok(validateNextGraph({ source: { values: {} } }, { requiredSkills: ['source'] }).length > 0);
  const inherited = Object.create({ source: { values: { 'dhpk-next': terminal } } });
  assert.ok(validateNextGraph(inherited, { requiredSkills: ['source'] }).length > 0);
  const inheritedTarget = Object.assign(Object.create({ target: { values: { 'dhpk-next': terminal } } }), { source: valid.source });
  assert.ok(validateNextGraph(inheritedTarget).length > 0);
});

run('skill-next-graph');
