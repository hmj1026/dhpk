#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { execute } = require('./lib/harness');

const invocation = execute(process.argv.slice(2), { root: path.join(__dirname, '..') });
if (invocation.help) {
  process.stdout.write(invocation.help);
  process.exit(0);
}
const payload = invocation.result || { phase: null, outcome: 'INTERNAL_ERROR' };
if (payload.outcome === 'USAGE' || payload.internalError) {
  process.stderr.write(`${(payload.diagnostics || []).join('\n')}\n`);
}
if (payload.outcome !== 'USAGE') process.stdout.write(`${JSON.stringify(payload)}\n`);
process.exit(invocation.status);
