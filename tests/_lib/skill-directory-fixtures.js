'use strict';

// Authoring-test registry. Registering a fixture is not execution evidence.
const definitions = new Map();

function registerFixture(definition) {
  if (!definition || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.id || '')) {
    throw new Error('fixture requires a stable kebab-case id');
  }
  if (definitions.has(definition.id)) throw new Error(`duplicate fixture: ${definition.id}`);
  if (typeof definition.entry !== 'string' || !definition.entry
    || typeof definition.assert !== 'function'
    || !definition.expected || !Number.isInteger(definition.expected.status)) {
    throw new Error(`fixture ${definition.id} requires an entry, expected status and behavior assertions`);
  }
  const fixture = Object.freeze({
    ...definition,
    args: Object.freeze([...(definition.args || [])]),
    expected: Object.freeze({ ...definition.expected }),
    evidenceKind: 'fixture',
  });
  definitions.set(fixture.id, fixture);
  return fixture;
}

function getFixtures() {
  return Object.fromEntries(definitions);
}

function runFixture(id, context) {
  const fixture = definitions.get(id);
  if (!fixture) throw new Error(`unknown fixture: ${id}`);
  const result = context.run(fixture.entry, fixture.args);
  fixture.assert(result, context);
  return { result, evidenceKind: 'fixture', hostStatus: 'NOT_RUN' };
}

module.exports = { registerFixture, getFixtures, runFixture };
