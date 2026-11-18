'use strict';

// Runtime-file selection for the Directory Plugin (Claude package).
//
// The package carries only files that run or that Claude loads.  Documentation
// and the build, CI, release, and maintainer scripts are dropped, even when a
// maintainer skill mentions them.  Pure: takes and returns a Map of
// destination path to { content: Buffer, ... }.

const NEVER_SHIPPED = Object.freeze([
  'docs/',
  'scripts/ci/', 'scripts/release/', 'scripts/maintainer/', 'scripts/validate/', 'scripts/codemaps/',
]);

// scripts/ci/_lib is a shared library that runtime scripts require.
const RUNTIME_EXCEPTIONS = Object.freeze(['scripts/ci/_lib/']);

const isRuntimeFile = (destination) => RUNTIME_EXCEPTIONS.some((prefix) => destination.startsWith(prefix))
  || !NEVER_SHIPPED.some((prefix) => destination.startsWith(prefix));

function selectRuntimeFiles(files) {
  return new Map([...files].filter(([destination]) => isRuntimeFile(destination)));
}

module.exports = { selectRuntimeFiles, isRuntimeFile, NEVER_SHIPPED };
