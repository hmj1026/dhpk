#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseRequest, execute } = require('./lib/dhpk-install-lifecycle');

const root = path.resolve(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));

try {
  const request = parseRequest(process.argv.slice(2));
  const result = execute(request, inventory);
  if (request.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.lifecycle.verdict}: ${request.surface} ${request.action}\n`);
  process.exit(result.lifecycle.verdict === 'BLOCKED' ? 2 : 0);
} catch (error) {
  process.stderr.write(`dhpk-install: ${error.message}\n`);
  process.exit(64);
}
