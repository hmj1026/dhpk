'use strict';

// Skills-only OpenAI submission ZIP codec and validation gate.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { TextDecoder } = require('node:util');
const {
  normalizePortableFrontmatter,
  validatePortableManifest,
} = require('./agent-plugin-package');
const { validateOpenaiListingAssets } = require('./openai-submission-assets');

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const DISPLAY_NAME_LIMIT = 30;
const GP_DATA_DESCRIPTOR = 0x0008;
const GP_UTF8 = 0x0800;
const ZIP64_SENTINEL = 0xffffffff;
const MAX_ZIP_ENTRIES = 5000;
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_COMPRESSED_ZIP_BYTES = 100000000;
const MAX_PATH_SEGMENTS = 20;
const OPENAI_EXTENSION = 'com.openai';
const OPENAI_CATEGORIES = new Set([
  'Productivity', 'Creativity', 'Developer Tools', 'Business & Operations',
  'Data & Analytics', 'Communication', 'Education & Research', 'Security',
  'Finance', 'Healthcare', 'Travel', 'Entertainment', 'Other',
]);
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function u16(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value, 0);
  return bytes;
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0, 0);
  return bytes;
}

function result(errors, archiveDigest, extractedFiles) {
  return {
    ok: errors.length === 0,
    errors,
    archiveDigest: archiveDigest || '',
    extractedFiles: Array.isArray(extractedFiles) ? extractedFiles : [],
  };
}

// Finds local destinations in Markdown links and images while skipping code.
function markdownTargets(content, documentRelative = 'SKILL.md') {
  const links = [];
  const add = (raw, documentRelativeTarget) => {
    if (typeof raw !== 'string') return;
    const value = raw.replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
    if (!value || /^(?:[a-z]+:|\/|#)/i.test(value)) return;
    const candidate = path.posix.normalize(path.posix.join(
      path.posix.dirname(documentRelativeTarget),
      value,
    ));
    links.push({ path: candidate, raw: value, document: documentRelativeTarget });
  };
  const source = String(content)
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
  const markdown = /\]\(\s*<?([^\s)>]+)>?/g;
  let match;
  while ((match = markdown.exec(source)) !== null) {
    add(match[1], documentRelative);
  }
  return links;
}

function unsafeZipName(name) {
  if (!name || name.includes('\0') || name.includes('\\') || path.posix.isAbsolute(name)
    || /^[a-z]:/i.test(name)) {
    return true;
  }
  return name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function readU16(buf, off) {
  if (off < 0 || off + 2 > buf.length) throw new Error('truncated zip');
  return buf.readUInt16LE(off);
}

function readU32(buf, off) {
  if (off < 0 || off + 4 > buf.length) throw new Error('truncated zip');
  return buf.readUInt32LE(off);
}

function findEocd(buf) {
  if (buf.length < 22) return -1;
  const exact = buf.length - 22;
  if (readU32(buf, exact) === EOCD_SIG && readU16(buf, exact + 20) === 0) return exact;
  const min = Math.max(0, buf.length - (65535 + 22));
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (readU32(buf, i) === EOCD_SIG) {
      const commentLen = readU16(buf, i + 20);
      if (i + 22 + commentLen === buf.length) return i;
    }
  }
  return -1;
}

function parseStoredZip(zipBytes, errors) {
  const extracted = Object.create(null);
  const eocd = findEocd(zipBytes);
  if (eocd < 0) {
    errors.push('invalid zip');
    return extracted;
  }
  const disk = readU16(zipBytes, eocd + 4);
  const cdDisk = readU16(zipBytes, eocd + 6);
  const entriesThisDisk = readU16(zipBytes, eocd + 8);
  const entriesTotal = readU16(zipBytes, eocd + 10);
  const cdSize = readU32(zipBytes, eocd + 12);
  const cdOffset = readU32(zipBytes, eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || entriesThisDisk !== entriesTotal
    || cdSize === ZIP64_SENTINEL || cdOffset === ZIP64_SENTINEL) {
    errors.push('invalid zip');
    return extracted;
  }
  const commentLength = readU16(zipBytes, eocd + 20);
  const cdEnd = cdOffset + cdSize;
  if (cdEnd !== eocd || eocd + 22 + commentLength !== zipBytes.length) {
    errors.push('invalid zip');
    return extracted;
  }
  if (entriesTotal > MAX_ZIP_ENTRIES) {
    errors.push(`archive entry count ${entriesTotal} exceeds the attested ${MAX_ZIP_ENTRIES}-entry limit`);
    return extracted;
  }
  let cursor = cdOffset;
  let extractedTotal = 0;
  const pathKinds = new Map();
  const normalizedPaths = new Map();
  const localRanges = [];
  for (let i = 0; i < entriesTotal; i += 1) {
    if (cursor + 46 > cdEnd || readU32(zipBytes, cursor) !== CENTRAL_SIG) {
      errors.push('invalid zip');
      break;
    }
    const centralStart = cursor;
    const flags = readU16(zipBytes, cursor + 8);
    const method = readU16(zipBytes, cursor + 10);
    const crc = readU32(zipBytes, cursor + 16);
    const compressed = readU32(zipBytes, cursor + 20);
    const uncompressed = readU32(zipBytes, cursor + 24);
    const nameLen = readU16(zipBytes, cursor + 28);
    const extraLen = readU16(zipBytes, cursor + 30);
    const commentLen = readU16(zipBytes, cursor + 32);
    const diskStart = readU16(zipBytes, cursor + 34);
    const externalAttributes = readU32(zipBytes, cursor + 38);
    const localOff = readU32(zipBytes, cursor + 42);
    const nameStart = cursor + 46;
    const nextCursor = nameStart + nameLen + extraLen + commentLen;
    if (nextCursor > cdEnd || diskStart !== 0) {
      errors.push('invalid zip');
      break;
    }
    const nameBytes = zipBytes.subarray(nameStart, nameStart + nameLen);
    cursor = nextCursor;
    let name;
    try {
      name = UTF8.decode(nameBytes);
    } catch {
      errors.push('zip entry path is not valid UTF-8');
      continue;
    }
    const hasTrailingSlash = name.endsWith('/');
    const normalizedName = hasTrailingSlash ? name.slice(0, -1) : name;
    if (unsafeZipName(normalizedName)) {
      errors.push(`zip entry ${name} escapes outside the archive root`);
      continue;
    }
    if (name !== name.trim()) {
      errors.push(`zip entry path ${name} has outer whitespace`);
      continue;
    }
    if (normalizedName.split('/').length > MAX_PATH_SEGMENTS) {
      errors.push(`zip entry path ${name} exceeds the ${MAX_PATH_SEGMENTS}-segment depth limit`);
      continue;
    }
    const normalizedKey = normalizedName.normalize('NFC').toLowerCase().normalize('NFC');
    if (normalizedPaths.has(normalizedKey)) {
      const previous = normalizedPaths.get(normalizedKey);
      errors.push(previous === normalizedName
        ? `zip entry ${name} is duplicated`
        : `zip entry ${name} collides with ${previous} after case or Unicode normalization`);
      continue;
    }
    normalizedPaths.set(normalizedKey, normalizedName);

    const madeBy = readU16(zipBytes, centralStart + 4);
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const unixType = (madeBy >>> 8) === 3 ? unixMode & 0o170000 : 0;
    if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) {
      errors.push(`zip entry ${name} has unsupported file type or is a symbolic link`);
      continue;
    }
    const isDirectory = hasTrailingSlash || unixType === 0o040000;
    pathKinds.set(normalizedKey, isDirectory ? 'directory' : 'file');
    if ((flags & GP_DATA_DESCRIPTOR) !== 0 || (flags & ~(GP_UTF8)) !== 0
      || method !== 0 || compressed !== uncompressed) {
      errors.push(`zip entry ${name} uses unsupported compression method ${method}`);
      continue;
    }
    if (uncompressed > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      errors.push(
        `zip entry ${name} uncompressed size ${uncompressed} exceeds the attested 100 MiB per-entry limit`
      );
      continue;
    }
    if (!isDirectory && extractedTotal + uncompressed > MAX_EXTRACTED_BYTES) {
      errors.push(
        `archive extracted size ${extractedTotal + uncompressed} exceeds the attested 512 MiB limit`
      );
      continue;
    }
    if (!isDirectory) extractedTotal += uncompressed;
    if (localOff + 30 > zipBytes.length || readU32(zipBytes, localOff) !== LOCAL_SIG) {
      errors.push('invalid zip');
      continue;
    }
    const localFlags = readU16(zipBytes, localOff + 6);
    const localMethod = readU16(zipBytes, localOff + 8);
    const localCrc = readU32(zipBytes, localOff + 14);
    const localCompressed = readU32(zipBytes, localOff + 18);
    const localUncompressed = readU32(zipBytes, localOff + 22);
    const localNameLen = readU16(zipBytes, localOff + 26);
    const localExtraLen = readU16(zipBytes, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressed;
    if (localFlags !== flags || localMethod !== method || localCrc !== crc
      || localCompressed !== compressed || localUncompressed !== uncompressed
      || localNameLen !== nameLen
      || !zipBytes.subarray(localOff + 30, localOff + 30 + localNameLen).equals(nameBytes)) {
      errors.push(`zip entry ${name} local and central headers disagree`);
      continue;
    }
    if (dataEnd > cdOffset || dataEnd > zipBytes.length) {
      errors.push(`zip entry ${name} payload is shorter than claimed uncompressed size`);
      continue;
    }
    const payload = zipBytes.subarray(dataStart, dataEnd);
    if (zlib.crc32(payload) !== crc) {
      errors.push(`zip entry ${name} CRC checksum does not match its payload`);
      continue;
    }
    localRanges.push([localOff, dataEnd, name]);
    if (isDirectory) {
      if (compressed !== 0 || uncompressed !== 0) {
        errors.push(`zip directory entry ${name} must not contain a payload`);
      }
      continue;
    }
    extracted[name] = Buffer.from(payload);
  }
  if (cursor !== cdEnd) errors.push('invalid zip');
  localRanges.sort((left, right) => left[0] - right[0]);
  for (let i = 1; i < localRanges.length; i += 1) {
    if (localRanges[i][0] < localRanges[i - 1][1]) {
      errors.push(`zip entries ${localRanges[i - 1][2]} and ${localRanges[i][2]} overlap`);
    }
  }
  for (const [filePath, kind] of pathKinds) {
    const segments = filePath.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const parent = pathKinds.get(segments.slice(0, i).join('/'));
      if (parent === 'file') {
        errors.push(`zip file path ${segments.slice(0, i).join('/')} conflicts with normalized path ${filePath}`);
        break;
      }
    }
    if (kind === 'file') {
      const prefix = `${filePath}/`;
      if ([...pathKinds.keys()].some((candidate) => candidate.startsWith(prefix))) {
        errors.push(`zip file path ${filePath} conflicts with a nested entry`);
      }
    }
  }
  return extracted;
}

function skillDirectoryNames(extracted) {
  const present = new Set();
  const withSkillMd = new Set();
  for (const filePath of Object.keys(extracted)) {
    const parts = filePath.split('/');
    if (parts.length < 3 || parts[0] !== 'skills') continue;
    const name = parts[1];
    present.add(name);
    if (filePath === `skills/${name}/SKILL.md`) withSkillMd.add(name);
  }
  return { present, withSkillMd };
}

function selectedNames(options) {
  const raw = options && Array.isArray(options.selectedSkillNames)
    ? options.selectedSkillNames
    : [];
  return new Set(raw.filter((name) => typeof name === 'string'));
}

function validateCatalog(extracted, options, errors) {
  const { present, withSkillMd } = skillDirectoryNames(extracted);
  const selected = selectedNames(options);
  for (const filePath of Object.keys(extracted)) {
    if (filePath === 'skills' || (filePath.startsWith('skills/') && filePath.split('/').length < 3)) {
      errors.push(`skills entry ${filePath} must be inside a skill directory`);
    }
  }
  for (const name of selected) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) || name.includes('--')) {
      errors.push(`selected skill name '${name}' is invalid`);
    }
  }
  for (const name of present) {
    if (!selected.has(name)) {
      errors.push(`skills/${name} is extra (not in selected; host-only)`);
    }
  }
  for (const name of selected) {
    if (!present.has(name)) {
      errors.push(`selected skill ${name} is missing (absent / not present)`);
      continue;
    }
    if (!withSkillMd.has(name)) {
      errors.push(`skills/${name} is invalid (SKILL.md)`);
      continue;
    }
    const content = extracted[`skills/${name}/SKILL.md`];
    if (!content) continue;
    const normalized = normalizePortableFrontmatter(content.toString('utf8'));
    for (const frontmatterError of normalized.errors) {
      errors.push(`skills/${name}/SKILL.md is invalid: ${frontmatterError}`);
    }
    if (normalized.name !== name) {
      errors.push(`skills/${name}/SKILL.md frontmatter name '${normalized.name}' does not match selected skill`);
    }
  }
}

function validateForbidden(extracted, errors) {
  const seen = new Set();
  for (const filePath of Object.keys(extracted)) {
    const first = filePath.split('/')[0];
    if (first === 'hooks' && !seen.has('hooks')) {
      seen.add('hooks');
      errors.push('hooks content is rejected');
    }
    if (first === 'apps' && !seen.has('apps')) {
      seen.add('apps');
      errors.push('apps content is rejected');
    }
    if ((first === 'mcp' || filePath === 'mcp.json') && !seen.has('mcp')) {
      seen.add('mcp');
      errors.push('mcp content is rejected');
    }
  }
}

function validateTextEncoding(extracted, errors) {
  const textFile = /(?:^plugin\.json$|\.(?:md|json|ya?ml|txt|toml|xml|svg|html?|css|js|ts|sh|py|csv))$/i;
  for (const filePath of Object.keys(extracted)) {
    if (!textFile.test(filePath)) continue;
    try {
      UTF8.decode(extracted[filePath]);
    } catch {
      errors.push(`${filePath} is not valid UTF-8`);
    }
  }
}

function validateMarkdownResources(extracted, errors) {
  for (const [filePath, bytes] of Object.entries(extracted)) {
    const match = filePath.match(/^skills\/([^/]+)\/(.+\.md)$/i);
    if (!match) continue;
    let content;
    try {
      content = UTF8.decode(bytes);
    } catch {
      continue;
    }
    const [, skillName, documentRelative] = match;
    for (const link of markdownTargets(content, documentRelative)) {
      if (link.path === '..' || link.path.startsWith('../')) {
        errors.push(`${filePath} markdown resource ${link.raw} escapes outside its skill package`);
        continue;
      }
      const target = path.posix.join('skills', skillName, link.path);
      if (!Object.prototype.hasOwnProperty.call(extracted, target)) {
        errors.push(`${filePath} markdown resource ${link.raw} is missing from the skill package`);
      }
    }
  }
}

function textLength(value) {
  return Array.from(value).length;
}

function validateTextField(listing, field, maximum, errors, options = {}) {
  const value = listing[field];
  const label = `OpenAI listing ${field}`;
  if (typeof value !== 'string') {
    errors.push(`${label} is required and must be a string`);
    return;
  }
  if (value.trim().length === 0) errors.push(`${label} must not be empty`);
  const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/u;
  if (controls.test(value) || (!options.multiline && /[\r\n]/u.test(value))) {
    errors.push(`${label} contains unsupported characters or line breaks`);
  }
  const actualLength = textLength(value);
  if (actualLength > maximum) {
    errors.push(`${label} length ${actualLength} exceeds the ${maximum}-character final limit`);
  }
}

function validateListingUrls(listing, errors) {
  for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    if (!Object.prototype.hasOwnProperty.call(listing, field)) continue;
    const value = listing[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`OpenAI listing ${field} must be a non-empty HTTPS URL when supplied`);
      continue;
    }
    if (textLength(value) > 1024) {
      errors.push(`OpenAI listing ${field} length exceeds the 1024-character final limit`);
    }
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !url.hostname) {
        errors.push(`OpenAI listing ${field} must be an HTTPS URL with a host`);
      }
      if (url.username || url.password) errors.push(`OpenAI listing ${field} must not contain URL credentials`);
    } catch {
      errors.push(`OpenAI listing ${field} must be a valid HTTPS URL`);
    }
  }
}

function validateStarterPrompts(listing, errors) {
  if (!Object.prototype.hasOwnProperty.call(listing, 'defaultPrompt')) return;
  const raw = listing.defaultPrompt;
  const prompts = typeof raw === 'string' ? [raw] : raw;
  if (!Array.isArray(prompts)) {
    errors.push('OpenAI listing defaultPrompt must be a string or an array of strings');
    return;
  }
  if (prompts.length > 3) errors.push('OpenAI listing defaultPrompt must contain at most three prompts');
  const normalized = new Set();
  for (const [index, prompt] of prompts.entries()) {
    if (typeof prompt !== 'string') {
      errors.push(`OpenAI listing defaultPrompt entry ${index + 1} must be a string`);
      continue;
    }
    validateTextField({ defaultPrompt: prompt }, 'defaultPrompt', 128, errors);
    if (/@[A-Za-z0-9][A-Za-z0-9._-]*/u.test(prompt)) {
      errors.push('OpenAI listing defaultPrompt must not contain MCP server @mentions');
    }
    const key = prompt.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (normalized.has(key)) errors.push('OpenAI listing defaultPrompt entries must be unique after Unicode and whitespace normalization');
    normalized.add(key);
  }
}

function validateListingFields(listing, errors) {
  for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category']) {
    if (!Object.prototype.hasOwnProperty.call(listing, field)) {
      errors.push(`OpenAI listing ${field} is required`);
    }
  }
  validateTextField(listing, 'displayName', DISPLAY_NAME_LIMIT, errors);
  validateTextField(listing, 'shortDescription', 30, errors);
  validateTextField(listing, 'longDescription', 4000, errors, { multiline: true });
  validateTextField(listing, 'developerName', 80, errors);
  if (typeof listing.category !== 'string' || !OPENAI_CATEGORIES.has(listing.category)) {
    errors.push(`OpenAI listing category must be one of the supported categories`);
  }
  validateStarterPrompts(listing, errors);
  validateListingUrls(listing, errors);
  if (Object.prototype.hasOwnProperty.call(listing, 'capabilities')) {
    if (!Array.isArray(listing.capabilities)) {
      errors.push('OpenAI listing capabilities must be an array of strings');
    } else {
      if (listing.capabilities.length > 20) errors.push('OpenAI listing capabilities must contain at most 20 entries');
      for (const [index, capability] of listing.capabilities.entries()) {
        if (typeof capability !== 'string') {
          errors.push(`OpenAI listing capability ${index + 1} must be a string`);
        } else {
          validateTextField({ capability }, 'capability', 120, errors);
        }
      }
    }
  }
}

function validateManifestDeclarations(plugin, errors) {
  const forbidden = new Set(['hooks', 'apps', 'mcp', 'mcpServers']);
  const extension = plugin.extensions && plugin.extensions[OPENAI_EXTENSION];
  for (const [pathLabel, value] of [
    ['plugin.json', plugin],
    ['plugin.json extensions.com.openai', extension],
    ['plugin.json extensions.com.openai.interface', extension && extension.interface],
  ]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const key of forbidden) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${pathLabel}.${key} is unsupported in a skills-only submission`);
      }
    }
  }
}

function validateListing(extracted, errors) {
  if (!Object.prototype.hasOwnProperty.call(extracted, 'plugin.json')) {
    errors.push('submission ZIP is missing required root plugin.json');
    return;
  }
  let plugin;
  try {
    plugin = JSON.parse(UTF8.decode(extracted['plugin.json']));
  } catch {
    errors.push('plugin.json is invalid JSON or UTF-8');
    return;
  }
  errors.push(...validatePortableManifest(plugin).errors);
  if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) return;
  validateManifestDeclarations(plugin, errors);
  const extension = plugin.extensions && plugin.extensions[OPENAI_EXTENSION];
  const listing = extension && extension.interface;
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) {
    errors.push('plugin.json must include extensions.com.openai.interface listing metadata');
    return;
  }
  validateListingFields(listing, errors);
  errors.push(...validateOpenaiListingAssets(listing, new Map(Object.entries(extracted))));
}

function validateOpenaiSubmissionBytes(zipBytes, options) {
  const errors = [];
  if (!Buffer.isBuffer(zipBytes)) {
    return result(['submission ZIP bytes must be a Buffer'], '', []);
  }
  if (zipBytes.length > MAX_COMPRESSED_ZIP_BYTES) {
    return result([`compressed ZIP size ${zipBytes.length} exceeds the 100,000,000-byte (100 MB) limit`], '', []);
  }
  const archiveDigest = sha256hex(zipBytes);
  let extracted = Object.create(null);
  try {
    extracted = parseStoredZip(zipBytes, errors);
  } catch (error) {
    errors.push(error && error.message ? error.message : 'invalid zip');
  }
  const extractedFiles = Object.keys(extracted).sort().map((filePath) => ({
    path: filePath,
    sha256: sha256hex(extracted[filePath]),
  }));
  validateCatalog(extracted, options, errors);
  validateForbidden(extracted, errors);
  validateTextEncoding(extracted, errors);
  validateMarkdownResources(extracted, errors);
  validateListing(extracted, errors);
  return result(errors, archiveDigest, extractedFiles);
}

function validateOpenaiSubmissionZip(zipPath, options) {
  try {
    const stat = fs.lstatSync(zipPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return result(['submission ZIP must be a regular file'], '', []);
    }
    if (stat.size > MAX_COMPRESSED_ZIP_BYTES) {
      return result([`compressed ZIP size ${stat.size} exceeds the 100,000,000-byte (100 MB) limit`], '', []);
    }
    return validateOpenaiSubmissionBytes(fs.readFileSync(zipPath), options);
  } catch (error) {
    return result([error && error.message ? error.message : 'invalid zip'], '', []);
  }
}

function encodeOpenaiSubmissionZip(files) {
  if (!files || typeof files !== 'object') {
    throw new TypeError('submission ZIP files must be an array of file descriptors or a path map');
  }
  const entries = Array.isArray(files)
    ? files.map((entry) => {
      if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') {
        throw new TypeError('submission ZIP file descriptors require a string path');
      }
      return [entry.path, entry];
    })
    : Object.entries(files);
  entries.sort((left, right) => Buffer.compare(Buffer.from(left[0]), Buffer.from(right[0])));
  const names = entries.map(([filePath]) => filePath);
  if (names.length === 0 || names.length > MAX_ZIP_ENTRIES) {
    throw new RangeError(`submission ZIP must contain between 1 and ${MAX_ZIP_ENTRIES} files`);
  }
  const paths = new Set();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let extractedTotal = 0;
  let projectedSize = 22;
  for (const [filePath, descriptor] of entries) {
    if (unsafeZipName(filePath) || filePath !== filePath.trim()
      || filePath.split('/').length > MAX_PATH_SEGMENTS) {
      throw new Error(`unsafe or over-deep submission ZIP path: ${filePath}`);
    }
    const pathKey = filePath.normalize('NFC').toLowerCase().normalize('NFC');
    if (paths.has(pathKey)) throw new Error(`submission ZIP paths collide after normalization: ${filePath}`);
    paths.add(pathKey);
    const content = Buffer.isBuffer(descriptor) || typeof descriptor === 'string'
      ? descriptor
      : descriptor && (descriptor.bytes !== undefined
        ? descriptor.bytes
        : descriptor.content !== undefined ? descriptor.content : descriptor.data);
    if (!Buffer.isBuffer(content) && typeof content !== 'string') {
      throw new TypeError(`submission ZIP entry ${filePath} must provide string or Buffer content`);
    }
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const modeValue = descriptor && typeof descriptor === 'object' ? descriptor.mode : undefined;
    const mode = modeValue === undefined ? (descriptor && descriptor.executable ? 0o755 : 0o644) : modeValue & 0o777;
    if (data.length > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new RangeError(`submission ZIP entry ${filePath} exceeds the 100 MiB per-entry limit`);
    }
    extractedTotal += data.length;
    if (extractedTotal > MAX_EXTRACTED_BYTES) {
      throw new RangeError('submission ZIP extracted content exceeds the 512 MiB limit');
    }
    const nameBytes = Buffer.from(filePath, 'utf8');
    if (UTF8.decode(nameBytes) !== filePath) throw new Error(`submission ZIP path ${filePath} is not valid UTF-8`);
    const crc = zlib.crc32(data);
    const local = Buffer.concat([
      u32(LOCAL_SIG), u16(20), u16(GP_UTF8), u16(0), u16(0), u16(0x21),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes,
    ]);
    const externalAttributes = (((0o100000 | mode) & 0xffff) << 16) >>> 0;
    const central = Buffer.concat([
      u32(CENTRAL_SIG), u16(0x0314), u16(20), u16(GP_UTF8), u16(0), u16(0), u16(0x21),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(externalAttributes), u32(localOffset), nameBytes,
    ]);
    localParts.push(local, data);
    centralParts.push(central);
    localOffset += local.length + data.length;
    projectedSize += local.length + data.length + central.length;
    if (localOffset > ZIP64_SENTINEL || projectedSize > MAX_COMPRESSED_ZIP_BYTES) {
      throw new RangeError('compressed ZIP exceeds the 100,000,000-byte (100 MB) limit');
    }
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(EOCD_SIG), u16(0), u16(0), u16(names.length), u16(names.length),
    u32(centralDirectory.length), u32(localOffset), u16(0),
  ]);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

module.exports = {
  encodeOpenaiSubmissionZip,
  validateOpenaiSubmissionBytes,
  validateOpenaiSubmissionZip,
};
