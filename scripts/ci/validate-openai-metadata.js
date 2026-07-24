#!/usr/bin/env node
'use strict';

// Validate the narrow, quoted agents/openai.yaml contract used by every
// canonical skill and verify the Codex projection does not drift from it.

const fs = require('node:fs');
const path = require('node:path');
const { collectInventory, relativePosix } = require('../lib/asset-inventory');
const { extract, isEmpty } = require('./_lib/frontmatter');
const { createReporter } = require('./_lib/report');

const PHYSICAL_SOURCES = Object.freeze({
  'legacy-code-characterization': 'modules/phpunit-5.7/skills/legacy-code-characterization',
  'php56-yii-dev': 'modules/yii-1.1/skills/php56-yii-dev',
  'php-pro': 'modules/php-5.6/skills/php-pro',
  'yii1-security-audit': 'modules/yii-1.1/skills/yii1-security-audit',
});

const REQUIRED_INTERFACE_KEYS = new Set([
  'display_name',
  'short_description',
  'default_prompt',
]);

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function decodeQuotedScalar(raw) {
  if (!/^"(?:\\.|[^"\\])*"$/.test(raw)) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function frontmatterName(skillFile, reporter) {
  const parsed = extract(fs.readFileSync(skillFile, 'utf8'));
  const rel = path.dirname(skillFile);
  if (!parsed.present) {
    reporter.err(`${rel} — SKILL.md frontmatter is missing`);
    return null;
  }
  if (parsed.duplicates.includes('name')) {
    reporter.err(`${rel} — SKILL.md frontmatter has duplicate name`);
  }
  const rawName = parsed.values.name;
  if (isEmpty(rawName)) {
    reporter.err(`${rel} — SKILL.md frontmatter name is missing or empty`);
    return null;
  }
  return rawName.replace(/^("|')(.*)\1$/, '$2').trim();
}

function parseOpenaiYaml(metadataFile, reporter) {
  const rel = path.dirname(metadataFile);
  const lines = fs.readFileSync(metadataFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines[0] !== 'interface:') {
    reporter.err(`${rel} — openai.yaml must start with interface:`);
    return null;
  }

  const values = Object.create(null);
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    const match = line.match(/^  ([A-Za-z0-9_]+): ("(?:\\.|[^"\\])*")$/);
    if (!match) {
      reporter.err(`${rel} — malformed interface scalar at line ${index + 1}`);
      continue;
    }
    const [, key, rawValue] = match;
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      reporter.err(`${rel} — duplicate interface.${key}`);
      continue;
    }
    if (!['display_name', 'short_description', 'default_prompt'].includes(key)) {
      reporter.err(`${rel} — unsupported interface.${key}; keep metadata minimal`);
      continue;
    }
    const value = decodeQuotedScalar(rawValue);
    if (value == null) {
      reporter.err(`${rel} — interface.${key} is not a valid quoted scalar`);
      continue;
    }
    values[key] = value;
  }

  for (const key of REQUIRED_INTERFACE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      reporter.err(`${rel} — missing interface.${key}`);
    }
  }
  return values;
}

function validateMetadata(skillDir, skillName, reporter) {
  const metadataFile = path.join(skillDir, 'agents', 'openai.yaml');
  if (!fs.existsSync(metadataFile)) {
    reporter.err(`${skillDir} — missing agents/openai.yaml`);
    return false;
  }
  if (!fs.statSync(metadataFile).isFile()) {
    reporter.err(`${skillDir} — agents/openai.yaml is not a file`);
    return false;
  }

  const metadata = parseOpenaiYaml(metadataFile, reporter);
  if (!metadata) return false;
  let valid = true;
  if (isEmpty(metadata.display_name)) {
    reporter.err(`${skillDir} — interface.display_name is empty`);
    valid = false;
  }
  if (typeof metadata.short_description !== 'string' || metadata.short_description.length < 25 || metadata.short_description.length > 64) {
    reporter.err(`${skillDir} — interface.short_description must be 25-64 characters`);
    valid = false;
  }
  if (typeof metadata.default_prompt !== 'string' || !metadata.default_prompt.includes(`$${skillName}`)) {
    reporter.err(`${skillDir} — interface.default_prompt must invoke $${skillName}`);
    valid = false;
  }
  return valid;
}

function validateProjection(root, canonicalByName, reporter) {
  const codexDir = path.join(root, 'codex', 'skills');
  if (!fs.existsSync(codexDir)) {
    reporter.err('codex/skills — projection directory is missing');
    return { entries: 0, symlinks: 0, physical: 0 };
  }

  let symlinks = 0;
  let physical = 0;
  const entries = fs.readdirSync(codexDir).sort();

  for (const name of entries) {
    const entry = path.join(codexDir, name);
    const stat = fs.lstatSync(entry);
    if (stat.isSymbolicLink()) {
      symlinks += 1;
      let actual;
      try {
        actual = fs.realpathSync(entry);
      } catch (_) {
        reporter.err(`${relativePosix(root, entry)} — dangling Codex symlink`);
        continue;
      }
      const canonical = canonicalByName.get(name);
      if (!canonical) {
        reporter.err(`${relativePosix(root, entry)} — symlink has no root canonical skill`);
        continue;
      }
      if (actual !== fs.realpathSync(canonical)) {
        reporter.err(`${relativePosix(root, entry)} — symlink target is not the canonical root skill`);
      }
      continue;
    }

    if (!stat.isDirectory()) {
      reporter.err(`${relativePosix(root, entry)} — unexpected non-directory Codex entry`);
      continue;
    }
    physical += 1;
    if (!Object.prototype.hasOwnProperty.call(PHYSICAL_SOURCES, name)) {
      reporter.err(`${relativePosix(root, entry)} — unexpected physical Codex skill`);
      continue;
    }

    const source = path.join(root, PHYSICAL_SOURCES[name]);
    if (!fs.existsSync(source)) {
      reporter.err(`${relativePosix(root, entry)} — canonical module source is missing: ${PHYSICAL_SOURCES[name]}`);
      continue;
    }
    const sourceMetadata = path.join(source, 'agents', 'openai.yaml');
    const mirrorMetadata = path.join(entry, 'agents', 'openai.yaml');
    if (!fs.existsSync(mirrorMetadata)) {
      reporter.err(`${relativePosix(root, entry)} — physical mirror metadata is missing`);
      continue;
    }
    try {
      if (fs.lstatSync(mirrorMetadata).isSymbolicLink()) {
        if (fs.realpathSync(mirrorMetadata) !== fs.realpathSync(sourceMetadata)) {
          reporter.err(`${relativePosix(root, mirrorMetadata)} — metadata symlink does not target the canonical module metadata`);
        }
      } else if (fs.readFileSync(mirrorMetadata, 'utf8') !== fs.readFileSync(sourceMetadata, 'utf8')) {
        reporter.err(`${relativePosix(root, mirrorMetadata)} — physical mirror metadata differs from canonical metadata`);
      }
    } catch (error) {
      reporter.err(`${relativePosix(root, mirrorMetadata)} — cannot compare physical mirror metadata: ${error.message}`);
    }
  }

  return { entries: entries.length, symlinks, physical };
}

function main() {
  const root = path.resolve(argValue('--root', process.cwd()));
  const reporter = createReporter('openai-metadata');
  const result = validateRepository(root);
  for (const error of result.errors) reporter.err(error);
  reporter.done(
    `canonical=${result.canonical} metadata=${result.metadata} ` +
    `codex=${result.projection.entries} symlinks=${result.projection.symlinks} physical=${result.projection.physical}`
  );
}

function validateRepository(root) {
  const errors = [];
  const reporter = { err: (message) => errors.push(message) };
  const inventory = collectInventory(root);
  const canonicalByName = new Map();
  const duplicateNames = new Set();
  let metadataCount = 0;

  for (const skillFile of inventory.paths.skills) {
    const skillDir = path.dirname(skillFile);
    const skillName = frontmatterName(skillFile, reporter);
    if (!skillName) continue;
    if (canonicalByName.has(skillName)) duplicateNames.add(skillName);
    else canonicalByName.set(skillName, skillDir);
    if (validateMetadata(skillDir, skillName, reporter)) metadataCount += 1;
  }

  for (const name of duplicateNames) {
    reporter.err(`duplicate canonical skill name: ${name}`);
  }

  const projection = validateProjection(root, canonicalByName, reporter);
  return {
    errors,
    canonical: inventory.paths.skills.length,
    metadata: metadataCount,
    projection,
  };
}

if (require.main === module) main();

module.exports = { validateRepository };
