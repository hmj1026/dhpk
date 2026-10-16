#!/usr/bin/env node
'use strict';
const { runGenerator } = require('./_lib/skill-distribution-generator');
const run = options => runGenerator('skill-directory-coverage', options);
if (require.main === module) process.exit(run().status);
module.exports = { run };
