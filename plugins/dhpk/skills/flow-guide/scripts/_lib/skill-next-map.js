'use strict';

const { qualifyCommand } = require('./command-namespace');

const STATES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'UNAVAILABLE']);
const FIRST_WAVE_SKILLS = Object.freeze([
  'code-trace', 'tdd-workflow', 'repo-verify', 'change-verdict', 'precommit',
  'code-simplify', 'doc-maintain', 'git-smart-commit', 'create-pr', 'flow-drive',
  'opsx-apply-resume',
]);
const IDENTITY = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?::([a-z][a-z0-9]*(?:-[a-z0-9]+)*))?$/;

function valuesOf(metadata) {
  return metadata && metadata.values ? metadata.values : {};
}

function ownSkill(skills, name) {
  return Object.prototype.hasOwnProperty.call(skills, name) ? skills[name] : null;
}

function validateNextGraph(skills, { requiredSkills = [] } = {}) {
  const errors = [];
  for (const name of requiredSkills) {
    const metadata = ownSkill(skills, name);
    if (!metadata || !valuesOf(metadata)['dhpk-next']) {
      errors.push(`${name}: required dhpk-next map is missing`);
    }
  }
  for (const [name, metadata] of Object.entries(skills)) {
    const values = valuesOf(metadata);
    const next = values['dhpk-next'];
    if (next == null) continue;
    if (typeof next !== 'object' || Array.isArray(next)) {
      errors.push(`${name}: dhpk-next must be a mapping`);
      continue;
    }
    const modes = values['dhpk-modes'] || [];
    for (const state of STATES) {
      if (!Object.prototype.hasOwnProperty.call(next, state)) errors.push(`${name}: missing state ${state}`);
    }
    for (const [key, target] of Object.entries(next)) {
      const parts = key.split(':');
      const state = parts[parts.length - 1];
      if (parts.length > 2 || !STATES.includes(state)) errors.push(`${name}: unknown state ${key}`);
      if (parts.length === 2 && !modes.includes(parts[0])) errors.push(`${name}: undeclared source mode ${parts[0]}`);
      if (target === 'none') continue;
      const identity = typeof target === 'string' ? target.match(IDENTITY) : null;
      if (!identity) {
        errors.push(`${name}: invalid target identity ${String(target)}`);
        continue;
      }
      const targetMetadata = ownSkill(skills, identity[1]);
      if (!targetMetadata) {
        errors.push(`${name}: target skill ${identity[1]} does not exist`);
        continue;
      }
      if (identity[2] && valuesOf(targetMetadata)['dhpk-modes'] !== undefined && !valuesOf(targetMetadata)['dhpk-modes'].includes(identity[2])) {
        errors.push(`${name}: target mode ${identity[1]}:${identity[2]} is undeclared`);
      }
    }
  }
  return errors;
}

function resolveNext(skills, { name, mode, state }) {
  const next = valuesOf(ownSkill(skills, name))['dhpk-next'] || {};
  const modeKey = mode ? `${mode}:${state}` : null;
  const value = modeKey && Object.prototype.hasOwnProperty.call(next, modeKey) ? next[modeKey] : next[state];
  const terminal = { name: null, mode: null, terminal: true, invocationClass: null };
  if (value == null || value === 'none') return terminal;
  const identity = typeof value === 'string' ? value.match(IDENTITY) : null;
  const metadata = identity && ownSkill(skills, identity[1]);
  if (!metadata) return terminal;
  if (identity[2] && valuesOf(metadata)['dhpk-modes'] !== undefined && !valuesOf(metadata)['dhpk-modes'].includes(identity[2])) return terminal;
  return {
    name: identity[1],
    mode: identity[2] || null,
    terminal: false,
    invocationClass: valuesOf(metadata)['dhpk-invocation-class'] || null,
  };
}

function formatNextAction(target, { host = 'codex' } = {}) {
  if (!target || target.terminal || !target.name) return null;
  const command = ['claude', 'claude-code'].includes(host) ? qualifyCommand(`/${target.name}`) : `$${target.name}`;
  return target.mode ? `${command} --mode ${target.mode}` : command;
}

module.exports = { STATES, FIRST_WAVE_SKILLS, validateNextGraph, resolveNext, formatNextAction };
