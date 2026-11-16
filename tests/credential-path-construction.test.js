'use strict';

// #1427 (spec #1422, REQ-5): a Protected Path read must not escape the guard by
// how the path word is spelled or built from visible text: ANSI-C and locale
// quoting, brace expansion, parameter defaults, split words, and variables set
// earlier in the same command. Public seam: the guard and the dispatcher read
// the host JSON payload; fixtures are synthetic and nothing is executed.
const { test, run, assert } = require('./_lib/tinytest');
const { runHook: runHookAt } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FIXTURE_CWD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-credential-construct-')));
fs.writeFileSync(path.join(FIXTURE_CWD, '.env'), 'synthetic');
fs.writeFileSync(path.join(FIXTURE_CWD, 'ordinary'), 'synthetic');
fs.mkdirSync(path.join(FIXTURE_CWD, 'config'));
fs.writeFileSync(path.join(FIXTURE_CWD, 'config', 'private.key'), 'synthetic');
process.on('exit', () => fs.rmSync(FIXTURE_CWD, { recursive: true, force: true }));
const HOOKS = ['pre-bash-guard.sh', 'pre-bash-dispatch.sh'];
const decide = (hook, command, env = {}) => runHookAt(hook, { cwd: FIXTURE_CWD, payload: { tool_input: { command } }, env });

// Each row reads a Protected Path once the word is built the way the shell would.
const blocked = [
  // ANSI-C quoting decodes escapes before the path is matched
  "cat $'.env'", "cat $'.e\\x6ev'", "cat $'\\056env'", "cat $'\\u002eenv'", "cat $'.e'nv", "cat $'.en\\166'",
  "cat $'\\x2eenv'", "cat $'.env\\0ignored'", "cat ordinary $'.env'", "cat $'.e\\nnv' $'.env'",
  // locale quoting is a plain double quote
  'cat $".env"', 'cat $".e"nv', 'cat ".e"$"nv"',
  // brace expansion yields several words
  'cat .{e,}nv', 'cat {.env,ordinary}', 'cat .env{,.bak}', 'cat ordinary .e{n,x}v', 'cat {a,.env}',
  // variables with a visible source in the same command
  'f=.env; cat $f', 'f=.env; cat "$f"', 'f=.env; cat ${f}', 'export f=.env; cat $f', 'f=.e; g=nv; cat $f$g',
  'f=.en; cat ${f}v', 'f=ordinary; f=.env; cat $f', 'f=.env && cat $f', 'f=.env\ncat $f',
  "f=$'.env'; cat $f", 'f=.e; f+=nv; cat $f', 'for f in ordinary .env; do cat $f; done',
  // parameter defaults and alternatives carry a visible path
  'cat ${x:-.env}', 'cat "${x:-.env}"', 'cat ${x-.env}', 'cat ${x:=.env}', 'cat ${x=.env}', 'cat ${x:+.env}',
  'f=ordinary; cat ${f:+.env}', 'cat ${x:-.e}nv', 'cat ${x:-${y:-.env}}', 'y=.env; cat ${x:-$y}',
  // an unquoted value splits into several words
  "f='ordinary .env'; cat $f", "f='.env ordinary'; cat $f",
  // a visible value that the guard cannot resolve is an ambiguous read target
  'f=.e*; cat $f', 'f=.env; cat ${f#x}', 'f=.env; cat ${f:0:4}', 'f=.env; cat ${f/x/y}',
];

const allowed = [
  "cat $'ordinary'", 'cat $"ordinary"', "cat $'.env.example'", "cat $'ord\\x69nary'", "cat $'a\\0.env'",
  "echo $'.env'", "printf '%s\\n' $'.env'", 'echo $".env"',
  'cat {ordinary,ordinary}', 'cat ord{i,i}nary', 'echo .{e,}nv', 'cat ".{e,}nv"', "cat '.{e,}nv'", 'cat .env.{example,sample}',
  'f=ordinary; cat $f', 'f=ordinary; cat "$f"', 'f=.env; echo $f', 'f=.env; echo "$f"', "f=.env; cat '$f'",
  'f=.env.example; cat $f', "f='.env ordinary'; cat \"$f\"", 'f=.env; f=ordinary; echo x; cat ordinary',
  'cat ${x:-ordinary}', 'cat "${x:-ordinary}"', 'cat ${x:+ordinary}', 'cat $UNSET_PATH_NAME', 'cat "$file"', 'cat "${file}"',
  'for f in ordinary; do cat $f; done', 'g=.env; cat ordinary', 'echo ${x:-.env}', 'f=.env; echo ${f#x}',
  "grep -e needle ordinary", 'grep $pattern ordinary', 'p=.env; grep $p ordinary',
];

for (const hook of HOOKS) {
  test(`${hook} blocks a Protected Path read built by quoting, braces or visible variables (#1427)`, () => {
    for (const command of blocked) {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)} should block: ${result.stderr}`);
      assert.match(result.stderr, /\[bash-guard\] blocked:/, JSON.stringify(command));
    }
  });
  test(`${hook} still allows ordinary files, templates and pure-data mentions of the same forms (#1427)`, () => {
    for (const command of allowed) {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)} should allow: ${result.stderr}`);
    }
  });
  test(`${hook} applies custom Protected Path rules to constructed words (#1427)`, () => {
    const env = { CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: '["config/private.key"]' };
    for (const command of ["cat $'config/private.key'", 'cat config/{private,x}.key', 'k=config/private.key; cat $k', 'cat ${x:-config/private.key}']) {
      assert.strictEqual(decide(hook, command, env).status, 2, JSON.stringify(command));
    }
    for (const command of ["cat $'config/other.key'", 'cat config/{a,b}.key', 'k=ordinary; cat $k', 'cat ${x:-ordinary}']) {
      assert.strictEqual(decide(hook, command, env).status, 0, JSON.stringify(command));
    }
  });
  test(`${hook} explains an unresolved visible value with a stable reason and a rewrite direction (#1427)`, () => {
    const result = decide(hook, 'f=.env; cat ${f:0:4}');
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /ambiguous read target/);
    assert.match(result.stderr, /explicit literal path/);
    assert.ok(!result.stderr.includes('synthetic'), 'the reason must not echo file content');
  });
}

run('credential-path-construction');
