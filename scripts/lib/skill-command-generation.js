'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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

function forwarder({ skill, declaration }) {
  const quote = value => `'${String(value).replace(/'/g, "''")}'`;
  const mode = declaration.mode || (declaration.forwarding && declaration.forwarding.action);
  const args = mode ? `${mode} $ARGUMENTS` : '$ARGUMENTS';
  return [
    '---',
    `description: ${quote(declaration.description || skill.description)}`,
    `argument-hint: ${quote(declaration.argument_contract)}`,
    ...(declaration.allowed_tools === undefined ? [] : [`allowed-tools: ${quote(declaration.allowed_tools)}`]),
    ...(skill.invocation_class === 'explicit-only' ? ['disable-model-invocation: true'] : []),
    'metadata:',
    `  dhpk-invocation-class: ${skill.invocation_class || 'implicit-eligible'}`,
    '---', '',
    `Load \`${skill.path}/SKILL.md\` and follow the owning Skill with \`${args}\`.`,
    'Keep its argument contract, authority boundary, verification, and output.', '',
  ].join('\n');
}

const FORWARDER_LEDGER = 'manifests/command-forwarder-copies.json';
const FORWARDER_SCHEMA = 'dhpk.command-forwarder-copies.v1';
const fingerprint = content => crypto.createHash('sha256').update(content).digest('hex');

function physicalPath(root, relative) {
  let current = path.resolve(root);
  if (fs.realpathSync(current) !== current) throw new Error('forwarder root must be physical');
  let stat = fs.lstatSync(current);
  for (const part of relative.split('/')) {
    if (!stat.isDirectory()) throw new Error(`non-directory forwarder parent: ${relative}`);
    current = path.join(current, part);
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`symlink forwarder path: ${relative}`);
  }
  if (!stat.isFile()) throw new Error(`non-regular forwarder path: ${relative}`);
  return stat;
}

function forwarderPlan(root) {
  const ledgerFile = path.join(root, FORWARDER_LEDGER);
  const ledgerExists = physicalPath(root, FORWARDER_LEDGER);
  const prior = ledgerExists ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : { schema: FORWARDER_SCHEMA, files: {} };
  if (!prior || prior.schema !== FORWARDER_SCHEMA || !prior.files || typeof prior.files !== 'object' || Array.isArray(prior.files) || Object.keys(prior).some(key => !['schema', 'files'].includes(key))) throw new Error('invalid forwarder ownership ledger');
  for (const [name, digest] of Object.entries(prior.files)) {
    if (!/^commands\/[a-z][a-z0-9-]*\.md$/.test(name) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`invalid forwarder ownership entry: ${name}`);
  }
  const entries = commandDeclarations(root).map(command => ({ path: `commands/${command.declaration.id}.md`, content: forwarder(command) })).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const files = Object.fromEntries(entries.map(entry => [entry.path, fingerprint(entry.content)]));
  const stale = Object.keys(prior.files).filter(name => !Object.prototype.hasOwnProperty.call(files, name));
  for (const name of stale) {
    if (physicalPath(root, name) && fingerprint(fs.readFileSync(path.join(root, name))) !== prior.files[name]) throw new Error(`modified stale forwarder preserved with receipt: ${name}`);
  }
  for (const entry of entries) physicalPath(root, entry.path);
  return { entries, stale, ledger: { schema: FORWARDER_SCHEMA, files }, prior, ledgerExists };
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
      const plan = forwarderPlan(root);
      const drift = plan.entries.filter(entry => !fs.existsSync(path.join(root, entry.path)) || fs.readFileSync(path.join(root, entry.path), 'utf8') !== entry.content);
      const ledgerDrift = !plan.ledgerExists || fs.readFileSync(path.join(root, FORWARDER_LEDGER), 'utf8') !== serialize(plan.ledger);
      if (!write && (drift.length || plan.stale.length || ledgerDrift)) {
        for (const entry of drift) stderr.write(`FAIL [${kind}]: ${entry.path} byte drift\n`);
        for (const name of plan.stale) stderr.write(`FAIL [${kind}]: stale managed forwarder ${name}\n`);
        if (ledgerDrift) stderr.write(`FAIL [${kind}]: ${FORWARDER_LEDGER} ownership drift\n`);
        return { status: 1 };
      }
      if (write) {
        for (const entry of plan.entries) {
          fs.mkdirSync(path.dirname(path.join(root, entry.path)), { recursive: true });
          writeInventoryAtomically(path.join(root, entry.path), entry.content);
        }
        for (const name of plan.stale) if (physicalPath(root, name)) {
          if (fingerprint(fs.readFileSync(path.join(root, name))) !== plan.prior.files[name]) throw new Error(`modified stale forwarder preserved with receipt: ${name}`);
          fs.unlinkSync(path.join(root, name));
        }
        fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
        writeInventoryAtomically(path.join(root, FORWARDER_LEDGER), serialize(plan.ledger));
      }
    }
    stdout.write(`PASS [${kind}]: ${write ? 'wrote' : 'checked'} Skill declarations\n`);
    return { status: 0 };
  } catch (error) { stderr.write(`FAIL [${kind}]: ${error.message}\n`); return { status: 1 }; }
}

module.exports = { commandDeclarations, compileDispositions, forwarder, runCommandGenerator };
