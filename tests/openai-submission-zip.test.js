'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { test, run, assert } = require('./_lib/tinytest');
const { validateOpenaiSubmissionZip } = require('../scripts/lib/openai-submission-zip');

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const CONTROL_DISPLAY_NAME = 'DHPK Skills';
const OVER_LIMIT_DISPLAY_NAME = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345';
const SELECTED = ['flow-guide', 'code-trace'];
const HOST_ONLY_SIBLING = 'dhpk-agy-fast-worker';
const ATTESTED_MAX_ENTRIES = 5000;
const ATTESTED_MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
const ATTESTED_MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const OVER_ENTRY_BYTES = ATTESTED_MAX_ENTRY_BYTES + 1;
const EXTRACTED_PAD_COUNT = 6;
const ENTRY_PAD_COUNT = 4998;

function u16(n) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n, 0);
  return buf;
}

function u32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n >>> 0, 0);
  return buf;
}

function writeStoredZip(zipPath, files) {
  const names = Object.keys(files).sort();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const data = Buffer.from(files[name]);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      data,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(names.length),
    u16(names.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  fs.writeFileSync(zipPath, Buffer.concat([...locals, centralDir, eocd]));
}

function setStoredClaimedSizes(zipPath, entryName, claimedBytes) {
  const buf = fs.readFileSync(zipPath);
  const eocd = buf.length - 22;
  let cursor = buf.readUInt32LE(eocd + 16);
  const cdEnd = cursor + buf.readUInt32LE(eocd + 12);
  const n = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < n; i += 1) {
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOff = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    if (name === entryName) {
      buf.writeUInt32LE(claimedBytes >>> 0, cursor + 20);
      buf.writeUInt32LE(claimedBytes >>> 0, cursor + 24);
      buf.writeUInt32LE(claimedBytes >>> 0, localOff + 18);
      buf.writeUInt32LE(claimedBytes >>> 0, localOff + 22);
      fs.writeFileSync(zipPath, buf);
      return;
    }
    cursor = cursor + 46 + nameLen + extraLen + commentLen;
    if (cursor > cdEnd) throw new Error('fixture CD walk missed ' + entryName);
  }
  throw new Error('fixture missing ' + entryName);
}

function pluginJson(displayName) {
  return [
    '{',
    `  "$schema": ${JSON.stringify(SCHEMA)},`,
    '  "name": "dhpk",',
    '  "version": "0.0.0",',
    '  "description": "Skills-only fixture",',
    '  "extensions": {',
    '    "com.openai.interface": {',
    `      "displayName": ${JSON.stringify(displayName)},`,
    '      "shortDescription": "Skills-only fixture"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}

function skillMd(name, body) {
  return [
    '---',
    `name: ${name}`,
    'description: Fixture skill.',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

function controlFiles(overrides) {
  return Object.assign({
    'plugin.json': pluginJson(CONTROL_DISPLAY_NAME),
    'skills/flow-guide/SKILL.md': skillMd('flow-guide', 'Fixture body.'),
    'skills/code-trace/SKILL.md': skillMd('code-trace', 'Fixture body.'),
  }, overrides);
}

function extractedList(files) {
  return Object.keys(files).sort().map((filePath) => ({
    path: filePath,
    sha256: crypto.createHash('sha256').update(Buffer.from(files[filePath])).digest('hex'),
  }));
}

function errorText(result) {
  return (result.errors || []).join('\n');
}

function withZip(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-openai-zip-'));
  const zipPath = path.join(dir, 'submission.zip');
  try {
    writeStoredZip(zipPath, files);
    return fn(zipPath, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('extra selected catalog entry is rejected', () => {
  const files = controlFiles({
    'skills/code-trace/SKILL.md': undefined,
    [`skills/${HOST_ONLY_SIBLING}/SKILL.md`]: skillMd(HOST_ONLY_SIBLING, 'Host-only fixture.'),
  });
  delete files['skills/code-trace/SKILL.md'];
  withZip(files, (zipPath) => {
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: ['flow-guide'] });
    assert.strictEqual(result.ok, false);
    const text = errorText(result);
    assert.match(text, new RegExp(HOST_ONLY_SIBLING));
    assert.match(text, /extra|unexpected|not in selected|host-only/i);
  });
});

test('missing selected catalog entry is rejected', () => {
  const files = controlFiles();
  delete files['skills/code-trace/SKILL.md'];
  withZip(files, (zipPath) => {
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    const text = errorText(result);
    assert.match(text, /code-trace/);
    assert.match(text, /missing|absent|not present/i);
  });
});

test('invalid sibling without SKILL.md is not a silent PASS', () => {
  const files = controlFiles({
    'skills/code-trace/SKILL.md': undefined,
    'skills/code-trace/README.md': 'not a skill\n',
  });
  delete files['skills/code-trace/SKILL.md'];
  withZip(files, (zipPath) => {
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    const text = errorText(result);
    assert.match(text, /code-trace/);
    assert.match(text, /invalid|SKILL\.md/i);
  });
});

test('hooks content is rejected', () => {
  const files = controlFiles({ 'hooks/hooks.json': '{"hooks":{}}\n' });
  withZip(files, (zipPath) => {
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /\bhooks\b/i);
  });
});

test('apps content is rejected', () => {
  const files = controlFiles({ 'apps/placeholder.json': '{}\n' });
  withZip(files, (zipPath) => {
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /\bapps\b/i);
  });
});

test('MCP content is rejected', () => {
  const files = controlFiles({ 'mcp.json': '{"mcpServers":{}}\n' });
  withZip(files, (zipPath) => {
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /\bmcp\b/i);
  });
});

test('resource outside the extracted package is rejected', () => {
  const files = controlFiles({
    'skills/flow-guide/SKILL.md': skillMd('flow-guide', 'See the secret](../../outside-secret.md)'),
  });
  withZip(files, (zipPath) => {
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    const text = errorText(result);
    assert.match(text, /flow-guide/);
    assert.match(text, /outside-secret\.md/);
    assert.match(text, /escape|outside/i);
  });
});

test('listing displayName over the attested 30-character final limit is rejected', () => {
  assert.strictEqual(OVER_LIMIT_DISPLAY_NAME.length, 31);
  const files = controlFiles({ 'plugin.json': pluginJson(OVER_LIMIT_DISPLAY_NAME) });
  withZip(files, (zipPath) => {
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    const text = errorText(result);
    assert.match(text, /displayName/);
    assert.match(text, /31/);
    assert.match(text, /30/);
  });
});

test('two builds share archive digest and extracted file bytes', () => {
  const files = controlFiles();
  const expectedExtracted = extractedList(files);
  const first = withZip(files, (zipPath) => {
    const zipHash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    return { zipHash, result };
  });
  const second = withZip(files, (zipPath) => {
    const zipHash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    return { zipHash, result };
  });
  assert.strictEqual(first.zipHash, second.zipHash);
  assert.match(String(first.result.archiveDigest || ''), /^[a-f0-9]{64}$/);
  assert.match(String(second.result.archiveDigest || ''), /^[a-f0-9]{64}$/);
  assert.strictEqual(first.result.archiveDigest, second.result.archiveDigest);
  assert.strictEqual(first.result.archiveDigest, first.zipHash);
  assert.strictEqual(second.result.archiveDigest, second.zipHash);
  assert.deepStrictEqual(first.result.extractedFiles, expectedExtracted);
  assert.deepStrictEqual(second.result.extractedFiles, expectedExtracted);
});

test('archive with 5001 entries exceeds the attested 5000-entry limit', () => {
  const files = controlFiles();
  for (let i = 0; i < ENTRY_PAD_COUNT; i += 1) {
    files[`skills/flow-guide/pad-${String(i).padStart(4, '0')}`] = 'x';
  }
  assert.strictEqual(Object.keys(files).length, ATTESTED_MAX_ENTRIES + 1);
  withZip(files, (zipPath) => {
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    const text = errorText(result);
    assert.match(text, /entry count/i);
    assert.match(text, /5001/);
    assert.match(text, /5000/);
  });
});

test('header-claimed single-entry uncompressed size over the attested 100 MiB limit is rejected', () => {
  const files = controlFiles({ 'skills/flow-guide/pad': 'x' });
  withZip(files, (zipPath) => {
    setStoredClaimedSizes(zipPath, 'skills/flow-guide/pad', OVER_ENTRY_BYTES);
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    const text = errorText(result);
    assert.match(text, /uncompressed/i);
    assert.match(text, /100/);
    assert.match(text, /MiB/);
    assert.match(text, /104857601/);
    assert.strictEqual((result.errors || []).includes('invalid zip'), false);
    assert.doesNotMatch(text, /unsupported compression method/);
  });
});

test('header-claimed extracted size over the attested 512 MiB limit is rejected', () => {
  assert.ok(EXTRACTED_PAD_COUNT * ATTESTED_MAX_ENTRY_BYTES > ATTESTED_MAX_EXTRACTED_BYTES);
  const files = controlFiles();
  for (let i = 0; i < EXTRACTED_PAD_COUNT; i += 1) {
    files[`skills/flow-guide/pad-${i}`] = 'x';
  }
  withZip(files, (zipPath) => {
    for (let i = 0; i < EXTRACTED_PAD_COUNT; i += 1) {
      setStoredClaimedSizes(zipPath, `skills/flow-guide/pad-${i}`, ATTESTED_MAX_ENTRY_BYTES);
    }
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    const text = errorText(result);
    assert.match(text, /extracted/i);
    assert.match(text, /512/);
    assert.match(text, /MiB/);
    assert.strictEqual((result.errors || []).includes('invalid zip'), false);
    assert.doesNotMatch(text, /unsupported compression method/);
    assert.doesNotMatch(text, /100 MiB per-entry/);
  });
});

// Compressed archive 100 MB stays NOT_RUN: zipBytes.length cannot be faked
// from headers, and this unit file does not pack 100 MB. Verification-stage
// wider limits have no numbers in 1.4 evidence. Codex 2% / 8,000-character
// listing budget is 6.7, not this ZIP gate.

run('openai-submission-zip');
