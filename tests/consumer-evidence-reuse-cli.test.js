'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { normalizeConsumerEvidence } = require('../scripts/lib/release-evidence');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'consumer-gate.js');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const NODE_BASH_ONLY_PATH = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);

function physicalTempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function copyRepositoryTree(destination) {
  fs.cpSync(ROOT, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter(source) {
      const relative = path.relative(ROOT, source);
      return relative !== '.git' && !relative.startsWith(`.git${path.sep}`);
    },
  });
}

function mkBinStub(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
}

function successfulCodexRoleProbeStub(logFile) {
  return `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(logFile)}
if [ "$1" = "--version" ]; then echo "codex-cli fixture ${'${CODEX_TEST_VERSION:-1.0}'}"; exit 0; fi
if [ "$1" != "exec" ]; then exit 93; fi
case "$*" in
  *"values: security-reviewer."*) role=security-reviewer ;;
  *) echo 'expected one exact role in prompt' >&2; exit 94 ;;
esac
role_path=$(printf '%s' "$role" | tr '-' '_')
session_dir="$CODEX_HOME/sessions/2026/01/01"
mkdir -p "$session_dir"
printf '%s\\n' '{"type":"session_meta","payload":{"id":"parent-1","thread_source":"root"}}' > "$session_dir/rollout-parent.jsonl"
printf '{"type":"session_meta","payload":{"id":"thread-%s","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"%s","agent_path":"/root/dhpk_probe_%s"}}\\n' "$role" "$role" "$role_path" > "$session_dir/rollout-child.jsonl"
printf '%s\\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$session_dir/rollout-child.jsonl"
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"CODEX_DHPK_NAMED_ROLES=PASS"}}'
exit 0
`;
}

function makeRequirement({ id, reason, question, authorized }) {
  return {
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['codex-sync'],
    checks: [{
      id,
      surface: 'codex-sync',
      host: 'codex',
      capability: 'named-role-security-reviewer',
      trigger: 'explicit-native',
      reason,
      question,
      evidenceKind: 'native',
      authorization: { authorized },
    }],
  };
}

function runRequirements(requirements, { root = ROOT, evidenceFile, env = {}, timeoutMs = 120000 } = {}) {
  const directory = physicalTempDir('dhpk-consumer-reuse-input-');
  const requirementsFile = path.join(directory, 'requirements.json');
  fs.writeFileSync(requirementsFile, JSON.stringify(requirements));
  const args = [CLI, '--version', VERSION, '--repo-root', root, '--requirements', requirementsFile];
  if (evidenceFile) args.push('--evidence', evidenceFile);
  try {
    return spawnSync(process.execPath, args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { ...process.env, ...env },
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function prepareCodexProbe() {
  const directory = physicalTempDir('dhpk-consumer-reuse-codex-');
  const bin = path.join(directory, 'bin');
  const home = path.join(directory, 'codex-home');
  const log = path.join(directory, 'codex-argv.log');
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, 'auth.json'), '{"fixture":"local-only"}\n', { mode: 0o600 });
  mkBinStub(bin, 'codex', successfulCodexRoleProbeStub(log));
  return {
    directory,
    log,
    env(version) {
      return {
        PATH: `${bin}${path.delimiter}${NODE_BASH_ONLY_PATH}`,
        CODEX_HOME: home,
        CODEX_TEST_VERSION: version,
        CI: 'true',
        DHPK_CONSUMER_PROBE_EXECUTE: '1',
      };
    },
  };
}

function nativeCalls(logFile) {
  return fs.existsSync(logFile)
    ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter((line) => /^exec\s/.test(line))
    : [];
}

function stageFrom(result) {
  assert.ok(result.stdout, `${result.stderr || 'consumer gate did not return JSON'}`);
  return JSON.parse(result.stdout);
}

test('reuses exact current native evidence after request and producer attribution change', () => {
  const fixture = prepareCodexProbe();
  const evidenceFile = path.join(fixture.directory, 'previous-consumer-evidence.json');
  try {
    const firstResult = runRequirements(makeRequirement({
      id: 'security-role-first-request',
      reason: 'Verify the selected role in the original workflow.',
      question: 'Did Codex complete the selected role?',
      authorized: true,
    }), { env: fixture.env('1.0') });
    assert.strictEqual(firstResult.status, 0, firstResult.stdout + firstResult.stderr);
    const firstStage = stageFrom(firstResult);
    const firstEvidence = firstStage.surfaceResults.find((entry) => entry.surface === 'codex-sync')
      .requirementEvidence.check1;
    assert.ok(firstEvidence.identity, 'native result should carry its current capability identity');
    assert.strictEqual(firstEvidence.identity.contractVersion, 'consumer-check-identity.v1');
    assert.strictEqual(firstEvidence.nativeProof.roles[0].childCompleted, true);
    assert.strictEqual(nativeCalls(fixture.log).length, 1);

    const prior = JSON.parse(JSON.stringify(firstStage));
    prior.producer = 'harness';
    prior.workflow = 'a-different-release-workflow';
    const inputBytes = Buffer.from(JSON.stringify(prior));
    fs.writeFileSync(evidenceFile, inputBytes);

    const secondResult = runRequirements(makeRequirement({
      id: 'security-role-renamed-request',
      reason: 'Recheck the same semantic role under a new workflow.',
      question: 'Is the role capability still current?',
      authorized: false,
    }), { evidenceFile, env: fixture.env('1.0') });
    assert.strictEqual(secondResult.status, 0, secondResult.stdout + secondResult.stderr);
    const secondStage = stageFrom(secondResult);
    const secondSurface = secondStage.surfaceResults.find((entry) => entry.surface === 'codex-sync');
    const secondEvidence = secondSurface.requirementEvidence.check1;
    const accepted = secondStage.acceptance.requiredChecks.find((entry) => entry.id === 'requirement.security-role-renamed-request');
    assert.strictEqual(secondStage.acceptance.verdict, 'PASS', JSON.stringify(secondStage.acceptance));
    assert.strictEqual(accepted.status, 'PASS', JSON.stringify(accepted));
    assert.strictEqual(secondEvidence.id, 'security-role-renamed-request');
    assert.strictEqual(secondEvidence.reason, 'Recheck the same semantic role under a new workflow.');
    assert.strictEqual(secondEvidence.authorized, false, 'historical evidence must not grant current execution authority');
    assert.deepStrictEqual(secondEvidence.identity, firstEvidence.identity);
    assert.deepStrictEqual(secondEvidence.nativeProof, firstEvidence.nativeProof);
    assert.strictEqual(secondEvidence.evidenceReuse.decision, 'REUSED');
    assert.strictEqual(secondEvidence.evidenceReuse.origin.envelopeIndex, 0);
    assert.strictEqual(secondEvidence.evidenceReuse.origin.surface, 'codex-sync');
    assert.strictEqual(secondEvidence.evidenceReuse.origin.slot, 'check1');
    assert.strictEqual(secondSurface.runtimeEvidence.status, 'NOT_RUN');
    assert.strictEqual(nativeCalls(fixture.log).length, 1, 'reuse must make zero additional native calls');
    assert.deepStrictEqual(fs.readFileSync(evidenceFile), inputBytes, 'supplied evidence bytes must remain unchanged');

    const roundTrip = normalizeConsumerEvidence(JSON.parse(JSON.stringify(secondStage)));
    const roundTripEvidence = roundTrip.surfaceResults.find((entry) => entry.surface === 'codex-sync')
      .requirementEvidence.check1;
    assert.deepStrictEqual(roundTripEvidence.identity, firstEvidence.identity);
    assert.deepStrictEqual(roundTripEvidence.nativeProof, firstEvidence.nativeProof);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('blocks unauthorized reuse when the selected Host version changes', () => {
  const fixture = prepareCodexProbe();
  const evidenceFile = path.join(fixture.directory, 'previous-consumer-evidence.json');
  try {
    const first = runRequirements(makeRequirement({
      id: 'original-role-check',
      reason: 'Verify the selected role.',
      question: 'Did the exact role complete?',
      authorized: true,
    }), { env: fixture.env('1.0') });
    assert.strictEqual(first.status, 0, first.stdout + first.stderr);
    fs.writeFileSync(evidenceFile, first.stdout);

    const second = runRequirements(makeRequirement({
      id: 'current-role-check',
      reason: 'Use the current Codex version.',
      question: 'Does current evidence cover this Host?',
      authorized: false,
    }), { evidenceFile, env: fixture.env('2.0') });
    assert.strictEqual(second.status, 1, second.stdout + second.stderr);
    const stage = stageFrom(second);
    const current = stage.surfaceResults.find((entry) => entry.surface === 'codex-sync')
      .requirementEvidence.check1;
    const accepted = stage.acceptance.requiredChecks.find((entry) => entry.id === 'requirement.current-role-check');
    assert.strictEqual(stage.acceptance.verdict, 'BLOCKED', JSON.stringify(stage.acceptance));
    assert.strictEqual(accepted.status, 'BLOCKED', JSON.stringify(accepted));
    assert.strictEqual(current.evidenceReuse.decision, 'REJECTED');
    assert.ok(current.evidenceReuse.mismatchFields.includes('hostVersion'), JSON.stringify(current.evidenceReuse));
    assert.strictEqual(current.authorized, false);
    assert.strictEqual(nativeCalls(fixture.log).length, 1, 'a mismatch must not start an unauthorized replacement probe');
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('invalidates historical role evidence when an installed dynamic resource family changes', () => {
  const fixture = prepareCodexProbe();
  const sourceRoot = physicalTempDir('dhpk-consumer-reuse-source-');
  const evidenceFile = path.join(fixture.directory, 'previous-consumer-evidence.json');
  try {
    copyRepositoryTree(sourceRoot);
    const firstResult = runRequirements(makeRequirement({
      id: 'dynamic-family-check',
      reason: 'Verify the selected role and its accessible support resources.',
      question: 'Did the selected role complete with current resources?',
      authorized: true,
    }), { root: sourceRoot, env: fixture.env('1.0') });
    assert.strictEqual(firstResult.status, 0, firstResult.stdout + firstResult.stderr);
    const previous = stageFrom(firstResult);
    fs.writeFileSync(evidenceFile, firstResult.stdout);
    const dynamicSheet = path.join(sourceRoot, 'agent-traps', 'security-reviewer', 'js.md');
    assert.ok(fs.statSync(dynamicSheet).isFile(), `missing copied dynamic resource: ${dynamicSheet}`);
    fs.appendFileSync(dynamicSheet, '\nAdditional criterion for current review.\n');

    const secondResult = runRequirements(makeRequirement({
      id: 'dynamic-family-check-current',
      reason: 'Reuse only evidence covering the selected role closure.',
      question: 'Does the prior check cover current accessible resources?',
      authorized: false,
    }), { root: sourceRoot, evidenceFile, env: fixture.env('1.0') });
    assert.strictEqual(secondResult.status, 1, `expected stale evidence to block; exit=${secondResult.status}; stderr=${secondResult.stderr}`);
    const current = stageFrom(secondResult);
    const currentEvidence = current.surfaceResults.find((entry) => entry.surface === 'codex-sync')
      .requirementEvidence.check1;
    assert.strictEqual(current.acceptance.verdict, 'BLOCKED', JSON.stringify(current.acceptance));
    assert.strictEqual(currentEvidence.evidenceReuse.decision, 'REJECTED');
    assert.ok(
      currentEvidence.evidenceReuse.mismatchFields.includes('sourceFingerprint')
        || currentEvidence.evidenceReuse.mismatchFields.includes('artifactFingerprint'),
      JSON.stringify(currentEvidence.evidenceReuse),
    );
    assert.strictEqual(currentEvidence.status, 'BLOCKED');
    assert.strictEqual(nativeCalls(fixture.log).length, 1, 'unauthorized stale evidence must not start a replacement probe');
    assert.notDeepStrictEqual(
      currentEvidence.identity,
      previous.surfaceResults.find((entry) => entry.surface === 'codex-sync').requirementEvidence.check1.identity,
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('preserves conflicting historical origins when a separately authorized replacement runs', () => {
  const fixture = prepareCodexProbe();
  const evidenceFile = path.join(fixture.directory, 'conflicting-consumer-evidence.json');
  try {
    const first = runRequirements(makeRequirement({
      id: 'conflict-origin-check',
      reason: 'Create the prior passing native observation.',
      question: 'Did the selected role complete?',
      authorized: true,
    }), { env: fixture.env('1.0') });
    assert.strictEqual(first.status, 0, first.stdout + first.stderr);
    const passing = JSON.parse(first.stdout);
    const failing = JSON.parse(first.stdout);
    failing.verdict = 'FAIL';
    failing.acceptance.verdict = 'FAIL';
    const failedCheck = failing.surfaceResults.find((entry) => entry.surface === 'codex-sync')
      .requirementEvidence.check1;
    failedCheck.status = 'FAIL';
    failedCheck.observedStatus = 'FAIL';
    failedCheck.outcomeReason = 'contradictory historical failure';
    delete failedCheck.nativeProof;
    delete failedCheck.runtimeVerified;
    const failedAcceptanceCheck = failing.acceptance.requiredChecks.find((entry) => entry.id === 'requirement.conflict-origin-check');
    failedAcceptanceCheck.status = 'FAIL';
    fs.writeFileSync(evidenceFile, JSON.stringify([passing, failing]));

    const replacement = runRequirements(makeRequirement({
      id: 'conflict-origin-check-current',
      reason: 'Run a separately authorized current observation.',
      question: 'Does the role complete now?',
      authorized: true,
    }), { evidenceFile, env: fixture.env('1.0') });
    assert.strictEqual(replacement.status, 0, `expected authorized replacement to complete; exit=${replacement.status}; stderr=${replacement.stderr}`);
    const current = stageFrom(replacement);
    const currentEvidence = current.surfaceResults.find((entry) => entry.surface === 'codex-sync')
      .requirementEvidence.check1;
    assert.strictEqual(currentEvidence.status, 'PASS');
    assert.strictEqual(currentEvidence.evidenceReuse.decision, 'REJECTED');
    assert.strictEqual(currentEvidence.evidenceReuse.rejectionReason, 'CONFLICTING_EVIDENCE');
    assert.deepStrictEqual(currentEvidence.evidenceReuse.conflicts.map((entry) => ({
      envelopeIndex: entry.envelopeIndex,
      status: entry.status,
    })), [
      { envelopeIndex: 0, status: 'PASS' },
      { envelopeIndex: 1, status: 'FAIL' },
    ]);
    assert.strictEqual(currentEvidence.authorized, true);
    assert.strictEqual(currentEvidence.observedStatus, 'PASS');
    assert.strictEqual(nativeCalls(fixture.log).length, 2, 'authorized replacement should run one fresh role probe');
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('rejects a symlinked evidence file before parsing its target', () => {
  const directory = physicalTempDir('dhpk-consumer-reuse-symlink-');
  const target = path.join(directory, 'evidence-target.json');
  const link = path.join(directory, 'evidence.json');
  try {
    fs.writeFileSync(target, '{"not":"a consumer evidence envelope"}');
    fs.symlinkSync(target, link);
    const result = runRequirements(makeRequirement({
      id: 'symlink-evidence-input',
      reason: 'Reject non-physical evidence inputs.',
      question: 'Was evidence read from a physical file?',
      authorized: false,
    }), { evidenceFile: link, env: { PATH: NODE_BASH_ONLY_PATH }, timeoutMs: 5000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /evidence.*(?:regular|physical|read)/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects FIFO evidence inputs promptly without blocking the gate', () => {
  const directory = physicalTempDir('dhpk-consumer-reuse-fifo-');
  const fifo = path.join(directory, 'evidence.json');
  try {
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    assert.strictEqual(created.status, 0, created.stdout + created.stderr);
    const result = runRequirements(makeRequirement({
      id: 'fifo-evidence-input',
      reason: 'Reject non-regular evidence inputs.',
      question: 'Was evidence read from a bounded regular file?',
      authorized: false,
    }), { evidenceFile: fifo, env: { PATH: NODE_BASH_ONLY_PATH }, timeoutMs: 5000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /evidence.*(?:regular|physical|read)/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects evidence JSON larger than the 4 MiB input bound before parsing', () => {
  const directory = physicalTempDir('dhpk-consumer-reuse-oversize-');
  const evidenceFile = path.join(directory, 'evidence.json');
  try {
    fs.writeFileSync(evidenceFile, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));
    const result = runRequirements(makeRequirement({
      id: 'oversized-evidence-input',
      reason: 'Reject oversized evidence before parsing.',
      question: 'Is evidence input within the published size bound?',
      authorized: false,
    }), { evidenceFile, env: { PATH: NODE_BASH_ONLY_PATH }, timeoutMs: 5000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /evidence.*(?:4.?mib|size|large|bound)/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('does not echo malformed evidence contents in diagnostics', () => {
  const directory = physicalTempDir('dhpk-consumer-reuse-malformed-');
  const evidenceFile = path.join(directory, 'evidence.json');
  const secretMarker = 'password=FAKE';
  try {
    fs.writeFileSync(evidenceFile, secretMarker);
    const result = runRequirements(makeRequirement({
      id: 'malformed-evidence-input',
      reason: 'Reject malformed evidence without echoing its bytes.',
      question: 'Does the error omit evidence contents?',
      authorized: false,
    }), { evidenceFile, env: { PATH: NODE_BASH_ONLY_PATH }, timeoutMs: 5000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 2, result.stdout + result.stderr);
    assert.doesNotMatch(result.stderr, new RegExp(secretMarker));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

run('consumer-evidence-reuse-cli');
