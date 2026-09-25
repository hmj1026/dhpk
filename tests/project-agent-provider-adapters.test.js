'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  AGY_PROJECT_PROBE_ADAPTER,
  AGY_PROJECT_PROBE_CLAIMS,
  AGY_PROJECT_PROBE_PRODUCER,
  createClaudeProjectDiscoveryAdapter,
  createCursorProjectDiscoveryAdapter,
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

test('Cursor discovery adapter can bind skills as evidence-gated direct Host Bindings', () => {
  const adapter = createCursorProjectDiscoveryAdapter({
    entries: [{ stableId: 'sample', name: 'dhpk-sample' }],
    bindingShape: DIRECT_SHAPE,
  });
  assert.strictEqual(adapter.bindingShape, DIRECT_SHAPE);
  assert.strictEqual(adapter.kind, 'direct');
  assert.deepStrictEqual(adapter.entries, [{ stableId: 'sample', name: 'dhpk-sample' }]);
});

run('project-agent-provider-adapters');
