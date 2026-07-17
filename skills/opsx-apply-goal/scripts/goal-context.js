#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const selector = require('../../../scripts/fast-worker-selector.js');

const VALID = ['claude', 'codex', 'agy', 'auto'];
const MAX_INLINE_FILES = 2;

function truncateUtf8(text, maxBytes) {
  let result = '';
  for (const char of text) {
    if (Buffer.byteLength(result + char, 'utf8') > maxBytes) break;
    result += char;
  }
  return result;
}

function taskDigest(tasks) {
  const titles = tasks.split(/\r?\n/)
    .filter((line) => /^- \[ \] /.test(line))
    .map((line) => line.replace(/^- \[ \] /, '').trim());
  return truncateUtf8(titles.join('; '), 200);
}

function detectE2e(tasks, proposal) {
  return /(playwright|\.spec\.(?:js|ts)\b|browser[- ]journey)/i.test(`${tasks}\n${proposal}`);
}

function normalizeHeading(line) {
  const heading = line.trim();
  if (!/^#+(?:\s|$)/.test(heading)) return '';
  return heading
    .replace(/^#+/, '')
    .trim()
    .replace(/^(?:\d+\s*[.)]?\s*|[()[\].,:;/-]+\s*)+/, '')
    .trim()
    .toLowerCase();
}

function parseFiles(filesValue) {
  if (filesValue === 'none') return { conclusive: true, count: 0 };
  const files = filesValue.split(',').map((file) => file.trim());
  const normalized = new Set();
  for (const file of files) {
    const normalizedFile = file.replace(/^\.\//, '');
    const segments = normalizedFile.split('/');
    const resolved = path.resolve(process.cwd(), normalizedFile);
    if (!normalizedFile || path.isAbsolute(normalizedFile) || segments.includes('..')
      || /[\\*?\[]/.test(normalizedFile) || normalizedFile.endsWith('/')
      || /^<[^>]+>$/.test(normalizedFile) || /^tbd$/i.test(normalizedFile)) {
      return { conclusive: false, count: 0 };
    }
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return { conclusive: false, count: 0 };
    }
    normalized.add(normalizedFile);
  }
  return { conclusive: true, count: normalized.size };
}

function parseMetadata(line) {
  const match = /^  - \*\*Mechanical:\*\* (yes|no); \*\*Files:\*\* (.*?)[ \t]*$/.exec(line || '');
  return match ? { mechanical: match[1], files: match[2].trim() } : null;
}

function scanFootprint(tasksText) {
  const lines = String(tasksText == null ? '' : tasksText).split(/\r?\n/);
  const verificationIndex = lines.findIndex((line) => normalizeHeading(line) === 'verification');
  const limit = verificationIndex < 0 ? lines.length : verificationIndex;
  let eligible = false;
  let inconclusive = false;
  let offendingTaskId = null;

  for (let index = 0; index < limit; index += 1) {
    if (!/^- \[ \] /.test(lines[index])) continue;
    const taskId = lines[index].replace(/^- \[ \] /, '').trim();
    const metadata = parseMetadata(lines[index + 1]);
    if (!metadata) {
      inconclusive = true;
      if (!offendingTaskId) offendingTaskId = taskId;
      continue;
    }
    const files = parseFiles(metadata.files);
    if (!files.conclusive) {
      inconclusive = true;
      if (!offendingTaskId) offendingTaskId = taskId;
      continue;
    }
    if (metadata.mechanical !== 'yes') continue;
    if (files.count > MAX_INLINE_FILES) eligible = true;
  }

  return { eligible, inconclusive, offendingTaskId };
}

function clean(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
}

function buildContext(options) {
  const tasks = options.tasks;
  const proposal = options.proposal;
  const configured = process.env.CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND || 'claude';
  const rawFlag = options.fastWorker;
  let requested = rawFlag || configured;
  let warning = '';
  if (rawFlag && !VALID.includes(rawFlag)) {
    warning = `[opsx-goal] WARN: invalid --fast-worker value '${rawFlag}'; using configured backend '${configured}'`;
    requested = configured;
  }
  const order = process.env.CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER || selector.DEFAULT_ORDER.join(',');
  const fallback = process.env.CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK || 'none';
  const footprint = scanFootprint(tasks);
  if (footprint.inconclusive) {
    const footprintWarning = `[opsx-goal] WARN: footprint scan inconclusive at task '${footprint.offendingTaskId}'; embedding FAST_WORKER_CLAUSE`;
    warning = warning ? `${warning}\n${footprintWarning}` : footprintWarning;
  }
  let workerFields = {
    FAST_WORKER_REQUESTED: '',
    FAST_WORKER_STATUS: 'skipped',
    FAST_WORKER_SELECTED: '',
    FAST_WORKER_AGENT: '',
    FAST_WORKER_ORDER: order,
    FAST_WORKER_FALLBACK: fallback,
    FAST_WORKER_REJECTED: '',
    FAST_WORKER_CLAUSE: '',
  };
  if (footprint.inconclusive || footprint.eligible) {
    const selected = selector.select(selector.parseArgs(['--backend', requested, '--order', order, '--fallback', fallback]));
    const rejected = (selected.rejected_candidates || []).map((item) => `${item.backend}:${item.reason}`).join('|');
    const clause = selected.status === 'blocked'
      ? `BLOCKED fast-worker requested=${selected.requested_backend}; reason=${selected.reason}; fallback=${fallback}; action=STOP and report BLOCKED; dispatch sanctioned selected fallback only${rejected ? `; rejected=${rejected}` : ''}`
      : `${selected.selected_agent} requested=${selected.requested_backend}; selected=${selected.selected_backend}; availability=${selected.reason}; order=${order}; fallback=${fallback}${rejected ? `; rejected=${rejected}` : ''}`;
    workerFields = {
      FAST_WORKER_REQUESTED: selected.requested_backend,
      FAST_WORKER_STATUS: selected.status,
      FAST_WORKER_SELECTED: selected.selected_backend,
      FAST_WORKER_AGENT: selected.selected_agent,
      FAST_WORKER_ORDER: order,
      FAST_WORKER_FALLBACK: fallback,
      FAST_WORKER_REJECTED: rejected,
      FAST_WORKER_CLAUSE: clause,
    };
  }
  return { warning, fields: {
    ...workerFields,
    HAS_E2E: detectE2e(tasks, proposal) ? 'true' : 'false',
    TASK_DIGEST: taskDigest(tasks),
  }};
}

function main(argv) {
  const options = Object.fromEntries(argv.map((arg) => {
    const at = arg.indexOf('=');
    return at < 0 ? [arg, ''] : [arg.slice(0, at), arg.slice(at + 1)];
  }));
  const tasks = fs.readFileSync(options['--tasks'], 'utf8');
  const proposal = fs.readFileSync(options['--proposal'], 'utf8');
  const { warning, fields } = buildContext({ tasks, proposal, fastWorker: options['--fast-worker'] });
  if (warning) process.stderr.write(`${warning}\n`);
  for (const [key, value] of Object.entries(fields)) process.stdout.write(`${key}=${clean(value)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main(process.argv.slice(2));

module.exports = { buildContext, detectE2e, taskDigest, truncateUtf8, scanFootprint, MAX_INLINE_FILES };
