'use strict';
const crypto = require('node:crypto');

const ROLES = new Set(['planner', 'reasoner', 'worker', 'reviewer']);
const AUTHORITIES = new Set(['read-only', 'workspace-write']);
const MAX_AUTHORITY = Object.freeze({ planner: 'read-only', reasoner: 'read-only', reviewer: 'read-only', worker: 'workspace-write' });
const STATES = new Set(['CLEAR', 'REASONER_REQUIRED', 'HUMAN_REQUIRED', 'BLOCKED']);
const STAGES = new Set(['evidence', 'diagnosis', 'decision', 'red', 'green', 'review', 'acceptance']);

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a record`);
  return value;
}

function safeFiles(value, label) {
  if (!Array.isArray(value) || value.some((file) => typeof file !== 'string' || file.trim() === '' || file.startsWith('/') || file.split(/[\\/]/).includes('..'))) throw new TypeError(`${label} must contain safe relative files`);
  return Object.freeze([...value]);
}

function nodeTaskDigest(node, task, workdir) {
  const normalized = { id: node.id, role: node.role, goal: task.goal, acceptance: [...task.acceptance], workdir,
    constraints: { ...task.constraints, prompt_evidence: { sha256: task.constraints.prompt_evidence.sha256 }, assigned_files: [...task.constraints.assigned_files].sort() } };
  const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: stable(value[key]) }), {}) : value;
  return crypto.createHash('sha256').update(JSON.stringify(stable(normalized))).digest('hex');
}

function validateTaskGraph(decision, parentConstraints = {}) {
  const input = record(decision, 'coordination decision');
  if (input.mode !== 'coordinated') throw new TypeError('coordination decision.mode must be coordinated');
  if (parentConstraints.delegation === 'none') throw new Error('task constraints delegation=none forbids coordinated execution');
  if (parentConstraints.decision_state === 'HUMAN_REQUIRED' || parentConstraints.decision_state === 'BLOCKED') throw new Error(`parent decision_state=${parentConstraints.decision_state} forbids coordinated dispatch`);
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) throw new TypeError('coordinated decision requires nodes');
  const ids = new Set();
  const nodes = input.nodes.map((raw, index) => {
    const node = record(raw, `coordination node ${index}`);
    if (typeof node.id !== 'string' || node.id.trim() === '' || ids.has(node.id)) throw new TypeError(`coordination node ${index} has a duplicate or invalid id`);
    ids.add(node.id);
    if (typeof node.goal !== 'string' || node.goal.trim() === '') throw new TypeError(`coordination node ${node.id} goal is required`);
    if (!Array.isArray(node.acceptance) || node.acceptance.length === 0 || node.acceptance.some((item) => typeof item !== 'string' || item.trim() === '')) throw new TypeError(`coordination node ${node.id} acceptance is required`);
    const role = node.role || 'worker';
    if (node.stage !== undefined && !STAGES.has(node.stage)) throw new TypeError(`coordination node ${node.id} has invalid stage`);
    const decisionState = node.decision_state || 'CLEAR';
    if (!STATES.has(decisionState)) throw new TypeError(`coordination node ${node.id} has invalid decision_state`);
    const authority = node.authority || (MAX_AUTHORITY[role] || 'read-only');
    if (!ROLES.has(role) || !AUTHORITIES.has(authority) || (MAX_AUTHORITY[role] === 'read-only' && authority !== 'read-only')) throw new TypeError(`coordination node ${node.id} has invalid role or authority`);
    const assignedFiles = safeFiles(node.assigned_files || [], `coordination node ${node.id}.assigned_files`);
    if (authority === 'workspace-write' && parentConstraints.authority !== 'workspace-write') throw new Error(`coordination node ${node.id} widens parent authority`);
    if (authority === 'workspace-write') {
      const parentFiles = new Set(parentConstraints.assigned_files || []);
      if (assignedFiles.length === 0 || assignedFiles.some((file) => !parentFiles.has(file))) throw new Error(`coordination node ${node.id} exceeds the parent write scope`);
    }
    const dependencies = Object.freeze([...(node.dependencies || [])]);
    if (dependencies.some((dependency) => typeof dependency !== 'string' || dependency === node.id)) throw new TypeError(`coordination node ${node.id} has invalid dependency`);
    if (role === 'reviewer' && node.independent_of !== undefined && (!Array.isArray(node.independent_of) || node.independent_of.some((dependency) => typeof dependency !== 'string'))) throw new TypeError(`coordination reviewer ${node.id}.independent_of must reference nodes`);
    if (node.reuse !== undefined && (!node.reuse || typeof node.reuse !== 'object' || Array.isArray(node.reuse)
      || typeof node.reuse.prompt_sha256 !== 'string' || typeof node.reuse.task_digest !== 'string'
      || typeof node.reuse.baseline_identity !== 'string')) throw new TypeError(`coordination node ${node.id}.reuse must contain prior prompt, task, and baseline identities`);
    return Object.freeze({ ...node, id: node.id, goal: node.goal, acceptance: Object.freeze([...node.acceptance]), role, authority, assigned_files: assignedFiles, dependencies, decision_state: decisionState });
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (parentConstraints.decision_state === 'REASONER_REQUIRED' && nodes.some((node) => node.authority === 'workspace-write' && node.decision_state === 'CLEAR')) throw new Error('parent REASONER_REQUIRED cannot be downgraded by a CLEAR writer node');
  nodes.forEach((node) => node.dependencies.forEach((dependency) => { if (!byId.has(dependency)) throw new Error(`unknown dependency ${dependency} for ${node.id}`); }));
  const visiting = new Set(); const visited = new Set();
  function visit(id) { if (visiting.has(id)) throw new Error(`dependency cycle at ${id}`); if (visited.has(id)) return; visiting.add(id); byId.get(id).dependencies.forEach(visit); visiting.delete(id); visited.add(id); }
  nodes.forEach((node) => visit(node.id));
  nodes.forEach((node) => {
    if (node.role !== 'reviewer' || node.independent_of === undefined) return;
    node.independent_of.forEach((reference) => {
      if (!byId.has(reference)) throw new Error(`unknown independent node ${reference} for ${node.id}`);
      const ancestry = new Set();
      const pending = [...node.dependencies];
      while (pending.length) {
        const current = pending.pop();
        if (ancestry.has(current)) continue;
        ancestry.add(current);
        const parent = byId.get(current);
        if (parent) pending.push(...parent.dependencies);
      }
      if (!ancestry.has(reference)) throw new Error(`reviewer ${node.id}.independent_of must reference dependency ancestry`);
    });
  });
  nodes.forEach((node) => {
    if (node.reasoner_dependencies === undefined) return;
    if (!Array.isArray(node.reasoner_dependencies) || node.reasoner_dependencies.some((id) => typeof id !== 'string' || !byId.has(id))) throw new Error(`reasoner dependencies for ${node.id} must reference known nodes`);
    const ancestry = new Set(); const pending = [...node.dependencies];
    while (pending.length) { const current = pending.pop(); if (ancestry.has(current)) continue; ancestry.add(current); const parent = byId.get(current); if (parent) pending.push(...parent.dependencies); }
    if (node.reasoner_dependencies.some((id) => !ancestry.has(id))) throw new Error(`reasoner dependencies for ${node.id} must reference dependency ancestry`);
  });
  return Object.freeze({ mode: 'coordinated', nodes });
}

module.exports = Object.freeze({ validateTaskGraph, nodeTaskDigest });
