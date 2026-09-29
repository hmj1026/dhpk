'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const policy = require('../scripts/lib/project-agent-host-binding-policy');
const {
  createProjectAgentProviderAdapters,
} = require('../scripts/lib/project-agent-provider-adapters');

test('Host selection precedence and Codex discovery visibility are explicit', () => {
  assert.deepStrictEqual(policy.boundStableIds({
    selectedStableIds: [],
    emittedStableIds: ['emitted'],
    bindings: [{ stableId: 'bound' }],
  }), []);
  assert.deepStrictEqual(policy.boundStableIds({ emittedStableIds: ['b', 'a', 'b'] }), ['a', 'b']);
  assert.deepStrictEqual(policy.boundStableIds({ bindings: [{ stableId: 'b' }, null, { stableId: 'a' }] }), ['a', 'b']);

  const entries = [
    { stableId: 'visible', discoveryVisible: true },
    { stableId: 'hidden', discoveryVisible: false },
    { stableId: 'default-visible' },
  ];
  assert.deepStrictEqual(policy.discoveryVisibleEntries(entries).map((entry) => entry.stableId), [
    'visible',
    'default-visible',
  ]);
});

test('Host selection and preserved bindings return independent values', () => {
  const original = {
    codex: { selectedStableIds: ['old'], emittedStableIds: ['old'] },
    cursor: { selectedStableIds: ['cursor'] },
  };
  const selected = policy.applyHostSelections(original, { codex: ['b', 'a', 'a'], missing: ['ignored'] });
  assert.deepStrictEqual(selected.codex, { selectedStableIds: ['a', 'b'], emittedStableIds: ['a', 'b'] });
  assert.deepStrictEqual(original.codex, { selectedStableIds: ['old'], emittedStableIds: ['old'] });

  const preserved = policy.restorePreservedHostBindings(selected, { cursor: { selectedStableIds: ['preserved'] } });
  assert.deepStrictEqual(preserved.cursor, { selectedStableIds: ['preserved'] });
  assert.deepStrictEqual(selected.cursor, { selectedStableIds: ['cursor'] });
});

test('discovery stamping persists native-link and direct Host binding shapes', () => {
  const providers = {
    forHost: {
      codex: {
        discovery: {
          id: 'codex-project-discovery',
          version: '1.0.0',
          kind: 'symlink',
          sourceRoot: '.agents/skills',
          destinationRoot: '.codex/skills',
          entries: [{
            stableId: 'alpha',
            name: 'dhpk-alpha',
            path: '.codex/skills/dhpk-alpha',
            target: '../../.agents/skills/dhpk-alpha',
          }],
        },
      },
      cursor: {
        discovery: {
          id: 'cursor-project-discovery',
          version: '1.0.0',
          kind: 'direct',
          sourceRoot: '.agents/skills',
          destinationRoot: '.cursor/skills',
          entries: [{ stableId: 'alpha', name: 'dhpk-alpha' }],
        },
      },
    },
  };
  const originalBindings = {
    codex: { selectedStableIds: ['alpha'] },
    cursor: { selectedStableIds: ['alpha'] },
  };
  const originalPaths = {};
  let stamped = policy.stampDiscoveryHost(originalBindings, originalPaths, providers, { hostId: 'codex', bindingShape: policy.NATIVE_LINK_SHAPE });
  stamped = policy.stampDiscoveryHost(stamped.hostBindings, stamped.bindingPaths, providers, {
    hostId: 'cursor',
    bindingShape: policy.DIRECT_SHAPE,
    bindingReason: 'consumer evidence passed',
  });

  assert.deepStrictEqual(stamped.bindingPaths.codex, [{
    path: '.codex/skills/dhpk-alpha',
    target: '../../.agents/skills/dhpk-alpha',
  }]);
  assert.deepStrictEqual(stamped.hostBindings.codex.bindings, [{
    stableId: 'alpha',
    name: 'dhpk-alpha',
    path: '.codex/skills/dhpk-alpha',
    target: '../../.agents/skills/dhpk-alpha',
    shape: policy.NATIVE_LINK_SHAPE,
  }]);
  assert.deepStrictEqual(stamped.bindingPaths.cursor, []);
  assert.deepStrictEqual(stamped.hostBindings.cursor.bindings, [{
    stableId: 'alpha',
    name: 'dhpk-alpha',
    shape: policy.DIRECT_SHAPE,
  }]);
  assert.strictEqual(stamped.hostBindings.cursor.bindingReason, 'consumer evidence passed');
  assert.deepStrictEqual(originalBindings.cursor, { selectedStableIds: ['alpha'] });
  assert.deepStrictEqual(originalPaths, {});
});

test('receipt Host binding validation consumes generated adapter descriptors', () => {
  const hostBindings = {
    codex: {
      host: 'codex',
      surface: 'codex-sync',
      evidenceSource: 'entry_surfaces',
      shape: 'project-skill-directory',
      transform: { id: 'codex-project-skill', version: '1' },
      selectedStableIds: ['alpha'],
      bindingShape: policy.NATIVE_LINK_SHAPE,
    },
  };
  const providers = createProjectAgentProviderAdapters(hostBindings, {
    entries: [{ stableId: 'alpha', name: 'dhpk-alpha' }],
  });
  const discovery = providers.forHost.codex.discovery;
  const bindingPaths = {
    codex: discovery.entries.map(({ path: bindingPath, target }) => ({ path: bindingPath, target })),
  };
  const receipt = {
    hostBindings: {
      ...hostBindings,
      codex: {
        ...hostBindings.codex,
        discovery: {
          adapterId: discovery.id,
          adapterVersion: discovery.version,
          kind: discovery.kind,
          sourceRoot: discovery.sourceRoot,
          destinationRoot: discovery.destinationRoot,
          paths: bindingPaths.codex.map((entry) => entry.path),
        },
        bindings: discovery.entries.map((entry) => ({
          stableId: entry.stableId,
          name: entry.name,
          path: entry.path,
          target: entry.target,
          shape: policy.NATIVE_LINK_SHAPE,
        })),
      },
    },
    bindingPaths,
  };

  assert.strictEqual(policy.validateReceiptBindingState(receipt, bindingPaths), false);
  assert.strictEqual(policy.validateReceiptBindings(receipt, providers, bindingPaths), bindingPaths);
  assert.throws(
    () => policy.validateReceiptBindings(receipt, providers, {
      codex: [{ path: '.codex/skills/foreign', target: '../../.agents/skills/foreign' }],
    }),
    /Codex discovery bindings do not match the selected artifact/,
  );
});

run('project-agent-host-binding-policy');
