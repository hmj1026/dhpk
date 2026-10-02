'use strict';

// Guardrail for repository JavaScript: every tracked or new .js/.cjs file must
// parse as CommonJS, and modules marked `dhpk:read-only-planner` must stay
// read-only and read untrusted files through descriptors, never readFileSync.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { checkFiles, main, PLANNER_MARKER } = require('../scripts/ci/validate-js-guardrails');

const ROOT = path.join(__dirname, '..');

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-js-guardrails-'));
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return root;
}

function errorsFor(files) {
  const root = fixture(files);
  try {
    return checkFiles(root, Object.keys(files));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const planner = (body) => `'use strict';\n// ${PLANNER_MARKER}\nconst fs = require('node:fs');\n${body}\n`;

test('the real repository satisfies the JavaScript guardrails', () => {
  const result = main(ROOT);
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.ok(result.checked > 900, `expected the full repository to be scanned, got ${result.checked}`);
});

test('a syntax error is reported with its file', () => {
  const errors = errorsFor({ 'scripts/broken.js': "'use strict';\nfunction ( {\n" });
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].startsWith('scripts/broken.js: syntax:'), errors[0]);
});

test('a shebang script parses', () => {
  assert.deepStrictEqual(errorsFor({ 'bin/tool.js': "#!/usr/bin/env node\n'use strict';\nconsole.log(1);\n" }), []);
});

test('a marked planner may not use readFileSync', () => {
  const errors = errorsFor({ 'scripts/lib/x-plan.js': planner("fs.readFileSync('a');") });
  assert.deepStrictEqual(errors, ['scripts/lib/x-plan.js: read-only planner uses readFileSync; read through a descriptor opened with O_NOFOLLOW']);
});

test('a marked planner may not call any write API', () => {
  for (const call of ['fs.writeFileSync(a, b);', 'fs.mkdirSync(a);', 'fs.rmSync(a);', 'fs.renameSync(a, b);', 'fs.createWriteStream(a);', 'fs.promises.writeFile(a, b);']) {
    const errors = errorsFor({ 'scripts/lib/x-plan.js': planner(call) });
    assert.strictEqual(errors.length, 1, `${call} -> ${errors.join('; ')}`);
    assert.ok(errors[0].includes('read-only planner uses write API'), errors[0]);
  }
});

test('destructured, aliased, bracketed, and promise-based write APIs are caught', () => {
  for (const call of [
    "const { writeFileSync } = require('node:fs'); writeFileSync(a, b);",
    "const f = require('node:fs'); f.writeFileSync(a, b);",
    "fs['writeFileSync'](a, b);",
    "require('node:fs/promises');",
  ]) {
    const errors = errorsFor({ 'a.js': planner(call) });
    assert.strictEqual(errors.length, 1, `${call} -> ${errors.join('; ')}`);
  }
});

test('dynamic child_process imports are caught', () => {
  assert.strictEqual(errorsFor({ 'a.js': planner("import('node:child_process');") }).length, 1);
});

test('a marked planner may not open files for writing or spawn processes', () => {
  assert.strictEqual(errorsFor({ 'a.js': planner("fs.openSync(p, 'w');") }).length, 1);
  assert.strictEqual(errorsFor({ 'a.js': planner('fs.openSync(p, fs.constants.O_RDWR);') }).length, 1);
  assert.strictEqual(errorsFor({ 'a.js': planner("require('node:child_process');") }).length, 1);
});

test('a read-only planner using descriptors passes, and unmarked modules are unrestricted', () => {
  assert.deepStrictEqual(errorsFor({
    'scripts/lib/ok-plan.js': planner('const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); fs.readSync(fd, buf); fs.closeSync(fd);'),
    'scripts/lib/writer.js': "'use strict';\nrequire('node:fs').writeFileSync('a', 'b');\n",
  }), []);
});

run('validate-js-guardrails');
