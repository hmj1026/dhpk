const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run } = require('./_lib/tinytest');

const repository = path.resolve(__dirname, '..');
const resources = {
  react: ['references/target-selection.md', 'references/18.md', 'references/19.md'],
  nextjs: ['references/target-selection.md', 'references/15.5.md', 'references/16.md'],
};

// Inspect the package's real Markdown links. This is a resource-closure check,
// not an implementation of the agent's natural-language routing decisions.
function readClosure(directory, entry = 'SKILL.md', seen = new Set()) {
  const base = fs.realpathSync(directory);
  const file = fs.realpathSync(path.resolve(base, entry));
  assert.ok(file.startsWith(`${base}${path.sep}`), `resource escapes family: ${entry}`);
  if (seen.has(file)) return seen;
  seen.add(file);
  const markdown = fs.readFileSync(file, 'utf8');
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(!path.isAbsolute(target), `absolute resource: ${target}`);
    readClosure(base, path.relative(base, path.resolve(path.dirname(file), target)), seen);
  }
  return seen;
}

for (const [family, expected] of Object.entries(resources)) {
  test(`${family} ships a complete directory with version resources`, () => {
    const directory = path.join(repository, 'skills', family);
    const files = [...readClosure(directory)].map(file => path.relative(directory, file));
    for (const resource of expected) assert.ok(files.includes(resource), `unreachable ${resource}`);
    const yaml = fs.readFileSync(path.join(directory, 'agents/openai.yaml'), 'utf8');
    assert.ok(yaml.includes(`$${family}`));
    const skill = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^name: ${family}$`, 'm'));
    assert.doesNotMatch([...readClosure(directory)].map(file => fs.readFileSync(file, 'utf8')).join('\n'),
      /(?:skills\/dhpk-(?:react|nextjs)|modules\/|\.\.[/\\])/);
  });

  test(`${family} resource closure survives relocation without repository peers`, () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-${family}-family-`));
    try {
      const relocated = path.join(scratch, 'family');
      fs.cpSync(path.join(repository, 'skills', family), relocated, { recursive: true });
      assert.equal(readClosure(relocated).size, expected.length + 1);
      fs.rmSync(path.join(relocated, expected.at(-1)));
      assert.throws(() => readClosure(relocated), /ENOENT/);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  test(`${family} closure rejects a tampered resource outside its directory`, () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-${family}-escape-`));
    try {
      const relocated = path.join(scratch, 'family');
      fs.cpSync(path.join(repository, 'skills', family), relocated, { recursive: true });
      fs.writeFileSync(path.join(scratch, 'ambient.md'), '# Ambient fallback');
      fs.rmSync(path.join(relocated, expected.at(-1)));
      fs.symlinkSync(path.join(scratch, 'ambient.md'), path.join(relocated, expected.at(-1)));
      assert.throws(() => readClosure(relocated), /resource escapes family/);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
}

run('self-contained-frontend-families');
