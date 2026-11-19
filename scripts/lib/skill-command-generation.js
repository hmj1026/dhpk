'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readSkillDirectories } = require('./skill-distribution-source');
const { serialize, same } = require('./skill-distribution-compile');
const { writeInventoryAtomically } = require('./distribution-inventory');

function commandDeclarations(root) {
  const commands = [];
  const seen = new Set();
  for (const skill of readSkillDirectories(root)) for (const declaration of skill.distribution.commands || []) {
    if (!declaration || typeof declaration !== 'object' || !/^[a-z][a-z0-9-]*$/.test(declaration.id || '')) throw new Error(`${skill.id}: invalid command id`);
    if (seen.has(declaration.id)) throw new Error(`duplicate command id ${declaration.id}`);
    seen.add(declaration.id);
    for (const key of ['public_name', 'argument_contract', 'authority', 'disposition']) if (typeof declaration[key] !== 'string') throw new Error(`${skill.id}: command ${declaration.id} missing ${key}`);
    if (Object.prototype.hasOwnProperty.call(declaration, 'allowed_tools') && (typeof declaration.allowed_tools !== 'string' || !declaration.allowed_tools.trim() || /[\r\n]/.test(declaration.allowed_tools))) throw new Error(`${skill.id}: command ${declaration.id} allowed_tools must be a nonempty single-line string`);
    if (declaration.disposition !== 'thin-front-door') throw new Error(`${skill.id}: command ${declaration.id} must be a thin-front-door`);
    for (const key of ['path', 'skill_owner', 'resource']) if (Object.prototype.hasOwnProperty.call(declaration, key)) throw new Error(`${skill.id}: command ${declaration.id} ${key} is derived`);
    commands.push({ skill, declaration });
  }
  return commands;
}

function dispositionRow({ skill, declaration }) {
  // Keep the public row shape and its optional evidence/adapter fields stable.
  return {
    id: declaration.id,
    path: `commands/${declaration.id}.md`,
    host_surface: 'claude-command',
    public_name: declaration.public_name,
    argument_contract: declaration.argument_contract,
    authority: declaration.authority,
    skill_owner: skill.id,
    disposition: declaration.disposition,
    ...Object.fromEntries(Object.entries(declaration).filter(([key]) => !['id', 'public_name', 'argument_contract', 'authority', 'disposition', 'allowed_tools', 'description'].includes(key))),
    resource: `${skill.path}/SKILL.md`,
  };
}

function compileDispositions(root, existing) {
  const declared = new Map(commandDeclarations(root).map(command => [command.declaration.id, dispositionRow(command)]));
  const output = [];
  for (const row of existing.commands || []) {
    if (declared.has(row.id)) {
      const next = declared.get(row.id);
      // Retain key order only; every value of a Skill-owned row is authored locally.
      output.push(Object.fromEntries([...Object.keys(row), ...Object.keys(next)].filter((key, index, keys) => keys.indexOf(key) === index && Object.prototype.hasOwnProperty.call(next, key)).map(key => [key, next[key]])));
      declared.delete(row.id);
    } else if (!row.path.startsWith('commands/') || !row.skill_owner || row.disposition !== 'thin-front-door') output.push(row);
  }
  output.push(...[...declared.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')));
  return { ...existing, commands: output };
}

function runCommandGenerator(kind, options = {}) {
  const root = options.root || path.resolve(__dirname, '../..');
  const argv = options.argv || process.argv.slice(2);
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const write = argv.includes('--write');
  if (write === argv.includes('--check') || argv.some(arg => !['--write', '--check'].includes(arg))) {
    stderr.write(`Usage: gen-${kind}.js --write|--check\n`); return { status: 2 };
  }
  try {
    if (kind === 'command-skill-dispositions') {
      const file = path.join(root, 'manifests/command-skill-dispositions.json');
      const actual = fs.readFileSync(file, 'utf8');
      const existing = JSON.parse(actual);
      const generated = compileDispositions(root, existing);
      const expected = serialize(generated);
      if (!write && actual !== expected) {
        for (const id of new Set([...(existing.commands || []).map(row => row.id), ...generated.commands.map(row => row.id)])) {
          if (!same(existing.commands.find(row => row.id === id), generated.commands.find(row => row.id === id))) stderr.write(`FAIL [${kind}]: ${id} differs from Skill declaration\n`);
        }
        stderr.write(`FAIL [${kind}]: manifests/command-skill-dispositions.json byte drift\n`);
        return { status: 1 };
      }
      if (write) writeInventoryAtomically(file, expected);
    } else {
      throw new Error(`unknown command generator kind: ${kind}`);
    }
    stdout.write(`PASS [${kind}]: ${write ? 'wrote' : 'checked'} Skill declarations\n`);
    return { status: 0 };
  } catch (error) { stderr.write(`FAIL [${kind}]: ${error.message}\n`); return { status: 1 }; }
}

module.exports = { commandDeclarations, compileDispositions, runCommandGenerator };
