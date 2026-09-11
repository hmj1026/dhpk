#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  SURFACES,
  buildDispatchProjection,
  validateDispatchProjection,
  validateDispatchProjectionSet,
} = require('../lib/dispatch-projection');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const all = args.includes('--all');
const surfaceIndex = args.indexOf('--surface');
const outputIndex = args.indexOf('--out');
const surface = surfaceIndex === -1 ? 'claude-core' : args[surfaceIndex + 1];
const output = outputIndex === -1 ? null : args[outputIndex + 1];
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'provider-model-catalog.json'), 'utf8'));
const hostProfiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'host-profiles.json'), 'utf8'));
const projections = (all ? SURFACES : [surface]).map((configuredSurface) => buildDispatchProjection({ surface: configuredSurface, catalog, hostProfiles }));
const projection = all ? { schema: 'dhpk.dispatch.projections.v1', projections } : projections[0];
const validation = all ? validateDispatchProjectionSet(projections) : validateDispatchProjection(projection);
if (!validation.ok) {
  for (const error of validation.errors) console.error(`FAIL [gen-dispatch-projection]: ${error}`);
  process.exit(1);
}
if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(projection, null, 2)}\n`);
else process.stdout.write(`${JSON.stringify(projection)}\n`);
