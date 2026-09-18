#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseRequest, execute } = require('./lib/dhpk-install-lifecycle');

const root = path.resolve(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
const profiles = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'install-profiles.json'), 'utf8'));
const moduleCatalog = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'module-catalog.json'), 'utf8'));
const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));

try {
  const request = parseRequest(process.argv.slice(2));
  const result = execute(request, inventory, { profiles, moduleCatalog, sourceVersion: plugin.version });
  if (request.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.lifecycle.verdict}: ${request.surface} ${request.action}\n`);
  process.exitCode = result.lifecycle.verdict === 'BLOCKED' ? 2 : 0;
} catch (error) {
  process.stderr.write(`dhpk-install: ${error.message}\n`);
  process.exitCode = 64;
}
