'use strict';

// Public facade for the explicit Review Gate runtime checkpoint. Domain
// implementations live in the storage, evidence, checkpoint, and composition
// modules; this surface keeps the existing Node callers stable.

const errors = require('./review-gate-runtime-errors');
const storage = require('./review-gate-runtime-storage');
const evidence = require('./review-gate-runtime-evidence');
const checkpoint = require('./review-gate-runtime-checkpoint');
const composition = require('./review-gate-runtime-composition');

module.exports = {
  ADAPTER: storage.ADAPTER,
  CONFIG_RELATIVE_PATH: storage.CONFIG_RELATIVE_PATH,
  CONFIG_SCHEMA: storage.CONFIG_SCHEMA,
  KEY_RELATIVE_PATH: storage.KEY_RELATIVE_PATH,
  MAX_STDIN_BYTES: storage.MAX_STDIN_BYTES,
  PLAN_CHECKPOINT_SCHEMA: storage.PLAN_CHECKPOINT_SCHEMA,
  PRODUCER: storage.PRODUCER,
  SCHEMA: storage.SCHEMA,
  STORE_RELATIVE_PATH: storage.STORE_RELATIVE_PATH,
  RuntimeError: errors.RuntimeError,
  createIntegrityKey: storage.createIntegrityKey,
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
