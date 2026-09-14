'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  AGY_PROJECT_PROBE_ADAPTER,
  AGY_PROJECT_PROBE_CLAIMS,
  AGY_PROJECT_PROBE_PRODUCER,
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

run('project-agent-provider-adapters');
