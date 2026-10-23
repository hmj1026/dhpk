'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');

const ROOT = path.join(__dirname, '..');
const FLOW_DRIVE = path.join(ROOT, 'skills', 'flow-drive');
const REQUIRED_FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'distribution.yaml',
  'references/migration.md',
];

function physicalFiles(root, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const target = path.join(root, relative);
    assert.ok(!entry.isSymbolicLink(), `relocated resource must be a regular directory or file: ${relative}`);
    if (entry.isDirectory()) files.push(...physicalFiles(root, relative));
    else {
      assert.ok(entry.isFile(), `relocated resource must be a regular file: ${relative}`);
      files.push(relative);
    }
  }
  return files;
}

test('the relocated Flow Drive directory is complete without executable runtime or checkout resources', () => {
  withIsolatedSkill({ source: FLOW_DRIVE }, (context) => {
    assert.notStrictEqual(context.skillDir, fs.realpathSync(FLOW_DRIVE), 'the consumer copy is a distinct directory');
    assert.deepStrictEqual(physicalFiles(context.skillDir).sort(), [...REQUIRED_FILES].sort());

    const skill = fs.readFileSync(path.join(context.skillDir, 'SKILL.md'), 'utf8');
    const localLinks = [...skill.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map(([, target]) => target.split('#', 1)[0])
      .filter((target) => target !== '' && !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(target));
    for (const link of localLinks) {
      const target = path.resolve(context.skillDir, link);
      assert.ok(target.startsWith(`${context.skillDir}${path.sep}`), `local resource stays within the copied Skill: ${link}`);
      assert.ok(fs.statSync(target).isFile(), `local resource is available after relocation: ${link}`);
    }
  });
});

run('flow-drive-relocation');
