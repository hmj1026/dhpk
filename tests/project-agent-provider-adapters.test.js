'use strict';

const { test, run, assert } = require('./_lib/tinytest');

{
  // Source suite: tests/project-agent-provider-adapters.test.js
  const {
    AGY_PROJECT_PROBE_ADAPTER,
    AGY_PROJECT_PROBE_CLAIMS,
    AGY_PROJECT_PROBE_PRODUCER,
    createClaudeProjectDiscoveryAdapter,
    createCursorProjectDiscoveryAdapter,
    createCodexProjectDiscoveryAdapter,
    DIRECT_SHAPE,
    createProjectAgentProviderAdapters,
    renderAgyDirectFile,
  } = require('../scripts/lib/project-agent-provider-adapters');

  function bindings() {
    return {
      agy: {
        host: 'agy',
        surface: 'agy-plugin',
        evidenceSource: 'surface_membership',
        shape: 'project-skill-direct-file',
        transform: { id: 'agy-project-direct-file', version: '1' },
      },
      claude: {
        host: 'claude',
        surface: 'claude-core',
        evidenceSource: 'entry_surfaces',
        shape: 'project-skill-directory',
        transform: { id: 'claude-project-skill', version: '1' },
      },
      codex: {
        host: 'codex',
        surface: 'codex-sync',
        evidenceSource: 'entry_surfaces',
        shape: 'project-skill-directory',
        transform: { id: 'codex-project-skill', version: '1' },
      },
      cursor: {
        host: 'cursor',
        surface: 'cursor-plugin',
        evidenceSource: 'surface_membership',
        shape: 'project-skill-directory',
        transform: { id: 'cursor-project-skill', version: '1' },
      },
    };
  }

  test('provider adapters expose one shared directory shape and an AGY direct-file shape', () => {
    const adapters = createProjectAgentProviderAdapters(bindings());
    assert.deepStrictEqual(adapters.directory.hosts, ['claude', 'codex', 'cursor']);
    assert.deepStrictEqual(adapters.directFile.hosts, ['agy']);
    assert.strictEqual(adapters.forHost.agy.kind, 'direct-file');
    assert.strictEqual(adapters.forHost.codex.kind, 'directory');
    assert.strictEqual(adapters.forHost.agy.transform.id, 'agy-project-direct-file');
  });

  test('provider adapters fail closed when AGY is assigned a directory shape', () => {
    const invalid = bindings();
    invalid.agy.shape = 'project-skill-directory';
    assert.throws(
      () => createProjectAgentProviderAdapters(invalid),
      /AGY.*direct-file|shape.*agy|incompatible/i,
    );
  });

  test('AGY direct-file rendering embeds the body and gates sibling references on consumer PASS', () => {
    const body = '---\nname: dhpk-sample\ndescription: Sample\n---\n\n# Sample\n';
    const planFingerprint = `sha256:${'a'.repeat(64)}`;
    const artifactFingerprint = `sha256:${'b'.repeat(64)}`;
    const consumerEvidence = {
      stage: 'CONSUMER',
      producer: AGY_PROJECT_PROBE_PRODUCER,
      adapter: { ...AGY_PROJECT_PROBE_ADAPTER },
      surface: 'agy-plugin',
      status: 'PASS',
      planFingerprint,
      artifactFingerprint,
      checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(),
    };
    const consumerExpectation = {
      producer: AGY_PROJECT_PROBE_PRODUCER,
      adapter: { ...AGY_PROJECT_PROBE_ADAPTER },
      planFingerprint,
      artifactFingerprint,
      checkedClaims: AGY_PROJECT_PROBE_CLAIMS.slice(),
    };
    const selfContained = renderAgyDirectFile({ name: 'dhpk-sample', body });
    assert.strictEqual(selfContained.resolution, 'self-contained');
    assert.strictEqual(selfContained.content, body);

    assert.throws(
      () => renderAgyDirectFile({
        name: 'dhpk-sample',
        description: 'Sample',
        body,
        siblingPackage: './dhpk-sample/SKILL.md',
      }),
      /consumer probe|verified|PASS/i,
    );

    assert.throws(
      () => renderAgyDirectFile({
        name: 'dhpk-sample',
        description: 'Sample',
        body,
        siblingPackage: './dhpk-sample/SKILL.md',
        consumerEvidence,
        consumerExpectation: { ...consumerExpectation, artifactFingerprint: `sha256:${'c'.repeat(64)}` },
      }),
      /consumer probe|verified|PASS/i,
    );

    const sibling = renderAgyDirectFile({
      name: 'dhpk-sample',
      description: 'Sample',
      body,
      siblingPackage: './dhpk-sample/SKILL.md',
      consumerEvidence,
      consumerExpectation,
    });
    assert.strictEqual(sibling.resolution, 'verified-sibling-package');
    assert.match(sibling.content, /\.\/dhpk-sample\/SKILL\.md/);
  });

  test('Claude discovery adapter binds generated packages without creating an authored skill tree', () => {
    const adapter = createClaudeProjectDiscoveryAdapter({
      entries: [
        { stableId: 'z-skill', name: 'dhpk-z-skill' },
        { stableId: 'a-skill', name: 'dhpk-a-skill' },
      ],
    });
    assert.deepStrictEqual(adapter, {
      id: 'claude-project-discovery',
      version: '1.0.0',
      kind: 'symlink',
      sourceRoot: '.agents/skills',
      destinationRoot: '.claude/skills',
      owner: 'dhpk.project-agent-projection',
      entries: [
        {
          stableId: 'a-skill',
          name: 'dhpk-a-skill',
          path: '.claude/skills/dhpk-a-skill',
          target: '../../.agents/skills/dhpk-a-skill',
        },
        {
          stableId: 'z-skill',
          name: 'dhpk-z-skill',
          path: '.claude/skills/dhpk-z-skill',
          target: '../../.agents/skills/dhpk-z-skill',
        },
      ],
    });
    assert.throws(
      () => createClaudeProjectDiscoveryAdapter({ entries: [{ stableId: 'bad', name: '../outside' }] }),
      /safe|name|path/i,
    );
  });

  test('Cursor native-link discovery adapter binds per-skill links into .cursor/skills', () => {
    const adapter = createCursorProjectDiscoveryAdapter({
      entries: [
        { stableId: 'portable', name: 'dhpk-portable' },
        { stableId: 'trace', name: 'dhpk-code-trace' },
      ],
    });
    assert.strictEqual(adapter.id, 'cursor-project-discovery');
    assert.strictEqual(adapter.kind, 'symlink');
    assert.strictEqual(adapter.bindingShape, 'native-link');
    assert.strictEqual(adapter.sourceRoot, '.agents/skills');
    assert.strictEqual(adapter.destinationRoot, '.cursor/skills');
    assert.deepStrictEqual(adapter.entries.map((entry) => entry.path), [
      '.cursor/skills/dhpk-code-trace',
      '.cursor/skills/dhpk-portable',
    ]);
    assert.deepStrictEqual(adapter.entries.map((entry) => entry.target), [
      '../../.agents/skills/dhpk-code-trace',
      '../../.agents/skills/dhpk-portable',
    ]);
  });

  test('Cursor Host adapter exposes native-link discovery when cursor is bound', () => {
    const adapters = createProjectAgentProviderAdapters(bindings(), {
      entries: [{ stableId: 'sample', name: 'dhpk-sample' }],
    });
    assert.ok(adapters.forHost.cursor.discovery);
    assert.strictEqual(adapters.forHost.cursor.discovery.bindingShape, 'native-link');
    assert.strictEqual(adapters.forHost.cursor.discovery.destinationRoot, '.cursor/skills');
    assert.deepStrictEqual(adapters.forHost.cursor.discovery.entries, [{
      stableId: 'sample',
      name: 'dhpk-sample',
      path: '.cursor/skills/dhpk-sample',
      target: '../../.agents/skills/dhpk-sample',
    }]);
  });

  test('Codex native-link discovery adapter binds per-skill links into .codex/skills', () => {
    const adapter = createCodexProjectDiscoveryAdapter({
      entries: [
        { stableId: 'portable', name: 'dhpk-portable' },
        { stableId: 'trace', name: 'dhpk-code-trace' },
      ],
    });
    assert.strictEqual(adapter.id, 'codex-project-discovery');
    assert.strictEqual(adapter.kind, 'symlink');
    assert.strictEqual(adapter.bindingShape, 'native-link');
    assert.strictEqual(adapter.destinationRoot, '.codex/skills');
    assert.deepStrictEqual(adapter.entries.map((entry) => entry.path), [
      '.codex/skills/dhpk-code-trace',
      '.codex/skills/dhpk-portable',
    ]);
  });

  test('Claude, Codex, and Cursor Host adapters bind only their selectedStableIds', () => {
    const hostBindings = bindings();
    hostBindings.cursor.selectedStableIds = ['emitted', 'selected-only'];
    hostBindings.cursor.emittedStableIds = ['emitted'];
    hostBindings.codex.selectedStableIds = ['other'];
    hostBindings.claude.selectedStableIds = ['claude-only'];
    hostBindings.claude.emittedStableIds = ['claude-only'];
    const adapters = createProjectAgentProviderAdapters(hostBindings, {
      entries: [
        { stableId: 'emitted', name: 'dhpk-emitted' },
        { stableId: 'selected-only', name: 'dhpk-selected-only' },
        { stableId: 'other', name: 'dhpk-other' },
        { stableId: 'claude-only', name: 'dhpk-claude-only' },
      ],
    });
    assert.deepStrictEqual(adapters.forHost.cursor.discovery.entries.map((entry) => entry.stableId), ['emitted']);
    assert.deepStrictEqual(adapters.forHost.codex.discovery.entries.map((entry) => entry.stableId), ['other']);
    assert.deepStrictEqual(adapters.forHost.claude.discovery.entries.map((entry) => entry.stableId), ['claude-only']);
    assert.strictEqual(adapters.forHost.codex.discovery.destinationRoot, '.codex/skills');
  });

  test('Cursor discovery adapter can bind skills as evidence-gated direct Host Bindings', () => {
    const adapter = createCursorProjectDiscoveryAdapter({
      entries: [{ stableId: 'sample', name: 'dhpk-sample' }],
      bindingShape: DIRECT_SHAPE,
    });
    assert.strictEqual(adapter.bindingShape, DIRECT_SHAPE);
    assert.strictEqual(adapter.kind, 'direct');
    assert.deepStrictEqual(adapter.entries, [{ stableId: 'sample', name: 'dhpk-sample' }]);
  });
}

{
  // Source suite: tests/project-agent-host-binding-policy.test.js
  const policy = require('../scripts/lib/project-agent-host-binding-policy');
  const {
    createProjectAgentProviderAdapters,
  } = require('../scripts/lib/project-agent-provider-adapters');

  test('Host selection precedence and Codex discovery visibility are explicit', () => {
    assert.deepStrictEqual(policy.boundStableIds({
      selectedStableIds: ['selected-only'],
      emittedStableIds: ['emitted'],
      bindings: [{ stableId: 'bound' }],
    }), ['emitted']);
    assert.deepStrictEqual(policy.boundStableIds({
      selectedStableIds: ['selected-only'],
      emittedStableIds: [],
      bindings: [{ stableId: 'bound' }],
    }), []);
    assert.deepStrictEqual(policy.boundStableIds({ selectedStableIds: ['legacy-selected'] }), ['legacy-selected']);
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

  test('discovery adapters bind emitted subsets and preserve legacy selections', () => {
    const entries = [
      { stableId: 'emitted', name: 'dhpk-emitted' },
      { stableId: 'selected-only', name: 'dhpk-selected-only' },
      { stableId: 'codex-only', name: 'dhpk-codex-only' },
    ];
    for (const { selection, expected } of [
      { selection: { selectedStableIds: ['selected-only', 'emitted'], emittedStableIds: ['emitted'] }, expected: ['emitted'] },
      { selection: { selectedStableIds: ['selected-only'], emittedStableIds: [] }, expected: [] },
      { selection: { selectedStableIds: ['selected-only'] }, expected: ['selected-only'] },
    ]) {
      const hostBindings = {
        cursor: {
          host: 'cursor', surface: 'cursor-plugin', shape: 'project-skill-directory',
          transform: { id: 'cursor-project-skill', version: '1' }, ...selection,
        },
        claude: {
          host: 'claude', surface: 'claude-core', shape: 'project-skill-directory',
          transform: { id: 'claude-project-skill', version: '1' }, ...selection,
        },
        codex: {
          host: 'codex', surface: 'codex-sync', shape: 'project-skill-directory',
          transform: { id: 'codex-project-skill', version: '1' }, selectedStableIds: ['codex-only'],
        },
      };
      const before = JSON.stringify(hostBindings);
      const adapters = createProjectAgentProviderAdapters(hostBindings, { entries });
      assert.deepStrictEqual(policy.boundStableIds(hostBindings.cursor), expected);
      assert.deepStrictEqual(adapters.forHost.cursor.discovery.entries.map((entry) => entry.stableId), expected);
      assert.deepStrictEqual(adapters.forHost.claude.discovery.entries.map((entry) => entry.stableId), expected);
      assert.deepStrictEqual(adapters.forHost.codex.discovery.entries.map((entry) => entry.stableId), ['codex-only']);
      assert.strictEqual(JSON.stringify(hostBindings), before);
    }
    assert.deepStrictEqual(policy.selectedAdapterEntries(entries, {}), entries);
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
    assert.doesNotThrow(() => policy.validateReceiptBindings(receipt, providers, bindingPaths));
    assert.throws(
      () => policy.validateReceiptBindings(receipt, providers, {
        codex: [{ path: '.codex/skills/foreign', target: '../../.agents/skills/foreign' }],
      }),
      /Codex discovery bindings do not match the selected artifact/,
    );
  });

  test('Cursor receipt paths match emitted skills while Codex keeps its independent selection', () => {
    const hostBindings = {
      cursor: {
        host: 'cursor', surface: 'cursor-plugin', shape: 'project-skill-directory',
        transform: { id: 'cursor-project-skill', version: '1' },
        selectedStableIds: ['emitted', 'selected-only'],
        emittedStableIds: ['emitted'],
        bindingShape: policy.NATIVE_LINK_SHAPE,
      },
      codex: {
        host: 'codex', surface: 'codex-sync', shape: 'project-skill-directory',
        transform: { id: 'codex-project-skill', version: '1' },
        selectedStableIds: ['codex-only'],
        bindingShape: policy.NATIVE_LINK_SHAPE,
      },
    };
    const providers = createProjectAgentProviderAdapters(hostBindings, {
      entries: [
        { stableId: 'emitted', name: 'dhpk-emitted' },
        { stableId: 'selected-only', name: 'dhpk-selected-only' },
        { stableId: 'codex-only', name: 'dhpk-codex-only' },
      ],
    });
    assert.deepStrictEqual(providers.forHost.cursor.discovery.entries.map((entry) => entry.stableId), ['emitted']);
    assert.deepStrictEqual(providers.forHost.codex.discovery.entries.map((entry) => entry.stableId), ['codex-only']);

    let stamped = policy.stampDiscoveryHost(hostBindings, {}, providers, {
      hostId: 'cursor',
      bindingShape: policy.NATIVE_LINK_SHAPE,
    });
    stamped = policy.stampDiscoveryHost(stamped.hostBindings, stamped.bindingPaths, providers, {
      hostId: 'codex',
      bindingShape: policy.NATIVE_LINK_SHAPE,
    });
    const receipt = { hostBindings: stamped.hostBindings, bindingPaths: stamped.bindingPaths };
    assert.deepStrictEqual(receipt.bindingPaths.cursor.map((entry) => entry.path), ['.cursor/skills/dhpk-emitted']);
    assert.deepStrictEqual(receipt.bindingPaths.codex.map((entry) => entry.path), ['.codex/skills/dhpk-codex-only']);
    assert.doesNotThrow(() => policy.validateReceiptBindings(receipt, providers, receipt.bindingPaths));
  });
}

run('project-agent-provider-adapters');
