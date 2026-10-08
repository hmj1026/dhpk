'use strict';

const crypto = require('node:crypto');
const KEY = Symbol.for('dhpk.dispatch.writer-lease');
const state = globalThis[KEY] || { phase: 'IDLE', owner: null, queue: [] };
globalThis[KEY] = state;

function suspendedError() {
  const error = new Error('writer lease requires reconciliation');
  error.code = 'RECONCILIATION_REQUIRED';
  return error;
}

function grant(resolve) {
  const identity = crypto.randomUUID();
  state.phase = 'ACTIVE';
  state.owner = identity;
  const control = Object.freeze({
    owner_id: identity,
    suspend() {
      if (state.owner !== identity || state.phase !== 'ACTIVE') return;
      state.phase = 'SUSPENDED';
      state.queue.splice(0).forEach(({ reject }) => reject(suspendedError()));
    },
  });
  const release = () => {
    if (state.owner !== identity || state.phase !== 'ACTIVE') return;
    state.owner = null;
    state.phase = 'IDLE';
    const next = state.queue.shift();
    if (next) grant(next.resolve);
  };
  Object.defineProperty(release, 'control', { value: control });
  resolve(release);
}

async function acquireWriter() {
  if (state.phase === 'SUSPENDED') throw suspendedError();
  return new Promise((resolve, reject) => {
    if (state.phase === 'IDLE') grant(resolve);
    else state.queue.push({ resolve, reject });
  });
}

async function withWriterLease(fn) {
  const release = await acquireWriter();
  try { return await fn(release.control); } finally { release(); }
}

module.exports = Object.freeze({ acquireWriter, withWriterLease });
