'use strict';

// (#1451) A shell startup file named by BASH_ENV, ENV, --rcfile or --init-file is run as shell code,
// so it is an execution entrance judged by the same visible-name rule as source and dot (#1430).
// The startup file content is never read; only its name is judged.
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, runHook } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Two fixtures: a protected branch (main) and a feature branch. The synthetic .env holds no secret.
const mk = (branch) => {
  const repo = mkRepo({ prefix: 'dhpk-startup-file-', gitConfig: true });
  const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('branch', '-M', 'main');
  if (branch !== 'main') git('checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(repo, '.env'), 'synthetic');
  fs.writeFileSync(path.join(repo, 'ordinary'), 'synthetic');
  fs.writeFileSync(path.join(repo, 'hook.sh'), 'synthetic');
  process.on('exit', () => rmRepo(repo));
  return repo;
};
const FIXTURES = { main: mk('main'), feature: mk('feature/x') };

const at = (hook, command, cwd) =>
  runHook(hook, { cwd, env: { DHPK_BRANCH_SAFETY: 'block' }, payload: { tool_input: { command } } });

const blocked = [
  // #1436 B05 B06 R03 R04
  'BASH_ENV=.env bash -c :',
  'export BASH_ENV=.env; bash -c :',
  'bash --rcfile .env -i </dev/null',
  'bash --init-file .env -i -c : </dev/null',
  // other carriers and spellings of the same entrance
  'ENV=.env sh -c :',
  'export ENV=.env; sh -i </dev/null',
  'env BASH_ENV=.env bash -c :',
  'env -i BASH_ENV=./.env bash -c :',
  'BASH_ENV=".env" bash -c :',
  "BASH_ENV='.env' bash -c :",
  'BASH_ENV=/srv/app/.env bash -c :',
  'BASH_ENV=.env.production bash -c :',
  'BASH_ENV=config/../.env bash -c :',
  'declare -x BASH_ENV=.env; bash -c :',
  'true && BASH_ENV=.env bash -c :',
  'bash -i --rcfile .env </dev/null',
  'bash -o posix --rcfile .env -i </dev/null',
  'bash --noprofile --rcfile .env -i </dev/null',
  'bash --rcfile ./.env -i </dev/null',
  'bash --rcfile ".env" -i </dev/null',
  'sudo bash --rcfile .env -i </dev/null',
  'env bash --init-file .env -i </dev/null',
  '/bin/bash --init-file .env -i </dev/null',
  // an operand that cannot be resolved fails closed
  'BASH_ENV=*.env bash -c :',
  'BASH_ENV=$(echo ordinary) bash -c :',
  'bash --rcfile .e* -i </dev/null',
  'bash --init-file $(echo ordinary) -i </dev/null',
];
const allowed = [
  // #1436 B09 R06 and the pins that stay green
  'BASH_ENV=./ordinary bash -c :',
  'bash --rcfile ./ordinary -i -c : </dev/null',
  'BASH_ENV=./hook.sh bash -c :',
  'bash --rcfile ./hook.sh -i -c : </dev/null',
  // ordinary and template startup files
  'ENV=./ordinary sh -c :',
  'export BASH_ENV=./ordinary; bash -c :',
  'BASH_ENV=.env.example bash -c :',
  'bash --rcfile .env.example -i </dev/null',
  'bash --init-file ./ordinary -i </dev/null',
  'BASH_ENV= bash -c :',
  'BASH_ENV=/dev/null bash -c :',
  // words that only look like startup options are data or arguments of something else
  'echo BASH_ENV=.env',
  'echo bash --rcfile .env',
  'printf "%s" --init-file .env',
  'bash script.sh --rcfile .env',
  'bash -c : --rcfile .env',
  'FOO=.env bash -c :',
  'OTHER_ENV=.env bash -c :',
  'BASH_ENV=./ordinary cat ordinary',
];

for (const [name, cwd] of Object.entries(FIXTURES)) {
  for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
    for (const command of blocked) {
      test(`${name} ${hook} blocks startup file entrance: ${command}`, () => {
        const result = at(hook, command, cwd);
        assert.strictEqual(result.status, 2, result.stderr);
        assert.match(result.stderr, /\[bash-guard\] blocked:/);
      });
    }
    for (const command of allowed) {
      test(`${name} ${hook} allows startup file use: ${command}`, () => {
        const result = at(hook, command, cwd);
        assert.strictEqual(result.status, 0, result.stderr);
      });
    }
  }
}

test('startup file block names the construct and a safe rewrite without echoing content', () => {
  const result = at('pre-bash-guard.sh', 'BASH_ENV=.env bash -c :', FIXTURES.feature);
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /protected path|execution entrance/i);
  assert.ok(!result.stderr.includes('synthetic'));
  const unresolved = at('pre-bash-guard.sh', 'BASH_ENV=*.env bash -c :', FIXTURES.feature);
  assert.match(unresolved.stderr, /execution entrance operand/);
  assert.match(unresolved.stderr, /explicit literal path/);
});

run('credential-startup-file');
