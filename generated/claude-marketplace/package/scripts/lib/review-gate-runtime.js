'use strict';

// Public facade for the explicit Review Gate runtime checkpoint. Domain
// implementations live in the storage, evidence, checkpoint, and composition
// modules; this surface keeps the existing Node callers stable.

const errors = require('./review-gate-runtime-errors');
const storage = require('./review-gate-runtime-storage');
const evidence = require('./review-gate-runtime-evidence');
const checkpoint = require('./review-gate-runtime-checkpoint');
const composition = require('./review-gate-runtime-composition');
const attestation = require('./review-gate-runtime-attestation');

module.exports = {
  ADAPTER: storage.ADAPTER,
  ALGORITHM: attestation.ALGORITHM,
  CONFIG_RELATIVE_PATH: storage.CONFIG_RELATIVE_PATH,
  CONFIG_SCHEMA: storage.CONFIG_SCHEMA,
  KEY_RELATIVE_PATH: storage.KEY_RELATIVE_PATH,
  HOST_ATTESTATION_SCHEMA: attestation.HOST_ATTESTATION_SCHEMA,
  HOST_SUBJECT_SCHEMA: attestation.HOST_SUBJECT_SCHEMA,
  HOST_TRUST_SCHEMA: attestation.HOST_TRUST_SCHEMA,
  MAX_STDIN_BYTES: storage.MAX_STDIN_BYTES,
  PLAN_CHECKPOINT_SCHEMA: storage.PLAN_CHECKPOINT_SCHEMA,
  PRODUCER: storage.PRODUCER,
  SCHEMA: storage.SCHEMA,
  STORE_RELATIVE_PATH: storage.STORE_RELATIVE_PATH,
  RuntimeError: errors.RuntimeError,
  createIntegrityKey: storage.createIntegrityKey,
  buildObserveSubject: attestation.buildObserveSubject,
  createPlanRegisteredEvent: checkpoint.createPlanRegisteredEvent,
  defaultConfig: storage.defaultConfig,
  init: composition.init,
  observe: composition.observe,
  parseJson: storage.parseJson,
  prepare: composition.prepare,
  readStdinWorkRequest: evidence.readStdinWorkRequest,
  status: composition.status,
  writeDiagnostic: storage.writeDiagnostic,
};
