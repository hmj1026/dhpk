'use strict';

// RED contracts for the relocated setup Skills.  Every executable case runs a
// physical Skill copy against a disposable consumer project and an explicit
// fixture distribution.  The suite never executes a repository installer,
// performs a Host workflow, or uses a real network/provider.
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const {
  getOrCreateHostKey,
  hostInitArgs,
} = require('./_lib/review-gate-host-attestation-fixture');
const {
  SOURCES,
  RESERVED_ENV,
  AUTO_DETECTED_PLACEHOLDERS,
  ECOSYSTEM_TAGS,
  outputOf,
  fileSnapshot,
  fingerprint,
  assertFixtureEvidence,
  assertSuccess,
  makeHooksArtifact,
  makeCodexArtifact,
  makeLookalikeDistribution,
  registerSetupFixtures,
} = require('./_lib/skill-setup-family-fixtures');

const FIXTURES = registerSetupFixtures();
const WORK_REQUEST_PATH = path.join(
  __dirname,
  'fixtures',
  'review-gate',
  'runtime-work-request-v1.json',
);

function hostileEnvironment() {
  return Object.fromEntries(RESERVED_ENV.map((name) => [name, '/hostile/setup-root']));
}

function isolated(skill, callback) {
  const source = SOURCES[skill];
  const before = fingerprint(source);
  try {
    return withIsolatedSkill({
      source,
      env: hostileEnvironment(),
      stubs: {
        // The isolation helper already denies these tools.  Keep the explicit
        // fixture stubs for the Codex path so no real provider probe can run.
        codex: { status: 127, stderr: 'HOST_NOT_RUN: codex fixture unavailable\n' },
        curl: { status: 127, stderr: 'HOST_NOT_RUN: curl fixture unavailable\n' },
        wget: { status: 127, stderr: 'HOST_NOT_RUN: wget fixture unavailable\n' },
      },
    }, (context) => {
      assert.ok(context.skillDir.includes(' '), 'relocated Skill path must contain spaces');
      assert.notStrictEqual(context.skillDir, source);
      assert.notStrictEqual(context.projectDir, source);
      for (const name of RESERVED_ENV) {
        assert.strictEqual(context.env[name], undefined, `${name} must be scrubbed`);
      }
      const value = callback(context);
      if (value && value.result) assertFixtureEvidence(value.result);
      return value;
    });
  } finally {
    assert.strictEqual(fingerprint(source), before, `canonical ${skill} Skill changed during fixture execution`);
  }
}

function runEntry(context, entry, args, options = {}) {
  return context.run(entry, args, { ...options, timeout: 20000 });
}

function assertNonPass(result, fragments = []) {
  assert.notStrictEqual(result.status, 0, outputOf(result));
  assertFixtureEvidence(result);
  const output = outputOf(result);
  for (const fragment of fragments) assert.match(output, fragment, output);
}

function assertHookInstall(result, artifact, target) {
  assertSuccess(result);
  const output = outputOf(result);
  assert.match(output, /status["']?\s*:\s*["']?PASS/i, output);
  assert.match(output, /code["']?\s*:\s*["']?OK/i, output);
  assert.strictEqual(
    fs.readFileSync(path.join(target, 'hooks', 'hooks.json'), 'utf8'),
    artifact.hookBytes.toString('utf8'),
  );
  const hook = path.join(target, 'scripts', 'hooks', 'fixture-hook.sh');
  assert.strictEqual(fs.readFileSync(hook, 'utf8'), fs.readFileSync(artifact.hookScript, 'utf8'));
  assert.ok((fs.statSync(hook).mode & 0o100) !== 0, 'copied hook must retain executable mode');
}

test('setup-family fixture registry exposes stable public entries', () => {
  assert.deepStrictEqual(Object.keys(FIXTURES).sort(), [
    'setup-codex-local-wrapper-valid-artifact',
    'setup-codex-pinned-artifact-root',
    'setup-harness-explicit-artifact-required',
    'setup-harness-explicit-hooks-success',
    'setup-harness-invalid-artifact-no-mutation',
    'setup-harness-missing-local-writer',
    'setup-harness-review-gate-local-closure',
    'setup-project-explicit-artifact-required',
    'setup-project-explicit-hooks-success',
    'setup-project-missing-local-writer',
  ]);
  for (const fixture of Object.values(FIXTURES)) {
    assert.ok(fixture.entry.startsWith('scripts/'), fixture.id);
    assert.strictEqual(fixture.evidenceKind, 'fixture', fixture.id);
    assert.ok(Number.isSafeInteger(fixture.expected.status), fixture.id);
    assert.ok(Array.isArray(fixture.expected.output) && fixture.expected.output.length > 0, fixture.id);
    assert.ok(fixture.expected.output.every((fragment) => typeof fragment === 'string' && fragment.length > 0), fixture.id);
  }
});

test('relocated harness setup installs hooks from an explicit artifact without an artifact installer', () => {
  isolated('harness', (context) => {
    const marker = path.join(context.projectDir, 'artifact-installer-ran');
    const artifact = makeHooksArtifact(context.projectDir, { marker, includeInstaller: false });
    const parentLookalike = makeLookalikeDistribution(
      path.join(path.dirname(context.skillDir), 'hostile parent'),
      marker,
    );
    const siblingLookalike = makeLookalikeDistribution(
      path.join(context.projectDir, 'hostile sibling'),
      marker,
    );
    assert.ok(!fs.existsSync(path.join(artifact.artifact, 'scripts', 'setup', 'install-assets.sh')));
    assert.ok(fs.existsSync(path.join(parentLookalike.artifact, 'scripts', 'setup', 'install-assets.sh')));
    assert.ok(fs.existsSync(path.join(siblingLookalike.artifact, 'scripts', 'setup', 'install-assets.sh')));

    const target = path.join(context.projectDir, 'consumer target');
    const result = runEntry(context, FIXTURES['setup-harness-explicit-hooks-success'].entry, [
      '--source-artifact', artifact.artifact,
      '--target', target,
      '--install', 'hooks',
    ]);
    assertHookInstall(result, artifact, target);
    assert.strictEqual(fs.existsSync(marker), false, 'no artifact/parent/sibling installer canary may run');
    return { result };
  });
});

test('harness setup fails before mutation when its local writer is absent and cannot use artifact or parent canaries', () => {
  isolated('harness', (context) => {
    const marker = path.join(context.projectDir, 'missing-writer-canary-ran');
    const artifact = makeHooksArtifact(context.projectDir, { marker, includeInstaller: true });
    const writer = path.join(context.skillDir, 'scripts', 'lib', 'install-assets-writer.sh');
    fs.rmSync(writer, { force: true });
    const target = path.join(context.projectDir, 'consumer target');
    const before = fileSnapshot(target);
    const result = runEntry(context, FIXTURES['setup-harness-missing-local-writer'].entry, [
      '--source-artifact', artifact.artifact,
      '--target', target,
      '--install', 'hooks',
    ]);
    assertNonPass(result, [/BLOCKED_RESOURCE_MISSING/i]);
    assert.deepStrictEqual(fileSnapshot(target), before, 'missing local writer must fail before target mutation');
    assert.strictEqual(fs.existsSync(marker), false, 'artifact installer canary must not run');
    return { result };
  });
});

test('harness setup requires an explicit artifact even when an ambient lookalike exists above the relocated Skill', () => {
  isolated('harness', (context) => {
    const marker = path.join(context.projectDir, 'ambient-installer-ran');
    const ambient = makeLookalikeDistribution(
      path.join(path.dirname(context.skillDir), 'ambient distribution'),
      marker,
    );
    const target = path.join(context.projectDir, 'consumer target');
    const result = runEntry(context, FIXTURES['setup-harness-explicit-artifact-required'].entry, [
      '--target', target,
      '--install', 'hooks',
    ]);
    assertNonPass(result, [/SOURCE_ARTIFACT_REQUIRED/i]);
    assert.strictEqual(fileSnapshot(target), null, 'required artifact failure must not create a target');
    assert.strictEqual(fs.existsSync(marker), false, 'ambient installer canary must not run');
    assert.doesNotMatch(outputOf(result), /ambient distribution|ambient-installer-ran/i);
    assert.ok(fs.existsSync(path.join(ambient.artifact, 'hooks', 'hooks.json')));
    return { result };
  });
});

test('harness setup rejects an explicit artifact missing the selected payload before mutation', () => {
  isolated('harness', (context) => {
    const marker = path.join(context.projectDir, 'invalid-artifact-installer-ran');
    const artifact = makeHooksArtifact(context.projectDir, {
      marker,
      includeInstaller: true,
      valid: false,
    });
    const target = path.join(context.projectDir, 'consumer target');
    const result = runEntry(context, FIXTURES['setup-harness-invalid-artifact-no-mutation'].entry, [
      '--source-artifact', artifact.artifact,
      '--target', target,
      '--install', 'hooks',
    ]);
    assertNonPass(result, [/SOURCE_ARTIFACT_INVALID|WRITER_FAILED|missing source asset|hooks\.json/i]);
    assert.strictEqual(fileSnapshot(target), null, 'invalid artifact must fail before target mutation');
    assert.strictEqual(fs.existsSync(marker), false, 'artifact installer canary must not run');
    return { result };
  });
});

test('relocated Codex setup executes its Skill-local installer copy and ignores the artifact installer', () => {
  isolated('harness', (context) => {
    const marker = path.join(context.projectDir, 'codex-artifact-installer-ran');
    const artifact = makeCodexArtifact(context.projectDir, { marker });
    fs.mkdirSync(path.join(context.projectDir, '.git'));
    const result = runEntry(context, FIXTURES['setup-codex-local-wrapper-valid-artifact'].entry, [
      '--source-artifact', artifact.artifact,
      '--copy', '--force',
    ]);
    assertSuccess(result);
    assert.strictEqual(
      fs.readFileSync(path.join(context.projectDir, '.codex', 'config.toml.example'), 'utf8'),
      artifact.configBytes.toString('utf8'),
    );
    assert.strictEqual(fs.existsSync(marker), false, 'artifact Codex installer canary must never run');
    return { result };
  });
});

test('relocated Codex setup pins source roots to the artifact and rejects a Skill-root escape before mutation', () => {
  isolated('harness', (context) => {
    const marker = path.join(context.projectDir, 'codex-escape-canary-ran');
    const artifact = makeCodexArtifact(context.projectDir, {
      marker,
      escapeRoot: context.skillDir,
    });
    fs.mkdirSync(path.join(context.projectDir, '.git'));
    const target = path.join(context.projectDir, '.codex');
    const before = fileSnapshot(target);
    const result = runEntry(context, FIXTURES['setup-codex-pinned-artifact-root'].entry, [
      '--source-artifact', artifact.artifact,
      '--copy', '--force',
    ]);
    assertNonPass(result, [/escapes|outside|pinned|plugin root|artifact root|source root/i]);
    assert.deepStrictEqual(fileSnapshot(target), before, 'source escape must be rejected before target mutation');
    assert.strictEqual(fs.existsSync(marker), false, 'artifact Codex installer canary must never run');
    return { result };
  });
});

test('relocated harness Review Gate closure supports trusted init and status in a temporary project', () => {
  isolated('harness', (context) => {
    const host = getOrCreateHostKey(context.projectDir, 'setup-family-review-gate');
    const initialized = runEntry(
      context,
      FIXTURES['setup-harness-review-gate-local-closure'].entry,
      [...hostInitArgs(host), '--repo-root', context.projectDir],
    );
    assertSuccess(initialized);
    const initOutput = JSON.parse(initialized.stdout);
    assert.strictEqual(initOutput.schema, 'dhpk.review-gate.runtime.v1');
    assert.ok(['INITIALIZED', 'ALREADY_INITIALIZED'].includes(initOutput.status));

    const prepared = runEntry(
      context,
      FIXTURES['setup-harness-review-gate-local-closure'].entry,
      ['prepare', '--repo-root', context.projectDir],
      { input: fs.readFileSync(WORK_REQUEST_PATH) },
    );
    assertSuccess(prepared);
    const preparedOutput = JSON.parse(prepared.stdout);
    assert.strictEqual(preparedOutput.status, 'PREPARED');
    assert.match(preparedOutput.workId, /^work-[a-f0-9]{64}$/);

    const status = runEntry(context, FIXTURES['setup-harness-review-gate-local-closure'].entry, [
      'status',
      '--work-id', preparedOutput.workId,
      '--repo-root', context.projectDir,
    ]);
    assertSuccess(status);
    const statusOutput = JSON.parse(status.stdout);
    assert.strictEqual(statusOutput.schema, 'dhpk.review-gate.runtime.v1');
    assert.strictEqual(statusOutput.command, 'status');
    assert.strictEqual(statusOutput.status, 'PENDING');
    assert.deepStrictEqual(statusOutput.receiptSummary, { total: 0, byKind: {} });
    assert.strictEqual(fs.existsSync(path.join(context.projectDir, '.dhpk', 'review-gate', 'v1', 'config.json')), true);
    return { result: status };
  });
});

test('relocated project setup installs selected hooks through its own adapter and explicit artifact', () => {
  isolated('project', (context) => {
    const marker = path.join(context.projectDir, 'project-artifact-installer-ran');
    const artifact = makeHooksArtifact(context.projectDir, { marker, includeInstaller: false });
    const target = path.join(context.projectDir, 'project consumer target');
    const result = runEntry(context, FIXTURES['setup-project-explicit-hooks-success'].entry, [
      '--source-artifact', artifact.artifact,
      '--target', target,
      '--install', 'hooks',
    ]);
    assertHookInstall(result, artifact, target);
    assert.strictEqual(fs.existsSync(marker), false, 'artifact installer canary must not run');
    return { result };
  });
});

test('project setup requires an explicit artifact and does not consult an ambient lookalike', () => {
  isolated('project', (context) => {
    const marker = path.join(context.projectDir, 'project-ambient-installer-ran');
    const ambient = makeLookalikeDistribution(
      path.join(path.dirname(context.skillDir), 'project ambient distribution'),
      marker,
    );
    const target = path.join(context.projectDir, 'project consumer target');
    const result = runEntry(context, FIXTURES['setup-project-explicit-artifact-required'].entry, [
      '--target', target,
      '--install', 'hooks',
    ]);
    assertNonPass(result, [/SOURCE_ARTIFACT_REQUIRED/i]);
    assert.strictEqual(fileSnapshot(target), null, 'required artifact failure must not create a target');
    assert.strictEqual(fs.existsSync(marker), false, 'ambient installer canary must not run');
    assert.ok(fs.existsSync(path.join(ambient.artifact, 'hooks', 'hooks.json')));
    return { result };
  });
});

test('project setup reports a missing local writer before target mutation', () => {
  isolated('project', (context) => {
    const marker = path.join(context.projectDir, 'project-missing-writer-canary-ran');
    const artifact = makeHooksArtifact(context.projectDir, { marker, includeInstaller: true });
    fs.rmSync(path.join(context.skillDir, 'scripts', 'lib', 'install-assets-writer.sh'), { force: true });
    const target = path.join(context.projectDir, 'project consumer target');
    const before = fileSnapshot(target);
    const result = runEntry(context, FIXTURES['setup-project-missing-local-writer'].entry, [
      '--source-artifact', artifact.artifact,
      '--target', target,
      '--install', 'hooks',
    ]);
    assertNonPass(result, [/BLOCKED_RESOURCE_MISSING/i]);
    assert.deepStrictEqual(fileSnapshot(target), before, 'missing local writer must fail before target mutation');
    assert.strictEqual(fs.existsSync(marker), false, 'artifact installer canary must not run');
    return { result };
  });
});

test('relocated project setup keeps Host procedure resources local and declares the non-pass capability boundary', () => {
  isolated('project', (context) => {
    const skill = fs.readFileSync(path.join(context.skillDir, 'SKILL.md'), 'utf8');
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, 'project setup frontmatter is required');
    for (const tool of ['Read', 'Glob', 'AskUserQuestion', 'Edit', 'Write']) {
      assert.match(frontmatter[1], new RegExp(`\\b${tool}\\b`), `missing declared tool ${tool}`);
    }

    const template = fs.readFileSync(path.join(context.skillDir, 'templates', 'CLAUDE.md'), 'utf8');
    const settingsTemplate = fs.readFileSync(
      path.join(context.skillDir, 'templates', 'claude-settings-hooks.json'),
      'utf8',
    );
    assert.ok(settingsTemplate.trim().startsWith('{'), 'settings template must be JSON-shaped');
    for (const placeholder of AUTO_DETECTED_PLACEHOLDERS) {
      assert.ok(template.includes(placeholder), `first-install template is missing ${placeholder}`);
    }
    for (const tag of ECOSYSTEM_TAGS) {
      assert.ok(template.includes(`<!-- block:${tag} -->`), `template is missing ${tag} block marker`);
      assert.ok(template.includes('<!-- /block -->'), 'template is missing ecosystem block closing marker');
    }

    const body = skill.replace(/^---\n[\s\S]*?\n---\n/, '');
    assert.match(body, /templates\/CLAUDE\.md/);
    assert.match(body, /templates\/claude-settings-hooks\.json/);
    assert.match(body, /references\//);
    assert.match(body, /scripts\/install-project-assets\.sh/);
    assert.doesNotMatch(body, /docs\/(?:hook-extension|docker-setup)\.md|scripts\/install\.sh|node_modules|plugin cache|walk(?:ing)? parents/i);
    assert.match(body, /AskUserQuestion[\s\S]*(?:confirmation|confirm)[\s\S]*(?:before|prior to)[\s\S]*(?:write|Edit)/i);
    assert.match(body, /HOST_CAPABILITY_UNAVAILABLE/);
    assert.match(body, /\b(?:BLOCKED|UNAVAILABLE)\b/);
    assert.match(body, /\b(?:AskUserQuestion|project edit\/write|edit\/write)\b/);
    assert.match(body, /NOT_RUN/);
    assert.doesNotMatch(body, /--host\b/);
    return { result: { evidenceKind: 'fixture', hostStatus: 'NOT_RUN' } };
  });
});

test('setup asset adapters are one manifest-synchronized source that names itself', () => {
  const ROOT = path.join(__dirname, '..');
  const { spawnSync } = require('node:child_process');
  const canonical = 'skills/harness-setup/scripts/install-assets.sh';
  const adapters = {
    'harness-setup/install-assets': canonical,
    'dhpk-project-setup/install-project-assets': 'skills/dhpk-project-setup/scripts/install-project-assets.sh',
  };
  const bytes = Object.values(adapters).map(rel => fs.readFileSync(path.join(ROOT, rel)));
  assert.ok(bytes[0].equals(bytes[1]), 'adapters must be byte-identical copies of one source');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'skill-resources.json'), 'utf8'));
  const projectEntries = manifest.skills['project-setup'] || [];
  assert.ok(
    projectEntries.some(entry => entry.source === canonical && entry.destination === 'scripts/install-project-assets.sh'),
    'dhpk-project-setup adapter must be synchronized from the harness-setup source',
  );

  for (const [name, rel] of Object.entries(adapters)) {
    const result = spawnSync('bash', [path.join(ROOT, rel), '--help'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, outputOf(result));
    assert.match(result.stdout, new RegExp(`^Usage: ${path.basename(rel).replace('.', '\\.')} `, 'm'));
    const missing = spawnSync('bash', [path.join(ROOT, rel)], { encoding: 'utf8' });
    assert.match(missing.stderr, new RegExp(`\\[${name}\\] --source-artifact is required`));
  }
});

run('skill-setup-family-isolation');
