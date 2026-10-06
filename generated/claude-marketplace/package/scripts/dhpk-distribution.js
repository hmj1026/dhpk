#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { execute } = require('./lib/dhpk-distribution');

const result = execute(process.argv.slice(2), path.join(__dirname, '..'));
if (!result.ok && result.error) {
  console.error(`dhpk distribution: ${result.error}`);
} else {
  console.log(JSON.stringify(result.payload));
}
process.exitCode = result.status;
