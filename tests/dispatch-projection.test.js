'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  SURFACES,
  buildDispatchProjection,
  validateDispatchProjection,
  validateDispatchProjectionSet,
} = require('../scripts/lib/dispatch-projection');
const catalog = require('../manifests/provider-model-catalog.json');
const hostProfiles = require('../manifests/host-profiles.json');

test('projection carries one canonical dispatch contract for each configured surface', () => {
  const projection = buildDispatchProjection({ surface: 'cursor-plugin', catalog, hostProfiles });
  assert.strictEqual(projection.contract.request, 'dhpk.dispatch.request.v2');
  assert.strictEqual(projection.surface, 'cursor-plugin');
  assert.strictEqual(projection.contract.receipt, 'dhpk.dispatch.receipt.v2');
  assert.deepStrictEqual(projection.contract.roles.map((entry) => entry.role), ['planner', 'reasoner', 'worker', 'reviewer']);
  assert.strictEqual(projection.hosts.find((entry) => entry.host === 'cursor').native_provider, 'cursor-native');
  assert.deepStrictEqual(validateDispatchProjection(projection), { ok: true, errors: [] });
});

test('projection parity keeps the same dispatch contract across every configured surface', () => {
  const projections = SURFACES.map((surface) => buildDispatchProjection({ surface, catalog, hostProfiles }));
  const result = validateDispatchProjectionSet(projections);
  assert.strictEqual(result.ok, true, result.errors.join('; '));
  assert.deepStrictEqual(result.surfaces, [...SURFACES].sort());
});

test('projection parity rejects contract drift on one surface', () => {
  const projections = SURFACES.map((surface) => buildDispatchProjection({ surface, catalog, hostProfiles }));
  projections[0].contract.roles[0].authority = 'workspace-write';
  const result = validateDispatchProjectionSet(projections);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((error) => /contract drift/i.test(error)));
});

test('projection validator rejects Provider-bound role definitions', () => {
  const projection = buildDispatchProjection({ surface: 'agent-plugin', catalog, hostProfiles });
  const altered = JSON.parse(JSON.stringify(projection));
  altered.contract.roles[0].role = 'codex-reasoner';
  assert.strictEqual(validateDispatchProjection(altered).ok, false);
});

run('dispatch-projection');
