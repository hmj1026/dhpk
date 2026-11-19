'use strict';

// #1428: base64 and dd are Readers with their own input grammar (spec #1422, REQ-6, REQ-9).
// Every block has a legitimate-use allow beside it, every allow a dangerous counterpart.
const { run, assert } = require('./_lib/tinytest');
const { batchTest: test } = require('./_lib/hookreplay');
const { runHook: runHookAt } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FIXTURE_CWD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-credential-b64dd-')));
for (const name of ['.env', '.env.example', 'ordinary']) fs.writeFileSync(path.join(FIXTURE_CWD, name), 'synthetic');
process.on('exit', () => fs.rmSync(FIXTURE_CWD, { recursive: true, force: true }));
const runHook = (hook, command) => runHookAt(hook, { cwd: FIXTURE_CWD, payload: { tool_input: { command } } });

// Protected Path sources named through each command's own input syntax.
const protectedSource = [
  'base64 .env', 'base64 -d .env', 'base64 --decode .env', 'base64 -w 0 .env', 'base64 -w0 .env',
  'base64 --wrap=0 .env', 'base64 -- .env', 'base64 ordinary .env', 'base64 ./x/../.env', 'base64 credentials.json',
  'base64 -i .env', 'base64 -D -i .env -o out', 'base64 --input .env', 'base64 .env | tr -d "\\n"',
  '/usr/bin/base64 .env', 'env base64 .env',
  'dd if=.env', 'dd if=.env of=/dev/null', 'dd bs=1 if=.env', 'dd of=out if=.env bs=1M count=1',
  'dd if=./x/../.env', 'dd if=credentials.json', 'dd conv=ucase if=.env', 'dd iflag=fullblock if=.env status=none',
  'dd if=ordinary if=.env', 'dd if=.env | wc -c', 'sudo dd if=.env',
];
// Legitimate uses: ordinary and template inputs, options with their normal meaning.
const ordinarySource = [
  'base64 ordinary', 'base64 -d ordinary', 'base64 --decode ordinary', 'base64 -w 0 ordinary', 'base64 -w0 ordinary',
  'base64 --wrap=76 ordinary', 'base64 -- ordinary', 'base64 .env.example', 'base64 -i ordinary', 'base64 -i ordinary -o out',
  'base64 --input ordinary --output out', 'base64 -', 'base64', 'echo hi | base64', 'echo aGk= | base64 -d',
  // An option value is a number or output name, never a file the command reads.
  'base64 -w .env ordinary', 'base64 -o .env ordinary',
  'dd if=ordinary', 'dd if=ordinary of=out bs=1M count=1', 'dd if=.env.example', 'dd if=/dev/zero of=out bs=1 count=1',
  'dd if=ordinary skip=1 status=none', 'dd of=out', 'echo hi | dd of=out', 'dd --version', 'dd --help',
  // `of=` is not a source and only `if=` is: other operands are not filenames.
  'dd if=ordinary of=.env', 'dd if=ordinary bs=.env',
];
// Visible risk the grammar cannot resolve fails closed.
const ambiguous = [
  'base64 *.pem', 'base64 $(echo .env)', 'base64 -i "$(echo .env)"',
  'dd if=.e*', 'dd if=$(echo .env)', 'dd if=`echo .env`',
];
const unsupported = [
  'base64 --bogus ordinary', 'base64 -Z ordinary', 'base64 -w',
  'dd foo=bar if=ordinary', 'dd ordinary', 'dd if', 'dd --bogus if=ordinary', 'dd if=ordinary --version',
];

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} blocks base64 and dd reading a Protected Path (#1428)`, () => {
    for (const command of protectedSource) {
      const result = runHook(hook, command);
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
      assert.match(result.stderr, /protected path/, command);
      assert.doesNotMatch(result.stderr, /synthetic/, command);
    }
  });
  test(`${hook} allows base64 and dd on ordinary, template and non-source operands (#1428)`, () => {
    for (const command of ordinarySource) {
      const result = runHook(hook, command);
      assert.strictEqual(result.status, 0, `${command}: ${result.stderr}`);
    }
  });
  test(`${hook} blocks unresolvable base64 and dd sources with a literal-path rewrite (#1428)`, () => {
    for (const command of ambiguous) {
      const result = runHook(hook, command);
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
      assert.match(result.stderr, /^\[bash-guard\] blocked: ambiguous read target: /, command);
      assert.match(result.stderr, /explicit literal path/, command);
      assert.doesNotMatch(result.stderr, /git grep/, command);
    }
  });
  test(`${hook} fails closed on base64 and dd syntax it does not model (#1428)`, () => {
    for (const command of unsupported) {
      const result = runHook(hook, command);
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
      assert.match(result.stderr, /unsupported reader syntax/, command);
    }
  });
}

run('credential-base64-dd');
