#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { extractPhase, roundTrip, PHASES } = require('../lib/skill-distribution-extract');

function run(argv = process.argv.slice(2), root = path.join(__dirname, '../..')) {
  const phase = argv.find(argument => PHASES.includes(argument));
  if (!phase || argv.includes('--write') === argv.includes('--check')) {
    console.error(`Usage: extract-skill-distribution.js <${PHASES.join('|')}> --write|--check`);
    return 2;
  }
  try {
    const result = argv.includes('--write') ? extractPhase(root, phase, true) : roundTrip(root, phase);
    for (const error of result.drift) console.error(`distribution extraction ${phase}: ${error}`);
    if (result.ok) console.log(`PASS [distribution extraction ${phase}]`);
    return result.ok ? 0 : 1;
  } catch (error) { console.error(error.message); return 1; }
}
if (require.main === module) process.exit(run());
module.exports = { run };
