'use strict';

// Release evidence: three independently reported verdicts (SOURCE, PACKAGE,
// CONSUMER) plus an overall state derived from them. A SOURCE PASS never
// collapses into consumer readiness — see
// openspec/changes/harden-dhpk-release-contracts/specs/consumer-post-install-validation/spec.md.
//
// This module is a schema + builder, not an orchestrator: callers run their
// own gates (tests/run-all.js, the validators, package smoke tests, consumer
// checks) and hand the results in as stage objects.

const STAGES = ['SOURCE', 'PACKAGE', 'CONSUMER'];

const VERDICTS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  UNAVAILABLE: 'UNAVAILABLE',
  PENDING: 'PENDING',
};

// PUBLISHED_PENDING covers both "SOURCE+PACKAGE PASS, not yet tagged" and
// "tag exists, CONSUMER verification still running" — callers distinguish
// those by whether a tag/publication record exists alongside this evidence.
const OVERALL_STATES = {
  BLOCKED: 'BLOCKED',
  PUBLISHED_PENDING: 'PUBLISHED_PENDING',
  PUBLISHED_UNHEALTHY: 'PUBLISHED_UNHEALTHY',
  COMPLETE: 'COMPLETE',
};

function requireStageFields(name, stage) {
  const errors = [];
  if (!stage || typeof stage !== 'object') {
    errors.push(`${name}: missing stage object`);
    return errors;
  }
  if (!Object.values(VERDICTS).includes(stage.verdict)) {
    errors.push(`${name}: invalid verdict '${stage.verdict}' (expected one of ${Object.values(VERDICTS).join(', ')})`);
  }
  if (!Array.isArray(stage.commands)) errors.push(`${name}: 'commands' must be an array`);
  if (typeof stage.environment !== 'string' || !stage.environment) errors.push(`${name}: missing 'environment'`);
  if (!Array.isArray(stage.artifacts)) errors.push(`${name}: 'artifacts' must be an array`);
  if (!Array.isArray(stage.failureReasons)) errors.push(`${name}: 'failureReasons' must be an array`);
  return errors;
}

function validateEvidence(evidence) {
  const errors = [];
  if (!evidence || typeof evidence.version !== 'string' || !evidence.version) {
    errors.push('missing version');
  }
  for (const name of STAGES) {
    errors.push(...requireStageFields(name, evidence && evidence.stages && evidence.stages[name]));
  }
  if (evidence && !Object.values(OVERALL_STATES).includes(evidence.overall)) {
    errors.push(`invalid overall state '${evidence && evidence.overall}'`);
  }
  return { ok: errors.length === 0, errors };
}

function deriveOverall(stages) {
  const { SOURCE, PACKAGE, CONSUMER } = stages;

  if (SOURCE.verdict !== VERDICTS.PASS) return OVERALL_STATES.BLOCKED;
  if (PACKAGE.verdict !== VERDICTS.PASS) return OVERALL_STATES.BLOCKED;

  if (CONSUMER.verdict === VERDICTS.PASS) return OVERALL_STATES.COMPLETE;
  if (CONSUMER.verdict === VERDICTS.FAIL) return OVERALL_STATES.PUBLISHED_UNHEALTHY;
  if (CONSUMER.verdict === VERDICTS.BLOCKED) return OVERALL_STATES.BLOCKED;
  // PENDING or UNAVAILABLE: SOURCE+PACKAGE ready, tag not yet published or
  // consumer verification still running/unresolved.
  return OVERALL_STATES.PUBLISHED_PENDING;
}

function buildEvidence({ version, stages }) {
  for (const name of STAGES) {
    if (!stages || !stages[name]) {
      throw new Error(`release-evidence: missing required stage '${name}'`);
    }
  }
  const evidence = {
    version,
    stages: {
      SOURCE: stages.SOURCE,
      PACKAGE: stages.PACKAGE,
      CONSUMER: stages.CONSUMER,
    },
  };
  evidence.overall = deriveOverall(evidence.stages);

  const validation = validateEvidence(evidence);
  if (!validation.ok) {
    throw new Error(`release-evidence: invalid evidence:\n${validation.errors.join('\n')}`);
  }
  return evidence;
}

module.exports = { STAGES, VERDICTS, OVERALL_STATES, buildEvidence, validateEvidence };
