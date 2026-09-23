'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  reportFromSurfaces,
  expectedAgyPolicy,
  expectedCursorPolicyBody,
} = require('../scripts/ci/verify-platform-packages');

const ROOT = path.join(__dirname, '..');

test('an unprofiled generation preserves legacy package membership while adding only declared runtime support', () => {
  // Package generators reject symlinked ancestors; macOS exposes os.tmpdir() as /var.
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-unprofiled-platform-'));
  try {
    for (const surface of ['agent-plugin', 'agy-plugin']) {
      const output = path.join(root, surface);
      const result = spawnSync(path.join(ROOT, 'bin', 'dhpk'), [
        'distribution', surface, 'generate', '--output', output, '--version', '0.48.3', '--json',
      ], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.skillCount, 55, `${surface} must retain the current 55 inventory-selected skills`);
      const provenance = JSON.parse(fs.readFileSync(path.join(output, 'provenance.json'), 'utf8'));
      assert.strictEqual(provenance.profileId, undefined, `${surface} must not narrow without an explicit --profile`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('platform package verifier reports deterministic four-platform outputs', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ci', 'verify-platform-packages.js')], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.verdict, 'PASS');
  assert.strictEqual(report.surfaces['agent-plugin'].structural, 'PASS');
  assert.strictEqual(report.surfaces['cursor-plugin'].structural, 'PASS');
  assert.strictEqual(report.surfaces['codex-native'].structural, 'PASS');
  assert.strictEqual(report.surfaces['agy-plugin'].structural, 'PASS');
  assert.strictEqual(report.surfaces['agent-plugin'].selectedSkills, 55);
  assert.strictEqual(report.surfaces['cursor-plugin'].selectedSkills, 4);
  assert.strictEqual(report.surfaces['codex-native'].selectedSkills, 34);
  assert.strictEqual(report.surfaces['agy-plugin'].selectedSkills, 55);
  assert.strictEqual(report.policyParity.verdict, 'PASS');
  assert.strictEqual(report.surfaces['cursor-plugin'].sharedSkillSurface, 'agent-plugin');
  assert.strictEqual(report.surfaces['cursor-plugin'].sharedSkillSource, 'plugins/dhpk-agent/skills/');
  const cursorLocal = report.surfaces['cursor-plugin'].selectedSkillIds;
  const cursorShared = report.surfaces['cursor-plugin'].sharedSkillIds;
  const cursorProvenance = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'dhpk-cursor', 'provenance.json'), 'utf8'));
  assert.deepStrictEqual(cursorLocal, ['agy-fast-worker', 'cli-dispatch-context', 'cli-transport', 'codex-bridge']);
  assert.ok(cursorLocal.every((id) => cursorShared.includes(id) && cursorProvenance.runtimeSupportStableIds.includes(id)));
  assert.deepStrictEqual(report.errors, []);
});

test('platform package verifier permits declared Cursor runtime support but reports undeclared shared overlaps at the top level', () => {
  const agent = { selectedSkillIds: ['declared-runtime-support', 'undeclared-shared'], errors: [] };
  const declaredRuntimeSupport = {
    selectedSkillIds: ['declared-runtime-support'],
    sharedSkillIds: ['declared-runtime-support', 'undeclared-shared'],
    runtimeSupportStableIds: ['declared-runtime-support'],
    sharedSkillSurface: 'agent-plugin',
    sharedSkillSource: 'plugins/dhpk-agent/skills/',
    errors: [],
  };
  const allowed = reportFromSurfaces({ 'agent-plugin': agent, 'cursor-plugin': declaredRuntimeSupport });
  const undeclared = reportFromSurfaces({
    'agent-plugin': agent,
    'cursor-plugin': {
      selectedSkillIds: ['declared-runtime-support', 'undeclared-shared'],
      sharedSkillIds: ['declared-runtime-support', 'undeclared-shared'],
      runtimeSupportStableIds: ['declared-runtime-support'],
      sharedSkillSurface: 'agent-plugin',
      sharedSkillSource: 'plugins/dhpk-agent/skills/',
      errors: [],
    },
  });

  assert.deepStrictEqual(allowed.errors, []);
  assert.strictEqual(allowed.verdict, 'PASS');
  assert.deepStrictEqual(undeclared.errors, ['Cursor overlay repeats shared skill IDs without a declared runtime-support exception: undeclared-shared']);
  assert.strictEqual(undeclared.verdict, 'FAIL');
});

test('policy parity applies the generators\' repository-link rewrite before comparing AGY and Cursor projections', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-policy-links-'));
  try {
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'contracts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'contracts', 'reviewer-contract.md'), '# Contract\n');
    const canonicalPath = path.join(root, 'rules', 'execution-policy.md');
    const canonical = [
      '# Policy',
      '',
      'See the [reviewer contract](../docs/contracts/reviewer-contract.md#shape).',
      'A [missing doc](../docs/absent.md) keeps only its label.',
      'An [external link](https://example.com/x) is untouched.',
      '',
    ].join('\n');
    fs.writeFileSync(canonicalPath, canonical);
    const url = 'https://github.com/hmj1026/dhpk/blob/main/docs/contracts/reviewer-contract.md#shape';

    const agy = expectedAgyPolicy(canonical, canonicalPath, root);
    assert.ok(agy.includes(`[reviewer contract](${url})`), agy);
    assert.ok(agy.includes('A [missing doc] keeps only its label.'), agy);
    assert.ok(agy.includes('[external link](https://example.com/x)'), agy);
    assert.notStrictEqual(agy, canonical, 'an unrewritten projection must not satisfy parity');

    const cursor = expectedCursorPolicyBody(canonical, canonicalPath, root);
    assert.ok(cursor.includes(`[reviewer contract](${url})`), cursor);
    assert.ok(!cursor.includes('../docs/contracts/reviewer-contract.md'), cursor);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('verify-platform-packages');
