'use strict';

// Operability smoke for packaged Skill scripts (REQ-1). Discovers
// skills/*/scripts entries and classifies each as a CLI smoke target or a
// library module. Help/start smoke asserts exit code and output shape only —
// evidenceKind remains 'fixture' and hostStatus remains 'NOT_RUN'. This suite
// is not full behavior coverage and is not representative isolated runtime.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { EXECUTABLE_EXTENSIONS } = require('../scripts/lib/skill-directory-coverage');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const {
  SOURCES,
  registerRemainingFixtures,
  runRemainingEntryFixture,
} = require('./_lib/skill-remaining-entry-fixtures');

const ROOT = path.join(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const FIXTURES = registerRemainingFixtures();

const EXPECTED_REMAINING_ENTRIES = Object.freeze({
  'remaining-ios-iconify-generate': ['swift', 'scripts/iconify_gen.sh'],
  'remaining-ios-swift-list': ['swift', 'scripts/generate_icons.swift'],
  'remaining-code-trace-analyze-function-calls': ['code-trace', 'scripts/diagnose/analyze-function-calls.sh'],
  'remaining-code-trace-check-tools-unavailable': ['code-trace', 'scripts/diagnose/check-tools.sh'],
  'remaining-code-trace-find-polluter-multi-file': ['code-trace', 'scripts/diagnose/find-polluter.sh'],
  'remaining-code-trace-generate-flow-diagram': ['code-trace', 'scripts/diagnose/generate-flow-diagram.sh'],
  'remaining-code-trace-search-database-queries': ['code-trace', 'scripts/diagnose/search-database-queries.sh'],
  'remaining-code-trace-trace-data-flow': ['code-trace', 'scripts/diagnose/trace-data-flow.sh'],
  'remaining-deploy-list-generate': ['deploy-list', 'scripts/deploy-list.sh'],
  'remaining-deploy-list-check-golden': ['deploy-list', 'scripts/check-golden.sh'],
  'remaining-feature-verify-api-success': ['feature-verify', 'scripts/api-exec.sh'],
  'remaining-feature-verify-api-transport-failure': ['feature-verify', 'scripts/api-exec.sh'],
  'remaining-feature-verify-health-retry-success': ['feature-verify', 'scripts/health-probe.sh'],
  'remaining-feature-verify-health-retry-exhausted': ['feature-verify', 'scripts/health-probe.sh'],
  'remaining-change-verdict-unrelated-squash-warning': ['change-verdict', 'scripts/check-unrelated-changes.sh'],
  'remaining-change-verdict-unrelated-merge-skip': ['change-verdict', 'scripts/check-unrelated-changes.sh'],
  'remaining-change-verdict-review-cli-stub': ['change-verdict', 'scripts/review-cli.sh'],
  'remaining-flow-guide-pre-route-local-table': ['flow-guide', 'scripts/pre-route.sh'],
  'remaining-git-smart-commit-collect-changes-scope-readonly': ['git-smart-commit', 'scripts/collect-changes.js'],
});

function ignored(name) {
  return name === '.git' || name === '.cache' || name === 'node_modules'
    || name === '__pycache__' || name.endsWith('.pyc');
}

function fingerprintIgnored(name) {
  return name === '.git' || name === '.cache' || name === '__pycache__' || name.endsWith('.pyc');
}

function discoverPackagedSkillScripts() {
  assert.ok(EXECUTABLE_EXTENSIONS instanceof Set, 'EXECUTABLE_EXTENSIONS must be exported as a Set');
  const entries = [];
  for (const skill of fs.readdirSync(SKILLS_ROOT).sort()) {
    const scriptsRoot = path.join(SKILLS_ROOT, skill, 'scripts');
    let stat;
    try {
      stat = fs.lstatSync(scriptsRoot);
    } catch (_error) {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const visit = (relativeDir) => {
      const absoluteDir = path.join(SKILLS_ROOT, skill, relativeDir);
      for (const name of fs.readdirSync(absoluteDir).sort()) {
        if (ignored(name)) continue;
        const relative = `${relativeDir}/${name}`;
        const absolute = path.join(SKILLS_ROOT, skill, relative);
        const entryStat = fs.lstatSync(absolute);
        if (entryStat.isSymbolicLink()) {
          throw new Error(`packaged skill script is a symlink: ${skill}/${relative}`);
        }
        if (entryStat.isDirectory()) {
          visit(relative);
          continue;
        }
        if (!entryStat.isFile()) continue;
        const extension = path.extname(name).toLowerCase();
        if (!EXECUTABLE_EXTENSIONS.has(extension)) continue;
        entries.push({ skill, entry: relative, key: `${skill}/${relative}` });
      }
    };
    visit('scripts');
  }
  return entries;
}

function fingerprint(root) {
  const visit = (filePath) => {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) throw new Error(`canonical source is symlinked: ${filePath}`);
    const hash = crypto.createHash('sha256');
    if (stat.isDirectory()) {
      hash.update('dir\0');
      for (const name of fs.readdirSync(filePath).sort()) {
        if (fingerprintIgnored(name)) continue;
        hash.update(name);
        hash.update('\0');
        hash.update(visit(path.join(filePath, name)));
        hash.update('\0');
      }
    } else if (stat.isFile()) {
      hash.update('file\0');
      hash.update(fs.readFileSync(filePath));
    } else {
      throw new Error(`canonical source contains non-regular resource: ${filePath}`);
    }
    return hash.digest('hex');
  };
  return visit(root);
}

const SOURCE_DIGESTS = new Map(Object.entries(SOURCES).map(([id, skill]) => {
  const source = path.join(ROOT, 'skills', skill);
  assert.strictEqual(fs.realpathSync(source), path.resolve(source), `${id} source must be physical`);
  return [id, fingerprint(source)];
}));

function assertSourcesUnchanged() {
  for (const [id, expected] of SOURCE_DIGESTS) {
    assert.strictEqual(
      fingerprint(path.join(ROOT, 'skills', SOURCES[id])),
      expected,
      `canonical ${id} source changed during fixture execution`,
    );
  }
}

// Explicit classification so a newly packaged script cannot stay unclassified.
// kind: 'cli' is smoke-run (--help / documented start, or remaining-entry fixture).
// kind: 'module' is a library / require()'d internal, not invoked as a CLI.
const CLASSIFICATION = Object.freeze({
  'change-verdict/scripts/check-unrelated-changes.sh': { kind: 'cli', remainingEntry: true },
  'change-verdict/scripts/lib/command-namespace.js': { kind: 'module', reason: 'library under scripts/lib/' },
  'change-verdict/scripts/lib/runner-utils.js': { kind: 'module', reason: 'library under scripts/lib/' },
  'change-verdict/scripts/review-cli.sh': { kind: 'cli', remainingEntry: true },
  // risk-analyze has no --help; isolation has no git so the start path exits 2.
  'change-verdict/scripts/risk-analyze.js': { kind: 'cli', args: ['--help'], expectedStatus: 2 },
  'code-trace/scripts/diagnose/analyze-function-calls.sh': { kind: 'cli', remainingEntry: true },
  'code-trace/scripts/diagnose/check-tools.sh': { kind: 'cli', remainingEntry: true },
  'code-trace/scripts/diagnose/find-polluter.sh': { kind: 'cli', remainingEntry: true },
  'code-trace/scripts/diagnose/generate-flow-diagram.sh': { kind: 'cli', remainingEntry: true },
  'code-trace/scripts/diagnose/search-database-queries.sh': { kind: 'cli', remainingEntry: true },
  'code-trace/scripts/diagnose/trace-data-flow.sh': { kind: 'cli', remainingEntry: true },
  'dhpk-deploy-list/scripts/check-golden.sh': { kind: 'cli', remainingEntry: true },
  'dhpk-deploy-list/scripts/deploy-list.sh': { kind: 'cli', remainingEntry: true },
  'dhpk-feature-verify/scripts/api-exec.sh': { kind: 'cli', remainingEntry: true },
  'dhpk-feature-verify/scripts/health-probe.sh': { kind: 'cli', remainingEntry: true },
  // audit.js has no --help; empty isolated project is not a git repo (exit 2).
  'dhpk-project-audit/scripts/audit.js': { kind: 'cli', args: ['--help'], expectedStatus: 2 },
  'dhpk-project-audit/scripts/lib/command-namespace.js': { kind: 'module', reason: 'library under scripts/lib/' },
  'dhpk-project-audit/scripts/lib/runner-utils.js': { kind: 'module', reason: 'library under scripts/lib/' },
  'dhpk-repo-intake/scripts/intake_cached.js': { kind: 'cli', args: ['--help'], expectedStatus: 2 },
  'dhpk-repo-intake/scripts/lib/runner-utils.js': { kind: 'module', reason: 'library under scripts/lib/' },
  'dhpk-repo-intake/scripts/scan_delta.js': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'dhpk-repo-intake/scripts/scan_repo.js': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'flow-drive/scripts/adapters/run-agy.sh': { kind: 'module', reason: 'flow-drive adapter internal, not a public CLI' },
  'flow-drive/scripts/adapters/run-codex.sh': { kind: 'module', reason: 'flow-drive adapter internal, not a public CLI' },
  'flow-drive/scripts/attempt-executor.js': { kind: 'module', reason: 'require()\'d flow-drive internal' },
  'flow-drive/scripts/dispatch-runtime/build-cli-dispatch-context.js': { kind: 'module', reason: 'flow-drive dispatch-runtime internal' },
  'flow-drive/scripts/dispatch-runtime/cli-role-resolver.js': { kind: 'module', reason: 'flow-drive dispatch-runtime internal' },
  'flow-drive/scripts/dispatch-runtime/launch-cli-dispatch.js': { kind: 'module', reason: 'flow-drive dispatch-runtime internal' },
  'flow-drive/scripts/dispatch-runtime/physical-file.js': { kind: 'module', reason: 'flow-drive dispatch-runtime internal' },
  'flow-drive/scripts/dispatch-runtime/physical-file.py': { kind: 'module', reason: 'flow-drive dispatch-runtime internal' },
  'flow-drive/scripts/dispatch.js': { kind: 'module', reason: 'require()\'d flow-drive internal' },
  'flow-drive/scripts/graph-runner.js': { kind: 'module', reason: 'require()\'d flow-drive internal' },
  // --help is not a change id; parser prints a blocked JSON envelope (exit 2).
  'flow-drive/scripts/invocation.js': { kind: 'cli', args: ['--help'], expectedStatus: 2 },
  'flow-drive/scripts/launch-dispatch.js': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'flow-drive/scripts/provider-permissions.js': { kind: 'module', reason: 'require()\'d flow-drive internal' },
  'flow-drive/scripts/role-intents.js': { kind: 'module', reason: 'require()\'d flow-drive internal' },
  'flow-drive/scripts/run.js': { kind: 'module', reason: 'require()\'d flow-drive orchestrator, not a CLI' },
  'flow-drive/scripts/scope-baseline.js': { kind: 'module', reason: 'require()\'d flow-drive internal' },
  'flow-drive/scripts/target-policy.js': { kind: 'module', reason: 'require()\'d flow-drive internal' },
  'flow-drive/scripts/task-contract.js': { kind: 'module', reason: 'require()\'d flow-drive internal' },
  'flow-drive/scripts/task-graph.js': { kind: 'module', reason: 'require()\'d flow-drive internal' },
  'flow-drive/scripts/transport/prepare-cli-request.py': { kind: 'module', reason: 'flow-drive transport internal' },
  'flow-drive/scripts/transport/run-cli-transport.py': { kind: 'module', reason: 'flow-drive transport internal' },
  'flow-guide/scripts/_lib/command-namespace.js': { kind: 'module', reason: 'library under scripts/_lib/' },
  'flow-guide/scripts/_lib/frontmatter.js': { kind: 'module', reason: 'shared metadata parser under scripts/_lib/' },
  'flow-guide/scripts/_lib/skill-next-map.js': { kind: 'module', reason: 'shared declaration lookup under scripts/_lib/' },
  'flow-guide/scripts/skill-next-actions.js': { kind: 'module', reason: 'analyze.js helper, not a CLI' },
  'flow-guide/scripts/_lib/feature-resolver.js': { kind: 'module', reason: 'library under scripts/_lib/' },
  'flow-guide/scripts/_lib/runner-utils.js': { kind: 'module', reason: 'library under scripts/_lib/' },
  'flow-guide/scripts/_lib/runtime-loader.js': { kind: 'module', reason: 'library under scripts/_lib/' },
  'flow-guide/scripts/_lib/skill-usage.js': { kind: 'module', reason: 'library under scripts/_lib/' },
  // Documented start is the `help` action (not --help).
  'flow-guide/scripts/action-runner.js': { kind: 'cli', args: ['help'], expectedStatus: 0 },
  'flow-guide/scripts/analyze.js': { kind: 'cli', args: ['--help'], expectedStatus: 1 },
  'flow-guide/scripts/openspec_gate_check.py': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'flow-guide/scripts/pre-route.sh': { kind: 'cli', remainingEntry: true },
  'flow-guide/scripts/prepare_dev_scope.py': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'flow-guide/scripts/prepare_workflow_profile.py': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'flow-guide/scripts/route-result.js': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'flow-guide/scripts/usage-card.js': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'flow-guide/scripts/workflow_gate_check.py': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'git-smart-commit/scripts/collect-changes.js': { kind: 'cli', remainingEntry: true },
  'harness-setup/scripts/install-assets.sh': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'harness-setup/scripts/install-codex-project.sh': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'harness-setup/scripts/lib/install-assets-writer.sh': { kind: 'module', reason: 'library under scripts/lib/' },
  'harness-setup/scripts/lib/install-codex-skills.sh': { kind: 'module', reason: 'library under scripts/lib/' },
  'js-static-checks/scripts/status.js': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  // No --help parser; unknown argv asks which Laravel version (exit 2).
  'laravel/scripts/resolve-version.js': { kind: 'cli', args: ['--help'], expectedStatus: 2 },
  'laravel/scripts/version-resolver.js': { kind: 'module', reason: 'require()\'d family resolver, CLI is resolve-version.js' },
  'opsx-apply-resume/scripts/detect-phase.sh': { kind: 'cli', args: [], expectedStatus: 0 },
  'opsx-apply-resume/scripts/extract-compact.sh': { kind: 'cli', args: [], expectedStatus: 1 },
  'opsx-apply-resume/scripts/lib/portable-sed.sh': { kind: 'module', reason: 'library under scripts/lib/' },
  'opsx-apply-resume/scripts/post-obs.sh': { kind: 'cli', args: [], expectedStatus: 1 },
  'opsx-apply-resume/scripts/set-handoff-state.sh': { kind: 'cli', args: [], expectedStatus: 1 },
  'opsx-apply-resume/scripts/write-handoff.sh': { kind: 'cli', args: [], expectedStatus: 2 },
  'phpunit/scripts/resolve-version.js': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'phpunit/scripts/version-resolver.js': { kind: 'module', reason: 'require()\'d family resolver, CLI is resolve-version.js' },
  'precommit/scripts/lib/runner-utils.js': { kind: 'module', reason: 'library under scripts/lib/' },
  'precommit/scripts/precommit-runner.js': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  // Documented usage card is printed on too-few args (exit 2).
  'release-creator/scripts/release-runner.sh': { kind: 'cli', args: ['--help'], expectedStatus: 2 },
  'repo-verify/scripts/lib/runner-utils.js': { kind: 'module', reason: 'library under scripts/lib/' },
  'repo-verify/scripts/verify-runner.js': { kind: 'cli', args: ['--help'], expectedStatus: 0 },
  'swift/scripts/generate_icons.swift': { kind: 'cli', remainingEntry: true },
  'swift/scripts/iconify_gen.sh': { kind: 'cli', remainingEntry: true },
});

test('discovers packaged Skill scripts including remaining-entry paths', () => {
  const discovered = discoverPackagedSkillScripts();
  const keys = discovered.map((row) => row.key);
  assert.ok(keys.length > 0, 'expected packaged skills/*/scripts entries');
  for (const [id, [skillKey, entry]] of Object.entries(EXPECTED_REMAINING_ENTRIES)) {
    const key = `${SOURCES[skillKey]}/${entry}`;
    assert.ok(keys.includes(key), `${id} path ${key} must be discovered`);
  }
});

test('every discovered packaged script is classified', () => {
  const discovered = discoverPackagedSkillScripts().map((row) => row.key).sort();
  const classified = Object.keys(CLASSIFICATION).sort();
  assert.deepStrictEqual(discovered, classified);
  for (const key of classified) {
    const row = CLASSIFICATION[key];
    assert.ok(row.kind === 'cli' || row.kind === 'module', `${key} kind must be cli or module`);
  }
});

test('remaining-entry registry exposes exactly one fixture mapping per public entry', () => {
  assert.deepStrictEqual(Object.keys(FIXTURES).sort(), Object.keys(EXPECTED_REMAINING_ENTRIES).sort());
  for (const [id, [skill, entry]] of Object.entries(EXPECTED_REMAINING_ENTRIES)) {
    const fixture = FIXTURES[id];
    assert.ok(fixture, `missing fixture ${id}`);
    assert.strictEqual(fixture.skill, skill, `${id} Skill mismatch`);
    assert.strictEqual(fixture.entry, entry, `${id} entry must remain Skill-relative`);
    assert.ok(Number.isInteger(fixture.expected.status), `${id} expected status is required`);
    assert.ok(
      (Array.isArray(fixture.expected.output) && fixture.expected.output.length > 0)
      || typeof fixture.expected.stdout === 'string'
      || typeof fixture.expected.stderr === 'string',
      `${id} expected output evidence is required`,
    );
  }
});

for (const id of Object.keys(EXPECTED_REMAINING_ENTRIES)) {
  test(`isolated remaining-entry fixture ${id}`, () => {
    const evidence = runRemainingEntryFixture(id);
    assert.strictEqual(evidence.fixtureId, id);
    assert.strictEqual(evidence.evidenceKind, 'fixture');
    assert.strictEqual(evidence.hostStatus, 'NOT_RUN');
    assertSourcesUnchanged();
  });
}

test('canonical Skill sources remain unchanged after remaining-entry relocations', () => {
  assertSourcesUnchanged();
});

for (const [key, row] of Object.entries(CLASSIFICATION)) {
  if (row.kind !== 'cli' || row.remainingEntry) continue;
  test(`operability smoke ${key}`, () => {
    const slash = key.indexOf('/');
    const skill = key.slice(0, slash);
    const entry = key.slice(slash + 1);
    const source = path.join(SKILLS_ROOT, skill);
    const evidence = withIsolatedSkill({ source }, (context) => {
      const result = context.run(entry, row.args || ['--help']);
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      assert.strictEqual(result.status, row.expectedStatus, `${key} output:\n${output}`);
      assert.ok(output.trim().length > 0, `${key} must print non-empty stdout or stderr`);
      assert.ok(!output.includes(ROOT), `${key} must not leak the ambient checkout path`);
      assert.strictEqual(result.evidenceKind, 'fixture');
      assert.strictEqual(result.hostStatus, 'NOT_RUN');
      return result;
    });
    assert.strictEqual(evidence.evidenceKind, 'fixture');
    assert.strictEqual(evidence.hostStatus, 'NOT_RUN');
  });
}

run('skill-script-operability');
