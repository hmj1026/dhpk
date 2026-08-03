'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TIER_LABEL = /\b(?:haiku|sonnet|opus)\b/i;
const BACKTICKED_TOKEN = /`([a-z0-9]+(?:-[a-z0-9]+)*)`/g;

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function namesFrom(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .map((name) => name.slice(0, -extension.length));
}

function tomlStringField(source, field) {
  const inline = source.match(new RegExp(`^${field}\\s*=\\s*"([^"]*)"\\s*$`, 'm'));
  if (inline) return inline[1];

  const multiline = source.match(new RegExp(`^${field}\\s*=\\s*"""([\\s\\S]*?)"""`, 'm'));
  return multiline ? multiline[1] : null;
}

function topLevelAgentsConfig(source) {
  let inAgents = false;
  let hasConcurrency = false;
  const legacyKeys = [];

  for (const line of source.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      inAgents = header[1] === 'agents';
      continue;
    }
    if (inAgents && /^\s*max_concurrent_threads_per_session\s*=/.test(line)) {
      hasConcurrency = true;
    }
    if (inAgents && /^\s*max_(?:threads|depth)\s*=/.test(line)) {
      legacyKeys.push(line.trim().split(/\s*=/, 1)[0]);
    }
  }

  return { hasConcurrency, legacyKeys };
}

function collectCodexRuntimeErrors(root) {
  const errors = [];
  const canonicalDir = path.join(root, 'agents');
  const codexAgentsDir = path.join(root, 'codex', 'agents');
  const codexConfig = path.join(root, 'codex', 'config.toml.example');
  const canonicalNames = new Set(namesFrom(canonicalDir, '.md'));
  const codexFiles = namesFrom(codexAgentsDir, '.toml').sort();
  const dispatchableNames = new Set(codexFiles);

  if (!fs.existsSync(codexAgentsDir)) {
    errors.push('codex/agents — projection directory is missing');
  } else {
    for (const entry of fs.readdirSync(codexAgentsDir)) {
      if (!entry.endsWith('.toml')) {
        errors.push(
          `${relative(root, path.join(codexAgentsDir, entry))} — Codex agent definitions must use the .toml format`,
        );
      }
    }

    for (const role of codexFiles) {
      const file = path.join(codexAgentsDir, `${role}.toml`);
      const source = fs.readFileSync(file, 'utf8');
      const description = tomlStringField(source, 'description');

      const requiredFields = [
        'name',
        'description',
        'model',
        'model_reasoning_effort',
        'developer_instructions',
      ];
      for (const field of requiredFields) {
        const value = tomlStringField(source, field);
        if (value == null || !value.trim()) {
          errors.push(`${relative(root, file)} — missing non-empty ${field}`);
        }
      }

      const tierLabel = description && description.match(TIER_LABEL);
      if (tierLabel) {
        errors.push(
          `${relative(root, file)} — description contains Claude model tier label '${tierLabel[0]}'; ` +
          'use model and model_reasoning_effort as the runtime metadata',
        );
      }

      for (const match of source.matchAll(BACKTICKED_TOKEN)) {
        const referencedRole = match[1];
        if (canonicalNames.has(referencedRole) && !dispatchableNames.has(referencedRole)) {
          errors.push(
            `${relative(root, file)} — references non-dispatchable Codex agent '${referencedRole}'`,
          );
        }
      }
    }
  }

  if (!fs.existsSync(codexConfig)) {
    errors.push('codex/config.toml.example — example configuration is missing');
  } else {
    const config = fs.readFileSync(codexConfig, 'utf8');
    const { hasConcurrency, legacyKeys } = topLevelAgentsConfig(config);
    if (!hasConcurrency) {
      errors.push(
        'codex/config.toml.example — [agents] must define max_concurrent_threads_per_session',
      );
    }
    for (const key of legacyKeys) {
      errors.push(`codex/config.toml.example — legacy [agents] key '${key}' is not supported`);
    }
  }

  return errors;
}

module.exports = { collectCodexRuntimeErrors };
