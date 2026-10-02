'use strict';

// Skills-only OpenAI submission ZIP gate. Parses STORED (method 0) archives
// in memory and fail-closed on zip-slip, unsupported compression, extra /
// missing / invalid skills, hooks/apps/MCP, markdown escapes, and listing
// displayName over 30 characters. Does not produce a submission ZIP.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const DISPLAY_NAME_LIMIT = 30;
const GP_DATA_DESCRIPTOR = 0x0008;
const ZIP64_SENTINEL = 0xffffffff;
const MAX_ZIP_ENTRIES = 5000;
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function result(errors, archiveDigest, extractedFiles) {
  return {
    ok: errors.length === 0,
    errors,
    archiveDigest: archiveDigest || '',
    extractedFiles: Array.isArray(extractedFiles) ? extractedFiles : [],
  };
}

// Copied from skills/skill-scope/scripts/skill-lint.js:440-458 (markdown
// ](...) scanner only; the references/ textual walker is not copied).
function markdownTargets(content, documentRelative = 'SKILL.md') {
  const links = [];
  const add = (raw, documentRelativeTarget) => {
    if (typeof raw !== 'string') return;
    const value = raw.replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
    if (!value || /^(?:[a-z]+:|\/|#)/i.test(value) || !/\.md$/i.test(value)) return;
    const candidate = path.posix.normalize(path.posix.join(
      path.posix.dirname(documentRelativeTarget),
      value,
    ));
    links.push({ path: candidate, raw: value, document: documentRelativeTarget });
  };
  const markdown = /\]\(\s*<?([^\s)>]+)>?/g;
  let match;
  while ((match = markdown.exec(String(content))) !== null) {
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
  let cursor = cdOffset;
  const cdEnd = cdOffset + cdSize;
  if (cdEnd > zipBytes.length) {
    errors.push('invalid zip');
    return extracted;
  }
  if (entriesTotal > MAX_ZIP_ENTRIES) {
    errors.push(`archive entry count ${entriesTotal} exceeds the attested ${MAX_ZIP_ENTRIES}-entry limit`);
    return extracted;
  }
  let extractedTotal = 0;
  for (let i = 0; i < entriesTotal; i += 1) {
    if (cursor + 46 > cdEnd || readU32(zipBytes, cursor) !== CENTRAL_SIG) {
      errors.push('invalid zip');
      break;
    }
    const flags = readU16(zipBytes, cursor + 8);
    const method = readU16(zipBytes, cursor + 10);
    const compressed = readU32(zipBytes, cursor + 20);
    const uncompressed = readU32(zipBytes, cursor + 24);
    const nameLen = readU16(zipBytes, cursor + 28);
    const extraLen = readU16(zipBytes, cursor + 30);
    const commentLen = readU16(zipBytes, cursor + 32);
    const localOff = readU32(zipBytes, cursor + 42);
    const nameStart = cursor + 46;
    if (nameStart + nameLen + extraLen + commentLen > cdEnd) {
      errors.push('invalid zip');
      break;
    }
    const name = zipBytes.subarray(nameStart, nameStart + nameLen).toString('utf8');
    cursor = nameStart + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) {
      const trimmed = name.replace(/\/+$/, '');
      if (unsafeZipName(trimmed)) {
        errors.push(`zip entry ${name} escapes outside the archive root`);
      }
      continue;
    }
    if (unsafeZipName(name)) {
      errors.push(`zip entry ${name} escapes outside the archive root`);
      continue;
    }
    if ((flags & GP_DATA_DESCRIPTOR) !== 0 || method !== 0 || compressed !== uncompressed) {
      errors.push(`zip entry ${name} uses unsupported compression method ${method}`);
      continue;
    }
    if (uncompressed > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      errors.push(
        `zip entry ${name} uncompressed size ${uncompressed} exceeds the attested 100 MiB per-entry limit`
      );
      continue;
    }
    if (extractedTotal + uncompressed > MAX_EXTRACTED_BYTES) {
      errors.push(
        `archive extracted size ${extractedTotal + uncompressed} exceeds the attested 512 MiB limit`
      );
      continue;
    }
    extractedTotal += uncompressed;
    if (localOff + 30 > zipBytes.length || readU32(zipBytes, localOff) !== LOCAL_SIG) {
      errors.push('invalid zip');
      continue;
    }
    const localNameLen = readU16(zipBytes, localOff + 26);
    const localExtraLen = readU16(zipBytes, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressed;
    if (dataEnd > zipBytes.length) {
      errors.push(`zip entry ${name} payload is shorter than claimed uncompressed size`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(extracted, name)) {
      errors.push(`zip entry ${name} is duplicated`);
      continue;
    }
    extracted[name] = Buffer.from(zipBytes.subarray(dataStart, dataEnd));
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

function validateMarkdownEscapes(extracted, errors) {
  for (const filePath of Object.keys(extracted)) {
    if (!/^skills\/[^/]+\/SKILL\.md$/.test(filePath)) continue;
    const content = extracted[filePath].toString('utf8');
    // Skill-root documentRelative 'SKILL.md' matches skill-lint.js:487-489 so
    // `](../../outside-secret.md)` stays an escape; zip-root join would not.
    for (const link of markdownTargets(content, 'SKILL.md')) {
      if (link.path === '..' || link.path.startsWith('../')) {
        errors.push(`${filePath} markdown resource ${link.raw} escapes outside the package`);
      }
    }
  }
}

function validateListing(extracted, errors) {
  if (!Object.prototype.hasOwnProperty.call(extracted, 'plugin.json')) return;
  let plugin;
  try {
    plugin = JSON.parse(extracted['plugin.json'].toString('utf8'));
  } catch {
    errors.push('plugin.json is invalid');
    return;
  }
  const displayName = plugin && plugin.extensions
    && plugin.extensions['com.openai.interface']
    && plugin.extensions['com.openai.interface'].displayName;
  if (typeof displayName !== 'string') return;
  if (displayName.length > DISPLAY_NAME_LIMIT) {
    errors.push(
      `listing displayName length ${displayName.length} exceeds the attested ${DISPLAY_NAME_LIMIT}-character final limit`
    );
  }
}

function validateOpenaiSubmissionZip(zipPath, options) {
  const errors = [];
  let archiveDigest = '';
  let extractedFiles = [];
  try {
    const zipBytes = fs.readFileSync(zipPath);
    archiveDigest = sha256hex(zipBytes);
    const extracted = parseStoredZip(zipBytes, errors);
    extractedFiles = Object.keys(extracted).sort().map((filePath) => ({
      path: filePath,
      sha256: sha256hex(extracted[filePath]),
    }));
    validateCatalog(extracted, options, errors);
    validateForbidden(extracted, errors);
    validateMarkdownEscapes(extracted, errors);
    validateListing(extracted, errors);
  } catch (error) {
    errors.push(error && error.message ? error.message : 'invalid zip');
  }
  return result(errors, archiveDigest, extractedFiles);
}

module.exports = { validateOpenaiSubmissionZip };
