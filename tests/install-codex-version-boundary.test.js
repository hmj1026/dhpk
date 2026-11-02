'use strict';

// The installer's embedded Python holds the version-boundary diagnostic once;
// scripts/lib/content-fingerprint.js holds it once for Node. Both texts must be
// byte-identical (OpenSpec remove-legacy-tree-fingerprints, D1).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { versionBoundaryMessage } = require('../scripts/lib/content-fingerprint');

const INSTALLER = path.resolve(__dirname, '..', 'scripts', 'hooks', 'install-codex-skills.sh');
const BEGIN = '# BEGIN version-boundary-message';
const END = '# END version-boundary-message';

function extractBlock() {
  const text = fs.readFileSync(INSTALLER, 'utf8');
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  assert.ok(start >= 0 && end > start, 'the installer marks its version-boundary block');
  assert.strictEqual(text.indexOf(BEGIN, start + 1), -1, 'the text is held once');
  return text.slice(start, end);
}

// Each case is { field, observed } or { field, absent: true }; the driver reads
// them as JSON from argv so no value passes through shell quoting.
function pythonMessages(cases) {
  const driver = `
import json, sys
TREE_FINGERPRINT_ALGORITHM = 'tree-merkle-v1'
${extractBlock()}
out = []
for case in json.loads(sys.argv[1]):
    if case.get('absent'):
        out.append(version_boundary_message(case['field']))
    else:
        out.append(version_boundary_message(case['field'], case['observed']))
sys.stdout.write(json.dumps(out))
`;
  const result = spawnSync('python3', ['-I', '-c', driver, JSON.stringify(cases)], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const CASES = [
  { name: 'absent', field: 'fingerprint_algorithm', absent: true },
  { name: 'null', field: 'fingerprint_algorithm', observed: null },
  { name: 'unknown string', field: 'fingerprint_algorithm', observed: 'tree-merkle-v9' },
  { name: 'empty string', field: 'fingerprint_algorithm', observed: '' },
  { name: 'non-ASCII', field: 'fingerprint_algorithm', observed: 'algorithme-été-中文' },
  { name: 'astral character', field: 'fingerprint_algorithm', observed: 'v\u{1F600}' },
  { name: 'quote and backslash', field: 'fingerprint_algorithm', observed: 'a"b\\c' },
  { name: 'control characters', field: 'fingerprint_algorithm', observed: 'a\tb\u007f' },
  { name: 'number', field: 'fingerprint_algorithm', observed: 2 },
  { name: 'object', field: 'fingerprint_algorithm', observed: { a: [1, 'b'] } },
];

test('the Python builder equals the Node builder for every observed value', () => {
  const python = pythonMessages(CASES.map(({ name, ...rest }) => rest));
  CASES.forEach((entry, index) => {
    const expected = entry.absent
      ? versionBoundaryMessage(entry.field, undefined)
      : versionBoundaryMessage(entry.field, entry.observed);
    assert.strictEqual(python[index], expected, entry.name);
  });
});

test('the message pins the field, the observed value, the version boundary and both remediation paths', () => {
  const [absent, unknown] = pythonMessages([
    { field: 'fingerprint_algorithm', absent: true },
    { field: 'fingerprint_algorithm', observed: 'x' },
  ]);
  assert.strictEqual(
    absent,
    'fingerprint algorithm field \'fingerprint_algorithm\' must be "tree-merkle-v1" but the observed value is absent; '
    + '0.70.0 accepts only records written by 0.69.x or later; '
    + 'to continue, either upgrade through 0.69.x and run one install or update, or uninstall and reinstall',
  );
  assert.ok(unknown.includes('the observed value is "x";'));
});

run('install-codex-version-boundary');
