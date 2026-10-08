'use strict';

const KEY = Symbol.for('dhpk.dispatch.writer-lease');
const state = globalThis[KEY] || { tail: Promise.resolve() };
globalThis[KEY] = state;

async function acquireWriter() {
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const previous = state.tail;
  state.tail = previous.then(() => current);
  await previous;
  return release;
}

async function withWriterLease(fn) {
  const release = await acquireWriter();
  try { return await fn(); } finally { release(); }
}

module.exports = Object.freeze({ acquireWriter, withWriterLease });
