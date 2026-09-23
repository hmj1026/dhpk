'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { extract } = require('../scripts/ci/_lib/frontmatter');

const ROOT = path.join(__dirname, '..');

function read(name) {
  return fs.readFileSync(path.join(ROOT, 'commands', name + '.md'), 'utf8');
}

test('approved short flow front doors preserve canonical identity and invocation class', () => {
  const guide = read('flow-guide');
  const drive = read('flow-drive');
  assert.match(guide, /canonical `\$flow-guide` Skill/);
  assert.match(drive, /canonical `\$flow-drive` Skill/);
  assert.match(drive, /--worker-target=<provider>\/\<model>\[:<effort>\]/);
  assert.doesNotMatch(guide, /^(?:procedure|workflow steps|target authority)\s*$/im);
  assert.match(drive, /does not add a mode, route selection, proposal authoring/);
  assert.strictEqual(extract(guide).values['metadata.dhpk-invocation-class'] || 'implicit-eligible', 'implicit-eligible');
  assert.match(drive, /dhpk-invocation-class: explicit-only/);
  assert.match(drive, /disable-model-invocation: true/);
});

test('short front doors have no competing Usage Grammar', () => {
  for (const name of ['flow-guide', 'flow-drive']) {
    const text = read(name);
    assert.strictEqual((text.match(/argument-hint:/g) || []).length, 1);
    assert.match(text, /Forward[\s\S]*(?:arguments|options) unchanged/i);
    assert.match(text, /second\s+(?:usage\s+)?grammar/i);
  }
});

test('precommit and precommit-fast preserve forwarding authority and mode arguments', () => {
  const precommit = read('precommit');
  const fast = read('precommit-fast');
  assert.match(precommit, /argument-hint:\s*'\[--fast\]'/);
  assert.match(precommit, /Forward `\[--fast\]` unchanged to the\s+canonical `\$precommit` Skill/);
  assert.match(precommit, /metadata:\s*\n\s+dhpk-invocation-class: implicit-eligible/);
  assert.doesNotMatch(precommit, /scripts\/precommit-runner\.js|scripts\/verify-runner\.js/);

  assert.match(fast, /deprecated forwarding alias/i);
  assert.match(fast, /\$precommit --fast \$ARGUMENTS/);
  assert.match(fast, /metadata:\s*\n\s+dhpk-invocation-class: explicit-only/);
  assert.doesNotMatch(fast, /scripts\/precommit-runner\.js|scripts\/verify-runner\.js/);
});

test('verify preserves public authority and forwards optional integration/e2e arguments unchanged', () => {
  const verify = read('verify');
  assert.match(verify, /argument-hint:\s*'\[fast\|full\] \[--integration <path>\] \[--e2e <path>\]'/);
  assert.match(verify, /Forward `\[fast\|full\] \[--integration <path>\] \[--e2e <path>\]` unchanged to the\s+canonical `\$repo-verify` Skill/);
  assert.match(verify, /metadata:\s*\n\s+dhpk-invocation-class: implicit-eligible/);
  assert.match(verify, /public command remains `\/dhpk:verify`/);
  assert.doesNotMatch(verify, /scripts\/precommit-runner\.js|scripts\/verify-runner\.js/);
});

test('pilot Skill procedures retain package-local runner ownership and the new repo-verify install path', () => {
  const precommitSkill = fs.readFileSync(path.join(ROOT, 'skills', 'precommit', 'SKILL.md'), 'utf8');
  const precommitReference = fs.readFileSync(path.join(ROOT, 'skills', 'precommit', 'references', 'workflow.md'), 'utf8');
  const repoVerifySkill = fs.readFileSync(path.join(ROOT, 'skills', 'repo-verify', 'SKILL.md'), 'utf8');
  const repoVerifyReference = fs.readFileSync(path.join(ROOT, 'skills', 'repo-verify', 'references', 'workflow.md'), 'utf8');

  for (const text of [precommitSkill, precommitReference]) {
    assert.match(text, /\$SKILL_DIR\/scripts\/precommit-runner\.js/);
  }
  for (const text of [repoVerifySkill, repoVerifyReference]) {
    assert.match(text, /\.claude\/dhpk\/skills\/repo-verify\/scripts\/verify-runner\.js/);
    assert.doesNotMatch(text, /\.claude\/scripts\/verify-runner\.js/);
  }
});

function commandFiles() {
  const roots = [path.join(ROOT, 'commands')];
  for (const moduleName of fs.readdirSync(path.join(ROOT, 'modules'))) {
    const dir = path.join(ROOT, 'modules', moduleName, 'commands');
    if (fs.existsSync(dir)) roots.push(dir);
  }
  return roots.flatMap(dir => fs.readdirSync(dir)
    .filter(name => name.endsWith('.md') && name !== 'INDEX.md')
    .map(name => path.join(dir, name)));
}

test('every command front door states its non-use boundary before completion', () => {
  // docs/agent-guidance/command-contract.md: "State the trigger and nearest
  // non-use boundary before detailed mechanics."
  const offenders = [];
  for (const file of commandFiles()) {
    const body = fs.readFileSync(file, 'utf8');
    const boundary = body.search(/^Not for: \S/m);
    const completion = body.search(/^Completion:/m);
    if (boundary < 0 || (completion >= 0 && boundary > completion)) {
      offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepStrictEqual(offenders, [], `missing "Not for:" boundary:\n${offenders.join('\n')}`);
});

run('command-front-door-parity');
