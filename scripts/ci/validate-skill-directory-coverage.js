#!/usr/bin/env node
'use strict';

// Repository authoring check. Fixture definitions are not execution evidence.
const fs = require('node:fs');
const path = require('node:path');
const { validateSkillDirectoryCoverage } = require('../lib/skill-directory-coverage');
const { getFixtures } = require('../../tests/_lib/skill-directory-fixtures');
const { registerPilotFixtures } = require('../../tests/_lib/skill-pilot-fixtures');
const { registerAuditFamilyFixtures } = require('../../tests/_lib/skill-audit-family-fixtures');
const { registerResumeFamilyFixtures } = require('../../tests/_lib/skill-resume-family-fixtures');
const { registerBridgeFamilyFixtures } = require('../../tests/_lib/skill-bridge-family-fixtures');
const { registerReleaseFixtures } = require('../../tests/_lib/skill-release-fixtures');
const { registerLocalToolFixtures } = require('../../tests/_lib/skill-local-tool-fixtures');
const { registerFlowFamilyFixtures } = require('../../tests/_lib/skill-flow-family-fixtures');
const { registerSetupFixtures } = require('../../tests/_lib/skill-setup-family-fixtures');
const { registerFlowEntryFixtures } = require('../../tests/_lib/skill-flow-entry-fixtures');
const { registerGoalRuntimeFixtures } = require('../../tests/_lib/skill-goal-runtime-fixtures');
const { registerRemainingFixtures } = require('../../tests/_lib/skill-remaining-entry-fixtures');

if (process.argv.length !== 3 || process.argv[2] !== '--check') {
  console.error('Usage: validate-skill-directory-coverage.js --check');
  process.exitCode = 2;
} else {
  try {
    const root = path.resolve(__dirname, '../..');
    const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'manifests', name), 'utf8'));
    registerPilotFixtures();
    registerAuditFamilyFixtures();
    registerResumeFamilyFixtures();
    registerBridgeFamilyFixtures();
    registerReleaseFixtures();
    registerLocalToolFixtures();
    registerFlowFamilyFixtures();
    registerSetupFixtures();
    registerFlowEntryFixtures();
    registerGoalRuntimeFixtures();
    registerRemainingFixtures();
    const result = validateSkillDirectoryCoverage({
      root,
      inventory: read('distribution-inventory.json'),
      coverage: read('skill-directory-coverage.json'),
      fixtures: getFixtures(),
    });
    console.log(JSON.stringify({
      ...result,
      fixture_execution: 'NOT_RUN',
      host_probes: 'NOT_RUN',
    }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`Skill directory coverage failed: ${error.message}`);
    process.exitCode = 1;
  }
}
