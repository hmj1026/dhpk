'use strict';

class RuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReviewGateRuntimeError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new RuntimeError(code);
};

module.exports = { RuntimeError, fail };
