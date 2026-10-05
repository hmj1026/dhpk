'use strict';

// Regression guard for a historical Release failure (v0.3.1: "Validation
// errors: agents: Invalid input"). These tests exercise validator behavior
// through temporary repositories and verify both agents projection receipt
// boundaries without duplicating the frontmatter parser's focused unit contracts.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
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

test('fable model passes through the agent validator', () => {
  const tmp = makeTempRepo();
  try {
    writeAgent(tmp, agentFrontmatter({ effort: 'medium', maxTurns: 1 }));
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 0, result.out);
    assert.doesNotMatch(result.out, /invalid model 'fable'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('inherit is an accepted official model alias', () => {
  const tmp = makeTempRepo();
  try {
    writeAgent(tmp, agentFrontmatter({}));
    fs.writeFileSync(path.join(tmp, 'agents', 'architect.md'), [
      '---',
      'name: architect',
      'description: architecture guidance',
      'model: inherit',
      'tools: Read',
      'effort: low',
      'maxTurns: 1',
      '---',
      'body',
      '',
    ].join('\n'));
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 0, result.out);
    assert.doesNotMatch(result.out, /invalid model 'inherit'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('name that does not match the agent basename fails', () => {
  const tmp = makeTempRepo();
  try {
    writeAgent(tmp, [
      '---',
      'name: not-architect',
      'description: architecture guidance',
      'model: fable',
      'tools: Read',
      '---',
      'body',
      '',
    ].join('\n'));
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1, result.out);
    assert.match(result.out, /architect\.md — name 'not-architect' does not match basename 'architect'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing tools fails as local policy', () => {
  const tmp = makeTempRepo();
  try {
    writeAgent(tmp, [
      '---',
      'name: architect',
      'description: architecture guidance',
      'model: fable',
      '---',
      'body',
      '',
    ].join('\n'));
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1, result.out);
    assert.match(result.out, /architect\.md — missing\/empty 'tools'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the validator covers root and module agents', () => {
  const result = spawnSync(process.execPath, [VALIDATOR], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout || ''}${result.stderr || ''}`);
  assert.match(`${result.stdout || ''}${result.stderr || ''}`, /34 agent files/);
});

test('INDEX.md is skipped even without tools or a matching name', () => {
  const tmp = makeTempRepo();
  try {
    fs.writeFileSync(path.join(tmp, 'agents', 'INDEX.md'), [
      '---',
      'name: not-index',
      'description: roster',
      '---',
      'body',
      '',
    ].join('\n'));
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 0, result.out);
    assert.doesNotMatch(result.out, /INDEX\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
    assert.doesNotMatch(result.out, /missing 'maxTurns'/);
    const strictResult = runValidator(tmp, ['--strict']);
    assert.strictEqual(strictResult.status, 0, strictResult.out);
    assert.doesNotMatch(strictResult.out, /missing 'maxTurns'/);
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


// Consolidated from tests/validate-agents-skills.test.js; test registrations remain isolated in this lexical block.
{
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const GENERATOR = path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js');
  const VALIDATOR = path.join(ROOT, 'scripts', 'ci', 'validate-agents-skills.js');

test('validate-agents-skills CLI reports structural PASS and runtime boundary', () => {
  const outDir = fs.mkdtempSync(path.join(ROOT, '.agents-skills-validate-'));
  try {
      const generated = spawnSync(process.execPath, [GENERATOR, '--repo-root', ROOT, '--out-dir', outDir], {
        cwd: ROOT,
        encoding: 'utf8',
    });
      assert.strictEqual(
        generated.status,
        0,
        `${generated.stdout || ''}${generated.stderr || ''} outDir=${outDir} entries=${fs.readdirSync(outDir).join(',')}`,
      );
    const result = spawnSync(process.execPath, [VALIDATOR, '--repo-root', ROOT, '--out-dir', outDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS \[agents-skills\]: 52 selected skills; runtime=NOT_RUN/);

    const receipt = path.join(outDir, '.dhpk-projection.json');
    assert.ok(fs.existsSync(receipt), 'generator must write the projection receipt');
    fs.rmSync(receipt);
    const missingReceipt = spawnSync(process.execPath, [VALIDATOR, '--repo-root', ROOT, '--out-dir', outDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const missingReceiptOutput = `${missingReceipt.stdout || ''}${missingReceipt.stderr || ''}`;
    assert.strictEqual(missingReceipt.status, 1, missingReceiptOutput);
    assert.match(missingReceiptOutput, /projection receipt is missing/);

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const regenerated = spawnSync(process.execPath, [GENERATOR, '--repo-root', ROOT, '--out-dir', outDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(regenerated.status, 0, regenerated.stderr);
    const restored = spawnSync(process.execPath, [VALIDATOR, '--repo-root', ROOT, '--out-dir', outDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(restored.status, 0, restored.stderr);
    assert.match(restored.stdout, /PASS \[agents-skills\]: 52 selected skills; runtime=NOT_RUN/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  });

  test('validate-agents-skills CLI validates an external project receipt', () => {
    const projectRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-agents-skills-cli-validate-project-'));
    try {
      const generated = spawnSync(process.execPath, [
        GENERATOR,
        '--source-root', ROOT,
        '--project-root', projectRoot,
        '--profile', 'portable-core',
        '--host', 'claude',
        '--host', 'codex',
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(generated.status, 0, generated.stderr);
    const result = spawnSync(process.execPath, [
        VALIDATOR,
        '--repo-root', ROOT,
        '--source-root', ROOT,
        '--project-root', projectRoot,
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS \[agents-skills\]: 52 selected skills; runtime=NOT_RUN/);

    const receipt = path.join(projectRoot, '.agents', '.dhpk-installed.json');
    assert.ok(fs.existsSync(receipt), 'generator must write the external project receipt');
    fs.rmSync(receipt);
    const missingReceipt = spawnSync(process.execPath, [
      VALIDATOR,
      '--repo-root', ROOT,
      '--source-root', ROOT,
      '--project-root', projectRoot,
    ], { cwd: ROOT, encoding: 'utf8' });
    const missingReceiptOutput = `${missingReceipt.stdout || ''}${missingReceipt.stderr || ''}`;
    assert.strictEqual(missingReceipt.status, 1, missingReceiptOutput);
    assert.match(missingReceiptOutput, /project projection receipt is missing|no lifecycle receipt/);

    for (const directory of ['.agents', '.claude', '.codex']) {
      fs.rmSync(path.join(projectRoot, directory), { recursive: true, force: true });
    }
    const regenerated = spawnSync(process.execPath, [
      GENERATOR,
      '--source-root', ROOT,
      '--project-root', projectRoot,
      '--profile', 'portable-core',
      '--host', 'claude',
      '--host', 'codex',
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(regenerated.status, 0, regenerated.stderr);
    const restored = spawnSync(process.execPath, [
      VALIDATOR,
      '--repo-root', ROOT,
      '--source-root', ROOT,
      '--project-root', projectRoot,
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(restored.status, 0, restored.stderr);
    assert.match(restored.stdout, /PASS \[agents-skills\]: 52 selected skills; runtime=NOT_RUN/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
  });
}

run('validate-agents-behavior');
