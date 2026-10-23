'use strict';

// Portable package metadata has one YAML scalar type: string. Values authored
// as YAML arrays, mappings, booleans, numbers, or null are represented as JSON
// text inside a YAML string scalar. This small parser intentionally handles
// the metadata-only YAML subset used by SKILL.md and has no runtime deps.

const FRONTMATTER = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function leadingIndent(line) {
  return (line.match(/^[ \t]*/) || [''])[0].length;
}

function stripInlineComment(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote === "'" && character === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
}

function splitFlowItems(source) {
  const items = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let squareDepth = 0;
  let curlyDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote === "'" && character === "'" && source[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth -= 1;
    else if (character === '{') curlyDepth += 1;
    else if (character === '}') curlyDepth -= 1;
    else if (character === ',' && squareDepth === 0 && curlyDepth === 0) {
      items.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (start < source.length || source.trim()) items.push(source.slice(start).trim());
  return items.filter(Boolean);
}

function flowColon(source) {
  let quote = null;
  let escaped = false;
  let squareDepth = 0;
  let curlyDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote === "'" && character === "'" && source[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth -= 1;
    else if (character === '{') curlyDepth += 1;
    else if (character === '}') curlyDepth -= 1;
    else if (character === ':' && squareDepth === 0 && curlyDepth === 0
      && (index === source.length - 1 || /\s/.test(source[index + 1]))) return index;
  }
  return -1;
}

function parseScalar(source) {
  const value = stripInlineComment(String(source).trim());
  if (value === '') return { value: null, type: 'null' };
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return { value: JSON.parse(value), type: 'string' }; } catch (_) {
      return { error: `invalid quoted metadata scalar: ${value}` };
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return { value: value.slice(1, -1).replace(/''/g, "'"), type: 'string' };
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    const entries = inner ? splitFlowItems(inner) : [];
    const parsed = entries.map(parseScalar);
    const error = parsed.find((entry) => entry.error);
    return error ? error : { value: parsed.map((entry) => entry.value), type: 'array' };
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    const entries = inner ? splitFlowItems(inner) : [];
    const result = Object.create(null);
    for (const entry of entries) {
      const colon = flowColon(entry);
      if (colon < 0) return { error: `invalid inline metadata mapping entry: ${entry}` };
      const key = parseScalar(entry.slice(0, colon));
      const item = parseScalar(entry.slice(colon + 1));
      if (key.error || item.error) return key.error ? key : item;
      result[String(key.value)] = item.value;
    }
    return { value: result, type: 'mapping' };
  }
  if (/^(?:null|~)$/i.test(value)) return { value: null, type: 'null' };
  if (/^(?:true|false)$/i.test(value)) return { value: value.toLowerCase() === 'true', type: 'boolean' };
  if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return { value: number, type: 'number' };
  }
  return { value, type: 'string' };
}

function mappingLine(line) {
  const indent = leadingIndent(line);
  const source = stripInlineComment(line.slice(indent));
  const colon = flowColon(source);
  if (colon < 0) return null;
  const key = parseScalar(source.slice(0, colon).trim());
  if (key.error) return null;
  return { indent, key: String(key.value), rawValue: source.slice(colon + 1).trimStart() };
}

function meaningfulLine(lines, index, end) {
  for (let cursor = index; cursor < end; cursor += 1) {
    if (lines[cursor].trim() && !/^[ \t]*#/.test(lines[cursor])) return cursor;
  }
  return -1;
}

function subtreeEnd(lines, start, end, parentIndent) {
  for (let cursor = start; cursor < end; cursor += 1) {
    if (lines[cursor].trim() && leadingIndent(lines[cursor]) <= parentIndent) return cursor;
  }
  return end;
}

function parseBlockNode(lines, start, end, indent) {
  const first = meaningfulLine(lines, start, end);
  if (first < 0) return { value: null, type: 'null' };
  if (leadingIndent(lines[first]) !== indent) return { error: `malformed nested metadata indentation at line ${first + 1}` };
  const sequence = /^-[ \t]+/.test(lines[first].slice(indent));
  if (sequence) {
    const values = [];
    for (let cursor = first; cursor < end;) {
      const current = meaningfulLine(lines, cursor, end);
      if (current < 0 || leadingIndent(lines[current]) !== indent) break;
      const source = lines[current].slice(indent);
      if (!/^-($|[ \t])/.test(source)) break;
      const itemText = source.replace(/^-\s*/, '');
      if (!itemText) {
        const child = meaningfulLine(lines, current + 1, end);
        if (child >= 0 && leadingIndent(lines[child]) > indent) {
          const childEnd = subtreeEnd(lines, child + 1, end, indent);
          const parsed = parseBlockNode(lines, child, childEnd, leadingIndent(lines[child]));
          if (parsed.error) return parsed;
          values.push(parsed.value);
          cursor = childEnd;
        } else {
          values.push(null);
          cursor = current + 1;
        }
      } else {
        const itemMapping = mappingLine(`${' '.repeat(indent + 2)}${itemText}`);
        const childEnd = subtreeEnd(lines, current + 1, end, indent);
        if (itemMapping) {
          const itemLines = [
            `${' '.repeat(indent + 2)}${itemText}`,
            ...lines.slice(current + 1, childEnd),
          ];
          const parsed = parseBlockNode(itemLines, 0, itemLines.length, indent + 2);
          if (parsed.error) return parsed;
          values.push(parsed.value);
          cursor = childEnd;
        } else {
          const continuation = meaningfulLine(lines, current + 1, childEnd);
          if (continuation >= 0 && leadingIndent(lines[continuation]) > indent) {
            return { error: `unsupported nested metadata sequence continuation at line ${continuation + 1}` };
          }
          const parsed = parseScalar(itemText);
          if (parsed.error) return parsed;
          values.push(parsed.value);
          cursor = current + 1;
        }
      }
    }
    return { value: values, type: 'array' };
  }

  const object = Object.create(null);
  for (let cursor = first; cursor < end;) {
    const current = meaningfulLine(lines, cursor, end);
    if (current < 0 || leadingIndent(lines[current]) !== indent) break;
    const entry = mappingLine(lines[current]);
    if (!entry) return { error: `invalid nested metadata mapping at line ${current + 1}` };
    const next = meaningfulLine(lines, current + 1, end);
    if (!entry.rawValue) {
      if (next >= 0 && leadingIndent(lines[next]) > indent) {
        const childEnd = subtreeEnd(lines, next + 1, end, indent);
        const child = parseBlockNode(lines, next, childEnd, leadingIndent(lines[next]));
        if (child.error) return child;
        object[entry.key] = child.value;
        cursor = childEnd;
      } else {
        object[entry.key] = null;
        cursor = current + 1;
      }
    } else if (/^[|>]/.test(entry.rawValue)) {
      const childLines = [];
      let scan = current + 1;
      while (scan < end) {
        const line = lines[scan];
        if (line.trim() && leadingIndent(line) <= indent) break;
        childLines.push(line.slice(Math.min(line.length, indent + 1)));
        scan += 1;
      }
      object[entry.key] = childLines.join('\n');
      cursor = scan;
    } else {
      const parsed = parseScalar(entry.rawValue);
      if (parsed.error) return parsed;
      object[entry.key] = parsed.value;
      cursor = current + 1;
    }
  }
  return { value: object, type: 'mapping' };
}

function frontmatterParts(content) {
  const source = String(content);
  const match = FRONTMATTER.exec(source);
  if (!match) return { source, match: null, lines: null, newline: '\n' };
  const header = match[1];
  const newline = header.includes('\r\n') ? '\r\n' : '\n';
  return { source, match, lines: header.split(/\r?\n/), newline };
}

function metadataBlocks(lines) {
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^metadata[ \t]*:(.*)$/);
    if (!match) continue;
    const rawValue = match[1].trim();
    if (rawValue) {
      const parsed = parseScalar(rawValue);
      if (parsed.error) blocks.push({ line: index, error: parsed.error });
      else blocks.push({ line: index, inline: true, rawValue, parsed });
      continue;
    }
    let end = index + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() && leadingIndent(line) === 0) break;
      end += 1;
    }
    const first = meaningfulLine(lines, index + 1, end);
    if (first < 0) {
      blocks.push({ line: index, end, entries: [], value: {}, type: 'mapping' });
      index = end - 1;
      continue;
    }
    const entryIndent = leadingIndent(lines[first]);
    if (entryIndent === 0) {
      blocks.push({ line: index, error: `metadata mapping is malformed at line ${first + 1}` });
      index = end - 1;
      continue;
    }
    const entries = [];
    for (let cursor = first; cursor < end;) {
      const current = meaningfulLine(lines, cursor, end);
      if (current < 0 || leadingIndent(lines[current]) !== entryIndent) break;
      const entry = mappingLine(lines[current]);
      if (!entry) {
        entries.push({ line: current, end: current + 1, error: `invalid metadata entry at line ${current + 1}` });
        cursor = current + 1;
        continue;
      }
      let itemEnd = current + 1;
      while (itemEnd < end) {
        if (lines[itemEnd].trim() && leadingIndent(lines[itemEnd]) <= entryIndent) break;
        itemEnd += 1;
      }
      let parsed;
      if (!entry.rawValue) {
        const nested = meaningfulLine(lines, current + 1, itemEnd);
        if (nested < 0) parsed = { value: null, type: 'null' };
        else parsed = parseBlockNode(lines, nested, itemEnd, leadingIndent(lines[nested]));
      } else if (/^[|>]/.test(entry.rawValue)) {
        parsed = { value: '', type: 'string' };
      } else {
        parsed = parseScalar(entry.rawValue);
      }
      entries.push({
        line: current,
        end: itemEnd,
        indent: lines[current].slice(0, entryIndent),
        keyText: lines[current].slice(entryIndent).split(':', 1)[0],
        key: entry.key,
        parsed,
      });
      cursor = itemEnd;
    }
    const value = Object.create(null);
    for (const entry of entries) {
      if (!entry.error && !entry.parsed.error) value[entry.key] = entry.parsed.value;
    }
    blocks.push({ line: index, end, entries, value, type: 'mapping' });
    index = end - 1;
  }
  return blocks;
}

function serializeYamlString(value) {
  return JSON.stringify(String(value));
}

function serializePortableSkillMetadata(content) {
  const parts = frontmatterParts(content);
  if (!parts.match) return { ok: true, output: parts.source, errors: [] };
  const blocks = metadataBlocks(parts.lines);
  const errors = blocks.filter((block) => block.error).map((block) => block.error);
  if (errors.length > 0) return { ok: false, output: parts.source, errors };

  const replacements = new Map();
  const removed = new Set();
  for (const block of blocks) {
    if (block.inline) {
      if (block.parsed.type === 'mapping') {
        if (Object.keys(block.parsed.value).length === 0) continue;
        const lines = ['metadata:'];
        for (const [key, value] of Object.entries(block.parsed.value)) {
          const serialized = typeof value === 'string' ? value : JSON.stringify(value);
          lines.push(`  ${key}: ${serializeYamlString(serialized)}`);
        }
        replacements.set(block.line, lines);
      } else if (block.parsed.type !== 'string') {
        errors.push('metadata must be a mapping of string values');
      }
      continue;
    }
    for (const entry of block.entries) {
      if (entry.error || entry.parsed.error) {
        errors.push(entry.error || entry.parsed.error);
        continue;
      }
      if (entry.parsed.type === 'string') continue;
      const jsonText = JSON.stringify(entry.parsed.value);
      replacements.set(entry.line, [`${entry.indent}${entry.keyText}: ${serializeYamlString(jsonText)}`]);
      for (let line = entry.line + 1; line < entry.end; line += 1) removed.add(line);
    }
  }
  if (errors.length > 0) return { ok: false, output: parts.source, errors };

  const outputLines = [];
  for (let index = 0; index < parts.lines.length; index += 1) {
    if (removed.has(index)) continue;
    const replacement = replacements.get(index);
    if (replacement) outputLines.push(...replacement);
    else outputLines.push(parts.lines[index]);
  }
  const outputHeader = outputLines.join(parts.newline);
  const output = parts.source.slice(0, parts.match.index)
    + parts.match[0].replace(parts.match[1], outputHeader)
    + parts.source.slice(parts.match.index + parts.match[0].length);
  return { ok: true, output, errors: [] };
}

function validatePortableSkillMetadata(content) {
  const parts = frontmatterParts(content);
  if (!parts.match) return { ok: true, errors: [] };
  const blocks = metadataBlocks(parts.lines);
  const errors = [];
  for (const block of blocks) {
    if (block.error) {
      errors.push(`metadata: ${block.error}`);
      continue;
    }
    if (block.inline) {
      if (block.parsed.type !== 'mapping') errors.push('metadata must be a mapping of string values');
      else {
        for (const [key, value] of Object.entries(block.parsed.value)) {
          if (typeof value !== 'string') errors.push(`metadata.${key} must be a string scalar in portable output`);
        }
      }
      continue;
    }
    for (const entry of block.entries) {
      if (entry.error || entry.parsed.error) {
        errors.push(`metadata: ${entry.error || entry.parsed.error}`);
      } else if (typeof entry.parsed.value !== 'string') {
        errors.push(`metadata.${entry.key} must be a string scalar in portable output`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function cli() {
  const args = process.argv.slice(2);
  const checkOnly = args.length === 1 && args[0] === '--check';
  if (args.length > 0 && !checkOnly) {
    process.stderr.write('usage: portable-skill-metadata.js [--check] < SKILL.md\n');
    process.exitCode = 2;
    return;
  }
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    if (checkOnly) {
      const result = validatePortableSkillMetadata(input);
      if (!result.ok) {
        process.stderr.write(`${result.errors.join('\n')}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(input);
      return;
    }
    const result = serializePortableSkillMetadata(input);
    if (!result.ok) {
      process.stderr.write(`${result.errors.join('\n')}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(result.output);
  });
}

if (require.main === module) cli();

module.exports = {
  serializePortableSkillMetadata,
  validatePortableSkillMetadata,
};
