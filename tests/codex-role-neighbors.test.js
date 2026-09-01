'use strict';

// RED characterization for the shared Codex role-neighbor fence.  These
// tests use only the generator command and projection/runtime validators; all
// mutations are confined to disposable copies of the public projection.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const {
  collectCodexCoverageErrors,
  collectCodexProjectionReferenceErrors,
} = require(path.join(ROOT, 'scripts', 'ci', '_lib', 'codex-runtime'));
const {
  collectCodexRoleNeighborErrors,
} = require(path.join(ROOT, 'scripts', 'lib', 'codex-role-neighbors'));

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-${prefix}-`));
}

function cloneProjectionFixture(prefix) {
  const root = tmpRoot(prefix);
  for (const entry of ['agents', 'agent-traps', 'codex', 'manifests', 'modules']) {
    fs.cpSync(path.join(ROOT, entry), path.join(root, entry), { recursive: true });
  }
  return root;
}

function appendDeveloperInstructions(file, text) {
  const source = fs.readFileSync(file, 'utf8');
  const closing = source.lastIndexOf('"""');
  assert.ok(closing > 0, `${file}: developer_instructions closing delimiter missing`);
  fs.writeFileSync(file, `${source.slice(0, closing)}\n${text.trim()}\n${source.slice(closing)}`);
}

function neighborErrors(errors, token) {
  return errors.filter((error) => error.includes(token));
}

function assertNeighborDiagnostic(error, { source, token, state }) {
  assert.match(error, new RegExp(source));
  assert.match(error, new RegExp(token));
  assert.match(error, new RegExp(`\\b${state}\\b`, 'i'));
  assert.match(error, /direct Codex role|explicit manual fallback/i);
}

test('known direct role neighbors pass the committed projection fence', () => {
  const root = cloneProjectionFixture('codex-neighbor-direct-control');
  try {
    appendDeveloperInstructions(
      path.join(root, 'codex', 'agents', 'code-reviewer.toml'),
      'dispatch `architect` for a design review when the route requires it.',
    );
    const errors = collectCodexProjectionReferenceErrors(root);
    assert.deepStrictEqual(errors, [], errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('direct matrix targets still fail when their target is unresolved', () => {
  const root = cloneProjectionFixture('codex-neighbor-unresolved-direct');
  try {
    const mapPath = path.join(root, 'codex', 'agent-role-map.json');
    const matrix = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    matrix.roles.architect.target = 'ghost-role';
    fs.writeFileSync(mapPath, `${JSON.stringify(matrix, null, 2)}\n`);
    const errors = collectCodexCoverageErrors(root);
    assert.ok(
      errors.some((error) => /direct role 'architect'.*ghost-role/i.test(error)),
      errors.join('\n'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unknown executable neighbors remain associated across wrapped list items and table rows', () => {
  const root = cloneProjectionFixture('codex-neighbor-logical-units-red');
  try {
    appendDeveloperInstructions(
      path.join(root, 'codex', 'agents', 'code-reviewer.toml'),
      [
        '- dispatch a wrapped handoff',
        '  to `list-ghost` (punctuation must not end the logical item).',
        '',
        '| action | target | note |',
        '| --- | --- | --- |',
        '| dispatch `table-ghost` with escaped \\| delimiter | target | ordinary note |',
      ].join('\n'),
    );
    const errors = collectCodexProjectionReferenceErrors(root);
    const listDiagnostics = neighborErrors(errors, 'list-ghost');
    const tableDiagnostics = neighborErrors(errors, 'table-ghost');
    assert.ok(listDiagnostics.length > 0, errors.join('\n'));
    assert.ok(tableDiagnostics.length > 0, errors.join('\n'));
    assertNeighborDiagnostic(listDiagnostics[0], {
      source: 'code-reviewer',
      token: 'list-ghost',
      state: 'unknown',
    });
    assertNeighborDiagnostic(tableDiagnostics[0], {
      source: 'code-reviewer',
      token: 'table-ghost',
      state: 'unknown',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('general-purpose in an executable logical unit is an unknown neighbor', () => {
  const errors = collectCodexRoleNeighborErrors({
    sourceRole: 'architect',
    text: 'use a read-only `general-purpose` child; spawn it for the scoped task.',
    roleMap: { roles: {} },
    generatedRoles: ['architect'],
    packageRoles: [],
    resolvableTargets: [],
  });
  assert.strictEqual(errors.length, 1, errors.join('\n'));
  assertNeighborDiagnostic(errors[0], {
    source: 'architect',
    token: 'general-purpose',
    state: 'unknown',
  });
});

test('direct status still requires a physical target in the shared fence', () => {
  const errors = collectCodexRoleNeighborErrors({
    sourceRole: 'code-reviewer',
    text: 'dispatch `architect` for the design review.',
    roleMap: { roles: { architect: { status: 'direct', target: 'worker' } } },
    generatedRoles: ['code-reviewer'],
    packageRoles: ['worker'],
    resolvableTargets: ['code-reviewer', 'architect'],
  });
  assert.strictEqual(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /architect/);
  assert.match(errors[0], /not a resolvable package role/);
});

test('unknown context matching is exact lower-case and candidates stay single-backtick', () => {
  const errors = collectCodexRoleNeighborErrors({
    sourceRole: 'architect',
    text: [
      'Dispatch `upper-ghost` from this sentence.',
      'dispatch `lower-ghost` from this sentence.',
      'dispatch ``double-ghost`` and \\`escaped-ghost`.',
    ].join('\n'),
    roleMap: { roles: {} },
    generatedRoles: ['architect'],
    packageRoles: [],
    resolvableTargets: [],
  });
  assert.strictEqual(errors.length, 1, errors.join('\n'));
  assertNeighborDiagnostic(errors[0], {
    source: 'architect',
    token: 'lower-ghost',
    state: 'unknown',
  });
  assert.ok(!errors.some((error) => /upper-ghost|double-ghost|escaped-ghost/.test(error)), errors.join('\n'));
});

test('escaped table delimiters stay in context while unescaped delimiters isolate cells', () => {
  const errors = collectCodexRoleNeighborErrors({
    sourceRole: 'architect',
    text: [
      '| action | note |',
      '| dispatch `escaped-ghost` with escaped \\| delimiter | note |',
      '| dispatch | `isolated-ghost` | note |',
    ].join('\n'),
    roleMap: { roles: {} },
    generatedRoles: ['architect'],
    packageRoles: [],
    resolvableTargets: [],
  });
  assert.strictEqual(errors.length, 1, errors.join('\n'));
  assertNeighborDiagnostic(errors[0], {
    source: 'architect',
    token: 'escaped-ghost',
    state: 'unknown',
  });
  assert.ok(!errors.some((error) => error.includes('isolated-ghost')), errors.join('\n'));
});

test('prose, tool names, paths, versions, and fenced code are false positives', () => {
  const root = cloneProjectionFixture('codex-neighbor-false-positives-red');
  try {
    appendDeveloperInstructions(
      path.join(root, 'codex', 'agents', 'code-reviewer.toml'),
      [
        'Historical prose mentions `prose-ghost`, `data-testid`, and `playwright-cli`.',
        'The version marker is `v1-2-3`, while the file name is `agents/prose-ghost.md`.',
        '',
        '```text',
        'dispatch `fenced-ghost-role`',
        '```',
      ].join('\n'),
    );
    const errors = collectCodexProjectionReferenceErrors(root);
    assert.deepStrictEqual(errors, [], errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('codex-role-neighbors');
