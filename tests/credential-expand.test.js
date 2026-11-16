'use strict';

// In-process seam for #1427: `expand_variants` resolves the brace lists,
// parameter expansions and visible assignments of one lexed command into the
// word lists the policy judges. Hook-boundary outcomes live in
// credential-path-construction.test.js.
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT } = require('./_lib/hookharness');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const LIB = path.join(ROOT, 'scripts/hooks/_lib');

const PROBE = String.raw`
import json, sys
from credential_shell import lex
from credential_expand import expand_variants

out = []
for command in json.load(sys.stdin):
    tokens = lex(command).tokens
    variants = expand_variants(tokens)
    if variants is None:
        out.append(None)
        continue
    out.append(sorted(' '.join(('<%s>' % t.value) + ('?' if t.unresolved else '') for t in v if not t.operator) for v in variants))
json.dump(out, sys.stdout)
`;

function expand(commands) {
  const result = spawnSync('python3', ['-B', '-c', PROBE], {
    input: JSON.stringify(commands), env: { ...process.env, PYTHONPATH: LIB }, encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const rows = [
  // a plain command needs no resolution
  ['cat .env', null],
  // a name with no visible source stays as written, so existing verdicts do not change
  ['cat $UNSET_NAME', ['<cat> <$UNSET_NAME>']],
  ['echo "$HOME"', ['<echo> <$HOME>']],
  // brace lists and sequences
  ['cat .{e,}nv', ['<cat> <.env>', '<cat> <.nv>']],
  ['cat {a,b}{1,2}', ['<cat> <a1>', '<cat> <a2>', '<cat> <b1>', '<cat> <b2>']],
  ['cat f{1..3}', ['<cat> <f1>', '<cat> <f2>', '<cat> <f3>']],
  ['cat f{08..10}', ['<cat> <f08>', '<cat> <f09>', '<cat> <f10>']],
  ['cat {c..a}', ['<cat> <a>', '<cat> <b>', '<cat> <c>']],
  ['cat {a,{b,c}}', ['<cat> <a>', '<cat> <b>', '<cat> <c>']],
  ['cat {1..100}', ['<cat> <{1..100}>?']],
  // quoted or escaped braces are literal
  ["cat '{a,b}'", null],
  ['cat "{a,b}"', null],
  ['cat \\{a,b}', null],
  ['cat {.env}', null],
  // visible assignments
  ['f=.env; cat $f', ['<f=.env> <cat> <.env>']],
  ['f=a; f=b; cat $f', ['<f=a> <f=b> <cat> <a>', '<f=a> <f=b> <cat> <b>']],
  ['f=.e; g=nv; cat $f$g', ['<f=.e> <g=nv> <cat> <.env>']],
  ['f=a; f+=b; cat $f', ['<f=a> <f+=b> <cat> <a>', '<f=a> <f+=b> <cat> <ab>', '<f=a> <f+=b> <cat> <b>']],
  ['f=a; g=$f; cat $g', ['<f=a> <g=a> <cat> <a>']],
  ['for f in a b; do cat $f; done', ['<for> <f> <in> <a> <b> <do> <cat> <a> <done>', '<for> <f> <in> <a> <b> <do> <cat> <b> <done>']],
  // splitting only applies to an unquoted expansion
  ["f='a b'; cat $f", ['<f=a b> <cat> <a> <b>']],
  ["f='a b'; cat \"$f\"", ['<f=a b> <cat> <a b>']],
  // defaults and alternatives
  ['cat ${x:-.env}', ['<cat> <.env>']],
  ['cat "${x-a b}"', ['<cat> <a b>']],
  ['cat ${x:+.env}', ['<cat>', '<cat> <.env>']],
  ['cat ${x:-${y:-.env}}', ['<cat> <.env>']],
  ['y=.env; cat ${x:-$y}', ['<y=.env> <cat> <.env>']],
  ['f=a; cat ${f:-b}', ['<f=a> <cat> <a>', '<f=a> <cat> <b>']],
  // a visible value behind an operator that cannot be resolved is unresolved; no source stays as written
  ['f=.env; cat ${f#x}', ['<f=.env> <cat> <${f#x}>?']],
  ['cat ${f#x}', ['<cat> <${f#x}>']],
  ['f=.env; cat ${f:0:2}', ['<f=.env> <cat> <${f:0:2}>?']],
];

test('expand_variants resolves visible brace lists, assignments and parameter defaults (#1427)', () => {
  const results = expand(rows.map(([command]) => command));
  rows.forEach(([command, expected], index) => {
    assert.deepStrictEqual(results[index], expected, JSON.stringify(command));
  });
});

test('expand_variants marks a word with too many alternatives unresolved instead of expanding it (#1427)', () => {
  const [result] = expand(['cat {1..9}{1..9}{1..9}']);
  assert.deepStrictEqual(result, ['<cat> <{1..9}{1..9}{1..9}>?']);
});

run('credential-expand');
