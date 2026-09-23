'use strict';

// Authoring fixtures for the setup-family raw-directory RED suite.  The
// fixtures create their own distribution payloads and consumer projects; no
// fixture invokes a repository installer or a real Host.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assert } = require('./tinytest');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');

const ROOT = path.join(__dirname, '..', '..');
const SOURCES = Object.freeze({
  harness: path.join(ROOT, 'skills', 'harness-setup'),
  project: path.join(ROOT, 'skills', 'dhpk-project-setup'),
});

const AUTO_DETECTED_PLACEHOLDERS = Object.freeze([
  '{PROJECT_NAME}',
  '{FRAMEWORK}',
  '{DATABASE}',
  '{CONFIG_FILE}',
  '{BOOTSTRAP_FILE}',
  '{TEST_COMMAND}',
  '{LINT_FIX_COMMAND}',
  '{BUILD_COMMAND}',
  '{TYPECHECK_COMMAND}',
]);

const ECOSYSTEM_TAGS = Object.freeze([
  'node-ts', 'python', 'go', 'rust', 'ruby', 'java',
]);

const RESERVED_ENV = Object.freeze([
  'CLAUDE_PLUGIN_ROOT', 'PLUGIN_ROOT', 'DHPK_SOURCE_ROOT',
  'NODE_PATH', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME',
]);

let registered = false;

function outputOf(result) {
  return `${result && result.stdout ? result.stdout : ''}\n${result && result.stderr ? result.stderr : ''}`;
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function writeFile(file, bytes, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { mode });
  fs.chmodSync(file, mode);
}

function writeExecutable(file, body) {
  writeFile(file, body, 0o755);
}

function writeCanary(file, marker) {
  writeExecutable(file, [
    '#!/usr/bin/env bash',
    `printf '%s' canary-ran > ${quoteShell(marker)}`,
    'exit 91',
    '',
  ].join('\n'));
}

function fileSnapshot(root) {
  if (!fs.existsSync(root)) return null;
  const result = [];
  function visit(current, relative) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      result.push([relative, 'symlink', fs.readlinkSync(current)]);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) {
        visit(path.join(current, name), path.posix.join(relative, name));
      }
      return;
    }
    result.push([
      relative,
      'file',
      stat.mode & 0o777,
      fs.readFileSync(current),
    ]);
  }
  visit(root, '');
  return result;
}

function fingerprint(root) {
  const hash = crypto.createHash('sha256');
  function visit(current) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      hash.update(`link:${fs.readlinkSync(current)}\0`);
      return;
    }
    if (stat.isDirectory()) {
      hash.update('dir\0');
      for (const name of fs.readdirSync(current).sort()) {
        hash.update(name);
        hash.update('\0');
        visit(path.join(current, name));
      }
      return;
    }
    hash.update('file\0');
    hash.update(fs.readFileSync(current));
  }
  visit(root);
  return hash.digest('hex');
}

function assertFixtureEvidence(result) {
  assert.strictEqual(result.evidenceKind, 'fixture');
  assert.strictEqual(result.hostStatus, 'NOT_RUN');
}

function assertSuccess(result) {
  assert.strictEqual(result.status, 0, outputOf(result));
  assertFixtureEvidence(result);
}

function makeHooksArtifact(base, { marker = null, includeInstaller = false, valid = true } = {}) {
  const artifact = path.join(base, 'distribution artifact');
  const hooks = path.join(artifact, 'hooks');
  const hookScripts = path.join(artifact, 'scripts', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.mkdirSync(hookScripts, { recursive: true });
  const hookBytes = Buffer.from('{"hooks":{"PreToolUse":[{"hooks":[{"command":"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/fixture-hook.sh"}]}]}}\n');
  if (valid) {
    writeFile(path.join(hooks, 'hooks.json'), hookBytes);
    writeExecutable(path.join(hookScripts, 'fixture-hook.sh'), '#!/usr/bin/env bash\nprintf \'fixture-hook\\n\'\n');
  }
  if (includeInstaller && marker) {
    writeCanary(path.join(artifact, 'scripts', 'setup', 'install-assets.sh'), marker);
    writeCanary(path.join(artifact, 'scripts', 'setup', 'install-project-assets.sh'), marker);
  }
  return Object.freeze({
    artifact,
    hookBytes,
    hookScript: path.join(hookScripts, 'fixture-hook.sh'),
    marker,
  });
}

function makeCodexArtifact(base, { marker, escapeRoot = null } = {}) {
  const artifact = path.join(base, 'codex distribution');
  const configBytes = Buffer.from('[agents]\nmax_threads = 1\n');
  writeFile(path.join(artifact, 'codex', 'config.toml.example'), configBytes);
  if (marker) writeCanary(path.join(artifact, 'scripts', 'hooks', 'install-codex-skills.sh'), marker);
  if (escapeRoot) {
    const escaped = path.join(artifact, 'codex', 'skills', 'escaped');
    fs.mkdirSync(path.dirname(escaped), { recursive: true });
    fs.symlinkSync(escapeRoot, escaped, 'dir');
    writeFile(path.join(artifact, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{
        id: 'escaped-fixture',
        name: 'escaped',
        path: 'skills/escaped',
        lifecycle: 'optional',
        invokable: true,
        surfaces: ['codex-native'],
      }],
    }, null, 2)}\n`);
  }
  return Object.freeze({ artifact, configBytes, marker });
}

function makeLookalikeDistribution(base, marker) {
  return makeHooksArtifact(base, { marker, includeInstaller: true });
}

function registerSetupFixtures() {
  if (registered) return getFixtures();
  const definitions = [
    {
      id: 'setup-harness-explicit-hooks-success',
      family: 'harness',
      entry: 'scripts/install-assets.sh',
      expected: { status: 0, outcome: 'success', output: ['"status":"PASS"', '"code":"OK"'] },
    },
    {
      id: 'setup-harness-missing-local-writer',
      family: 'harness',
      entry: 'scripts/install-assets.sh',
      expected: { status: 1, outcome: 'nonzero', output: ['BLOCKED_RESOURCE_MISSING'] },
    },
    {
      id: 'setup-harness-explicit-artifact-required',
      family: 'harness',
      entry: 'scripts/install-assets.sh',
      expected: { status: 1, outcome: 'nonzero', output: ['SOURCE_ARTIFACT_REQUIRED'] },
    },
    {
      id: 'setup-harness-invalid-artifact-no-mutation',
      family: 'harness',
      entry: 'scripts/install-assets.sh',
      expected: { status: 1, outcome: 'nonzero', output: ['SOURCE_ARTIFACT_INVALID'] },
    },
    {
      id: 'setup-codex-local-wrapper-valid-artifact',
      family: 'codex',
      entry: 'scripts/install-codex-project.sh',
      expected: { status: 0, outcome: 'success', output: ['"status":"PASS"', '"code":"OK"'] },
    },
    {
      id: 'setup-codex-pinned-artifact-root',
      family: 'codex',
      entry: 'scripts/install-codex-project.sh',
      expected: { status: 1, outcome: 'nonzero', output: ['SOURCE_ARTIFACT_INVALID', 'pinned artifact root'] },
    },
    {
      id: 'setup-harness-review-gate-local-closure',
      family: 'harness',
      entry: 'scripts/review-gate-runtime.js',
      expected: { status: 0, outcome: 'success', output: ['review-gate.runtime.v1', 'PENDING'] },
    },
    {
      id: 'setup-project-explicit-hooks-success',
      family: 'project',
      entry: 'scripts/install-project-assets.sh',
      expected: { status: 0, outcome: 'success', output: ['"status":"PASS"', '"code":"OK"'] },
    },
    {
      id: 'setup-project-explicit-artifact-required',
      family: 'project',
      entry: 'scripts/install-project-assets.sh',
      expected: { status: 1, outcome: 'nonzero', output: ['SOURCE_ARTIFACT_REQUIRED'] },
    },
    {
      id: 'setup-project-missing-local-writer',
      family: 'project',
      entry: 'scripts/install-project-assets.sh',
      expected: { status: 1, outcome: 'nonzero', output: ['BLOCKED_RESOURCE_MISSING'] },
    },
  ];
  for (const definition of definitions) {
    registerFixture({
      ...definition,
      args: [],
      assert(result) {
        assert.strictEqual(result.status, this.expected.status, outputOf(result));
        if (this.expected.outcome === 'success') assertSuccess(result);
        else assert.notStrictEqual(result.status, 0, outputOf(result));
        for (const fragment of this.expected.output) {
          assert.ok(outputOf(result).includes(fragment), `${this.id}: missing output fragment ${fragment}`);
        }
      },
    });
  }
  registered = true;
  return getFixtures();
}

module.exports = {
  ROOT,
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
};
