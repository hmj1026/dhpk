'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const INVENTORY_BY_NAME = new Map(INVENTORY.skills.map((entry) => [entry.name, entry]));

function findSkillDirs(root) {
  const result = [];
  const ignored = new Set(['node_modules', 'references', 'scripts', 'assets', 'evals']);

  function walk(dir) {
    const skillFile = path.join(dir, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      result.push(dir);
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name) || !entry.isDirectory()) continue;
      walk(path.join(dir, entry.name));
    }
  }

  walk(root);
  return result.sort();
}

function parseSkillName(skillDir) {
  const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const match = content.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m);
  assert.ok(match, `${skillDir} is missing frontmatter name`);
  return match[1].trim();
}

function parseInterface(metadataPath) {
  const content = fs.readFileSync(metadataPath, 'utf8');
  const values = {};
  for (const key of ['display_name', 'short_description', 'default_prompt']) {
    const match = content.match(new RegExp(`^  ${key}: "((?:\\\\.|[^"\\\\])*)"\\s*$`, 'm'));
    assert.ok(match, `${metadataPath} is missing interface.${key}`);
    values[key] = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return values;
}

test('all 99 canonical skill packages have valid Codex interface metadata', () => {
  const canonicalDirs = [
    ...findSkillDirs(path.join(ROOT, 'skills')),
    ...findSkillDirs(path.join(ROOT, 'modules')),
  ].filter((dir) => dir.includes(`${path.sep}modules${path.sep}`) || dir.includes(`${path.sep}skills${path.sep}`));

  assert.strictEqual(canonicalDirs.length, 99, 'canonical package count changed');

  for (const skillDir of canonicalDirs) {
    const metadataPath = path.join(skillDir, 'agents', 'openai.yaml');
    assert.ok(fs.existsSync(metadataPath), `${skillDir} missing agents/openai.yaml`);
    const metadata = parseInterface(metadataPath);
    const skillName = parseSkillName(skillDir);
    const inventoryEntry = INVENTORY_BY_NAME.get(skillName);

    assert.ok(inventoryEntry, `${skillDir} is not registered in the inventory`);
    assert.ok(metadata.display_name.length > 0, `${skillDir} display_name is empty`);
    assert.ok(metadata.short_description.length >= 25, `${skillDir} short_description is too short`);
    assert.ok(metadata.short_description.length <= 64, `${skillDir} short_description is too long`);
    if (inventoryEntry.invokable === false) {
      assert.ok(!metadata.default_prompt.includes(`$${skillName}`), `${skillDir} internal runtime prompt must not invite direct invocation`);
      assert.match(metadata.default_prompt, /internal|do not invoke/i, `${skillDir} internal runtime prompt must explain its boundary`);
    } else {
      assert.ok(metadata.default_prompt.includes(`$${skillName}`), `${skillDir} default_prompt must invoke $${skillName}`);
    }
  }
});

run('codex-skill-metadata');
