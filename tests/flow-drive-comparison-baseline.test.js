'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { verify } = require('./fixtures/flow-drive-comparison/oracle');

const FIXTURES = path.join(__dirname, 'fixtures', 'flow-drive-comparison');

function freshProject(task) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-flow-drive-eval-'));
  const source = path.join(FIXTURES, 'tasks', task, 'project');
  const project = path.join(root, 'project');
  fs.cpSync(source, project, { recursive: true });
  return { root, project };
}

function fixtureDigest(directory) {
  const entries = [];
  function visit(current, prefix = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.posix.join(prefix, entry.name);
      const fullPath = path.join(current, entry.name);
      assert.ok(!entry.isSymbolicLink(), `fixture must not contain symlink ${relative}`);
      if (entry.isDirectory()) visit(fullPath, relative);
      else if (entry.isFile()) entries.push({ relative, bytes: fs.readFileSync(fullPath) });
      else assert.fail(`fixture contains non-regular entry ${relative}`);
    }
  }
  visit(directory);
  const hash = crypto.createHash('sha256');
  for (const entry of entries) hash.update(entry.relative).update('\0').update(entry.bytes).update('\0');
  return hash.digest('hex');
}

function fileDigest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('receipt quantity fixture rejects the initial omission at its public module seam', () => {
  const fixture = freshProject('receipt-quantity');
  try {
    const result = verify('receipt-quantity', fixture.project);
    assert.strictEqual(result.status, 'FAIL');
    assert.deepStrictEqual(result.checks.map(({ id, status }) => [id, status]), [
      ['quantity-is-multiplied', 'FAIL'],
      ['empty-receipt-is-zero', 'PASS'],
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('receipt quantity oracle accepts an independent known-good example', () => {
  const fixture = freshProject('receipt-quantity');
  try {
    const reference = path.join(FIXTURES, 'reference-answers', 'receipt-quantity', 'src', 'receipt.js');
    fs.copyFileSync(reference, path.join(fixture.project, 'src', 'receipt.js'));
    const result = verify('receipt-quantity', fixture.project);
    assert.strictEqual(result.status, 'PASS');
    assert.ok(result.checks.every(({ status }) => status === 'PASS'));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('explicit-zero discount fixture rejects default fallback and preserves the omitted default', () => {
  const fixture = freshProject('discount-diagnosis');
  try {
    const result = verify('discount-diagnosis', fixture.project);
    assert.strictEqual(result.status, 'FAIL');
    assert.deepStrictEqual(result.checks.map(({ id, status }) => [id, status]), [
      ['explicit-zero-preserves-price', 'FAIL'],
      ['omitted-discount-uses-default', 'PASS'],
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('discount diagnosis oracle accepts an independent known-good example', () => {
  const fixture = freshProject('discount-diagnosis');
  try {
    const reference = path.join(FIXTURES, 'reference-answers', 'discount-diagnosis', 'src', 'discount.js');
    fs.copyFileSync(reference, path.join(fixture.project, 'src', 'discount.js'));
    const result = verify('discount-diagnosis', fixture.project);
    assert.strictEqual(result.status, 'PASS');
    assert.ok(result.checks.every(({ status }) => status === 'PASS'));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('status-filter fixture rejects missing paid and open filtering while retaining old output', () => {
  const fixture = freshProject('status-filter');
  try {
    const result = verify('status-filter', fixture.project);
    assert.strictEqual(result.status, 'FAIL');
    assert.deepStrictEqual(result.checks.map(({ id, status }) => [id, status]), [
      ['paid-status-filter', 'FAIL'],
      ['open-status-filter', 'FAIL'],
      ['no-filter-keeps-existing-output', 'PASS'],
      ['invalid-status-is-an-error', 'FAIL'],
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('status-filter oracle accepts an independent known-good CLI', () => {
  const fixture = freshProject('status-filter');
  try {
    const reference = path.join(FIXTURES, 'reference-answers', 'status-filter', 'src', 'cli.js');
    fs.copyFileSync(reference, path.join(fixture.project, 'src', 'cli.js'));
    const result = verify('status-filter', fixture.project);
    assert.strictEqual(result.status, 'PASS');
    assert.ok(result.checks.every(({ status }) => status === 'PASS'));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('comparison manifest pins task inputs, Host settings, and the one-time nine-cell budget', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8'));
  const record = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'record.template.json'), 'utf8'));
  assert.strictEqual(manifest.schema, 'dhpk.flow-drive-comparison.v1');
  assert.deepStrictEqual(manifest.baseline, {
    dhpkVersion: 'v0.66.7',
    dhpkCommit: '5440dc516a7ffd0b52620546bb8f106210e79ce4',
    host: 'codex-cli',
    hostVersion: '0.163.0',
    provider: 'openai',
    model: 'gpt-6.1-sol',
    effort: 'medium',
    runtime: 'node v26.12.0',
  });
  assert.strictEqual(manifest.tasks.length, 3);
  assert.deepStrictEqual(manifest.conditions, [
    {
      id: 'native',
      skill: null,
      projectGuidance: 'No dhpk project instructions or installed skills; retain only the shared consumer instructions.',
    },
    {
      id: 'current',
      skill: 'Codex-materialized Flow Drive artifact from git archive 5440dc516a7ffd0b52620546bb8f106210e79ce4:plugins/dhpk/skills/flow-drive; install project-local at .agents/skills/flow-drive.',
    },
    {
      id: 'simplified',
      skill: 'Raw canonical Flow Drive directory from the completed #1111 integration commit:skills/flow-drive; install project-local at .agents/skills/flow-drive. Bind its final commit before the first comparison run.',
    },
  ]);
  assert.deepStrictEqual(manifest.protocol, {
    freshSessionPerCell: true,
    freshProjectCopyPerCell: true,
    sameConsumerInstructions: true,
    sameTaskPromptAcrossConditions: true,
    nativeHasDhpkProjectInjection: false,
    taskSessionCanReadDhpkCheckout: false,
    taskSessionCanReadSiblingPublicSkills: false,
    taskSessionCanReadOracleOrReferenceAnswers: false,
    taskSessionCanModifyOracleOrReferenceAnswers: false,
    maximumRuns: 9,
    maximumRunsPerCell: 1,
    automaticRetries: false,
    newPaidApi: false,
    providerSwitching: false,
  });
  assert.strictEqual(fileDigest(path.join(FIXTURES, 'oracle.js')), manifest.oracleSha256);
  for (const task of manifest.tasks) {
    assert.strictEqual(fixtureDigest(path.join(FIXTURES, 'tasks', task.id, 'project')), task.projectSha256, task.id);
    assert.strictEqual(fileDigest(path.join(FIXTURES, task.prompt)), task.promptSha256, `${task.id} prompt`);
    assert.strictEqual(fileDigest(path.join(FIXTURES, task.referenceAnswer)), task.referenceSha256, `${task.id} reference`);
    assert.deepStrictEqual(task.allowedEdits.length, 1, `${task.id} stays within its approved edit range`);
  }
  assert.strictEqual(record.limit.maxRuns, 9);
  assert.strictEqual(record.limit.maxRunsPerCell, 1);
  assert.strictEqual(record.limit.automaticRetries, false);
  assert.strictEqual(record.limit.newPaidApi, false);
  assert.strictEqual(record.cells.length, 9);
  assert.strictEqual(new Set(record.cells.map(({ id }) => id)).size, 9);
  assert.ok(record.cells.every((cell) => cell.status === 'NOT_RUN'));
  assert.strictEqual(new Set(record.cells.map(({ task }) => task)).size, 3);
  assert.strictEqual(new Set(record.cells.map(({ condition }) => condition)).size, 3);
  const expectedCells = manifest.tasks.flatMap((task) => manifest.conditions.map((condition) => `${task.id}/${condition.id}`)).sort();
  assert.deepStrictEqual(record.cells.map(({ id }) => id).sort(), expectedCells);
  for (const cell of record.cells) {
    const expectedArtifact = {
      native: 'none',
      current: 'codex-materialized:plugins/dhpk/skills/flow-drive',
      simplified: 'canonical:skills/flow-drive',
    }[cell.condition];
    assert.strictEqual(cell.skillArtifact, expectedArtifact, cell.id);
    const task = manifest.tasks.find(({ id }) => id === cell.task);
    assert.strictEqual(cell.fixtureSha256, task.projectSha256, cell.id);
  }
});

run('flow-drive-comparison-baseline');
