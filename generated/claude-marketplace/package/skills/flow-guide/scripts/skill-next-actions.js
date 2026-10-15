'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadRuntimeModule } = require('./_lib/runtime-loader');
const { resolveNext, formatNextAction } = loadRuntimeModule('skill-next-map');
const { extract, extractMetadata } = loadRuntimeModule('frontmatter');
const { createFlowHandoff, HOSTS } = loadRuntimeModule('flow-handoff-contract');

// Read only the peer frontmatter block, leaving procedure bodies unopened.
function readSkillHeader(file) {
  const descriptor = fs.openSync(file, 'r');
  const byte = Buffer.alloc(1);
  let text = '';
  try {
    while (Buffer.byteLength(text) < 65536 && fs.readSync(descriptor, byte, 0, 1, null)) {
      text += byte.toString('latin1');
      if (text.endsWith('\n---\n') || text.endsWith('\n---\r\n')) return Buffer.from(text, 'latin1').toString('utf8');
      if (text.includes('\n') && !/^\uFEFF?---\r?\n/.test(Buffer.from(text, 'latin1').toString('utf8'))) return '';
    }
    return '';
  } finally {
    fs.closeSync(descriptor);
  }
}

function collectSkillMetadata() {
  const metadata = {};
  const visit = directory => {
    const skill = path.join(directory, 'SKILL.md');
    if (fs.existsSync(skill)) {
      const header = readSkillHeader(skill);
      const name = extract(header).values.name;
      if (name) metadata[name] = extractMetadata(header);
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) visit(path.join(directory, entry.name));
    }
  };
  visit(path.resolve(__dirname, '..', '..'));
  return metadata;
}

function parseNextHost(argv = []) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--host') values.push(argv[++index]);
    else if (argv[index].startsWith('--host=')) values.push(argv[index].slice('--host='.length));
  }
  const host = values.length === 0 ? 'claude-code' : values[0];
  if (values.length > 1 || !HOSTS.includes(host)) throw new TypeError(`next host must be one of ${HOSTS.join(', ')}, specified once`);
  return host;
}

function buildDeclaredNextActions(findings, phase, featureCtx, metadata, reviewState, host = 'claude-code') {
  if (!HOSTS.includes(host)) throw new TypeError(`next host must be one of ${HOSTS.join(', ')}`);
  const actions = [];
  const add = (id, source, reason, confidence, findingTarget = null) => {
    const state = source.state === 'PARTIAL' ? 'FAIL' : source.state;
    // Findings select a current owner, while completed steps follow its declared edge.
    const lookup = findingTarget ? {
      ...metadata,
      '__finding': { values: { 'dhpk-next': { PASS: findingTarget.mode ? `${findingTarget.name}:${findingTarget.mode}` : findingTarget.name } } },
    } : metadata;
    const target = resolveNext(lookup, findingTarget ? { name: '__finding', state: 'PASS' } : { ...source, state });
    const command = formatNextAction(target, { host });
    const explicit = target.invocationClass === 'explicit-only';
    const nextAction = target.terminal
      ? 'No successor is declared; wait for an explicit next task.'
      : explicit ? `Present ${command} and wait for explicit invocation.` : command;
    actions.push({
      id,
      skill: target.name,
      mode: target.mode,
      command,
      args: null,
      reason,
      confidence,
      handoff: createFlowHandoff({
        handoff_id: `next-${id}`,
        owner: target.name || source.name || 'flow-guide',
        host,
        disposition: explicit ? 'explicit-required' : 'advice',
        target: null,
        evidence: [{ kind: 'next-state', state: 'available', detail: `${source.name}:${state}` }],
        next_action: nextAction,
      }),
    });
  };

  for (const finding of findings) {
    if (finding.priority !== 'P0' && finding.priority !== 'P1') continue;
    const confidence = finding.priority === 'P0' ? 1 : 0.8;
    if (finding.next_source || finding.next_target) {
      add(finding.id, finding.next_source || { name: 'flow-guide', state: 'NOT_RUN' }, finding.message, confidence, finding.next_target);
    } else if (typeof finding.guidance === 'string' && finding.guidance.trim()) {
      actions.push({ id: finding.id, guidance: finding.guidance, reason: finding.message, confidence });
    }
  }

  const receipt = reviewState && reviewState.last_skill;
  if (receipt && typeof receipt.name === 'string' && typeof receipt.state === 'string') {
    add('declared-next', receipt, 'Follow the last recorded skill result', 0.9);
  } else if (phase === 'post_precommit') {
    add('doc-sync', { name: 'precommit', state: 'PASS' }, 'Precommit passed — follow the declared documentation step', 0.9);
  } else if (phase === 'ready_to_commit') {
    add('declared-next', { name: 'change-verdict', mode: 'docs', state: 'PASS' }, 'Required gates passed — follow the declared next step', 0.9);
  }
  if (phase === 'post_precommit' && featureCtx.key && featureCtx.has_requests) {
    actions.push({
      id: 'request-update',
      guidance: 'Use the external $openspec-propose workflow to update request status.',
      reason: 'Precommit passed — update request status through the external proposal workflow',
      confidence: 0.8,
    });
  }
  return actions.sort((a, b) => b.confidence - a.confidence);
}

module.exports = { buildDeclaredNextActions, collectSkillMetadata, parseNextHost };
