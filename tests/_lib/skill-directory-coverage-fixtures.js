'use strict';

// Shared physical fixtures for the skill-directory coverage contracts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function physicalTemp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function remove(...targets) {
  for (const target of targets) {
    if (target) fs.rmSync(target, { recursive: true, force: true });
  }
}

function writeFile(root, relative, content, mode = null) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  if (mode !== null) fs.chmodSync(target, mode);
  return target;
}

function writeSkill(root, skillPath, {
  references = {},
  scripts = {},
  body = 'Instruction-only fixture.\n',
  symlink = null,
} = {}) {
  const directory = path.join(root, skillPath);
  writeFile(directory, 'SKILL.md', [
    '---',
    `name: ${path.basename(skillPath)}`,
    'description: synthetic coverage fixture',
    '---',
    '',
    body,
  ].join('\n'));
  for (const [relative, content] of Object.entries(references)) {
    writeFile(directory, relative, content);
  }
  for (const [relative, content] of Object.entries(scripts)) {
    writeFile(directory, relative, content, 0o755);
  }
  if (symlink) {
    const target = path.join(directory, symlink.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(symlink.target, target);
  }
  return directory;
}

function writeIntegritySkill(root, {
  name = 'integrity-fixture',
  body = 'The fixture has no executable entry.\n',
  scripts = {},
  symlinks = [],
} = {}) {
  const skillPath = path.join('skills', name);
  const skillRoot = path.join(root, skillPath);
  writeFile(skillRoot, 'SKILL.md', [
    '---',
    `name: ${name}`,
    'description: synthetic coverage-integrity fixture',
    '---',
    '',
    body,
  ].join('\n'));
  for (const [relative, content] of Object.entries(scripts)) {
    writeFile(skillRoot, relative, content, 0o755);
  }
  for (const { path: relative, target } of symlinks) {
    const link = path.join(skillRoot, relative);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
  }
  return { skillPath, skillRoot };
}

function skillRow(id, skillPath, lifecycle = 'optional') {
  return {
    id,
    name: id,
    path: skillPath,
    lifecycle,
    surfaces: ['claude-module'],
  };
}

function inventory(rows) {
  return { schema: 'dhpk.distribution-inventory.v2', skills: rows };
}

function record({
  references = [],
  executable_entries = [],
  api_entries = [],
  internal_helpers = [],
  host_capabilities = [],
  host_evidence = {},
} = {}) {
  return {
    entry: 'SKILL.md',
    references,
    executable_entries,
    api_entries,
    internal_helpers,
    host_capabilities,
    host_evidence,
  };
}

function validationInput(root, rows, skills, fixtures = {}) {
  return {
    root,
    inventory: inventory(rows),
    coverage: {
      schema: 'dhpk.skill-directory-coverage.v1',
      skills,
    },
    fixtures,
  };
}

function oneSkillInput(root, id, skillPath, skillRecord, fixtures = {}) {
  return validationInput(root, [skillRow(id, skillPath)], { [id]: skillRecord }, fixtures);
}

function errorText(result) {
  return (result && Array.isArray(result.errors) ? result.errors : []).join('\n');
}

function validLintBody(entry = 'scripts/public.js') {
  return [
    '## When NOT to Use',
    '',
    '- Use a different route for unrelated work.',
    '',
    '## Output',
    '',
    '- A linter report.',
    '',
    '## Verification',
    '',
    '- Run the focused check.',
    '',
    `Run \`${entry}\` to produce the report.`,
  ].join('\n');
}

module.exports = {
  errorText,
  inventory,
  oneSkillInput,
  physicalTemp,
  record,
  remove,
  skillRow,
  validLintBody,
  validationInput,
  writeFile,
  writeIntegritySkill,
  writeSkill,
};
