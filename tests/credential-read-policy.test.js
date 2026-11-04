'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { runHook, ROOT } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} blocks reading .env`, () => {
    const result = runHook(hook, { payload: { tool_input: { command: 'cat .env' } } });
    assert.strictEqual(result.status, 2, result.stderr);
  });
}

const blocked = [
  'cat .env.production', 'less my.cnf', 'head debian.cnf', 'tail private.pem',
  'awk "{print}" id_rsa.pub', 'grep password credentials.json', 'rg password .env',
  'sed -n p "some dir/.env"', 'cat .env.example .env', 'cat ./x/../.env',
  'cat ordinary; cat .env', 'cat ordinary && cat .env', 'cat ordinary || cat .env',
  'cat ordinary | cat .env', 'cat ordinary\ncat .env', 'cat < .env',
  'cat 3<.env', 'grep -f .env ordinary', 'grep -nf .env ordinary', 'grep --exclude-from=.env needle .', 'rg --ignore-file .env needle .', 'sed -f.env ordinary',
  'grep -rn needle .', 'rg needle .', 'rg needle --glob "!*.pem" .',
  'ssh -p 22 example "cat .env"', 'ssh example cat .env',
  'cat *.pem', 'cat .env.example; cat credentials.json',
  'python3 credential-extract.py --file .env --fields host',
];
const allowed = [
  'ls .env', 'stat .env', 'cat ordinary', 'cat .env.example', 'cat .env.sample',
  'cat .env.dist', 'cat .env.template', 'grep needle ordinary',
  'grep -r --exclude="*" needle .', 'rg --glob "!*" needle .',
];
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} protects target-scoped reads`, () => {
    for (const command of blocked) {
      const result = runHook(hook, { payload: { tool_input: { command } } });
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
    }
  });
  test(`${hook} allows safe controls`, () => {
    for (const command of allowed) {
      const result = runHook(hook, { payload: { tool_input: { command } } });
      assert.strictEqual(result.status, 0, `${command}: ${result.stderr}`);
    }
  });
  test(`${hook} enforces additive custom policy and malformed inputs`, () => {
    for (const command of ['cat secret.conf', 'cat a/config/private.key', 'cat .env.example']) {
      const result = runHook(hook, { payload: { tool_input: { command } }, env: {
        CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: JSON.stringify(['secret.conf', 'config/private.key', '.env.example']),
      } });
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
    }
    for (const payload of ['not json', JSON.stringify({tool_input: {command: 4}})]) {
      assert.strictEqual(runHook(hook, { payload }).status, 2);
    }
    assert.strictEqual(runHook(hook, { payload: {tool_input: {command: ''}}, env: {CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: 'invalid'} }).status, 2);
  });
}

test('all supported readers reject every default credential family', () => {
  const readers = ['cat', 'less', 'head', 'tail', 'sed -n p', 'awk "{print}"', 'grep needle', 'rg needle'];
  for (const reader of readers) {
    for (const target of ['.env', '.env.production', 'my.cnf', 'debian.cnf', 'private.pem', 'id_rsa.pub', 'credentials.json']) {
      const command = `${reader} ${target}`;
      assert.strictEqual(runHook('pre-bash-guard.sh', { payload: {tool_input: {command}} }).status, 2, command);
    }
  }
});

test('only the exact pinned extractor invocation is permitted', () => {
  const python = fs.realpathSync(execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {encoding: 'utf8'}).trim());
  const helper = path.join(ROOT, 'scripts/hooks/credential-extract.py');
  const exact = `${python} -I -S ${helper} --file /tmp/.env --fields host,dbname`;
  for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
    assert.strictEqual(runHook(hook, {payload: {tool_input: {command: exact}}}).status, 0);
    for (const command of [
      `${exact}; cat .env`, `${exact} | cat`, `VAR=x ${exact}`, `${exact} > output`,
      `${exact} --extra`, exact.replace('host,dbname', 'host,password'),
      `ssh example '${exact}'`,
    ]) {
      assert.strictEqual(runHook(hook, {payload: {tool_input: {command}}}).status, 2, command);
    }
  }
});

run('credential-read-policy');
