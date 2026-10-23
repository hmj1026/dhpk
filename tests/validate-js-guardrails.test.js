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
const RUNTIME_GUIDANCE_MARKER = 'dhpk:runtime-guidance-test';

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

function runtimeGuidanceErrors(source) {
  const root = fixture({
    'package.json': JSON.stringify({ version: '9.9.9-fixture' }),
    'tests/runtime-guidance.test.js': source,
  });
  try {
    return checkFiles(root, ['tests/runtime-guidance.test.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const planner = (body) => `'use strict';\n// ${PLANNER_MARKER}\nconst fs = require('node:fs');\n${body}\n`;
const runtimeGuidance = (body) => `'use strict';\n// ${RUNTIME_GUIDANCE_MARKER}\nconst fs = require('node:fs');\n${body}\n`;

test('the real repository satisfies the JavaScript guardrails', () => {
  const result = main(ROOT);
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.ok(result.checked > 0, 'repository scan must not be empty');
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

test('a marked runtime-guidance test may not read raw file contents', () => {
  for (const call of [
    "fs.readFileSync('skill.md', 'utf8');",
    "fs.readFile('skill.md', 'utf8', () => {});",
    "fs.promises.readFile('skill.md', 'utf8');",
    "fs.createReadStream('skill.md');",
  ]) {
    const errors = runtimeGuidanceErrors(runtimeGuidance(call));
    assert.ok(errors.length > 0, `${call} should be rejected by the runtime-guidance rule`);
    assert.ok(errors.some((error) => error.includes('tests/runtime-guidance.test.js')), errors.join('\n'));
  }
});

test('marked runtime-guidance tests may use metadata parsing and resource existence checks', () => {
  assert.deepStrictEqual(runtimeGuidanceErrors(runtimeGuidance([
    "const metadata = parseSkillMetadata(markdown);",
    "if (fs.existsSync(resourcePath)) return metadata;",
  ].join('\n'))), []);
});

test('unmarked tests may read fixture or package files directly', () => {
  assert.deepStrictEqual(runtimeGuidanceErrors([
    "'use strict';",
    "const fs = require('node:fs');",
    "fs.readFileSync('fixture.json', 'utf8');",
    '',
  ].join('\n')), []);
});

test('a test file may not hard-code the current root package version', () => {
  const currentVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const root = fixture({
    'package.json': JSON.stringify({ version: currentVersion }),
    'tests/current-version.test.js': `const expected = '${currentVersion}';\n`,
  });
  try {
    const errors = checkFiles(root, ['tests/current-version.test.js']);
    assert.strictEqual(errors.length, 1, errors.join('\n'));
    assert.ok(errors[0].startsWith('tests/current-version.test.js:'), errors[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a test file may read the current version from package.json', () => {
  const currentVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const root = fixture({
    'package.json': JSON.stringify({ version: currentVersion }),
    'tests/current-version.test.js': "const expected = require('../package.json').version;\n",
  });
  try {
    assert.deepStrictEqual(checkFiles(root, ['tests/current-version.test.js']), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a current-version fixture is allowed only on its explicitly marked line', () => {
  const currentVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const root = fixture({
    'package.json': JSON.stringify({ version: currentVersion }),
    'tests/historical-version.test.js': `const historicalFixture = '${currentVersion}'; // dhpk:historical-version-fixture\n`,
  });
  try {
    assert.deepStrictEqual(checkFiles(root, ['tests/historical-version.test.js']), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a historical fixture exemption does not hide an unannotated current version', () => {
  const currentVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const root = fixture({
    'package.json': JSON.stringify({ version: currentVersion }),
    'tests/version-fixture.test.js': [
      "const historicalFixture = '0.66.5'; // dhpk:historical-version-fixture",
      `const currentVersion = '${currentVersion}';`,
      '',
    ].join('\n'),
  });
  try {
    const errors = checkFiles(root, ['tests/version-fixture.test.js']);
    assert.strictEqual(errors.length, 1, errors.join('\n'));
    assert.ok(errors[0].startsWith('tests/version-fixture.test.js:'), errors[0]);
    assert.match(errors[0], /line 2|:2:/, errors[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('validate-js-guardrails');
