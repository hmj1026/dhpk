'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { test, run, assert } = require('./_lib/tinytest');
const { validateOpenaiSubmissionZip } = require('../scripts/lib/openai-submission-zip');

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const OPENAI_EXTENSION = 'com.openai';
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

function crc32Zeroes(length) {
  const block = Buffer.alloc(64 * 1024);
  let crc = 0;
  for (let offset = 0; offset < length; offset += block.length) {
    crc = zlib.crc32(block.subarray(0, Math.min(block.length, length - offset)), crc);
  }
  return crc;
}

function writeStoredZip(zipPath, files, options = {}) {
  const names = Object.keys(files).sort();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const sparse = name === options.sparseEntry;
    const data = sparse ? null : Buffer.from(files[name]);
    const dataLength = sparse ? options.sparseBytes : data.length;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = sparse ? crc32Zeroes(dataLength) : zlib.crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(dataLength),
      u32(dataLength),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
    ]);
    locals.push({ header: local, data, dataLength, sparse });
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(dataLength),
      u32(dataLength),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    centrals.push(central);
    offset += local.length + dataLength;
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
  const fd = fs.openSync(zipPath, 'w');
  let cursor = 0;
  try {
    for (const entry of locals) {
      fs.writeSync(fd, entry.header, 0, entry.header.length, cursor);
      cursor += entry.header.length;
      if (!entry.sparse) fs.writeSync(fd, entry.data, 0, entry.data.length, cursor);
      cursor += entry.dataLength;
    }
    fs.writeSync(fd, centralDir, 0, centralDir.length, cursor);
    cursor += centralDir.length;
    fs.writeSync(fd, eocd, 0, eocd.length, cursor);
  } finally {
    fs.closeSync(fd);
  }
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

function zipEntryRecord(buf, entryName) {
  const eocd = buf.length - 22;
  let cursor = buf.readUInt32LE(eocd + 16);
  const cdEnd = cursor + buf.readUInt32LE(eocd + 12);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i += 1) {
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (name === entryName) return { centralOffset: cursor, localOffset };
    cursor += 46 + nameLength + extraLength + commentLength;
    if (cursor > cdEnd) throw new Error('fixture CD walk missed ' + entryName);
  }
  throw new Error('fixture missing ' + entryName);
}

function setUnixEntryMode(zipPath, entryName, mode) {
  const buf = fs.readFileSync(zipPath);
  const entry = zipEntryRecord(buf, entryName);
  buf.writeUInt16LE(0x0314, entry.centralOffset + 4);
  buf.writeUInt32LE((mode << 16) >>> 0, entry.centralOffset + 38);
  fs.writeFileSync(zipPath, buf);
}

function corruptStoredEntryPayload(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath);
  const entry = zipEntryRecord(buf, entryName);
  const localNameLength = buf.readUInt16LE(entry.localOffset + 26);
  const localExtraLength = buf.readUInt16LE(entry.localOffset + 28);
  const payloadStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  buf[payloadStart] ^= 0x01;
  fs.writeFileSync(zipPath, buf);
}

function listingMetadata(overrides = {}) {
  return Object.assign({
    displayName: CONTROL_DISPLAY_NAME,
    shortDescription: 'Useful workflow skills',
    longDescription: 'A portable collection of useful workflow skills.',
    developerName: 'DHPK Project',
    category: 'Developer Tools',
    defaultPrompt: ['Inspect this repository change.'],
  }, overrides);
}

function portableManifest(listingOverrides = {}, manifestOverrides = {}) {
  const manifest = Object.assign({
    $schema: SCHEMA,
    name: 'dhpk',
    version: '1.0.0',
    description: 'Skills-only fixture.',
    author: { name: 'DHPK Project' },
    extensions: { [OPENAI_EXTENSION]: { interface: listingMetadata(listingOverrides) } },
  }, manifestOverrides);
  if (!Object.prototype.hasOwnProperty.call(manifestOverrides, 'extensions')) {
    manifest.extensions = { [OPENAI_EXTENSION]: { interface: listingMetadata(listingOverrides) } };
  }
  return manifest;
}

function pluginJson(listingOverrides = {}, manifestOverrides = {}) {
  const normalizedOverrides = typeof listingOverrides === 'string'
    ? { displayName: listingOverrides }
    : listingOverrides;
  return `${JSON.stringify(portableManifest(normalizedOverrides, manifestOverrides), null, 2)}\n`;
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

function withZip(files, fn, zipOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-openai-zip-'));
  const zipPath = path.join(dir, 'submission.zip');
  try {
    writeStoredZip(zipPath, files, zipOptions);
    return fn(zipPath, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function validateFixture(files, selectedSkillNames = SELECTED, zipOptions = {}) {
  return withZip(files, (zipPath) => validateOpenaiSubmissionZip(zipPath, { selectedSkillNames }), zipOptions);
}

test('valid portable manifest and selected skill packages pass', () => {
  const result = validateFixture(controlFiles());
  assert.strictEqual(result.ok, true, errorText(result));
  assert.deepStrictEqual(result.extractedFiles.map((entry) => entry.path), [
    'plugin.json',
    'skills/code-trace/SKILL.md',
    'skills/flow-guide/SKILL.md',
  ]);
});

test('valid contained listing SVGs remain in the validated ZIP inventory', () => {
  const iconPath = 'skills/flow-guide/assets/dhpk-icon.svg';
  const iconBytes = Buffer.from([
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">',
    '<rect width="48" height="48" fill="#ffffff"/>',
    '</svg>',
    '',
  ].join('\n'));
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ composerIcon: `./${iconPath}`, logo: `./${iconPath}` }),
    [iconPath]: iconBytes,
  }));
  assert.strictEqual(result.ok, true, errorText(result));
  assert.deepStrictEqual(result.extractedFiles.find((file) => file.path === iconPath), {
    path: iconPath,
    sha256: crypto.createHash('sha256').update(iconBytes).digest('hex'),
  });
});

test('submission ZIP rejects a listing icon that is absent from package contents', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ composerIcon: './skills/flow-guide/assets/missing.svg' }),
  }));
  assert.strictEqual(result.ok, false, 'listing assets must resolve to included ZIP entries');
  assert.match(errorText(result), /composerIcon|missing|asset/i);
});

test('submission ZIP rejects listing asset paths outside the package', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ logo: '../../outside.svg' }),
  }));
  assert.strictEqual(result.ok, false, 'listing asset references must be contained relative paths');
  assert.match(errorText(result), /logo|path|contained|traversal/i);
});

test('submission ZIP rejects active or external-resource SVG content', () => {
  const iconPath = 'skills/flow-guide/assets/dhpk-icon.svg';
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ composerIcon: `./${iconPath}` }),
    [iconPath]: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><script>alert(1)</script></svg>',
  }));
  assert.strictEqual(result.ok, false, 'listing SVGs must use the passive icon profile');
  assert.match(errorText(result), /SVG|active|script|unsafe|external/i);
});

test('submission ZIP rejects CSS imports nested inside SVG style elements', () => {
  const iconPath = 'skills/flow-guide/assets/dhpk-icon.svg';
  const nestedStyleImport = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><style><g>@import "https://example.invalid/x.css";</g></style></svg>';
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ composerIcon: `./${iconPath}` }),
    [iconPath]: nestedStyleImport,
  }));
  assert.strictEqual(result.ok, false, 'SVG style content must not load external stylesheets through nested elements');
  assert.match(errorText(result), /CSS|style|SVG|unsafe|external/i);
});

test('submission ZIP rejects a literal non-breaking space before the SVG root', () => {
  const iconPath = 'skills/flow-guide/assets/dhpk-icon.svg';
  const svg = '\u00a0<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48"/></svg>';
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ composerIcon: `./${iconPath}` }),
    [iconPath]: svg,
  }));
  assert.strictEqual(result.ok, false, 'XML only permits space, tab, CR, and LF around the root element');
  assert.match(errorText(result), /XML|outside|character|text/i);
});

test('submission ZIP rejects screenshots on the skills-only listing profile', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ screenshots: ['./skills/flow-guide/assets/preview.png'] }),
  }));
  assert.strictEqual(result.ok, false, 'the skills-only listing profile does not supply screenshots');
  assert.match(errorText(result), /screenshot|unsupported|skills.only/i);
});

test('root plugin.json is required', () => {
  const files = controlFiles();
  delete files['plugin.json'];
  const result = validateFixture(files);
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /plugin\.json/i);
});

test('plugin.json must be valid JSON', () => {
  const result = validateFixture(controlFiles({ 'plugin.json': '{invalid json' }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /plugin\.json.*invalid|invalid.*plugin\.json/i);
});

test('plugin.json must satisfy the existing portable manifest schema', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({}, { $schema: 'https://example.test/not-portable.json' }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /\$schema|portable/i);
});

test('OpenAI listing must use the current com.openai.interface nesting', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({}, {
      extensions: { 'com.openai.interface': listingMetadata() },
    }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /com\.openai|interface|listing/i);
});

test('portable manifest name must satisfy the existing portable schema', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({}, { name: 'Not a Valid Plugin Name' }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /name|portable/i);
});

test('portable manifest rejects an unknown root declaration', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({}, { hooks: { onInstall: 'run.sh' } }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /hooks|unknown.*field/i);
});

for (const [field, declaration] of [
  ['apps', { apps: [] }],
  ['MCP', { mcpServers: { example: { command: 'run' } } }],
]) {
  test(`portable manifest rejects ${field} declarations`, () => {
    const result = validateFixture(controlFiles({ 'plugin.json': pluginJson({}, declaration) }));
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), field === 'MCP' ? /mcpServers|MCP|unknown/i : /apps|unknown/i);
  });
}

test('OpenAI listing requires every final submission field', () => {
  const missing = ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category'];
  const listing = Object.fromEntries(missing.map((field) => [field, undefined]));
  const result = validateFixture(controlFiles({ 'plugin.json': pluginJson(listing) }));
  assert.strictEqual(result.ok, false);
  for (const field of missing) assert.match(errorText(result), new RegExp(field));
});

test('OpenAI listing requires a supported category', () => {
  const result = validateFixture(controlFiles({ 'plugin.json': pluginJson({ category: 'Unlisted Category' }) }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /category/i);
});

for (const [field, limit] of [
  ['displayName', 30],
  ['shortDescription', 30],
  ['longDescription', 4000],
  ['developerName', 80],
]) {
  test(`OpenAI listing ${field} over ${limit} characters is rejected`, () => {
    const result = validateFixture(controlFiles({
      'plugin.json': pluginJson({ [field]: 'x'.repeat(limit + 1) }),
    }));
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), new RegExp(field));
    assert.match(errorText(result), new RegExp(String(limit)));
  });
}

test('OpenAI listing values at every final length limit are accepted', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({
      displayName: 'd'.repeat(30),
      shortDescription: 's'.repeat(30),
      longDescription: 'l'.repeat(4000),
      developerName: 'n'.repeat(80),
    }),
  }));
  assert.strictEqual(result.ok, true, errorText(result));
});

test('starter prompts accept three unique prompts at the 128-character boundary', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ defaultPrompt: ['a'.repeat(128), 'b'.repeat(128), 'c'.repeat(128)] }),
  }));
  assert.strictEqual(result.ok, true, errorText(result));
});

test('starter prompts reject more than three prompts', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ defaultPrompt: ['one', 'two', 'three', 'four'] }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /prompt/i);
});

test('starter prompts reject empty entries', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ defaultPrompt: [''] }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /prompt|empty|required/i);
});

test('starter prompts reject an entry longer than 128 characters', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ defaultPrompt: ['x'.repeat(129)] }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /prompt/i);
  assert.match(errorText(result), /128/i);
});

test('starter prompts reject MCP server mentions', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ defaultPrompt: ['Use @server to inspect files.'] }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /prompt|mention|@/i);
});

test('starter prompts reject multi-line entries', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ defaultPrompt: ['Inspect this change.\nThen summarize it.'] }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /prompt|line|character/i);
});

test('starter prompts reject duplicates after Unicode and whitespace normalization', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ defaultPrompt: ['Review café notes', 'Review cafe\u0301   notes'] }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /prompt|duplicate/i);
});

test('skills-only listing accepts omitted optional URLs and valid HTTPS URLs', () => {
  const base = validateFixture(controlFiles());
  assert.strictEqual(base.ok, true, errorText(base));
  const url = `https://example.com/${'x'.repeat(1024 - 'https://example.com/'.length)}`;
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({
      websiteURL: url,
      supportURL: url,
      privacyPolicyURL: url,
      termsOfServiceURL: url,
    }),
  }));
  assert.strictEqual(result.ok, true, errorText(result));
});

test('supplied listing URLs must use HTTPS', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ websiteURL: 'http://example.com' }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /websiteURL|HTTPS/i);
});

test('supplied listing URLs reject embedded credentials', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ supportURL: 'https://user:password@example.com/help' }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /supportURL|credential/i);
});

test('supplied listing URLs reject lengths over 1024 characters', () => {
  const result = validateFixture(controlFiles({
    'plugin.json': pluginJson({ privacyPolicyURL: `https://example.com/${'x'.repeat(1024)}` }),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /privacyPolicyURL|1024/i);
});

test('selected skill front matter must identify the selected skill', () => {
  const result = validateFixture(controlFiles({
    'skills/flow-guide/SKILL.md': skillMd('different-skill', 'Fixture body.'),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /flow-guide|front.?matter|name/i);
});

test('selected skill front matter must contain a non-empty description', () => {
  const result = validateFixture(controlFiles({
    'skills/flow-guide/SKILL.md': ['---', 'name: flow-guide', 'description: ""', '---', '', 'Body.', ''].join('\n'),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /description|front.?matter/i);
});

test('selected skill files must contain valid UTF-8', () => {
  const validPrefix = Buffer.from(skillMd('flow-guide', 'Fixture body.'));
  const invalidUtf8 = Buffer.concat([validPrefix, Buffer.from([0xff, 0xfe])]);
  const result = validateFixture(controlFiles({ 'skills/flow-guide/SKILL.md': invalidUtf8 }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /UTF-8|encoding|invalid byte/i);
});

test('missing local markdown resources are rejected', () => {
  const result = validateFixture(controlFiles({
    'skills/flow-guide/SKILL.md': skillMd('flow-guide', 'See [the guide](references/missing.md).'),
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /missing\.md/);
  assert.match(errorText(result), /missing|resource|not found/i);
});

test('nested markdown resources cannot escape the submission ZIP', () => {
  const result = validateFixture(controlFiles({
    'skills/flow-guide/SKILL.md': skillMd('flow-guide', 'See [the guide](references/guide.md).'),
    'skills/flow-guide/references/guide.md': 'See [outside](../../../../outside-secret.md).\n',
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /outside-secret\.md/);
  assert.match(errorText(result), /escape|outside/i);
});

test('ZIP parser rejects a payload whose CRC no longer matches its entry', () => {
  withZip(controlFiles(), (zipPath) => {
    corruptStoredEntryPayload(zipPath, 'skills/flow-guide/SKILL.md');
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /CRC|checksum|corrupt|invalid zip/i);
  });
});

test('ZIP parser rejects entries marked as symbolic links', () => {
  withZip(controlFiles({ 'docs/link.md': 'target.md' }), (zipPath) => {
    setUnixEntryMode(zipPath, 'docs/link.md', 0o120777);
    const result = validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /symlink|symbolic|entry type/i);
  });
});

test('ZIP paths that collide by case folding are rejected', () => {
  const result = validateFixture(controlFiles({
    'docs/Guide.md': 'First file.\n',
    'docs/guide.md': 'Second file.\n',
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /collision|duplicate|normaliz/i);
});

test('ZIP paths that collide after Unicode normalization are rejected', () => {
  const result = validateFixture(controlFiles({
    'docs/caf\u00e9.md': 'First file.\n',
    'docs/cafe\u0301.md': 'Second file.\n',
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /collision|duplicate|normaliz/i);
});

test('ZIP file paths cannot be parents of nested entries after case normalization', () => {
  const result = validateFixture(controlFiles({
    'docs/Folder': 'A file.\n',
    'docs/folder/child.bin': 'A nested file.\n',
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /conflict|nested|directory/i);
});

test('ZIP file paths cannot be parents of nested entries after Unicode normalization', () => {
  const result = validateFixture(controlFiles({
    'docs/caf\u00e9': 'A file.\n',
    'docs/cafe\u0301/child.bin': 'A nested file.\n',
  }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /conflict|nested|directory/i);
});

test('ZIP paths deeper than 20 segments are rejected', () => {
  const deepPath = ['deep', ...Array.from({ length: 20 }, (_, index) => `d${index}`), 'file.md'].join('/');
  assert.strictEqual(deepPath.split('/').length, 22);
  const result = validateFixture(controlFiles({ [deepPath]: 'Too deep.\n' }));
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /depth|segment|20/i);
});

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

test('valid repeated archives share digest and extracted file bytes', () => {
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
  assert.strictEqual(first.result.ok, true, errorText(first.result));
  assert.strictEqual(second.result.ok, true, errorText(second.result));
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

test('compressed ZIP larger than 100,000,000 bytes is rejected', () => {
  const files = controlFiles({ 'docs/large.bin': 'sparse fixture payload' });
  const result = withZip(files, (zipPath) => {
    assert.ok(fs.statSync(zipPath).size > 100000000);
    return validateOpenaiSubmissionZip(zipPath, { selectedSkillNames: SELECTED });
  }, { sparseEntry: 'docs/large.bin', sparseBytes: 100000001 });
  assert.strictEqual(result.ok, false);
  assert.match(errorText(result), /100\s?MB|100,000,000|compressed.*large|archive.*large/i);
});

run('openai-submission-zip');
