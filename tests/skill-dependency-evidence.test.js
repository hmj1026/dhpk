'use strict';

// The repository coverage validator and the Skill-local linter each carry a
// copy of the textual dependency-evidence detector (the linter must stay
// self-contained).  Both copies must agree, and neither may accept an
// unrelated common word as proof that a caller loads a helper.

const { test, run, assert } = require('./_lib/tinytest');
const { callerReferencesHelper } = require('../scripts/lib/skill-directory-coverage');
const { scriptMentions } = require('../skills/skill-scope/scripts/skill-lint');

const CASES = [
  // [description, callerPath, callerText, helperPath, expected]
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

for (const [description, callerPath, callerText, helperPath, expected] of CASES) {
  test(`dependency evidence: ${description}`, () => {
    assert.strictEqual(callerReferencesHelper(callerText, callerPath, helperPath), expected, 'coverage validator');
    assert.strictEqual(scriptMentions(callerPath, callerText, helperPath), expected, 'skill linter');
  });
}

run('skill-dependency-evidence');
