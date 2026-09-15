#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateCommandSkillDispositions } = require('../lib/command-skill-disposition');

const ROOT = path.join(__dirname, '..', '..');
const manifestPath = path.join(ROOT, 'manifests', 'command-skill-dispositions.json');
const inventoryPath = path.join(ROOT, 'manifests', 'distribution-inventory.json');

function main(root = ROOT) {
  const errors = [];
  let manifest;
  let inventory;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'command-skill-dispositions.json'), 'utf8'));
    inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
  } catch (error) {
    console.error('FAIL [command-dispositions]: ' + error.message);
    return 1;
  }
  const result = validateCommandSkillDispositions({
    manifest,
    root,
    skillIds: (inventory.skills || []).map((skill) => skill.id),
    skills: inventory.skills || [],
  });
  errors.push(...result.errors);
  for (const error of errors) console.error('FAIL [command-dispositions]: ' + error);
  if (errors.length > 0) return 1;
  console.log('PASS [command-dispositions]: ' + result.canonicalPaths.length + ' canonical commands have one disposition.');
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { main };
