'use strict';

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateCursorPackage } = require('../scripts/lib/cursor-plugin-package');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));

test('tracked Cursor package exposes physical native components and no symlinks', () => {
  const result = validateCursorPackage({ packageRoot: path.join(ROOT, 'plugins/dhpk-cursor'), inventory: INVENTORY });
  assert.strictEqual(result.ok, true, result.errors.join('\n'));
  assert.strictEqual(result.skippedSkills.length, 0);
});

test('Cursor validator fails closed for an unloadable skill entry', () => {
  const root = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'dhpk-cursor-package-invalid-skill-'));
  try {
    const fs = require('node:fs');
    fs.mkdirSync(require('node:path').join(root, '.cursor-plugin'), { recursive: true });
    fs.mkdirSync(require('node:path').join(root, 'skills', 'broken'), { recursive: true });
    fs.writeFileSync(require('node:path').join(root, '.cursor-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk-cursor', version: '1.0.0', description: 'fixture', skills: './skills/', variables: { type: 'object', properties: {} } }));
    fs.writeFileSync(require('node:path').join(root, '.cursor-plugin', 'marketplace.json'), JSON.stringify({ name: 'test', owner: { name: 'test' }, plugins: [{ name: 'dhpk-cursor', source: '.' }] }));
    const result = validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor' });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((error) => /broken|SKILL\.md|invalid/i.test(error)));
  } finally { require('node:fs').rmSync(root, { recursive: true, force: true }); }
});

test('Cursor validator rejects .md rules and leftover plugin-root interpolation', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-package-native-docs-'));
  const token = '${' + 'CLAUDE_PLUGIN_ROOT}';
  try {
    fs.mkdirSync(path.join(root, '.cursor-plugin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cursor-plugin', 'plugin.json'), JSON.stringify({
      name: 'dhpk-cursor',
      version: '1.0.0',
      description: 'fixture',
      rules: './rules/',
      agents: './agents/',
      variables: { type: 'object', properties: {} },
    }));
    fs.writeFileSync(path.join(root, '.cursor-plugin', 'marketplace.json'), JSON.stringify({
      name: 'test',
      owner: { name: 'test' },
      plugins: [{ name: 'dhpk-cursor', source: '.' }],
    }));
    fs.writeFileSync(path.join(root, 'rules', 'legacy.md'), '---\nname: legacy\ndescription: leftover markdown rule\nalwaysApply: false\n---\n# leftover\n');
    fs.writeFileSync(path.join(root, 'agents', 'dirty.md'), `---\nname: dirty\ndescription: leftover plugin root\nmodel: inherit\nreadonly: true\n---\nLoad ${token}/docs/contracts/x.md\n`);
    const result = validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor' });
    assert.strictEqual(result.ok, false);
    const joined = result.errors.join('\n');
    assert.match(joined, /\.mdc extension/);
    assert.match(joined, /plugin-root interpolation/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Consolidated source suite: validate-cursor-plugin-package.
{

  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');
  const { verifyCursorPackage } = require('../scripts/lib/cursor-plugin-package');

  const ROOT = path.join(__dirname, '..');
  const INVENTORY = JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));

  test('Cursor consumer-runtime verification keeps NOT_CONFIGURED distinct from structural PASS', () => {
    const result = verifyCursorPackage({
      packageRoot: path.join(ROOT, 'plugins/dhpk-cursor'),
      inventory: INVENTORY,
      stage: 'consumer-runtime',
      observedAt: '2026-08-13T00:00:00.000Z',
    });
    assert.strictEqual(result.ok, true, result.error && result.error.message);
    assert.strictEqual(result.structural.ok, true);
    assert.strictEqual(result.evidence.stage, 'consumer-runtime');
    assert.strictEqual(result.evidence.verdict, 'NOT_CONFIGURED');
    assert.strictEqual(result.evidence.planFingerprint, JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'plugins/dhpk-cursor', 'provenance.json'), 'utf8')).planFingerprint);
    assert.notStrictEqual(result.evidence.planFingerprint, JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'plugins/dhpk-cursor', 'provenance.json'), 'utf8')).inventoryDigest);
    assert.strictEqual(result.evidence.observedAt, '2026-08-13T00:00:00.000Z');
    assert.ok(result.evidence.claims.includes('Cursor consumer configuration'));
  });

  test('Cursor consumer adapter can report UNAVAILABLE without upgrading to PASS', () => {
    const result = verifyCursorPackage({
      packageRoot: path.join(ROOT, 'plugins/dhpk-cursor'),
      inventory: INVENTORY,
      stage: 'consumer-runtime',
      observedAt: '2026-08-13T00:00:00.000Z',
      consumerAdapter: {
        identity: { id: 'cursor-cli', version: 'missing' },
        verify: () => ({ verdict: 'UNAVAILABLE', diagnostics: ['Cursor client tooling is unavailable'] }),
      },
    });
    assert.strictEqual(result.ok, true, result.error && result.error.message);
    assert.strictEqual(result.evidence.verdict, 'UNAVAILABLE');
    assert.deepStrictEqual(result.evidence.diagnostics, ['Cursor client tooling is unavailable']);
  });

  test('Cursor package validator reports structural PASS and consumer NOT_RUN separately', () => {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'validate-cursor-plugin-package.js'),
      path.join(ROOT, 'plugins', 'dhpk-cursor'),
    ], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.structural, 'PASS');
    assert.strictEqual(report.consumer.status, 'NOT_RUN');
    assert.strictEqual(report.provenance, 'PASS');
  });

  test('Cursor package validator reports invalid provenance as FAIL independently of structural PASS', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-cursor-provenance-'));
    const packageRoot = path.join(temporaryRoot, 'plugins', 'dhpk-cursor');
    fs.cpSync(path.join(ROOT, 'plugins', 'dhpk-cursor'), packageRoot, { recursive: true });

    try {
      const provenancePath = path.join(packageRoot, 'provenance.json');
      const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
      provenance.schema = 'invalid-schema';
      fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

      const result = spawnSync(process.execPath, [
        path.join(ROOT, 'scripts', 'ci', 'validate-cursor-plugin-package.js'),
        '--package-root', packageRoot,
        '--repo-root', ROOT,
      ], { encoding: 'utf8' });
      assert.strictEqual(result.status, 1, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.structural, 'PASS');
      assert.strictEqual(report.provenance, 'FAIL');
      assert.strictEqual(report.consumer.status, 'NOT_RUN');
      assert.ok(report.errors.some((error) => /provenance schema must be/i.test(error)), report.errors.join('\n'));
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
}


// Consolidated source suite: cursor-consumer-evidence.
{

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const {
    DIRECT_SHAPE,
    NATIVE_LINK_SHAPE,
    classifyCursorConsumerEvidence,
    classifyCodexConsumerEvidence,
    loadCursorConsumerEvidence,
  } = require('../scripts/lib/cursor-consumer-evidence');

  function passRecord(overrides = {}) {
    return {
      stage: 'CONSUMER',
      producer: 'consumer-platform-probe',
      adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
      surfaceResults: [{
        surface: 'cursor-project',
        status: 'PASS',
        adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
        commands: [{ cmd: 'node scripts/release/consumer-platform-probe.js --platform cursor-project', exitCode: 0 }],
        environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
        artifacts: [],
        diagnostics: [],
        reasons: ['bounded Cursor project probe PASS'],
        checkedClaims: ['project-artifact-structure', 'cursor-project-discovery', 'consumer-route'],
        ...overrides.surface,
      }],
      ...overrides.envelope,
    };
  }

  test('missing probe record selects native-link and says the record is missing', () => {
    const result = classifyCursorConsumerEvidence(null);
    assert.strictEqual(result.bindingShape, NATIVE_LINK_SHAPE);
    assert.match(result.reason, /missing/i);
  });

  test('PASS discovery probe record selects direct', () => {
    const result = classifyCursorConsumerEvidence(passRecord());
    assert.strictEqual(result.bindingShape, DIRECT_SHAPE);
    assert.match(result.reason, /PASS/i);
  });

  test('FAIL discovery probe record selects native-link', () => {
    const result = classifyCursorConsumerEvidence(passRecord({ surface: { status: 'FAIL', reasons: ['probe failed'] } }));
    assert.strictEqual(result.bindingShape, NATIVE_LINK_SHAPE);
    assert.match(result.reason, /fail/i);
  });

  test('a stage-less PASS payload is not discovery evidence', () => {
    const result = classifyCursorConsumerEvidence({
      surfaceResults: [{
        surface: 'cursor-project',
        status: 'PASS',
        adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
        commands: [],
        environment: { CI: 'true' },
        artifacts: [],
        diagnostics: [],
        reasons: ['unlabeled PASS'],
        checkedClaims: ['project-artifact-structure', 'cursor-project-discovery', 'consumer-route'],
      }],
    });
    assert.strictEqual(result.bindingShape, NATIVE_LINK_SHAPE);
    assert.match(result.reason, /not a PASS/i);
  });

  test('cursor-sync installer PASS is not discovery evidence', () => {
    const result = classifyCursorConsumerEvidence(passRecord({
      envelope: { adapter: { id: 'cursor-sync-installer', version: '1.0.0' } },
      surface: {
        surface: 'cursor-sync',
        adapter: { id: 'cursor-sync-installer', version: '1.0.0' },
        checkedClaims: ['package-manifest', 'consumer-route'],
      },
    }));
    assert.strictEqual(result.bindingShape, NATIVE_LINK_SHAPE);
    assert.match(result.reason, /not a PASS|discovery/i);
  });

  test('wrong envelope producer is not Cursor discovery evidence', () => {
    const result = classifyCursorConsumerEvidence(passRecord({
      envelope: { producer: 'other-probe' },
    }));
    assert.strictEqual(result.bindingShape, NATIVE_LINK_SHAPE);
  });

  test('wrong envelope adapter is not Cursor discovery evidence', () => {
    const result = classifyCursorConsumerEvidence(passRecord({
      envelope: { adapter: { id: 'other-adapter', version: '1.0.0' } },
    }));
    assert.strictEqual(result.bindingShape, NATIVE_LINK_SHAPE);
  });

  test('missing checked claims are not Cursor discovery evidence', () => {
    const result = classifyCursorConsumerEvidence(passRecord({
      surface: { checkedClaims: ['project-artifact-structure', 'consumer-route'] },
    }));
    assert.strictEqual(result.bindingShape, NATIVE_LINK_SHAPE);
  });

  test('duplicate checked claims are not Cursor discovery evidence', () => {
    const result = classifyCursorConsumerEvidence(passRecord({
      surface: {
        checkedClaims: [
          'project-artifact-structure',
          'cursor-project-discovery',
          'consumer-route',
          'consumer-route',
        ],
      },
    }));
    assert.strictEqual(result.bindingShape, NATIVE_LINK_SHAPE);
  });

  test('loadCursorConsumerEvidence reads a regular fixture file and ignores a static tree', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-evidence-'));
    try {
      const file = path.join(dir, 'probe.json');
      fs.writeFileSync(file, `${JSON.stringify(passRecord())}\n`);
      const loaded = loadCursorConsumerEvidence({ consumerEvidencePath: file });
      assert.strictEqual(loaded.stage, 'CONSUMER');
      const symlink = path.join(dir, 'probe-link.json');
      fs.symlinkSync(file, symlink, 'file');
      assert.throws(
        () => loadCursorConsumerEvidence({ consumerEvidencePath: symlink }),
        /regular file/,
      );
      assert.strictEqual(loadCursorConsumerEvidence({ env: {} }), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Codex PASS discovery probe record selects direct; Cursor PASS is not Codex evidence', () => {
    const result = classifyCodexConsumerEvidence({
      stage: 'CONSUMER',
      producer: 'consumer-platform-probe',
      adapter: { id: 'codex-project-discovery', version: '1.0.0' },
      surfaceResults: [{
        surface: 'codex-project',
        status: 'PASS',
        adapter: { id: 'codex-project-discovery', version: '1.0.0' },
        commands: [],
        environment: { CI: 'true' },
        artifacts: [],
        diagnostics: [],
        reasons: ['bounded Codex project probe PASS'],
        checkedClaims: ['project-artifact-structure', 'codex-project-discovery', 'consumer-route'],
      }],
    });
    assert.strictEqual(result.bindingShape, DIRECT_SHAPE);
    const cursorPass = classifyCodexConsumerEvidence(passRecord());
    assert.strictEqual(cursorPass.bindingShape, NATIVE_LINK_SHAPE);
  });
}


// Consolidated source suite: cursor-harness-adapt.
{

  const { test, assert } = require('./_lib/tinytest');
  const {
    cursorAgentModel,
    cursorDocumentDestinationName,
    rewriteCursorHarnessBody,
    rewriteCursorSupportingAssetBody,
    retainsClaudePluginRoot,
    retainsCodexSupportRoot,
  } = require('../scripts/lib/cursor-harness-adapt');
  const { adaptSkill } = require('../scripts/lib/cursor-plugin-package');

  const PLUGIN_ROOT_TOKEN = '${' + 'CLAUDE_PLUGIN_ROOT}';

  test('cursorAgentModel maps doc roles to Composer and every other role to Grok', () => {
    assert.strictEqual(cursorAgentModel('doc-reviewer.md'), 'composer-2.5-fast');
    assert.strictEqual(cursorAgentModel('docs-lookup'), 'composer-2.5-fast');
    assert.strictEqual(cursorAgentModel('doc-updater.md'), 'composer-2.5-fast');
    assert.strictEqual(cursorAgentModel('code-reviewer.md'), 'cursor-grok-4.6-high');
    assert.strictEqual(cursorAgentModel('fast-worker'), 'cursor-grok-4.6-high');
  });

  test('cursorDocumentDestinationName only rewrites rules to .mdc', () => {
    assert.strictEqual(cursorDocumentDestinationName('rules', 'prefer-const.md'), 'prefer-const.mdc');
    assert.strictEqual(cursorDocumentDestinationName('agents', 'reviewer.md'), 'reviewer.md');
    assert.strictEqual(cursorDocumentDestinationName('commands', 'review.md'), 'review.md');
  });

  test('rewriteCursorHarnessBody maps plugin-root paths onto the Cursor tree', () => {
    const rewritten = rewriteCursorHarnessBody([
      'Load ' + PLUGIN_ROOT_TOKEN + '/agent-traps/_common/prompt-defense.md',
      'Policy ' + PLUGIN_ROOT_TOKEN + '/rules/execution-policy.md',
      'Economics ' + PLUGIN_ROOT_TOKEN + '/rules/model-economics.md',
      'Peer ' + PLUGIN_ROOT_TOKEN + '/agents/reviewer.md',
      'Contracts ' + PLUGIN_ROOT_TOKEN + '/docs/contracts/output.md',
      'Bare leftover ' + PLUGIN_ROOT_TOKEN,
    ].join('\n'));
    assert.match(rewritten, /\.cursor\/dhpk\/agent-traps\/_common\/prompt-defense\.md/);
    assert.match(rewritten, /\.cursor\/dhpk\/policies\/execution-policy\.md/);
    assert.match(rewritten, /\.cursor\/rules\/model-economics\.mdc/);
    assert.match(rewritten, /\.cursor\/agents\/reviewer\.md/);
    assert.match(rewritten, /\.cursor\/dhpk\/contracts\/output\.md/);
    assert.match(rewritten, /Bare leftover \.cursor\/dhpk/);
    assert.ok(!rewritten.includes(PLUGIN_ROOT_TOKEN));
  });

  test('rewriteCursorHarnessBody preserves transport invocations with the bound Cursor package root', () => {
    const rewritten = rewriteCursorHarnessBody(
      'bash "' + PLUGIN_ROOT_TOKEN + '/skills/dhpk-codex-bridge/scripts/run-codex.sh" read-only /work prompt.txt',
    );
    assert.match(rewritten, /bash "\$\{CURSOR_PLUGIN_ROOT\}\/skills\/dhpk-codex-bridge\/scripts\/run-codex\.sh"/);
    assert.ok(!rewritten.includes(PLUGIN_ROOT_TOKEN));
  });

  test('Cursor skill adaptation rewrites transport wrapper roots and rejects leftovers', () => {
    const adapted = adaptSkill([
      '---',
      'name: dhpk-codex-bridge',
      'description: Bridge',
      '---',
      'bash "' + PLUGIN_ROOT_TOKEN + '/skills/dhpk-codex-bridge/scripts/run-codex.sh" read-only /work prompt.txt',
    ].join('\n'), 'dhpk-codex-bridge');
    assert.strictEqual(adapted.ok, true, adapted.reason);
    assert.ok(adapted.content.includes('${CURSOR_PLUGIN_ROOT}/skills/dhpk-codex-bridge/scripts/run-codex.sh'));
    assert.ok(!retainsClaudePluginRoot(adapted.content));
  });

  test('rewriteCursorSupportingAssetBody rewrites Codex support roots', () => {
    const rewritten = rewriteCursorSupportingAssetBody(
      'Read .codex/dhpk/agent-traps/_common/loader.md and ' +
        'write .codex/artifacts/sessions/partial.json and ' +
        PLUGIN_ROOT_TOKEN + '/manifests/x.json',
    );
    assert.match(rewritten, /\.cursor\/dhpk\/agent-traps\/_common\/loader\.md/);
    assert.match(rewritten, /\.cursor\/artifacts\/sessions\/partial\.json/);
    assert.match(rewritten, /\.cursor\/dhpk\/manifests\/x\.json/);
    assert.ok(!rewritten.includes('.codex/dhpk'));
    assert.ok(!rewritten.includes('.codex/artifacts'));
    assert.ok(!rewritten.includes(PLUGIN_ROOT_TOKEN));
  });

  test('retention helpers detect leftover Claude and Codex roots', () => {
    assert.strictEqual(retainsClaudePluginRoot('ok .cursor/dhpk'), false);
    assert.strictEqual(retainsClaudePluginRoot('Load ' + PLUGIN_ROOT_TOKEN + '/rules/x.md'), true);
    assert.strictEqual(retainsCodexSupportRoot('ok .cursor/dhpk'), false);
    assert.strictEqual(retainsCodexSupportRoot('Read .codex/dhpk/policies/x.md'), true);
  });
}


// Consolidated source suite: cursor-session-home.
{

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const {
    cloneCursorSessionFiles,
    createCursorSessionHome,
  } = require('../scripts/lib/cursor-session-home');

  function tempRoot(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  test('clones only allowlisted Cursor session files with private permissions', () => {
    const hostHome = tempRoot('dhpk-cursor-session-host-');
    const probeHome = tempRoot('dhpk-cursor-session-probe-');
    try {
      fs.mkdirSync(path.join(hostHome, '.config', 'cursor'), { recursive: true });
      fs.mkdirSync(path.join(hostHome, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(hostHome, '.config', 'cursor', 'auth.json'), '{"accessToken":"fixture"}\n', { mode: 0o644 });
      fs.writeFileSync(path.join(hostHome, '.cursor', 'cli-config.json'), '{"profile":"fixture"}\n', { mode: 0o644 });
      fs.writeFileSync(path.join(hostHome, '.config', 'cursor', 'unlisted.json'), '{}\n', { mode: 0o644 });

      const result = cloneCursorSessionFiles({ hostHome, probeHome });
      const expectedPaths = ['.config/cursor/auth.json', '.cursor/cli-config.json'];
      assert.deepStrictEqual(result.copiedFiles, expectedPaths);
      for (const relative of expectedPaths) {
        const source = path.join(hostHome, relative);
        const destination = path.join(probeHome, relative);
        assert.deepStrictEqual(fs.readFileSync(destination), fs.readFileSync(source));
        assert.strictEqual(fs.statSync(destination).mode & 0o777, 0o600);
      }
      assert.strictEqual(fs.existsSync(path.join(probeHome, '.config', 'cursor', 'unlisted.json')), false);
    } finally {
      fs.rmSync(hostHome, { recursive: true, force: true });
      fs.rmSync(probeHome, { recursive: true, force: true });
    }
  });

  test('skips symlinked session ancestors and rejects non-absolute probe homes', () => {
    const hostHome = tempRoot('dhpk-cursor-session-symlink-host-');
    const outside = tempRoot('dhpk-cursor-session-symlink-outside-');
    const probeHome = tempRoot('dhpk-cursor-session-symlink-probe-');
    try {
      fs.mkdirSync(path.join(outside, 'cursor'), { recursive: true });
      fs.writeFileSync(path.join(outside, 'cursor', 'auth.json'), '{"token":"outside"}\n');
      fs.symlinkSync(outside, path.join(hostHome, '.config'), 'dir');
      assert.deepStrictEqual(cloneCursorSessionFiles({ hostHome, probeHome }).copiedFiles, []);
      assert.strictEqual(fs.existsSync(path.join(probeHome, '.config', 'cursor', 'auth.json')), false);
      assert.throws(() => cloneCursorSessionFiles({ hostHome, probeHome: 'relative-home' }), /absolute path/);
    } finally {
      fs.rmSync(hostHome, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(probeHome, { recursive: true, force: true });
    }
  });

  test('createCursorSessionHome always provides cleanup for the disposable profile', () => {
    const hostHome = tempRoot('dhpk-cursor-session-cleanup-host-');
    const session = createCursorSessionHome({ hostHome });
    try {
      assert.ok(path.isAbsolute(session.home));
      assert.ok(fs.existsSync(session.home));
      assert.deepStrictEqual(session.copiedFiles, []);
    } finally {
      session.cleanup();
    }
    assert.strictEqual(fs.existsSync(session.home), false);
    fs.rmSync(hostHome, { recursive: true, force: true });
  });
}


run('cursor-plugin-package');
