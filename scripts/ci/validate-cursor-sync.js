#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createReporter } = require('./_lib/report');
const { validateCursorSyncTree } = require('../lib/cursor-sync-package');

const ROOT = path.join(__dirname, '..', '..');
const r = createReporter('cursor-sync');
const inventoryPath = path.join(ROOT, 'manifests', 'distribution-inventory.json');
if (!fs.existsSync(inventoryPath)) {
  r.err('manifests/distribution-inventory.json not found');
  r.done('cursor-sync');
}

const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const result = validateCursorSyncTree({
  root: ROOT,
  outDir: path.join(ROOT, 'cursor'),
  inventory,
});
for (const message of result.errors) r.err(message);
r.done('cursor-sync');
