'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { extractPhase, roundTrip } = require('../scripts/lib/skill-distribution-extract');

test('all four extract phases round-trip literal rows without rewriting authoritative aggregates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-extract-roundtrip-'));
  const put = (file, value) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); };
  const coverage = { entry: 'SKILL.md', references: ['references/a.md'], executable_entries: [], host_capabilities: [] };
  const copies = [{ source: 'shared/a.js', destination: 'scripts/a.js' }];
  const usage = { invocation_class: 'implicit-eligible', summary: 'Literal usage' };
  const command = { id: 'inspect', path: 'commands/inspect.md', public_name: '/dhpk:inspect', argument_contract: '<input>', authority: 'read-only', skill_owner: 'stable', disposition: 'thin-front-door', resource: 'skills/public/SKILL.md' };
  put('skills/public/SKILL.md', '---\nname: public\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\n');
  put('manifests/distribution-inventory.json', { schema: 'dhpk.distribution-inventory.v2', skills: [{ id: 'stable', name: 'public', path: 'skills/public', capability_id: 'dhpk.skill.stable', invocation_class: 'implicit-eligible', usage }], modules: [] });
  put('manifests/skill-directory-coverage.json', { schema: 'dhpk.skill-directory-coverage.v1', skills: { stable: coverage } });
  put('manifests/skill-resources.json', { schema: 'dhpk.skill-resources.v1', skills: { stable: copies } });
  put('manifests/command-skill-dispositions.json', { schema: 'dhpk.command-skill-dispositions.v3', commands: [command] });
  const files = fs.readdirSync(path.join(root, 'manifests'));
  const before = files.map(file => fs.readFileSync(path.join(root, 'manifests', file), 'utf8'));
  try {
    assert.strictEqual(roundTrip(root, 'coverage').ok, false);
    for (const phase of ['identity', 'coverage', 'resources', 'inventory', 'commands']) {
      assert.strictEqual(extractPhase(root, phase, true).ok, true);
      assert.strictEqual(roundTrip(root, phase).ok, true, phase);
    }
    const local = JSON.parse(fs.readFileSync(path.join(root, 'skills/public/distribution.yaml')));
    assert.deepStrictEqual(local.coverage, coverage);
    assert.deepStrictEqual(local.resource_copies, copies);
    assert.deepStrictEqual(local.usage, usage);
    assert.deepStrictEqual(local.commands, [{ id: 'inspect', public_name: '/dhpk:inspect', argument_contract: '<input>', authority: 'read-only', disposition: 'thin-front-door' }]);
    assert.deepStrictEqual(files.map(file => fs.readFileSync(path.join(root, 'manifests', file), 'utf8')), before);
    local.coverage.references = [];
    put('skills/public/distribution.yaml', local);
    assert.deepStrictEqual(roundTrip(root, 'coverage'), { ok: false, drift: ['stable: coverage'] });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('skill-distribution-extraction');
