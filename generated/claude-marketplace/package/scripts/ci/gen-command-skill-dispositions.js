#!/usr/bin/env node
'use strict';
const { runCommandGenerator } = require('../lib/skill-command-generation');
const run = options => runCommandGenerator('command-skill-dispositions', options);
if (require.main === module) process.exit(run().status);
module.exports = { run };
