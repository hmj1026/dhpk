'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

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

test('loadCursorConsumerEvidence reads a regular fixture file and ignores a static tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-evidence-'));
  try {
    const file = path.join(dir, 'probe.json');
    fs.writeFileSync(file, `${JSON.stringify(passRecord())}\n`);
    const loaded = loadCursorConsumerEvidence({ consumerEvidencePath: file });
    assert.strictEqual(loaded.stage, 'CONSUMER');
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

run('cursor-consumer-evidence');
