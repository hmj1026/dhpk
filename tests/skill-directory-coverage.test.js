'use strict';

// RED contracts for inventory-driven raw Skill coverage.  These fixtures are
// intentionally synthetic: canonical inventory coverage must remain visibly
// non-pass until each runtime family has a real behavior fixture.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

let coverageModule;
let coverageLoadError;
try {
  coverageModule = require('../scripts/lib/skill-directory-coverage');
} catch (error) {
  coverageLoadError = error;
}

function physicalTemp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function remove(...paths) {
  for (const target of paths) {
    if (target) fs.rmSync(target, { recursive: true, force: true });
  }
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

function writeSkill(root, skillPath, {
  references = {},
  scripts = {},
  body = 'Instruction-only fixture.\n',
  symlink = null,
} = {}) {
  const directory = path.join(root, skillPath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), [
    '---',
    `name: ${path.basename(skillPath)}`,
    'description: synthetic coverage fixture',
    '---',
    '',
    body,
  ].join('\n'));
  for (const [relative, content] of Object.entries(references)) {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  for (const [relative, content] of Object.entries(scripts)) {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode: 0o755 });
    fs.chmodSync(target, 0o755);
  }
  if (symlink) {
    const target = path.join(directory, symlink.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(symlink.target, target);
  }
  return directory;
}

function record({ references = [], executable_entries = [], api_entries = [], internal_helpers = [], host_capabilities = [], host_evidence = {} } = {}) {
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

function fixture(id, entry, stdout = `${id}\n`) {
  return {
    id,
    entry,
    behavior: `runs ${entry} and observes its output`,
    expected: { status: 0, stdout },
    assert(result) {
      assert.strictEqual(result.status, this.expected.status);
      assert.strictEqual(result.stdout, this.expected.stdout);
    },
  };
}

function errorText(result) {
  return (result && Array.isArray(result.errors) ? result.errors : []).join('\n');
}

function validate(input) {
  assert.ifError(coverageLoadError);
  assert.strictEqual(typeof coverageModule.validateSkillDirectoryCoverage, 'function',
    'coverage module must expose validateSkillDirectoryCoverage(input)');
  return coverageModule.validateSkillDirectoryCoverage(input);
}

test('coverage validator exposes its API and accepts complete instruction-only coverage', () => {
  assert.ifError(coverageLoadError);
  assert.strictEqual(typeof coverageModule.validateSkillDirectoryCoverage, 'function');
  const root = physicalTemp('skill coverage instruction with spaces-');
  try {
    writeSkill(root, 'skills/instruction-only', {
      references: { 'references/guide.md': 'Use the written procedure only.\n' },
    });
    const result = validate({
      root,
      inventory: inventory([skillRow('instruction-only', 'skills/instruction-only')]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: {
          'instruction-only': record({ references: ['references/guide.md'] }),
        },
      },
      fixtures: {},
    });
    assert.strictEqual(result.ok, true, errorText(result));
    assert.ok(result.skills && result.skills['instruction-only']);
  } finally {
    remove(root);
  }
});

test('coverage fails with the stable identity of an omitted active inventory Skill', () => {
  const root = physicalTemp('skill coverage omitted-');
  try {
    writeSkill(root, 'skills/alpha', {});
    writeSkill(root, 'skills/beta', {});
    const result = validate({
      root,
      inventory: inventory([
        skillRow('alpha', 'skills/alpha'),
        skillRow('beta', 'skills/beta'),
      ]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: { alpha: record() },
      },
      fixtures: {},
    });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /beta/);
  } finally {
    remove(root);
  }
});

test('reachable Markdown links with a contained parent reference report missing resources', () => {
  const root = physicalTemp('skill coverage markdown parent link-');
  try {
    writeSkill(root, 'skills/relative-links', {
      references: {
        'references/guide.md': 'See [the shared procedure](../shared/missing.md).\n',
      },
    });
    const result = validate({
      root,
      inventory: inventory([skillRow('relative-links', 'skills/relative-links')]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: {
          'relative-links': record({ references: ['references/guide.md'] }),
        },
      },
      fixtures: {},
    });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /shared\/missing\.md|linked Markdown resource/i);
  } finally {
    remove(root);
  }
});

test('nested Markdown links resolve relative to their document and pass when both references are recorded', () => {
  const root = physicalTemp('skill coverage markdown nested link-');
  try {
    writeSkill(root, 'skills/relative-links', {
      references: {
        'references/guide.md': 'Continue with [the topic](nested/topic.md).\n',
        'references/nested/topic.md': 'The nested procedure is complete.\n',
      },
    });
    const result = validate({
      root,
      inventory: inventory([skillRow('relative-links', 'skills/relative-links')]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: {
          'relative-links': record({
            references: ['references/guide.md', 'references/nested/topic.md'],
          }),
        },
      },
      fixtures: {},
    });
    assert.strictEqual(result.ok, true, errorText(result));
    assert.strictEqual(result.skills['relative-links'].structural, 'PASS');
  } finally {
    remove(root);
  }
});

test('Markdown links that escape the Skill boundary are rejected even when the target exists', () => {
  const root = physicalTemp('skill coverage markdown escape link-');
  const sibling = path.join(root, 'skills', 'outside.md');
  try {
    fs.mkdirSync(path.dirname(sibling), { recursive: true });
    fs.writeFileSync(sibling, 'hostile sibling content\n');
    writeSkill(root, 'skills/relative-links', {
      references: {
        'references/guide.md': 'See [outside](../../outside.md).\n',
      },
    });
    const result = validate({
      root,
      inventory: inventory([skillRow('relative-links', 'skills/relative-links')]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: {
          'relative-links': record({ references: ['references/guide.md'] }),
        },
      },
      fixtures: {},
    });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /outside\.md|escapes|linked Markdown resource/i);
  } finally {
    remove(root);
  }
});

test('coverage rejects missing or non-regular local resources before reporting complete', () => {
  const outside = physicalTemp('skill coverage outside-');
  const outsideFile = path.join(outside, 'outside.md');
  fs.writeFileSync(outsideFile, 'outside\n');
  const cases = [
    {
      label: 'missing',
      setup(root) {
        writeSkill(root, 'skills/resource-case', {});
      },
      reference: 'references/missing.md',
      expected: /missing|resource-case/i,
    },
    {
      label: 'symlink',
      setup(root) {
        writeSkill(root, 'skills/resource-case', {
          symlink: { path: 'references/linked.md', target: outsideFile },
        });
      },
      reference: 'references/linked.md',
      expected: /symlink|regular|contained|resource-case/i,
    },
  ];
  try {
    for (const current of cases) {
      const root = physicalTemp(`skill coverage ${current.label}-`);
      try {
        current.setup(root);
        const result = validate({
          root,
          inventory: inventory([skillRow('resource-case', 'skills/resource-case')]),
          coverage: {
            schema: 'dhpk.skill-directory-coverage.v1',
            skills: {
              'resource-case': record({ references: [current.reference] }),
            },
          },
          fixtures: {},
        });
        assert.strictEqual(result.ok, false);
        assert.match(errorText(result), current.expected);
      } finally {
        remove(root);
      }
    }
  } finally {
    remove(outside);
  }
});

test('coverage requires fixtures for reachable executable entries while allowing API extras and internal helpers', () => {
  const root = physicalTemp('skill coverage executable with spaces-');
  const fixtures = {
    'fixture-public': fixture('fixture-public', 'scripts/public.js', 'public\n'),
    'fixture-indirect': fixture('fixture-indirect', 'scripts/indirect.js', 'indirect\n'),
    'fixture-api': fixture('fixture-api', 'scripts/api.js', 'api\n'),
  };
  const row = skillRow('executable-case', 'skills/executable-case');
  const commonRecord = {
    references: ['references/guide.md'],
    executable_entries: [
      { path: 'scripts/public.js', fixture_ids: ['fixture-public'] },
    ],
    api_entries: [
      { path: 'scripts/api.js', fixture_ids: ['fixture-api'] },
    ],
    internal_helpers: [
      { path: 'scripts/internal.js', required_by: ['scripts/public.js'] },
    ],
    host_capabilities: ['host:fixture-cli'],
    host_evidence: {
      'host:fixture-cli': { status: 'NOT_RUN', reason: 'synthetic fixture has no Host probe' },
    },
  };
  try {
    writeSkill(root, row.path, {
      body: 'Run `node scripts/public.js --json`.\n',
      references: {
        'references/guide.md': 'The indirect command is `node scripts/indirect.js --json`.\n',
      },
      scripts: {
        'scripts/public.js': "#!/usr/bin/env node\nrequire('./internal.js');\n",
        'scripts/indirect.js': '#!/usr/bin/env node\n',
        'scripts/api.js': '#!/usr/bin/env node\n',
        'scripts/internal.js': '#!/usr/bin/env node\n',
      },
    });

    const omittedIndirect = validate({
      root,
      inventory: inventory([row]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: { 'executable-case': record(commonRecord) },
      },
      fixtures,
    });
    assert.strictEqual(omittedIndirect.ok, false);
    assert.match(errorText(omittedIndirect), /scripts\/indirect\.js/);

    const unknownFixture = validate({
      root,
      inventory: inventory([row]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: {
          'executable-case': record({
            ...commonRecord,
            executable_entries: [
              { path: 'scripts/public.js', fixture_ids: ['fixture-missing'] },
              { path: 'scripts/indirect.js', fixture_ids: ['fixture-indirect'] },
            ],
          }),
        },
      },
      fixtures,
    });
    assert.strictEqual(unknownFixture.ok, false);
    assert.match(errorText(unknownFixture), /fixture-missing/);

    const complete = validate({
      root,
      inventory: inventory([row]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: {
          'executable-case': record({
            ...commonRecord,
            executable_entries: [
              { path: 'scripts/public.js', fixture_ids: ['fixture-public'] },
              { path: 'scripts/indirect.js', fixture_ids: ['fixture-indirect'] },
            ],
          }),
        },
      },
      fixtures,
    });
    assert.strictEqual(complete.ok, true, errorText(complete));
    assert.ok(complete.skills && complete.skills['executable-case']);
    assert.strictEqual(complete.skills['executable-case'].fixtures, 'NOT_RUN');
    assert.strictEqual(complete.skills['executable-case'].host, 'NOT_RUN');
    assert.strictEqual(complete.skills['executable-case'].status, 'PASS');
    assert.strictEqual(
      complete.host_evidence['executable-case']['host:fixture-cli'].status,
      'NOT_RUN'
    );
  } finally {
    remove(root);
  }
});

test('internal helper with a required_by that never reaches a covered public entry fails', () => {
  const root = physicalTemp('skill coverage helper bypass-');
  const row = skillRow('helper-bypass-case', 'skills/helper-bypass-case');
  try {
    writeSkill(root, row.path, {
      body: 'Instruction-only fixture referencing scripts/internal.js indirectly.\n',
      scripts: {
        'scripts/internal.js': '#!/usr/bin/env node\n',
      },
    });
    const bypassed = validate({
      root,
      inventory: inventory([row]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: {
          'helper-bypass-case': record({
            internal_helpers: [
              // 'SKILL.md' physically exists but is not an executable/api
              // entry, so this required_by chain never reaches coverage.
              { path: 'scripts/internal.js', required_by: ['SKILL.md'] },
            ],
          }),
        },
      },
      fixtures: {},
    });
    assert.strictEqual(bypassed.ok, false);
    assert.match(errorText(bypassed), /scripts\/internal\.js.*never reaches a covered public entry/);
  } finally {
    remove(root);
  }
});

test('per-Skill status fails when an executable fixture definition is missing', () => {
  const root = physicalTemp('skill coverage missing fixture status-');
  const row = skillRow('missing-fixture', 'skills/missing-fixture');
  try {
    writeSkill(root, row.path, {
      scripts: { 'scripts/public.js': '#!/usr/bin/env node\n' },
    });
    const result = validate({
      root,
      inventory: inventory([row]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: {
          'missing-fixture': record({
            executable_entries: [
              { path: 'scripts/public.js', fixture_ids: ['fixture-not-registered'] },
            ],
          }),
        },
      },
      fixtures: {},
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.skills['missing-fixture'].fixtures, 'FAIL');
    assert.strictEqual(result.skills['missing-fixture'].status, 'FAIL');
    assert.match(errorText(result), /fixture-not-registered/);
  } finally {
    remove(root);
  }
});

test('missing coverage rows expose a failing per-Skill status', () => {
  const root = physicalTemp('skill coverage missing row status-');
  const row = skillRow('missing-row', 'skills/missing-row');
  try {
    writeSkill(root, row.path, {});
    const result = validate({
      root,
      inventory: inventory([row]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: {},
      },
      fixtures: {},
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.skills['missing-row'].structural, 'FAIL');
    assert.strictEqual(result.skills['missing-row'].fixtures, 'FAIL');
    assert.strictEqual(result.skills['missing-row'].status, 'FAIL');
    assert.strictEqual(result.skills['missing-row'].host, 'NOT_APPLICABLE');
    assert.match(errorText(result), /missing-row/);
  } finally {
    remove(root);
  }
});

test('a nested Markdown link is not also interpreted as a root-relative textual reference', () => {
  const root = physicalTemp('skill coverage link once-');
  try {
    writeSkill(root, 'skills/example', { references: {
      'references/guide.md': '[Topic](references/topic.md)\n',
      'references/references/topic.md': 'Contained nested topic.\n',
    } });
    const result = validate({ root,
      inventory: inventory([skillRow('example', 'skills/example')]),
      coverage: { schema: 'dhpk.skill-directory-coverage.v1', skills: {
        example: record({ references: ['references/guide.md', 'references/references/topic.md'] }),
      } }, fixtures: {},
    });
    assert.strictEqual(result.ok, true, errorText(result));
  } finally { remove(root); }
});

test('a fixture for another executable cannot cover an untested declared entry', () => {
  const root = physicalTemp('skill coverage wrong entry-');
  try {
    writeSkill(root, 'skills/example', { scripts: {
      'scripts/one.js': 'console.log("one");\n',
      'scripts/two.js': 'console.log("two");\n',
    } });
    const result = validate({ root,
      inventory: inventory([skillRow('example', 'skills/example')]),
      coverage: { schema: 'dhpk.skill-directory-coverage.v1', skills: {
        example: record({ executable_entries: [
          { path: 'scripts/one.js', fixture_ids: ['one'] },
          { path: 'scripts/two.js', fixture_ids: ['one'] },
        ] }),
      } }, fixtures: { one: fixture('one', 'scripts/one.js', 'one\n') },
    });
    assert.strictEqual(result.ok, false, 'one.js execution cannot establish coverage for two.js');
    assert.match(errorText(result), /two\.js/);
  } finally { remove(root); }
});

test('behavior fixtures can declare multiple literal output fragments', () => {
  const root = physicalTemp('skill coverage fragments-');
  try {
    writeSkill(root, 'skills/example', { scripts: { 'scripts/run.js': 'console.log("start\\nPASS");\n' } });
    const definition = {
      id: 'fragments', entry: 'scripts/run.js',
      expected: { status: 0, output: ['start', 'PASS'] },
      assert(result) {
        assert.strictEqual(result.status, 0);
        for (const fragment of this.expected.output) assert.ok(result.stdout.includes(fragment));
      },
    };
    const input = { root, inventory: inventory([skillRow('example', 'skills/example')]),
      coverage: { schema: 'dhpk.skill-directory-coverage.v1', skills: {
        example: record({ executable_entries: [{ path: 'scripts/run.js', fixture_ids: ['fragments'] }] }),
      } }, fixtures: { fragments: definition },
    };
    assert.strictEqual(validate(input).ok, true, errorText(validate(input)));
    definition.expected.output = [];
    assert.strictEqual(validate(input).ok, false, 'an empty fragment list provides no output contract');
  } finally { remove(root); }
});

test('an executable script listed only as a reference must be classified as an entry or helper', () => {
  const root = physicalTemp('skill coverage reference-only script-');
  const row = skillRow('reference-script', 'skills/reference-script');
  try {
    writeSkill(root, row.path, {
      body: 'Instruction-only fixture that ships a scanner.\n',
      scripts: { 'scripts/scan.sh': '#!/usr/bin/env bash\n' },
    });
    const result = validate({
      root,
      inventory: inventory([row]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: { 'reference-script': record({ references: ['scripts/scan.sh'] }) },
      },
      fixtures: {},
    });
    assert.strictEqual(result.ok, false, 'a reference entry cannot hide an unfixtured executable');
    assert.match(errorText(result), /scripts\/scan\.sh.*(entry|helper)/);
  } finally {
    remove(root);
  }
});

test('an inert retained script is accepted only with an explicit reason and no registered caller', () => {
  const root = physicalTemp('skill coverage inert script-');
  const row = skillRow('inert-script', 'skills/inert-script');
  try {
    writeSkill(root, row.path, {
      body: 'Instruction-only fixture that retains a deprecated module.\n',
      scripts: { 'scripts/legacy.py': '# DEPRECATED: retained for reference only\n' },
    });
    const run = (inert) => validate({
      root,
      inventory: inventory([row]),
      coverage: {
        schema: 'dhpk.skill-directory-coverage.v1',
        skills: { 'inert-script': { ...record({ references: ['scripts/legacy.py'] }), inert_scripts: inert } },
      },
      fixtures: {},
    });
    const accepted = run([{ path: 'scripts/legacy.py', reason: 'deprecated v1 logic retained for reference' }]);
    assert.strictEqual(accepted.ok, true, errorText(accepted));
    const unexplained = run([{ path: 'scripts/legacy.py' }]);
    assert.strictEqual(unexplained.ok, false);
    assert.match(errorText(unexplained), /inert.*reason/i);
  } finally {
    remove(root);
  }
});

run('skill-directory-coverage');
