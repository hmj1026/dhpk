'use strict';

// RED contracts for coverage metadata integrity and Skill-local script
// discovery.  Fixtures are intentionally small, physical, and disposable;
// they describe observable validator/linter results without executing code or
// contacting a provider.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const coverage = require('../scripts/lib/skill-directory-coverage');
const lint = require('../skills/skill-scope/scripts/skill-lint');

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

function writeSkill(root, {
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

function inventory(skillPath, id = 'integrity-fixture') {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{
      id,
      name: id,
      path: skillPath,
      lifecycle: 'optional',
      surfaces: ['claude-module'],
    }],
  };
}

function fixture(id, entry) {
  return {
    id,
    entry,
    behavior: `runs ${entry} and observes its output`,
    expected: { status: 0, stdout: `${id}\n` },
    assert(result) {
      assert.strictEqual(result.status, this.expected.status);
      assert.strictEqual(result.stdout, this.expected.stdout);
    },
  };
}

function record({ executable_entries = [], api_entries = [], internal_helpers = [] } = {}) {
  return {
    entry: 'SKILL.md',
    references: [],
    executable_entries,
    api_entries,
    internal_helpers,
    host_capabilities: [],
    host_evidence: {},
  };
}

function validate(root, skillPath, recordValue, fixtures = {}) {
  return coverage.validateSkillDirectoryCoverage({
    root,
    inventory: inventory(skillPath),
    coverage: {
      schema: 'dhpk.skill-directory-coverage.v1',
      skills: { 'integrity-fixture': recordValue },
    },
    fixtures,
  });
}

function errors(result) {
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

function scriptsFinding(result) {
  const finding = result.findings.find((entry) => entry.check === 'scripts-contract');
  assert.ok(finding, 'expected scripts-contract finding');
  return finding;
}

test('documented public scripts cannot be reclassified as internal helpers', () => {
  const root = physicalTemp('dhpk coverage integrity public-helper-');
  try {
    const { skillPath } = writeSkill(root, {
      body: 'Run `node scripts/public.js` to produce the report.\n',
      scripts: { 'scripts/public.js': '#!/usr/bin/env node\n' },
    });
    const result = validate(root, skillPath, record({
      internal_helpers: [{ path: 'scripts/public.js', required_by: ['SKILL.md'] }],
    }));

    assert.strictEqual(result.ok, false, 'a documented public script must remain fixture-covered');
    assert.match(errors(result), /SKILL\.md|public|registered|helper/i);
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
    const { skillPath } = writeSkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = { api: require('./api.js'), helper: require('./js-helper') };\n",
        'scripts/api.js': "module.exports = require('./js-helper.js');\n",
        'scripts/js-helper.js': "module.exports = require('./python-helper.py');\n",
        'scripts/python-helper.py': 'print("fixture helper")\n',
      },
    });
    const result = validate(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      api_entries: [{ path: 'scripts/api.js', fixture_ids: ['api'] }],
      internal_helpers: [
        {
          path: 'scripts/js-helper.js',
          required_by: ['scripts/launcher.js', 'scripts/api.js'],
        },
        {
          path: 'scripts/python-helper.py',
          required_by: ['scripts/js-helper.js'],
        },
      ],
    }), fixtures);

    assert.strictEqual(result.ok, true, errors(result));
    assert.strictEqual(result.skills['integrity-fixture'].status, 'PASS');
  } finally {
    remove(root);
  }
});

test('a helper cannot list itself as its caller', () => {
  const root = physicalTemp('dhpk coverage integrity self-edge-');
  try {
    const { skillPath } = writeSkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./helper.js');\n",
        'scripts/helper.js': 'module.exports = {};\n',
      },
    });
    const result = validate(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      internal_helpers: [{ path: 'scripts/helper.js', required_by: ['scripts/helper.js'] }],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.strictEqual(result.ok, false);
    assert.match(errors(result), /self|cycle|helper\.js/i);
  } finally {
    remove(root);
  }
});

test('helper metadata cannot describe a dependency cycle', () => {
  const root = physicalTemp('dhpk coverage integrity cycle-');
  try {
    const { skillPath } = writeSkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./first.js');\n",
        'scripts/first.js': "module.exports = require('./second.js');\n",
        'scripts/second.js': "module.exports = require('./first.js');\n",
      },
    });
    const result = validate(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      internal_helpers: [
        { path: 'scripts/first.js', required_by: ['scripts/launcher.js', 'scripts/second.js'] },
        { path: 'scripts/second.js', required_by: ['scripts/first.js'] },
      ],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.strictEqual(result.ok, false);
    assert.match(errors(result), /cycle|first\.js|second\.js/i);
  } finally {
    remove(root);
  }
});

test('every declared helper must be reachable from the fixture-covered public entry', () => {
  const root = physicalTemp('dhpk coverage integrity orphan-');
  try {
    const { skillPath } = writeSkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./used.js');\n",
        'scripts/used.js': 'module.exports = {};\n',
        'scripts/orphan.js': 'module.exports = {};\n',
      },
    });
    const result = validate(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      internal_helpers: [
        { path: 'scripts/used.js', required_by: ['scripts/launcher.js'] },
        { path: 'scripts/orphan.js', required_by: ['scripts/launcher.js'] },
      ],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.strictEqual(result.ok, false);
    assert.match(errors(result), /orphan|reachable|orphan\.js/i);
  } finally {
    remove(root);
  }
});

test('a registered required_by edge must match the caller file that contains the local dependency', () => {
  const root = physicalTemp('dhpk coverage integrity fake-edge-');
  try {
    const { skillPath } = writeSkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./helper.js');\n",
        'scripts/api.js': 'module.exports = {};\n',
        'scripts/helper.js': 'module.exports = {};\n',
      },
    });
    const result = validate(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      api_entries: [{ path: 'scripts/api.js', fixture_ids: [] }],
      internal_helpers: [{ path: 'scripts/helper.js', required_by: ['scripts/api.js'] }],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.strictEqual(result.ok, false);
    assert.match(errors(result), /dependency|caller|edge|launcher\.js|api\.js/i);
  } finally {
    remove(root);
  }
});

test('a required_by caller must be a declared public, API, or helper entry', () => {
  const root = physicalTemp('dhpk coverage integrity unregistered-caller-');
  try {
    const { skillPath } = writeSkill(root, {
      body: 'Run `node scripts/launcher.js` to produce the report.\n',
      scripts: {
        'scripts/launcher.js': "module.exports = require('./helper.js');\n",
        'scripts/unregistered.js': "module.exports = require('./helper.js');\n",
        'scripts/helper.js': 'module.exports = {};\n',
      },
    });
    const result = validate(root, skillPath, record({
      executable_entries: [{ path: 'scripts/launcher.js', fixture_ids: ['launch'] }],
      internal_helpers: [{ path: 'scripts/helper.js', required_by: ['scripts/unregistered.js'] }],
    }), { launch: fixture('launch', 'scripts/launcher.js') });

    assert.strictEqual(result.ok, false);
    assert.match(errors(result), /registered|coverage|unregistered\.js/i);
  } finally {
    remove(root);
  }
});

test('the scripts lint rejects an external symlink used as a documented public script', () => {
  const root = physicalTemp('dhpk lint integrity public-symlink-');
  const outside = physicalTemp('dhpk lint integrity outside-public-');
  try {
    const external = writeFile(outside, 'external.js', 'module.exports = "outside";\n');
    const { skillRoot } = writeSkill(root, {
      body: validLintBody('scripts/public.js'),
      symlinks: [{ path: 'scripts/public.js', target: external }],
    });
    const finding = scriptsFinding(lint.lintSkill('integrity-fixture', skillRoot, ['integrity-fixture']));

    assert.strictEqual(finding.pass, false);
    assert.match(finding.message, /symlink|physical|contained|public\.js/i);
  } finally {
    remove(root, outside);
  }
});

test('the scripts lint rejects an external symlink reached as an imported helper', () => {
  const root = physicalTemp('dhpk lint integrity helper-symlink-');
  const outside = physicalTemp('dhpk lint integrity outside-helper-');
  try {
    const external = writeFile(outside, 'helper.js', 'module.exports = "outside";\n');
    const { skillRoot } = writeSkill(root, {
      body: validLintBody('scripts/public.js'),
      scripts: {
        'scripts/public.js': "module.exports = require('./helper.js');\n",
      },
      symlinks: [{ path: 'scripts/helper.js', target: external }],
    });
    const finding = scriptsFinding(lint.lintSkill('integrity-fixture', skillRoot, ['integrity-fixture']));

    assert.strictEqual(finding.pass, false);
    assert.match(finding.message, /symlink|physical|contained|helper\.js/i);
  } finally {
    remove(root, outside);
  }
});

test('a bare basename cannot document two nested scripts at once', () => {
  const root = physicalTemp('dhpk lint integrity duplicate-basename-');
  try {
    const { skillRoot } = writeSkill(root, {
      body: validLintBody('run.js'),
      scripts: {
        'scripts/alpha/run.js': 'module.exports = "alpha";\n',
        'scripts/beta/run.js': 'module.exports = "beta";\n',
      },
    });
    const finding = scriptsFinding(lint.lintSkill('integrity-fixture', skillRoot, ['integrity-fixture']));

    assert.strictEqual(finding.pass, false);
    assert.match(finding.message, /ambiguous|basename|alpha\/run\.js|beta\/run\.js/i);
  } finally {
    remove(root);
  }
});

run('skill-coverage-integrity');
