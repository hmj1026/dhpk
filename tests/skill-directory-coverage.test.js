'use strict';

// RED contracts for inventory-driven raw Skill coverage.  These fixtures are
// intentionally synthetic: canonical inventory coverage must remain visibly
// non-pass until each runtime family has a real behavior fixture.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  errorText,
  oneSkillInput,
  physicalTemp,
  record,
  remove,
  skillRow,
  validationInput,
  writeFile,
  writeIntegritySkill,
  writeSkill,
} = require('./_lib/skill-directory-coverage-fixtures');
const { callerReferencesHelper } = require('../scripts/lib/skill-directory-coverage');
const canonicalInventory = require('../manifests/distribution-inventory.json');
const canonicalCoverage = require('../manifests/skill-directory-coverage.json').skills;
const { scanCanonicalSkillDeclarations, scanSkillScripts } = require('./_lib/skill-declared-entry-audit');
const coverageCLI = path.join(__dirname, '..', 'scripts', 'ci', 'validate-skill-directory-coverage.js');

let coverageModule;
let coverageLoadError;
try {
  coverageModule = require('../scripts/lib/skill-directory-coverage');
} catch (error) {
  coverageLoadError = error;
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

function validate(input) {
  assert.ifError(coverageLoadError);
  assert.strictEqual(typeof coverageModule.validateSkillDirectoryCoverage, 'function',
    'coverage module must expose validateSkillDirectoryCoverage(input)');
  return coverageModule.validateSkillDirectoryCoverage(input);
}

function validateSkill(root, id, skillPath, skillRecord, fixtures = {}) {
  return validate(oneSkillInput(root, id, skillPath, skillRecord, fixtures));
}

function validateSkills(root, rows, records, fixtures = {}) {
  return validate(validationInput(root, rows, records, fixtures));
}

function validateIntegrity(root, skillPath, skillRecord, fixtures = {}) {
  return validateSkill(root, 'integrity-fixture', skillPath, skillRecord, fixtures);
}

test('coverage accepts complete instruction-only Skill coverage', () => {
  const root = physicalTemp('skill coverage instruction with spaces-');
  try {
    writeSkill(root, 'skills/instruction-only', {
      references: { 'references/guide.md': 'Use the written procedure only.\n' },
    });
    const result = validateSkill(root, 'instruction-only', 'skills/instruction-only',
      record({ references: ['references/guide.md'] }));
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
    const result = validateSkills(root, [
        skillRow('alpha', 'skills/alpha'),
        skillRow('beta', 'skills/beta'),
      ], { alpha: record() });
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
    const result = validateSkill(root, 'relative-links', 'skills/relative-links',
      record({ references: ['references/guide.md'] }));
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
    const result = validateSkill(root, 'relative-links', 'skills/relative-links', record({
      references: ['references/guide.md', 'references/nested/topic.md'],
    }));
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
    const result = validateSkill(root, 'relative-links', 'skills/relative-links',
      record({ references: ['references/guide.md'] }));
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
        const result = validateSkill(root, 'resource-case', 'skills/resource-case',
          record({ references: [current.reference] }));
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

    const omittedIndirect = validateSkill(root, row.id, row.path, record(commonRecord), fixtures);
    assert.strictEqual(omittedIndirect.ok, false);
    assert.match(errorText(omittedIndirect), /scripts\/indirect\.js/);

    const unknownFixture = validateSkill(root, row.id, row.path, record({
      ...commonRecord,
      executable_entries: [
        { path: 'scripts/public.js', fixture_ids: ['fixture-missing'] },
        { path: 'scripts/indirect.js', fixture_ids: ['fixture-indirect'] },
      ],
    }), fixtures);
    assert.strictEqual(unknownFixture.ok, false);
    assert.match(errorText(unknownFixture), /fixture-missing/);

    const complete = validateSkill(root, row.id, row.path, record({
      ...commonRecord,
      executable_entries: [
        { path: 'scripts/public.js', fixture_ids: ['fixture-public'] },
        { path: 'scripts/indirect.js', fixture_ids: ['fixture-indirect'] },
      ],
    }), fixtures);
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
    const bypassed = validateSkill(root, row.id, row.path, record({
      internal_helpers: [
        // 'SKILL.md' physically exists but is not an executable/api entry.
        { path: 'scripts/internal.js', required_by: ['SKILL.md'] },
      ],
    }));
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
    const result = validateSkill(root, row.id, row.path, record({
      executable_entries: [{ path: 'scripts/public.js', fixture_ids: ['fixture-not-registered'] }],
    }));

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
    const result = validateSkills(root, [row], {});

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
    const result = validateSkill(root, 'example', 'skills/example',
      record({ references: ['references/guide.md', 'references/references/topic.md'] }));
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
    const result = validateSkill(root, 'example', 'skills/example', record({
      executable_entries: [
        { path: 'scripts/one.js', fixture_ids: ['one'] },
        { path: 'scripts/two.js', fixture_ids: ['one'] },
      ],
    }), { one: fixture('one', 'scripts/one.js', 'one\n') });
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
    const runValidation = () => validateSkill(root, 'example', 'skills/example', record({
      executable_entries: [{ path: 'scripts/run.js', fixture_ids: ['fragments'] }],
    }), { fragments: definition });
    assert.strictEqual(runValidation().ok, true, errorText(runValidation()));
    definition.expected.output = [];
    assert.strictEqual(runValidation().ok, false, 'an empty fragment list provides no output contract');
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
    const result = validateSkill(root, row.id, row.path,
      record({ references: ['scripts/scan.sh'] }));
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
    const run = (inert) => validateSkill(root, row.id, row.path, {
      ...record({ references: ['scripts/legacy.py'] }),
      inert_scripts: inert,
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

// ----- Coverage metadata integrity (consolidated from skill-coverage-integrity) -----

test('documented public scripts cannot be reclassified as internal helpers', () => {
  const root = physicalTemp('dhpk coverage integrity public-helper-');
  try {
    const { skillPath } = writeIntegritySkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\nRun `node scripts/public.js` directly.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./public.js');\n",
        'scripts/public.js': '#!/usr/bin/env node\n',
      },
    });
    const result = validateIntegrity(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      internal_helpers: [{
        path: 'scripts/public.js',
        required_by: ['SKILL.md', 'scripts/launcher.js'],
      }],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.deepStrictEqual(result.errors, [
      "integrity-fixture: internal helper 'scripts/public.js' required_by caller 'SKILL.md' is not a registered coverage entry",
    ]);
  } finally {
    remove(root);
  }
});

test('a fixture-covered public launcher may reach a registered API and transitive JS-to-Python helpers', () => {
  const root = physicalTemp('dhpk coverage integrity valid-chain-');
  const fixtures = {
    launch: fixture('launch', 'scripts/launcher.js'),
    api: fixture('api', 'scripts/api.js'),
  };
  try {
    const { skillPath } = writeIntegritySkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = { api: require('./api.js'), helper: require('./js-helper') };\n",
        'scripts/api.js': "module.exports = require('./js-helper.js');\n",
        'scripts/js-helper.js': "module.exports = require('./python-helper.py');\n",
        'scripts/python-helper.py': 'print("fixture helper")\n',
      },
    });
    const result = validateIntegrity(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      api_entries: [{ path: 'scripts/api.js', fixture_ids: ['api'] }],
      internal_helpers: [
        { path: 'scripts/js-helper.js', required_by: ['scripts/launcher.js', 'scripts/api.js'] },
        { path: 'scripts/python-helper.py', required_by: ['scripts/js-helper.js'] },
      ],
    }), fixtures);

    assert.strictEqual(result.ok, true, errorText(result));
    assert.strictEqual(result.skills['integrity-fixture'].status, 'PASS');
  } finally {
    remove(root);
  }
});

test('a helper cannot list itself as its caller', () => {
  const root = physicalTemp('dhpk coverage integrity self-edge-');
  try {
    const { skillPath } = writeIntegritySkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./helper.js');\n",
        'scripts/helper.js': 'module.exports = {};\n',
      },
    });
    const result = validateIntegrity(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      internal_helpers: [{
        path: 'scripts/helper.js',
        required_by: ['scripts/helper.js', 'scripts/launcher.js'],
      }],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.deepStrictEqual(result.errors, [
      "integrity-fixture: internal helper 'scripts/helper.js' lists itself as its caller (self-cycle)",
    ]);
  } finally {
    remove(root);
  }
});

test('helper metadata cannot describe a dependency cycle', () => {
  const root = physicalTemp('dhpk coverage integrity cycle-');
  try {
    const { skillPath } = writeIntegritySkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./first.js');\n",
        'scripts/first.js': "module.exports = require('./second.js');\n",
        'scripts/second.js': "module.exports = require('./first.js');\n",
      },
    });
    const result = validateIntegrity(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      internal_helpers: [
        { path: 'scripts/first.js', required_by: ['scripts/launcher.js', 'scripts/second.js'] },
        { path: 'scripts/second.js', required_by: ['scripts/first.js'] },
      ],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /cycle|first\.js|second\.js/i);
  } finally {
    remove(root);
  }
});

test('every declared helper must be reachable from the fixture-covered public entry', () => {
  const root = physicalTemp('dhpk coverage integrity orphan-');
  try {
    const { skillPath } = writeIntegritySkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./used.js');\n",
        'scripts/used.js': 'module.exports = {};\n',
        'scripts/unreachable.js': "module.exports = require('./orphan.js');\n",
        'scripts/orphan.js': 'module.exports = {};\n',
      },
    });
    const result = validateIntegrity(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      internal_helpers: [
        { path: 'scripts/used.js', required_by: ['scripts/launcher.js'] },
        { path: 'scripts/unreachable.js', required_by: [] },
        { path: 'scripts/orphan.js', required_by: ['scripts/unreachable.js'] },
      ],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.deepStrictEqual(result.errors, [
      "integrity-fixture: internal helper 'scripts/unreachable.js' required_by chain never reaches a covered public entry",
      "integrity-fixture: internal helper 'scripts/orphan.js' required_by chain never reaches a covered public entry",
    ]);
  } finally {
    remove(root);
  }
});

test('a registered required_by edge must match the caller file that contains the local dependency', () => {
  const root = physicalTemp('dhpk coverage integrity fake-edge-');
  try {
    const { skillPath } = writeIntegritySkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./helper.js');\n",
        'scripts/api.js': 'module.exports = {};\n',
        'scripts/helper.js': 'module.exports = {};\n',
      },
    });
    const result = validateIntegrity(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      api_entries: [{ path: 'scripts/api.js', fixture_ids: [] }],
      internal_helpers: [{ path: 'scripts/helper.js', required_by: ['scripts/api.js'] }],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /dependency|caller|edge|launcher\.js|api\.js/i);
  } finally {
    remove(root);
  }
});

test('a required_by caller must be a declared public, API, or helper entry', () => {
  const root = physicalTemp('dhpk coverage integrity unregistered-caller-');
  try {
    const { skillPath } = writeIntegritySkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./helper.js');\n",
        'scripts/unregistered.js': "module.exports = require('./helper.js');\n",
        'scripts/helper.js': 'module.exports = {};\n',
      },
    });
    const result = validateIntegrity(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      internal_helpers: [{
        path: 'scripts/helper.js',
        required_by: ['scripts/unregistered.js', 'scripts/launcher.js'],
      }],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.deepStrictEqual(result.errors, [
      "integrity-fixture: internal helper 'scripts/helper.js' required_by caller 'scripts/unregistered.js' is not a registered coverage entry",
    ]);
  } finally {
    remove(root);
  }
});

test('runnable script declarations require public coverage while prose examples stay non-public', () => {
  const root = physicalTemp('skill coverage declared entry-');
  const row = skillRow('declared-entry', 'skills/declared-entry');
  try {
    writeSkill(root, row.path, {
      body: [
        'Run `node scripts/public.js --help`.',
        'The `helper.js` module is internal implementation detail.',
        'The example output includes `sample.js`.',
      ].join('\n'),
      scripts: { 'scripts/public.js': '#!/usr/bin/env node\n' },
    });
    const covered = validate(oneSkillInput(root, row.id, row.path, record({
      executable_entries: [{ path: 'scripts/public.js', fixture_ids: ['public'] }],
    }), { public: fixture('public', 'scripts/public.js', 'public\n') }));
    assert.strictEqual(covered.ok, true, errorText(covered));

    const uncovered = validate(oneSkillInput(root, row.id, row.path, record()));
    assert.deepStrictEqual(uncovered.errors, [
      "declared-entry: documented executable entry 'scripts/public.js' is missing from coverage registry (SKILL.md:6)",
    ]);
  } finally {
    remove(root);
  }
});

test('every script basename declared by a canonical Skill has an explicit coverage role', () => {
  const root = physicalTemp('skill coverage bare-basename-');
  const row = skillRow('bare-basename', 'skills/bare-basename');
  try {
    writeSkill(root, row.path, {
      body: 'The fixture keeps `new-tool.js` available for operators.\n',
      scripts: { 'scripts/new-tool.js': '#!/usr/bin/env node\n' },
    });
    assert.deepStrictEqual(scanSkillScripts(root, row,
      fs.readFileSync(path.join(root, row.path, 'SKILL.md'), 'utf8'), record()), {
      missing: ['bare-basename: scripts/new-tool.js'],
      misclassified: [],
    });
  } finally {
    remove(root);
  }

  const result = scanCanonicalSkillDeclarations(path.join(__dirname, '..'),
    canonicalInventory, canonicalCoverage);
  assert.deepStrictEqual(result.missing, []);
  assert.deepStrictEqual(result.misclassified, []);
});

// ----- Dependency evidence parity (consolidated from skill-dependency-evidence) -----

const dependencyCases = [
  ['static require with extension', 'scripts/a.js', "require('./lib/runner-utils.js');", 'scripts/lib/runner-utils.js', true],
  ['extensionless relative require', 'scripts/a.js', "require('./js-helper')", 'scripts/js-helper.js', true],
  ['named-module loader call', 'scripts/a.js', "loadRuntimeModule('runner-utils');", 'scripts/_lib/runner-utils.js', true],
  ['path.join segments', 'scripts/a.js', "bundleModule(path.join('scripts', 'lib', 'dispatch-contract'))", 'references/b/scripts/lib/dispatch-contract.js', true],
  ['shell source by basename', 'scripts/run.sh', '. "$DIR/lib/portable-sed.sh"', 'scripts/lib/portable-sed.sh', true],
  ['python absolute package import', 'scripts/sync.py', 'from sync_lib.cli import main', 'scripts/sync_lib/cli.py', true],
  ['python package __init__', 'scripts/sync.py', 'from sync_lib.cli import main', 'scripts/sync_lib/__init__.py', true],
  ['python relative import', 'scripts/sync_lib/cli.py', 'from .utils import helper', 'scripts/sync_lib/utils.py', true],
  ['python relative nested package', 'scripts/lib/a.py', 'from .vendor.tomli import loads', 'scripts/lib/vendor/tomli/__init__.py', true],
  ['object literal common word', 'scripts/main.js', "return list.map((x) => ({ type: 'index' }));", 'scripts/helpers/index.js', false],
  ['config mode string', 'scripts/main.js', "const opts = { mode: 'config' };", 'scripts/helpers/config.js', false],
  ['dotted suffix inside message', 'scripts/main.js', "throw new Error('Failed to load config.utils')", 'scripts/utils.js', false],
  ['python variable named like module', 'scripts/main.py', 'utils = []\nutils.append(1)', 'scripts/utils.py', false],
  ['longer basename containing helper name', 'scripts/a.sh', 'bash "$DIR/prerun.sh"', 'scripts/run.sh', false],
];

for (const [description, callerPath, callerText, helperPath, expected] of dependencyCases) {
  test(`dependency evidence: ${description}`, () => {
    assert.strictEqual(callerReferencesHelper(callerText, callerPath, helperPath), expected, 'coverage validator');
  });
}

// ----- Validator CLI contract (consolidated from validate-skill-directory-coverage) -----

function invokeCoverageCLI(args) {
  return spawnSync(process.execPath, [coverageCLI, ...args], { encoding: 'utf8', timeout: 120000 });
}

test('--check reports one PASS result per canonical inventory identity', () => {
  const result = invokeCoverageCLI(['--check']);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.ok, true, report.errors.join('\n'));
  assert.deepStrictEqual(Object.keys(report.skills).sort(), canonicalInventory.skills.map((row) => row.id).sort());
  for (const [id, detail] of Object.entries(report.skills)) {
    assert.strictEqual(detail.status, 'PASS', id);
    assert.ok(['NOT_RUN', 'NOT_APPLICABLE'].includes(detail.fixtures), `${id} fixtures ${detail.fixtures}`);
  }
  assert.strictEqual(report.fixture_execution, 'NOT_RUN');
  assert.strictEqual(report.host_probes, 'NOT_RUN');
});

test('unknown arguments exit 2 without a report', () => {
  for (const args of [[], ['--write'], ['--check', '--extra']]) {
    const result = invokeCoverageCLI(args);
    assert.strictEqual(result.status, 2, `${args.join(' ')}: ${result.stdout}`);
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /Usage: validate-skill-directory-coverage\.js --check/);
  }
});

run('skill-directory-coverage');
