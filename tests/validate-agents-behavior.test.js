'use strict';

// Regression guard for a historical Release failure (v0.3.1: "Validation
// errors: agents: Invalid input"). scripts/ci/validate-agents.js relies on
// frontmatter.js to detect missing/empty required fields — this test proves
// that detection logic actually flags the malformed input classes that
// caused the failure, rather than only being exercised indirectly against
// already-valid real agent files.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { extract, isEmpty } = require(
  path.join(__dirname, '..', 'scripts', 'ci', '_lib', 'frontmatter')
);

const ROOT = path.join(__dirname, '..');
const VALIDATOR = path.join(ROOT, 'scripts', 'ci', 'validate-agents.js');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-agents-'));
  for (const directory of ['agents', 'codex', 'manifests', 'modules']) {
    fs.cpSync(path.join(ROOT, directory), path.join(tmp, directory), { recursive: true });
  }
  return tmp;
}

function writeAgent(tmp, content) {
  fs.writeFileSync(path.join(tmp, 'agents', 'architect.md'), content);
}

function runValidator(tmp, extraArgs = []) {
  const result = spawnSync(process.execPath, [VALIDATOR, '--root', tmp, ...extraArgs], {
    encoding: 'utf8',
  });
  return { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function agentFrontmatter(fields) {
  return [
    '---',
    'name: architect',
    'description: architecture guidance',
    'model: fable',
    'tools: Read',
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    '---',
    'body',
    '',
  ].join('\n');
}

test('missing frontmatter block is detected', () => {
  const fm = extract('no frontmatter here');
  assert.strictEqual(fm.present, false);
});

test('missing description is flagged as empty', () => {
  const fm = extract('---\nname: broken-agent\n---\nbody');
  assert.ok(isEmpty(fm.values.description), 'undefined description must be treated as empty');
});

test('blank quoted description is flagged as empty', () => {
  const fm = extract('---\nname: broken-agent\ndescription: \'\'\n---\nbody');
  assert.ok(isEmpty(fm.values.description), "quoted '' description must be treated as empty");
});

test('duplicate frontmatter keys are reported', () => {
  const fm = extract('---\nname: a\nname: b\n---\nbody');
  assert.ok(fm.duplicates.includes('name'), 'duplicate "name" key must be reported');
});

test('a well-formed agent frontmatter passes all checks', () => {
  const fm = extract('---\nname: ok-agent\ndescription: does a thing\nmodel: sonnet\n---\nbody');
  assert.ok(fm.present, 'frontmatter should be present');
  assert.ok(!isEmpty(fm.values.name), 'name should not be empty');
  assert.ok(!isEmpty(fm.values.description), 'description should not be empty');
  assert.strictEqual(fm.duplicates.length, 0, 'no duplicates expected');
});

test('fable is an accepted model tier (agents/architect.md ships on it)', () => {
  const src = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'scripts', 'ci', 'validate-agents.js'), 'utf8');
  assert.ok(/VALID_MODELS\s*=\s*\[[^\]]*'fable'/.test(src),
    'validate-agents.js VALID_MODELS must include fable so agents/architect.md (model: fable) validates');
});

test('the validator covers root and module agents', () => {
  const result = spawnSync(process.execPath, [VALIDATOR], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout || ''}${result.stderr || ''}`);
  assert.match(`${result.stdout || ''}${result.stderr || ''}`, /32 agent files/);
});

test('official effort values pass in a validator fixture', () => {
  const tmp = makeTempRepo();
  try {
    for (const effort of ['xhigh', 'max']) {
      writeAgent(tmp, agentFrontmatter({ effort, maxTurns: 1 }));
      const result = runValidator(tmp);
      assert.strictEqual(result.status, 0, result.out);
      assert.doesNotMatch(result.out, /invalid effort/);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unofficial effort values fail in a validator fixture', () => {
  const tmp = makeTempRepo();
  try {
    for (const effort of ['ultra', 'extreme']) {
      writeAgent(tmp, agentFrontmatter({ effort, maxTurns: 1 }));
      const result = runValidator(tmp);
      assert.strictEqual(result.status, 1, result.out);
      assert.match(result.out, new RegExp(`architect\\.md — invalid effort '${effort}'`));
      const strictResult = runValidator(tmp, ['--strict']);
      assert.strictEqual(strictResult.status, 1, strictResult.out);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('zero, negative, and non-numeric maxTurns fail in a validator fixture', () => {
  const tmp = makeTempRepo();
  try {
    for (const maxTurns of ['0', '-1', 'not-a-number']) {
      writeAgent(tmp, agentFrontmatter({ effort: 'medium', maxTurns }));
      const result = runValidator(tmp);
      assert.strictEqual(result.status, 1, result.out);
      assert.match(result.out, /architect\.md — invalid maxTurns/);
      const strictResult = runValidator(tmp, ['--strict']);
      assert.strictEqual(strictResult.status, 1, strictResult.out);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing optional fields remain non-fatal on the default run', () => {
  const tmp = makeTempRepo();
  try {
    writeAgent(tmp, agentFrontmatter({}));
    const before = fs.readFileSync(path.join(tmp, 'agents', 'architect.md'), 'utf8');
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 0, result.out);
    assert.match(result.out, /missing 'maxTurns'/);
    const strictResult = runValidator(tmp, ['--strict']);
    assert.strictEqual(strictResult.status, 0, strictResult.out);
    assert.match(strictResult.out, /missing 'maxTurns'/);
    assert.strictEqual(
      fs.readFileSync(path.join(tmp, 'agents', 'architect.md'), 'utf8'),
      before,
      'validator must not rewrite agent files',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('explicitly empty optional fields fail only in strict mode', () => {
  const tmp = makeTempRepo();
  try {
    writeAgent(tmp, agentFrontmatter({ effort: "''", maxTurns: 1 }));
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 0, result.out);
    assert.match(result.out, /missing\/empty 'effort'/);
    const strictResult = runValidator(tmp, ['--strict']);
    assert.strictEqual(strictResult.status, 1, strictResult.out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-agents-behavior');
