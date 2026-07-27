'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'validate-openai-metadata.js');
const { validateRepository } = require(SCRIPT);

function writeFixture({ metadata = true, physical = false, invalid = false, invocationClass = null, claudeDisabled = null, codexPolicy = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-openai-metadata-'));
  const skillDir = path.join(tmp, 'skills', 'demo-skill');
  const codexDir = path.join(tmp, 'codex', 'skills');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });

  const claudeLine = claudeDisabled == null ? '' : `disable-model-invocation: ${claudeDisabled}\n`;
  const classBlock = invocationClass == null ? '' : `metadata:\n  dhpk-invocation-class: ${invocationClass}\n`;
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: demo-skill\ndescription: A fixture skill for metadata validation.\n${claudeLine}${classBlock}---\n\n# Demo\n`,
  );

  if (metadata) {
    const description = invalid ? 'too short' : 'A fixture metadata description for testing';
    const prompt = invalid
      ? 'Use $wrong-skill to test metadata.'
      : 'Use $demo-skill to test metadata validation.';
    const policyBlock = codexPolicy == null ? '' : `policy:\n  allow_implicit_invocation: ${codexPolicy}\n`;
    fs.mkdirSync(path.join(skillDir, 'agents'), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'agents', 'openai.yaml'),
      `interface:\n  display_name: "Demo Skill"\n  short_description: "${description}"\n  default_prompt: "${prompt}"\n${policyBlock}`,
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

test('explicit-only in canonical/Claude but Codex permits implicit invocation fails parity', () => {
  const tmp = writeFixture({ invocationClass: 'explicit-only', claudeDisabled: 'true', codexPolicy: null });
  try {
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /explicit-only but missing policy\.allow_implicit_invocation: false/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('explicit-only but Claude frontmatter lacks disable-model-invocation fails parity', () => {
  const tmp = writeFixture({ invocationClass: 'explicit-only', claudeDisabled: null, codexPolicy: 'false' });
  try {
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /explicit-only but Claude frontmatter is missing disable-model-invocation: true/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('implicit-eligible skill retaining a stale Claude restriction fails parity', () => {
  const tmp = writeFixture({ invocationClass: 'implicit-eligible', claudeDisabled: 'true', codexPolicy: null });
  try {
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /implicit-eligible but still carries disable-model-invocation: true \(stale restriction\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('implicit-eligible skill retaining a stale Codex policy block fails parity', () => {
  const tmp = writeFixture({ invocationClass: 'implicit-eligible', claudeDisabled: null, codexPolicy: 'false' });
  try {
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /implicit-eligible but retains a policy: block \(stale restriction\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('matching explicit-only class across canonical/Claude/Codex passes parity', () => {
  const tmp = writeFixture({ invocationClass: 'explicit-only', claudeDisabled: 'true', codexPolicy: 'false' });
  try {
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 0, result.output);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('matching implicit-eligible class with no restrictive flags anywhere passes parity', () => {
  const tmp = writeFixture({ invocationClass: 'implicit-eligible' });
  try {
    const result = runValidator(tmp);
    assert.strictEqual(result.status, 0, result.output);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-openai-metadata');
