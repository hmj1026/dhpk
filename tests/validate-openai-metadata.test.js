'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'validate-openai-metadata.js');
const { validateRepository } = require(SCRIPT);

function writeFixture({ metadata = true, physical = false, invalid = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-openai-metadata-'));
  const skillDir = path.join(tmp, 'skills', 'demo-skill');
  const codexDir = path.join(tmp, 'codex', 'skills');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: demo-skill\ndescription: A fixture skill for metadata validation.\n---\n\n# Demo\n',
  );

  if (metadata) {
    const description = invalid ? 'too short' : 'A fixture metadata description for testing';
    const prompt = invalid
      ? 'Use $wrong-skill to test metadata.'
      : 'Use $demo-skill to test metadata validation.';
    fs.mkdirSync(path.join(skillDir, 'agents'), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'agents', 'openai.yaml'),
      `interface:\n  display_name: "Demo Skill"\n  short_description: "${description}"\n  default_prompt: "${prompt}"\n`,
    );
  }

  if (physical) fs.cpSync(skillDir, path.join(codexDir, 'demo-skill'), { recursive: true });
  else fs.symlinkSync('../../skills/demo-skill', path.join(codexDir, 'demo-skill'));
  return tmp;
}

function runValidator(root) {
  const result = validateRepository(root);
  const output = result.errors.length > 0
    ? result.errors.join('\n')
    : `PASS [openai-metadata]: canonical=${result.canonical} metadata=${result.metadata} ` +
      `codex=${result.projection.entries} symlinks=${result.projection.symlinks} physical=${result.projection.physical}`;
  return {
    status: result.errors.length > 0 ? 1 : 0,
    output,
  };
}

test('real repository passes the OpenAI metadata validator', () => {
  const result = runValidator(ROOT);
  assert.strictEqual(result.status, 0, result.output);
  assert.match(result.output, /PASS \[openai-metadata\]/);
});

test('missing canonical metadata fails with its package path', () => {
  const tmp = writeFixture({ metadata: false });
  try {
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /missing agents\/openai\.yaml/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('invalid metadata fields fail validation', () => {
  const tmp = writeFixture({ invalid: true });
  try {
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /short_description|default_prompt/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unauthorized physical Codex projection fails validation', () => {
  const tmp = writeFixture({ physical: true });
  try {
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /unexpected physical Codex skill/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dangling Codex symlink fails validation', () => {
  const tmp = writeFixture();
  try {
    const projection = path.join(tmp, 'codex', 'skills', 'demo-skill');
    fs.unlinkSync(projection);
    fs.symlinkSync('../../skills/missing-skill', projection);
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /dangling Codex symlink/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-openai-metadata');
