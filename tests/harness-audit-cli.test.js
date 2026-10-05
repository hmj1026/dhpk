'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'harness-audit', 'scripts', 'harness-audit.js');

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-cli-')));
}

function runAudit(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ...env },
  });
}

function writeConsumerFixture(root) {
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Agents\n');
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'sample.test.js'), '// placeholder\n');
}

function writeRepoFixture(root) {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dhpk' }));
  fs.mkdirSync(path.join(root, 'hooks', 'memory-persistence'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hooks', 'hooks.json'), JSON.stringify({ PreToolUse: [] }));
  fs.writeFileSync(path.join(root, 'tests', 'hooks', 'hooks.test.js'), '// hook test fixture\n');

  const hookFiles = [
    'suggest-compact.js',
    'session-start.js',
    'session-end.js',
    'hook-4.js',
    'hook-5.js',
    'hook-6.js',
    'hook-7.js',
    'hook-8.js',
  ];
  for (const file of hookFiles) {
    fs.writeFileSync(path.join(root, 'scripts', 'hooks', file), '// hook fixture\n');
  }
}

test('audit module exports buildReport and parseArgs', () => {
  const audit = require(SCRIPT);
  assert.strictEqual(typeof audit.buildReport, 'function');
  assert.strictEqual(typeof audit.parseArgs, 'function');
});

test('audit accepts positional scope, equals-form options, and AUDIT_ROOT', () => {
  const flagResult = runAudit([
    '--scope=hooks',
    '--format=json',
    '--root=' + ROOT,
  ], { AUDIT_ROOT: '' });
  assert.strictEqual(flagResult.status, 0, flagResult.stderr);
  const flagReport = JSON.parse(flagResult.stdout);

  const positionalResult = runAudit(['hooks', '--format=json'], { AUDIT_ROOT: ROOT });
  assert.strictEqual(positionalResult.status, 0, positionalResult.stderr);
  const positionalReport = JSON.parse(positionalResult.stdout);

  assert.strictEqual(flagReport.scope, 'hooks');
  assert.strictEqual(flagReport.root_dir, ROOT);
  assert.deepStrictEqual(positionalReport, flagReport);
});

test('audit report retains the characterized consumer fixture values', () => {
  const fixture = tempDir();
  try {
    writeConsumerFixture(fixture);
    fs.mkdirSync(path.join(fixture, 'home'), { recursive: true });
    const result = runAudit(['--root', fixture, '--format', 'json'], {
      HOME: path.join(fixture, 'home'),
      AUDIT_ROOT: '',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const actual = {
      scope: report.scope,
      root_dir: '<fixture-root>',
      target_mode: report.target_mode,
      deterministic: report.deterministic,
      rubric_version: report.rubric_version,
      overall_score: report.overall_score,
      max_score: report.max_score,
      categories: report.categories,
      checks: report.checks.map(({ id, category, points, path: checkPath, pass }) => ({
        id,
        category,
        points,
        path: checkPath,
        pass,
      })),
      top_actions: report.top_actions.map(({ category, points, path: actionPath }) => ({
        category,
        points,
        path: actionPath,
      })),
    };

    assert.ok(report.checks.every((check) => typeof check.description === 'string' && check.description.length > 0));
    assert.ok(report.top_actions.every((action) => typeof action.action === 'string' && action.action.length > 0));
    assert.deepStrictEqual(actual, {
      scope: 'repo',
      root_dir: '<fixture-root>',
      target_mode: 'consumer',
      deterministic: true,
      rubric_version: '2026-03-30',
      overall_score: 7,
      max_score: 29,
      categories: {
        'Tool Coverage': { score: 0, earned: 0, max: 7 },
        'Context Efficiency': { score: 6, earned: 3, max: 5 },
        'Quality Gates': { score: 6, earned: 4, max: 7 },
        'Memory Persistence': { score: 0, earned: 0, max: 2 },
        'Eval Coverage': { score: 0, earned: 0, max: 2 },
        'Security Guardrails': { score: 0, earned: 0, max: 6 },
        'Cost Efficiency': { score: 0, earned: 0, max: 0 },
      },
      checks: [
        {
          id: 'consumer-plugin-install',
          category: 'Tool Coverage',
          points: 4,
          path: '~/.claude/plugins/dhpk/',
          pass: false,
        },
        {
          id: 'consumer-project-overrides',
          category: 'Tool Coverage',
          points: 3,
          path: '.claude/',
          pass: false,
        },
        {
          id: 'consumer-instructions',
          category: 'Context Efficiency',
          points: 3,
          path: 'AGENTS.md',
          pass: true,
        },
        {
          id: 'consumer-project-config',
          category: 'Context Efficiency',
          points: 2,
          path: '.mcp.json',
          pass: false,
        },
        {
          id: 'consumer-test-suite',
          category: 'Quality Gates',
          points: 4,
          path: 'tests/',
          pass: true,
        },
        {
          id: 'consumer-ci-workflow',
          category: 'Quality Gates',
          points: 3,
          path: '.github/workflows/',
          pass: false,
        },
        {
          id: 'consumer-memory-notes',
          category: 'Memory Persistence',
          points: 2,
          path: '.claude/memory.md',
          pass: false,
        },
        {
          id: 'consumer-eval-coverage',
          category: 'Eval Coverage',
          points: 2,
          path: 'evals/',
          pass: false,
        },
        {
          id: 'consumer-security-policy',
          category: 'Security Guardrails',
          points: 2,
          path: 'SECURITY.md',
          pass: false,
        },
        {
          id: 'consumer-secret-hygiene',
          category: 'Security Guardrails',
          points: 2,
          path: '.gitignore',
          pass: false,
        },
        {
          id: 'consumer-hook-guardrails',
          category: 'Security Guardrails',
          points: 2,
          path: '.claude/settings.json',
          pass: false,
        },
      ],
      top_actions: [
        {
          path: '~/.claude/plugins/dhpk/',
          category: 'Tool Coverage',
          points: 4,
        },
        {
          path: '.claude/',
          category: 'Tool Coverage',
          points: 3,
        },
        {
          path: '.github/workflows/',
          category: 'Quality Gates',
          points: 3,
        },
      ],
    });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('audit repository scopes retain rubric check membership and maximum points', () => {
  const fixture = tempDir();
  try {
    writeRepoFixture(fixture);
    const scopes = [
      {
        scope: 'repo',
        count: 25,
        maxScore: 68,
        ids: [
          'tool-hooks-config', 'tool-hooks-impl-count', 'tool-agent-count', 'tool-skill-count', 'tool-command-parity',
          'context-strategic-compact', 'context-suggest-compact-hook', 'context-model-route', 'context-token-doc',
          'quality-test-runner', 'quality-ci-validations', 'quality-hook-tests', 'quality-doctor-script',
          'memory-hooks-dir', 'memory-session-hooks', 'eval-skill', 'eval-commands', 'eval-tests-presence',
          'security-review-skill', 'security-agent', 'security-prompt-hook', 'security-scan-command',
          'cost-skill', 'cost-doc', 'cost-model-route-command',
        ],
      },
      {
        scope: 'hooks',
        count: 7,
        maxScore: 19,
        ids: [
          'tool-hooks-config', 'tool-hooks-impl-count', 'context-suggest-compact-hook', 'quality-hook-tests',
          'memory-hooks-dir', 'memory-session-hooks', 'security-prompt-hook',
        ],
      },
      {
        scope: 'skills',
        count: 5,
        maxScore: 16,
        ids: ['tool-skill-count', 'context-strategic-compact', 'eval-skill', 'security-review-skill', 'cost-skill'],
      },
      {
        scope: 'commands',
        count: 5,
        maxScore: 13,
        ids: ['tool-command-parity', 'context-model-route', 'eval-commands', 'security-scan-command', 'cost-model-route-command'],
      },
      {
        scope: 'agents',
        count: 2,
        maxScore: 5,
        ids: ['tool-agent-count', 'security-agent'],
      },
    ];

    for (const expected of scopes) {
      const result = runAudit([
        '--root=' + fixture,
        '--scope=' + expected.scope,
        '--format=json',
      ], { AUDIT_ROOT: '' });
      assert.strictEqual(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.target_mode, 'repo');
      assert.strictEqual(report.scope, expected.scope);
      assert.strictEqual(report.checks.length, expected.count);
      assert.strictEqual(report.max_score, expected.maxScore);
      assert.strictEqual(report.checks.reduce((total, check) => total + check.points, 0), expected.maxScore);
      assert.deepStrictEqual(report.checks.map((check) => check.id), expected.ids);

      if (expected.scope === 'hooks') {
        assert.ok(report.checks.every((check) => check.pass), JSON.stringify(report.checks));
      }
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

run('harness-audit-cli');
