'use strict';

// Build-time authoring reader. Skill runtimes never import this module.
const fs = require('node:fs');
const path = require('node:path');
const { extract, extractMetadata } = require('../ci/_lib/frontmatter');

const DISTRIBUTION_SCHEMA = 'dhpk.skill-distribution.v1';
const BULK_KEYS = new Set(['schema', 'usage', 'resource_copies', 'coverage', 'standalone_dependencies', 'commands']);
const PER_SKILL_FIELDS = ['id', 'name', 'path', 'capability_id', 'invocation_class', 'usage', 'standalone_dependencies'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const mapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseJson(source) {
  const value = JSON.parse(source);
  const stack = [];
  for (const token of source.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]/g) || []) {
    if (token === '{' || token === '[') stack.push({ object: token === '{', key: token === '{', names: new Set() });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',') { if (stack.length) stack[stack.length - 1].key = stack[stack.length - 1].object; }
    else if (token === ':') { if (stack.length) stack[stack.length - 1].key = false; }
    else if (stack.length && stack[stack.length - 1].object && stack[stack.length - 1].key) {
      const frame = stack[stack.length - 1];
      const key = JSON.parse(token);
      if (frame.names.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`duplicate or unsafe key ${key}`);
      frame.names.add(key);
      frame.key = false;
    }
  }
  return value;
}

function scalar(source) {
  if (!source) return null;
  if (source.startsWith('"') || source.startsWith('[') || source.startsWith('{')) return parseJson(source);
  if (source.startsWith("'")) {
    if (!source.endsWith("'")) throw new Error('unterminated quoted scalar');
    return source.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(true|false|null)$/.test(source)) return JSON.parse(source);
  if (/^-?\d+(?:\.\d+)?$/.test(source)) return Number(source);
  if (/^[&*!>|%@`]/.test(source)) throw new Error('unsupported YAML scalar; use a quoted string');
  return source.replace(/\s+#.*$/, '').trim();
}

/** Small fail-closed YAML subset: mappings, sequences, JSON flow values, scalars.
 * JSON is valid YAML and is the extractor's stable serialization format.
 * Anchors, tags, block scalars and multi-document streams are deliberately absent.
 */
function parseYaml(source) {
  const clean = source.replace(/^\uFEFF/, '').trim();
  if (clean.startsWith('{')) return parseJson(clean);
  const lines = source.split(/\r?\n/).filter(line => line.trim() && !/^\s*#/.test(line)).map(raw => {
    if (/\t/.test(raw)) throw new Error('tabs are not supported');
    const indent = raw.match(/^ */)[0].length;
    return { indent, text: raw.slice(indent) };
  });
  let position = 0;
  function block(indent) {
    const list = lines[position].text.startsWith('- ');
    const result = list ? [] : {};
    while (position < lines.length && lines[position].indent === indent) {
      const line = lines[position++];
      if (list) {
        if (!line.text.startsWith('- ')) throw new Error('mixed sequence and mapping');
        const item = line.text.slice(2);
        if (/^[a-zA-Z_][\w-]*:\s/.test(item)) {
          const match = item.match(/^([^:]+):\s*(.*)$/);
          const record = { [match[1]]: scalar(match[2]) };
          if (position < lines.length && lines[position].indent > indent) {
            const continuation = block(lines[position].indent);
            if (!mapping(continuation) || Object.keys(continuation).some(key => own(record, key))) throw new Error('invalid sequence mapping');
            Object.assign(record, continuation);
          }
          result.push(record);
        } else if (!item && position < lines.length && lines[position].indent > indent) result.push(block(lines[position].indent));
        else result.push(scalar(item));
      } else {
        const match = line.text.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
        if (!match) throw new Error(`invalid mapping: ${line.text}`);
        const [, key, value] = match;
        if (['__proto__', 'prototype', 'constructor'].includes(key) || own(result, key)) throw new Error(`duplicate or unsafe key ${key}`);
        result[key] = !value && position < lines.length && lines[position].indent > indent ? block(lines[position].indent) : scalar(value);
      }
      if (position < lines.length && lines[position].indent > indent) throw new Error('unexpected indentation');
    }
    return result;
  }
  if (!lines.length) return {};
  if (lines[0].indent !== 0) throw new Error('root mapping must start at column zero');
  const result = block(0);
  if (position !== lines.length) throw new Error('inconsistent indentation');
  return result;
}

function parseDistribution(source, file) {
  try {
    const value = parseYaml(source);
    if (!mapping(value)) throw new Error('expected a mapping');
    if (value.schema !== DISTRIBUTION_SCHEMA) throw new Error(`schema must be ${DISTRIBUTION_SCHEMA}`);
    for (const key of Object.keys(value)) if (!BULK_KEYS.has(key)) throw new Error(`unknown key ${key}`);
    for (const key of ['usage', 'coverage']) if (own(value, key) && !mapping(value[key])) throw new Error(`${key} must be a mapping`);
    for (const key of ['resource_copies', 'standalone_dependencies', 'commands']) if (own(value, key) && !Array.isArray(value[key])) throw new Error(`${key} must be a list`);
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'schema'));
  } catch (error) { throw new Error(`${file}: ${error.message}`); }
}

function compactDescription(content, frontmatter) {
  if (!frontmatter.descriptionIndicator || !frontmatter.descriptionIndicator.startsWith('>')) return scalar(frontmatter.values.description || '') || '';
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => /^description:/.test(line));
  const folded = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() && !/^\s/.test(lines[index])) break;
    folded.push(lines[index].trim());
  }
  return folded.join(' ').replace(/\s+/g, ' ').trim();
}

function readSkillDirectory(root, directory, contents) {
  const relative = path.relative(root, directory).split(path.sep).join('/');
  const file = path.join(directory, 'SKILL.md');
  const content = contents ? contents.skill : fs.readFileSync(file, 'utf8');
  const frontmatter = extract(content);
  const metadata = extractMetadata(content);
  if (metadata.errors.length) throw new Error(`${relative}/SKILL.md: ${metadata.errors.join('; ')}`);
  const unquote = value => scalar(value || '');
  const capabilityId = metadata.values['dhpk-capability-id'] || `dhpk.skill.${path.basename(directory)}`;
  if (!/^dhpk\.skill\.[a-z][a-z0-9-]*$/.test(capabilityId)) throw new Error(`${relative}/SKILL.md: invalid metadata.dhpk-capability-id`);
  const id = capabilityId.slice('dhpk.skill.'.length);
  const authoring = path.join(directory, 'distribution.yaml');
  const source = contents ? contents.distribution : fs.existsSync(authoring) ? fs.readFileSync(authoring, 'utf8') : undefined;
  const distribution = source === undefined ? {} : parseDistribution(source, `${relative}/distribution.yaml`);
  const invocation = metadata.values['dhpk-invocation-class'];
  if (distribution.usage && distribution.usage.invocation_class !== invocation) throw new Error(`${id}: usage.invocation_class disagrees with metadata.dhpk-invocation-class`);
  return {
    id,
    name: unquote(frontmatter.values.name) || id,
    path: relative,
    capability_id: capabilityId,
    invocation_class: invocation,
    description: compactDescription(content, frontmatter),
    argument_hint: unquote(frontmatter.values['argument-hint']) || '',
    name_style: metadata.values['dhpk-name-style'],
    distribution,
  };
}

function readSkillDirectories(root) {
  const entries = [];
  const base = path.join(root, 'skills');
  if (!fs.existsSync(base)) return entries;
  function walk(directory) {
    if (fs.existsSync(path.join(directory, 'SKILL.md'))) { entries.push(readSkillDirectory(root, directory)); return; }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) walk(path.join(directory, entry.name));
    }
  }
  walk(base);
  return entries.sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

module.exports = { DISTRIBUTION_SCHEMA, BULK_KEYS, PER_SKILL_FIELDS, parseDistribution, readSkillDirectory, readSkillDirectories };
