'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DISTRIBUTION_SCHEMA, readSkillDirectories } = require('./skill-distribution-source');
const { extract } = require('../ci/_lib/frontmatter');

const PHASES = ['identity', 'coverage', 'resources', 'inventory', 'commands'];
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const unquote = value => value === undefined ? undefined : value.startsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value.startsWith('"') ? JSON.parse(value) : value;

function commandGrant(root, commandPath) {
  const file = path.join(root, commandPath);
  return fs.existsSync(file) ? unquote(extract(fs.readFileSync(file, 'utf8')).values['allowed-tools']) : undefined;
}

function extractionPlan(root, phase) {
  if (!PHASES.includes(phase)) throw new Error(`unknown extraction phase ${phase}`);
  const load = name => JSON.parse(fs.readFileSync(path.join(root, 'manifests', `${name}.json`), 'utf8'));
  const inventory = load('distribution-inventory');
  const source = phase === 'coverage' ? load('skill-directory-coverage') : phase === 'resources' ? load('skill-resources') : phase === 'commands' ? load('command-skill-dispositions') : inventory;
  return inventory.skills.map(row => {
    const dir = path.join(root, row.path);
    const file = path.join(dir, 'distribution.yaml');
    const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schema: DISTRIBUTION_SCHEMA };
    const next = { ...old };
    const skillPath = path.join(dir, 'SKILL.md');
    let skill = fs.readFileSync(skillPath, 'utf8');
    if (phase === 'coverage' && source.skills[row.id]) next.coverage = source.skills[row.id];
    if (phase === 'resources' && source.skills[row.id]) next.resource_copies = source.skills[row.id];
    if (phase === 'inventory') {
      if (row.usage) next.usage = row.usage;
      if (row.standalone_dependencies) next.standalone_dependencies = row.standalone_dependencies;
    }
    if (phase === 'identity' || phase === 'inventory') {
      const metadata = [];
      if (row.capability_id) metadata.push(`  dhpk-capability-id: ${row.capability_id}`);
      if (row.name_style) metadata.push(`  dhpk-name-style: ${row.name_style}`);
      if (metadata.length) {
        skill = skill.replace(/^  dhpk-(?:capability-id|name-style):.*\r?\n/gm, '');
        if (/^metadata:\s*$/m.test(skill)) skill = skill.replace(/^metadata:\s*$/m, `metadata:\n${metadata.join('\n')}`);
        else skill = skill.replace(/\r?\n---(?:\r?\n|$)/, `\nmetadata:\n${metadata.join('\n')}\n---\n`);
      }
    }
    if (phase === 'commands') {
      const commands = source.commands.filter(command => command.skill_owner === row.id && command.path.startsWith('commands/') && command.disposition === 'thin-front-door');
      if (commands.length) next.commands = commands.map(({ path: commandPath, skill_owner: ignoredOwner, resource: ignoredResource, ...command }) => {
        const grant = commandGrant(root, commandPath);
        return { ...command, ...(grant === undefined ? {} : { allowed_tools: grant }) };
      });
    }
    return { file, content: json(next), skillPath, skill, previousSkill: fs.readFileSync(skillPath, 'utf8'), needed: Object.keys(next).length > 1 };
  });
}

function extractPhase(root, phase, write = false) {
  const plan = extractionPlan(root, phase);
  const drift = [];
  for (const entry of plan) {
    if (entry.needed && (!fs.existsSync(entry.file) || fs.readFileSync(entry.file, 'utf8') !== entry.content)) drift.push(path.relative(root, entry.file));
    if (entry.skill !== entry.previousSkill) drift.push(path.relative(root, entry.skillPath));
  }
  if (write) for (const entry of plan) {
    if (entry.needed) fs.writeFileSync(entry.file, entry.content);
    if (entry.skill !== entry.previousSkill) fs.writeFileSync(entry.skillPath, entry.skill);
  }
  return { ok: write || drift.length === 0, drift };
}

function roundTrip(root, phase) {
  const load = name => JSON.parse(fs.readFileSync(path.join(root, 'manifests', `${name}.json`), 'utf8'));
  const inventory = load('distribution-inventory');
  const directories = readSkillDirectories(root);
  const drift = [];
  const expected = phase === 'coverage' ? load('skill-directory-coverage').skills : phase === 'resources' ? load('skill-resources').skills : null;
  const key = phase === 'coverage' ? 'coverage' : 'resource_copies';
  for (const row of inventory.skills) {
    const skill = directories.find(candidate => candidate.path === row.path);
    if (!skill) { drift.push(`${row.id}: missing Skill directory`); continue; }
    if (phase === 'identity') {
      if (skill.id !== row.id || skill.capability_id !== row.capability_id) drift.push(`${row.id}: compact identity`);
    } else if (phase === 'inventory') {
      for (const field of ['id', 'name', 'path', 'capability_id', 'invocation_class', 'name_style']) {
        if (row[field] !== undefined && JSON.stringify(skill[field]) !== JSON.stringify(row[field])) drift.push(`${row.id}: ${field}`);
      }
      for (const field of ['usage', 'standalone_dependencies']) if (JSON.stringify(skill.distribution[field]) !== JSON.stringify(row[field])) drift.push(`${row.id}: ${field}`);
    } else if (expected && JSON.stringify(skill.distribution[key]) !== JSON.stringify(expected[row.id])) drift.push(`${row.id}: ${key}`);
    else if (phase === 'commands') {
      const wanted = load('command-skill-dispositions').commands.filter(command => command.skill_owner === row.id && command.path.startsWith('commands/') && command.disposition === 'thin-front-door').map(({ path: ignoredPath, skill_owner: ignoredOwner, resource: ignoredResource, ...command }) => command);
      const local = (skill.distribution.commands || []).map(({ allowed_tools: ignoredTools, description: ignoredDescription, ...command }) => command);
      if (JSON.stringify(local) !== JSON.stringify(wanted)) drift.push(`${row.id}: commands`);
      for (const declaration of skill.distribution.commands || []) if (declaration.allowed_tools !== commandGrant(root, `commands/${declaration.id}.md`)) drift.push(`${row.id}: command ${declaration.id} allowed_tools`);
    }
  }
  return { ok: drift.length === 0, drift };
}

module.exports = { PHASES, extractPhase, roundTrip };
