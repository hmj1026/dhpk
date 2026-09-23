'use strict';

// Stable raw-directory fixtures for the resume helper cutover. Every entry is
// a future Skill-local path; the isolation test never invokes the old root
// scripts as a fallback.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');

let registered = false;

function writeFile(context, relative, contents) {
  const target = path.join(context.projectDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function fullPayload() {
  return [
    'state: saved',
    'saved_at: 2020-01-01T00:00:00Z',
    'summary: isolated resume payload',
    `details: ${'安全な handoff 💾 '.repeat(256)}`,
    '',
  ].join('\n');
}

function prepareEmpty() {}

function prepareSavedHandoff(context) {
  writeFile(context, 'explicit/latest.md', 'state: saved\nsaved_at: 2020-01-01T00:00:00Z\n');
}

function prepareStateHandoff(context) {
  writeFile(context, 'explicit/latest.md', 'state: saved\nsaved_at: 2020-01-01T00:00:00Z\n');
}

function prepareCompact(context) {
  writeFile(context, 'compact.json', JSON.stringify({
    L0: 'resume fixture headline',
    session_goal: 'preserve context across a boundary',
    completed: ['phase one', { task: 'phase two' }],
    in_progress: ['phase three'],
    key_decisions: [{ decision: 'use local scripts', reason: 'no peer checkout' }],
    failed_approaches: [{ lesson: 'do not use ambient paths' }],
  }));
}

function preparePayload(context) {
  writeFile(context, 'payload.json', JSON.stringify({
    title: 'resume fixture',
    content: 'network must remain fixture controlled',
    concepts: ['fixture', 'opsx-apply-resume'],
  }));
}

function prepareSymlinkedParent(context, parentRelative) {
  const external = path.join(context.projectDir, 'external-resume-target');
  const symlinkParent = path.join(context.projectDir, parentRelative);
  fs.mkdirSync(external, { recursive: true });
  fs.mkdirSync(path.dirname(symlinkParent), { recursive: true });
  fs.symlinkSync(external, symlinkParent, 'dir');
  context.resumeSafety = {
    external,
    expectedLeaf: path.join(external, 'handoff', 'latest.md'),
  };
}

const NETWORK_DENIED_CURL = {
  status: 7,
  stderr: 'NETWORK_DENIED: fixture curl is intentionally denied\n',
};

function outputText(result) {
  return `${String(result.stdout || '')}\n${String(result.stderr || '')}`;
}

function shellDefinition(definition, validate) {
  const expected = { ...definition.expected };
  if (!Array.isArray(expected.output) || expected.output.length === 0
    || expected.output.some((fragment) => typeof fragment !== 'string' || fragment.length === 0)) {
    throw new Error(`fixture ${definition.id} requires non-empty output fragments`);
  }
  return {
    ...definition,
    expected,
    assert(result, context) {
      assert.strictEqual(result.status, expected.status, `${definition.id}: ${outputText(result)}`);
      const output = outputText(result);
      for (const fragment of expected.output) {
        assert.ok(output.includes(fragment), `${definition.id} output is missing: ${fragment}\n${output}`);
      }
      if (validate) validate(result, context);
    },
  };
}

function registerResumeFamilyFixtures() {
  if (registered) return getFixtures();

  const fixtures = [
    shellDefinition({
      id: 'resume-detect-missing-handoff-save',
      skill: 'opsx-apply-resume',
      entry: 'scripts/detect-phase.sh',
      args: [],
      prepare: prepareEmpty,
      stubs: {},
      expected: { status: 0, output: ['save'] },
    }, (result) => {
      assert.strictEqual(result.stdout.trim(), 'save');
    }),
    shellDefinition({
      id: 'resume-detect-saved-old-resume',
      skill: 'opsx-apply-resume',
      entry: 'scripts/detect-phase.sh',
      args: ['explicit/latest.md'],
      prepare: prepareSavedHandoff,
      stubs: {},
      expected: { status: 0, output: ['resume'] },
    }, (result) => {
      assert.strictEqual(result.stdout.trim(), 'resume');
    }),
    shellDefinition({
      id: 'resume-set-state-consuming',
      skill: 'opsx-apply-resume',
      entry: 'scripts/set-handoff-state.sh',
      args: ['consuming', 'explicit/latest.md'],
      prepare: prepareStateHandoff,
      stubs: {},
      expected: { status: 0, output: ['state updated to: consuming'] },
    }, (_result, context) => {
      assert.match(
        fs.readFileSync(path.join(context.projectDir, 'explicit/latest.md'), 'utf8'),
        /^state: consuming$/m,
      );
    }),
    shellDefinition({
      id: 'resume-write-create-explicit',
      skill: 'opsx-apply-resume',
      entry: 'scripts/write-handoff.sh',
      args: ['explicit/nested/handoff.md'],
      input: fullPayload(),
      prepare: prepareEmpty,
      stubs: {},
      expected: { status: 0, output: ['handoff written: explicit/nested/handoff.md'] },
    }, (_result, context) => {
      assert.strictEqual(
        fs.readFileSync(path.join(context.projectDir, 'explicit/nested/handoff.md'), 'utf8'),
        fullPayload(),
      );
    }),
    ...[
      ['resume-write-missing-leaf-dhpk-symlink', '.dhpk', '.dhpk/handoff/latest.md'],
      ['resume-write-missing-leaf-claude-symlink', '.claude', '.claude/handoff/latest.md'],
      ['resume-write-missing-leaf-explicit-symlink', 'explicit/nested-parent', 'explicit/nested-parent/handoff/latest.md'],
    ].map(([id, parentRelative, target]) => shellDefinition({
      id,
      skill: 'opsx-apply-resume',
      entry: 'scripts/write-handoff.sh',
      args: [target],
      input: fullPayload(),
      prepare: (context) => prepareSymlinkedParent(context, parentRelative),
      stubs: {},
      expected: { status: 2, output: ['symlink'] },
    }, (_result, context) => {
      assert.ok(!fs.existsSync(context.resumeSafety.expectedLeaf),
        'rejected symlink ancestor must not receive a handoff');
    })),
    shellDefinition({
      id: 'resume-extract-compact-owner',
      skill: 'dhpk-opsx-load-context',
      entry: 'scripts/extract-compact.sh',
      args: ['compact.json'],
      prepare: prepareCompact,
      stubs: {},
      expected: {
        status: 0,
        output: ['L0: resume fixture headline', 'session_goal: preserve context across a boundary', '  - phase two', '[use local scripts] no peer checkout'],
      },
    }),
    shellDefinition({
      id: 'resume-extract-compact-copy',
      skill: 'opsx-apply-resume',
      entry: 'scripts/extract-compact.sh',
      args: ['compact.json'],
      prepare: prepareCompact,
      stubs: {},
      expected: {
        status: 0,
        output: ['L0: resume fixture headline', 'session_goal: preserve context across a boundary', '  - phase two', '[use local scripts] no peer checkout'],
      },
    }),
    shellDefinition({
      id: 'resume-post-observation-owner-unavailable',
      skill: 'dhpk-opsx-post-observation',
      entry: 'scripts/post-obs.sh',
      args: ['payload.json'],
      prepare: preparePayload,
      stubs: { curl: NETWORK_DENIED_CURL },
      expected: { status: 0, output: ['null'] },
    }, (result) => {
      assert.strictEqual(result.stdout.trim(), 'null');
    }),
    shellDefinition({
      id: 'resume-post-observation-copy-unavailable',
      skill: 'opsx-apply-resume',
      entry: 'scripts/post-obs.sh',
      args: ['payload.json'],
      prepare: preparePayload,
      stubs: { curl: NETWORK_DENIED_CURL },
      expected: { status: 0, output: ['null'] },
    }, (result) => {
      assert.strictEqual(result.stdout.trim(), 'null');
    }),
  ];

  for (const fixture of fixtures) registerFixture(fixture);
  registered = true;
  return getFixtures();
}

module.exports = { registerResumeFamilyFixtures };
