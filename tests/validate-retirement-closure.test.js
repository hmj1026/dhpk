'use strict';

// Issue #534 P2 closure gate. These tests exercise the public validator seam
// with independent mutations so a missing ledger row or resurrected route
// cannot be hidden by a passing inventory-only check.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  CURRENT_WAVE_IDS,
  REMOVED_COMMAND_IDS,
  validateRetirementClosure,
} = require('../scripts/lib/retirement-closure');

const ROOT = path.join(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
const purposeLedger = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/skill-purpose-decisions.json'), 'utf8'));
const commandManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/command-skill-dispositions.json'), 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function closure(overrides = {}) {
  return validateRetirementClosure({
    root: ROOT,
    inventory: clone(inventory),
    purposeLedger: clone(purposeLedger),
    commandManifest: clone(commandManifest),
    ...overrides,
  });
}

test('retirement closure accepts exactly the current wave and removed command set', () => {
  const result = closure();
  assert.strictEqual(result.ok, true, result.errors.join('\n'));
  assert.deepStrictEqual(result.currentWaveIds.sort(), [...CURRENT_WAVE_IDS].sort());
  assert.deepStrictEqual(result.removedCommandIds.sort(), [...REMOVED_COMMAND_IDS].sort());
  assert.deepStrictEqual(result.findings, []);
});

test('retirement closure rejects a missing current-wave purpose row', () => {
  const candidate = clone(purposeLedger);
  candidate.retirements = candidate.retirements.slice(1);
  const result = closure({ purposeLedger: candidate });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((error) => /missing retirement purpose decision 'laravel-5\.4-notes'/.test(error)), result.errors.join('\n'));
});

test('retirement closure rejects resurrected retired paths and removed command routes', () => {
  const resurrectedSkill = clone(inventory);
  const skill = resurrectedSkill.retired_skills.find((row) => row.id === 'harness-budget');
  skill.canonicalPath = 'skills/laravel';
  const skillResult = closure({ inventory: resurrectedSkill });
  assert.strictEqual(skillResult.ok, false);
  assert.ok(skillResult.errors.some((error) => /harness-budget.*canonicalPath|retired skill path is present/.test(error)), skillResult.errors.join('\n'));

  const resurrectedCommand = clone(commandManifest);
  resurrectedCommand.removed_commands.find((row) => row.id === 'do').path = 'commands/flow-guide.md';
  const commandResult = closure({ commandManifest: resurrectedCommand });
  assert.strictEqual(commandResult.ok, false);
  assert.ok(commandResult.errors.some((error) => /removed command path|commands\/flow-guide\.md/.test(error)), commandResult.errors.join('\n'));
});

test('retirement closure rejects renamed invocation and stale active references', () => {
  const renamed = closure({
    historicalAllowlist: [],
    activeReferences: [{ path: 'fixture/renamed.md', text: '$dhpk-laravel' }],
  });
  assert.strictEqual(renamed.ok, false);
  assert.ok(renamed.errors.some((error) => /renamed public name.*dhpk-laravel/.test(error)), renamed.errors.join('\n'));

  const stale = closure({
    historicalAllowlist: [],
    activeReferences: [{ path: 'fixture/route.md', text: '/dhpk:do\nskills/dhpk-harness-budget' }],
  });
  assert.strictEqual(stale.ok, false);
  assert.ok(stale.errors.some((error) => /removed command invocation.*\/dhpk:do/.test(error)), stale.errors.join('\n'));
  assert.ok(stale.errors.some((error) => /canonical path.*skills\/dhpk-harness-budget/.test(error)), stale.errors.join('\n'));
});

test('retirement closure accepts only exact historical file allowlist entries', () => {
  const result = closure({ historicalAllowlist: [{ path: 'docs', reason: 'too broad' }] });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((error) => /exact normalized file path.*docs/.test(error)), result.errors.join('\n'));
});

test('default active-root discovery catches route, package, projection, and renamed mutations', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-retirement-closure-'));
  try {
    fs.cpSync(ROOT, temporaryRoot, {
      recursive: true,
      filter(source) {
        const relative = path.relative(ROOT, source);
        if (!relative) return true;
        const first = relative.split(path.sep)[0];
        if (first.startsWith('.agents-skills-validate-')) return false;
        return !new Set(['.claude', '.codex', '.git', '.gitnexus', 'node_modules', 'tests']).has(first);
      },
    });

    const baseline = validateRetirementClosure({ root: temporaryRoot });
    assert.strictEqual(baseline.ok, true, baseline.errors.join('\n'));
    for (const expectedPath of [
      'skills/flow-guide/scripts/analyze.js',
      'generated/claude-marketplace/package/skills/flow-guide/scripts/analyze.js',
      'generated/claude-profiles/full/package/skills/flow-guide/scripts/analyze.js',
      'scripts/run-skill.sh',
      'generated/claude-marketplace/package/scripts/run-skill.sh',
      '.agents/skills/flow-guide/SKILL.md',
      'docs/basic-operations.md',
      'manifests/skill-purpose-decisions.json',
    ]) {
      assert.ok(baseline.activeFiles.includes(expectedPath), `default scan did not discover ${expectedPath}`);
    }

    const mutations = [
      {
        path: 'skills/flow-guide/scripts/analyze.js',
        text: "\n// mutation: resurrected route\nconst legacyRoute = '/create-request';\n",
        pattern: /retired route.*\/create-request/,
      },
      {
        path: 'generated/claude-marketplace/package/skills/flow-guide/scripts/analyze.js',
        text: "\n// mutation: resurrected package route\nconst legacyRoute = '/dhpk:do';\n",
        pattern: /removed command invocation.*\/dhpk:do/,
      },
      {
        path: 'generated/claude-profiles/full/package/skills/flow-guide/scripts/analyze.js',
        text: "\n// mutation: resurrected projection route\nconst legacyRoute = '/dhpk:do';\n",
        pattern: /removed command invocation.*\/dhpk:do/,
      },
      {
        path: 'plugins/dhpk-agent/skills/flow-guide/SKILL.md',
        text: '\n<!-- mutation: renamed public invocation -->\n$dhpk-laravel\n',
        pattern: /renamed public name.*dhpk-laravel/,
      },
      {
        path: 'scripts/run-skill.sh',
        text: "\n# mutation: canonical runtime route\nlegacy_route='/create-request'\n",
        pattern: /retired route.*\/create-request/,
      },
      {
        path: 'generated/claude-marketplace/package/scripts/run-skill.sh',
        text: "\n# mutation: packaged runtime route\nlegacy_route='/dhpk:do'\n",
        pattern: /removed command invocation.*\/dhpk:do/,
      },
      {
        path: '.agents/skills/flow-guide/SKILL.md',
        text: '\n<!-- mutation: project skill projection -->\n$dhpk-laravel\n',
        pattern: /renamed public name.*dhpk-laravel/,
      },
      {
        path: 'docs/basic-operations.md',
        text: '\n<!-- mutation: active operational guide -->\n/dhpk:do\n',
        pattern: /removed command invocation.*\/dhpk:do/,
      },
    ];
    for (const mutation of mutations) {
      const absolute = path.join(temporaryRoot, mutation.path);
      const original = fs.readFileSync(absolute, 'utf8');
      fs.writeFileSync(absolute, original + mutation.text);
      const result = validateRetirementClosure({ root: temporaryRoot });
      fs.writeFileSync(absolute, original);
      assert.strictEqual(result.ok, false, `mutation unexpectedly passed: ${mutation.path}`);
      assert.ok(result.errors.some((error) => mutation.pattern.test(error)), result.errors.join('\n'));
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

run('validate-retirement-closure');
