'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, run } = require('./_lib/tinytest');
const {
  encodeOpenaiSubmissionZip,
  validateOpenaiSubmissionBytes,
} = require('../scripts/lib/openai-submission-zip');

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

function validFiles() {
  return [
    {
      path: 'plugin.json',
      bytes: Buffer.from(JSON.stringify({
        $schema: SCHEMA,
        name: 'dhpk',
        version: '1.0.0',
        description: 'Portable workflow skills.',
        extensions: {
          'com.openai': {
            interface: {
              displayName: 'DHPK Skills',
              shortDescription: 'Useful workflow skills',
              longDescription: 'A portable collection of useful workflow skills.',
              developerName: 'DHPK Project',
              category: 'Developer Tools',
            },
          },
        },
      })),
      mode: 0o644,
    },
    {
      path: 'skills/flow-guide/SKILL.md',
      bytes: Buffer.from('---\nname: flow-guide\ndescription: Routes workflow requests.\n---\n\nUse the relevant workflow.\n'),
      mode: 0o644,
    },
    {
      path: 'skills/flow-guide/scripts/run.sh',
      bytes: Buffer.from('#!/bin/sh\nexit 0\n'),
      mode: 0o755,
    },
    {
      path: 'docs/caf\u00e9.md',
      bytes: Buffer.from('UTF-8 path.\n'),
      mode: 0o644,
    },
  ];
}

function sortedPaths(files) {
  return files.map(({ path }) => path)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

test('submission ZIP encoding is deterministic and readable by Python zipfile', () => {
  const first = encodeOpenaiSubmissionZip(validFiles());
  const second = encodeOpenaiSubmissionZip(validFiles());
  assert.deepStrictEqual(first, second);

  const python = [
    'import io, json, stat, sys, zipfile',
    'archive = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))',
    'infos = archive.infolist()',
    'names = [entry.filename for entry in infos]',
    'assert names == sorted(names, key=lambda value: value.encode("utf-8"))',
    'assert all(entry.compress_type == zipfile.ZIP_STORED for entry in infos)',
    'assert all(entry.date_time == (1980, 1, 1, 0, 0, 0) for entry in infos)',
    'assert archive.testzip() is None',
    'modes = {entry.filename: stat.S_IMODE(entry.external_attr >> 16) for entry in infos}',
    'print(json.dumps({"names": names, "modes": modes}, ensure_ascii=False))',
  ].join('\n');
  const report = JSON.parse(execFileSync('python3', ['-c', python], { input: first, encoding: 'utf8' }));
  assert.deepStrictEqual(report.names, sortedPaths(validFiles()));
  assert.strictEqual(report.modes['skills/flow-guide/scripts/run.sh'], 0o755);
  assert.strictEqual(report.modes['docs/caf\u00e9.md'], 0o644);
});

test('submission ZIP bytes validate through the public bytes API', () => {
  const bytes = encodeOpenaiSubmissionZip(validFiles());
  const result = validateOpenaiSubmissionBytes(bytes, { selectedSkillNames: ['flow-guide'] });
  const expectedDigest = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.strictEqual(result.ok, true, result.errors.join('\n'));
  assert.strictEqual(result.archiveDigest, expectedDigest);
  assert.deepStrictEqual(result.extractedFiles.map((entry) => entry.path), sortedPaths(validFiles()));
});

test('submission ZIP encoding rejects unsafe and normalized-colliding paths', () => {
  assert.throws(
    () => encodeOpenaiSubmissionZip({ '../outside.txt': 'escape' }),
    /unsafe|path/i,
  );
  assert.throws(
    () => encodeOpenaiSubmissionZip({ 'docs/Guide.md': 'a', 'docs/guide.md': 'b' }),
    /collid|normaliz/i,
  );
});

run('openai-submission-encoding');
