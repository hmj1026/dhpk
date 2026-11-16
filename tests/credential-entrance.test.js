'use strict';

// (#1430) source and dot are execution entrances: the file they run is judged by its visible
// name, apart from the Reader adapters. The script content is never read.
const { test, run, assert } = require('./_lib/tinytest');
const { runHook: runHookAt, mkRepo, rmRepo } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FIXTURE_CWD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-entrance-cwd-')));
fs.writeFileSync(path.join(FIXTURE_CWD, '.env'), 'synthetic');
fs.writeFileSync(path.join(FIXTURE_CWD, 'ordinary'), 'synthetic');
fs.mkdirSync(path.join(FIXTURE_CWD, 'bin'));
fs.writeFileSync(path.join(FIXTURE_CWD, 'bin', 'activate'), 'synthetic');
process.on('exit', () => fs.rmSync(FIXTURE_CWD, { recursive: true, force: true }));

const decide = (hook, command, options = {}) =>
  runHookAt(hook, { cwd: FIXTURE_CWD, payload: { tool_input: { command } }, ...options });

// Both spellings, each with the prefixes and separators that still reach command position.
const blocked = [
  'source .env', '. .env', 'source ./.env', '. ./.env', 'source -- .env', '. -- .env',
  'source .env.production', 'source config/../.env', 'source /srv/app/.env',
  'command source .env', 'builtin . .env', 'FOO=1 source .env', '! source .env', 'time . .env',
  'true && source .env', 'true; . .env', 'false || . .env', 'echo x & source .env',
  'if true; then source .env; fi', '{ . .env; }', 'source .env arg', 'source .env >/dev/null',
  '>/dev/null source .env', '2>&1 . .env', 'f=.env; source $f', 'source $\'.e\\x6ev\'',
  'source ".env"', "source '.env'", 'source $HOME/.env',
  // Unresolvable operands next to an execution entrance fail closed with a rewrite direction.
  'source *.env', '. .e*', '. $(echo ordinary)', 'source `echo ordinary`',
];
const allowed = [
  'source ordinary', '. ordinary', 'source ./ordinary', 'source bin/activate', '. bin/activate',
  'source .env.example', '. .env.example', 'source .env.sample', 'command source ordinary',
  'true && source bin/activate', 'if true; then source bin/activate; fi',
  // Words that only look like entrances are plain data or other commands' operands.
  'echo source .env', 'echo . .env', 'ls .', 'git add .', 'grep x . --include=ordinary', 'printf "%s" source .env',
  // Extra operands are positional parameters, not scripts that are run.
  'source ordinary .env', '. bin/activate .env',
  'source', '.',
];
const hooks = ['pre-bash-guard.sh', 'pre-bash-dispatch.sh'];

for (const hook of hooks) {
  for (const command of blocked) {
    test(`${hook} blocks execution entrance: ${JSON.stringify(command)}`, () => {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
      assert.match(result.stderr, /\[bash-guard\] blocked:/);
    });
  }
  for (const command of allowed) {
    test(`${hook} allows ordinary execution entrance use: ${JSON.stringify(command)}`, () => {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 0, `${command}: ${result.stderr}`);
    });
  }
  test(`${hook} gives the same verdict for source and dot`, () => {
    for (const operand of ['.env', 'ordinary', '*.env', 'bin/activate']) {
      assert.strictEqual(decide(hook, `source ${operand}`).status, decide(hook, `. ${operand}`).status, operand);
    }
  });
  test(`${hook} names a stable reason and a rewrite direction without leaking content`, () => {
    const secret = decide(hook, 'source .env');
    assert.match(secret.stderr, /protected path: execution entrance operand/);
    assert.match(secret.stderr, /controlled extraction or provide non-secret information/);
    assert.doesNotMatch(secret.stderr, /synthetic/);
    const wild = decide(hook, 'source *.env');
    assert.match(wild.stderr, /ambiguous read target: execution entrance operand '\*\.env'/);
    assert.match(wild.stderr, /explicit literal path without wildcards or command substitutions/);
    const option = decide(hook, 'source -p /bin ordinary');
    assert.strictEqual(option.status, 2);
    assert.match(option.stderr, /unsupported reader syntax: execution entrance option '-p'/);
  });
  test(`${hook} does not turn source into an ordinary Reader`, () => {
    // A Reader adapter would also judge extra operands and options; an entrance judges only the script.
    assert.strictEqual(decide(hook, 'source ordinary -r .env').status, 0);
    assert.strictEqual(decide(hook, 'cat ordinary .env').status, 2);
  });
}

// REQ-8: the accepted conservative restriction "source before git" stays exactly as it was.
test('the Git Gate still blocks git after an activation file, and plain git stays allowed', () => {
  const repo = mkRepo({ prefix: 'dhpk-entrance-git-', gitConfig: true });
  try {
    const env = { DHPK_BRANCH_SAFETY: 'block' };
    for (const hook of ['pretool-git-gate.sh', 'pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
      const before = runHookAt(hook, { cwd: repo, env, payload: { tool_input: { command: 'source ordinary && git commit -m x' } } });
      const plain = runHookAt(hook, { cwd: repo, env, payload: { tool_input: { command: 'git status' } } });
      assert.strictEqual(plain.status, 0, `${hook}: ${plain.stderr}`);
      if (hook !== 'pre-bash-guard.sh') assert.strictEqual(before.status, 2, `${hook}: ${before.stderr}`);
    }
  } finally {
    rmRepo(repo);
  }
});

run('credential-entrance');
