'use strict';

// (#1456) A find that selects files by name and hands them to a Reader (`-exec cat {}` or a piped xargs)
// reads every selected path. With a plain -name/-iname conjunction the guard judges the named files; (#1460)
// a find without a name filter, or with predicates the guard does not model (-o, !, -not, parentheses),
// is judged like grep -r: the find roots are scanned and blocked only when a protected path is found or the
// tree cannot be scanned.
// Hook-boundary outcomes use synthetic fixtures; unit rows cover the parser in `credential_find.py`.
const { test, run, assert } = require('./_lib/tinytest');
const { runHook: runHookAt, ROOT } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const FIXTURE_CWD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-credential-find-')));
fs.writeFileSync(path.join(FIXTURE_CWD, '.env'), 'synthetic');
fs.writeFileSync(path.join(FIXTURE_CWD, 'ordinary'), 'synthetic');
fs.writeFileSync(path.join(FIXTURE_CWD, 'app.js'), 'synthetic');
fs.writeFileSync(path.join(FIXTURE_CWD, 'notes.md'), 'synthetic');
process.on('exit', () => fs.rmSync(FIXTURE_CWD, { recursive: true, force: true }));
// (#1460) A tree without any protected file: an unfiltered find stays allowed here.
const CLEAN_CWD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-credential-find-clean-')));
fs.writeFileSync(path.join(CLEAN_CWD, 'app.js'), 'synthetic');
fs.writeFileSync(path.join(CLEAN_CWD, 'notes.md'), 'synthetic');
process.on('exit', () => fs.rmSync(CLEAN_CWD, { recursive: true, force: true }));
const HOOKS = ['pre-bash-guard.sh', 'pre-bash-dispatch.sh'];
const decide = (hook, command, cwd = FIXTURE_CWD) => runHookAt(hook, { cwd, payload: { tool_input: { command } } });

const blocked = [
  'find . -name .env -exec cat {} \\;',
  'find . -name .env | xargs cat',
  'find . -iname .ENV -exec cat {} +',
  'find . -name .env -execdir head {} \\;',
  'find . -name .env -print0 | xargs -0 cat',
  'find . -name ".env*" -exec cat {} \\;',
  'find . -name "*.js" -name .env -exec cat {} \\;',
  'n=.env; find . -name "$n" -exec cat {} \\;',
  // (#1456 review) wrapped readers, compound words before find or xargs, and `+` that does not end the clause
  'find . -name .env -exec env cat {} \\;', 'find . -name .env -exec nice cat {} \\;', 'find . -name .env -exec timeout 5 cat {} \\;',
  'find . -name .env | xargs env cat', 'find . -name .env -print0 | xargs -0 -n1 timeout 5 cat',
  '{ find . -name .env -exec cat {} \\; ; }', 'if true; then find . -name .env -exec cat {} \\; ; fi',
  '! find . -name .env -exec cat {} \\;', 'find . -name .env | { xargs cat; }', 'f() { find . -name .env -exec cat {} \\; ; }; f',
  'find . -name .env -exec cat + {} \\;',
  // (#1460) no name filter, or predicates the guard does not model: the roots are scanned
  'find . -type f -exec cat {} +', 'find . -type f | xargs cat',
  "find . -name '*.js' -o -name .env -exec cat {} \\;", 'find . ! -name app.js -exec cat {} +',
  // (#1460) xargs interactive options still run the command on the selected words
  'find . -name .env | xargs -o cat', 'find . -name .env | xargs -p cat', 'find . -name .env | xargs -e cat',
  'find . -name .env | xargs -eEOF cat', 'find . -name .env | xargs --open-tty cat', 'echo .env | xargs -o cat',
  // (#1460 review) short-option clusters of known xargs flags
  'find . -name .env | xargs -or cat', 'find . -name .env | xargs -pt cat', 'find . -name .env | xargs -0o cat',
  'find . -name .env -print0 | xargs -0r cat',
];
const ambiguous = [
  'find . -name "$n" -exec cat {} \\;',
  'find . -name "$n" | xargs cat',
  'find . -name "$(date)" -exec cat {} \\;',
];
const allowed = [
  "find . -name '*.js' -exec cat {} \\;",
  "find . -name '*.md' | xargs cat",
  'echo find . -exec cat {} +',
  'find . -name .env',
  'find . -name .env -exec echo {} \\;',
  'find . -name .env | xargs echo',
  "find . -name '*.js' -exec env cat {} \\;", "find . -name '*.js' | xargs env cat", "{ find . -name '*.js' -exec cat {} \\; ; }",
  // (#1460)
  "find . -name '*.md' | xargs -o cat", "find . -name '*.md' | xargs -p cat", 'echo ordinary | xargs -o cat',
  'find . -name notes.md | xargs -or cat',
  'find . -type f', 'find . -type f -exec echo {} \\;',
];
const cleanAllowed = ['find . -type f -exec cat {} +', 'find . -type f | xargs cat'];
const NO_FILTER_HINT = 'narrow the find roots to directories without protected files, or use a plain -name filter (no -o, !, or parentheses) that does not match a protected file';

for (const hook of HOOKS) {
  test(`${hook} blocks find -name selecting a Protected Path for a Reader (#1456)`, () => {
    for (const command of blocked) {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /\[bash-guard\] blocked:/, JSON.stringify(command));
      assert.ok(!result.stderr.includes('synthetic'), 'no file content in the reason');
    }
  });
  test(`${hook} fails closed on a dynamic find -name filter with a rewrite direction (#1456)`, () => {
    for (const command of ambiguous) {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /find -name/, JSON.stringify(command));
      assert.match(result.stderr, /explicit literal operand|find -name filter/, `rewrite direction: ${result.stderr}`);
    }
  });
  test(`${hook} gives a stable rewrite hint when an unfiltered find selects a Protected Path (#1460)`, () => {
    for (const command of ['find . -type f -exec cat {} +', 'find . -type f | xargs cat']) {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.ok(result.stderr.includes(NO_FILTER_HINT), `hint: ${result.stderr}`);
    }
  });
  test(`${hook} allows an unfiltered find whose roots hold no Protected Path (#1460)`, () => {
    for (const command of cleanAllowed) {
      const result = decide(hook, command, CLEAN_CWD);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });
  test(`${hook} keeps allowing finds that name no Protected Path or hand nothing to a Reader (#1456)`, () => {
    for (const command of allowed) {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });
}

// (#1462) A find or xargs behind wrappers (and their option values) is judged like a bare one.
// Each row keeps its matrix ID in the test name. Controls (benign rows) pass before and after the change.
const wrapperBlocked = [
  ['W1', 'busybox find . -exec cat {} +'],
  ['W2', 'busybox find . -name .env -exec cat {} \\;'],
  ['W3', 'nice -n 5 find . -name .env -exec cat {} \\;'],
  ['W4', 'timeout 5 find . -name .env -exec cat {} \\;'],
  ['W5', 'sudo -u root find . -name .env -exec cat {} \\;'],
  ['X1', 'echo .env | nice -n 5 xargs cat'],
  ['X2', 'echo .env | busybox xargs cat'],
  ['time-p', 'time -p find . -name .env -exec cat {} \\;'],
  ['sudo-D', "sudo -D /tmp find . -name '*.js' -exec cat {} \\;"],
  ['xargs-rn1', 'echo .env | xargs -rn1 cat'],
  ['bare-find', 'find . -name .env -exec cat {} \\;'],
];
const wrapperAllowed = [
  ['nice', "nice -n 5 find . -name '*.js' -exec cat {} \\;"],
  ['busybox', "busybox find . -name '*.js' -exec cat {} \\;"],
  ['timeout', "timeout 5 find . -name '*.js' -exec cat {} \\;"],
  ['sudo-u', "sudo -u root find . -name '*.js' -exec cat {} \\;"],
  ['env', "env find . -name '*.js' -exec cat {} \\;"],
  ['xargs-nice', 'echo ordinary | nice -n 5 xargs cat'],
  ['xargs-busybox', 'echo ordinary | busybox xargs cat'],
  ['xargs-rn1', 'echo ordinary | xargs -rn1 cat'],
];
for (const hook of HOOKS) {
  for (const [id, command] of wrapperBlocked) {
    test(`${hook} blocks wrapped find/xargs ${id} (#1462): ${command}`, () => {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /\[bash-guard\] blocked:/);
    });
  }
  for (const [id, command] of wrapperAllowed) {
    test(`${hook} allows benign wrapped find/xargs ${id} (#1462): ${command}`, () => {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    });
  }
  test(`${hook} allows W1 in a tree without a protected file (#1462)`, () => {
    const result = decide(hook, 'busybox find . -exec cat {} +', CLEAN_CWD);
    assert.strictEqual(result.status, 0, result.stderr);
  });
}

// Unit seam: the parser reports roots, name filters, exec clauses and unmodelled predicates.
const LIB = path.join(ROOT, 'scripts/hooks/_lib');
const PROBE = String.raw`
import json, sys
from credential_shell import lex
from credential_find import find_spec

out = []
for command in json.load(sys.stdin):
    words = [t for t in lex(command).tokens if not t.operator]
    spec = find_spec(words, 0)
    out.append(None if spec is None else {
        'roots': [t.value for t in spec.roots],
        'filters': [[w.value, folded] for w, folded in spec.filters],
        'clauses': [[t.value for t in c] for c in spec.clauses],
        'follow': spec.follow,
        'unmodelled': spec.unmodelled,
    })
json.dump(out, sys.stdout)
`;
function parse(commands) {
  const result = spawnSync('python3', ['-B', '-c', PROBE], {
    input: JSON.stringify(commands), env: { ...process.env, PYTHONPATH: LIB }, encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('find_spec reads roots, name filters, exec clauses and follow options (#1456)', () => {
  const [plain, multi, follow, notFind] = parse([
    'find . -name .env -exec cat {} ;',
    'find a b -iname X -type f -name Y -execdir head {} +',
    'find -L src -follow -name z',
    'cat find',
  ]);
  assert.deepStrictEqual(plain, { roots: ['.'], filters: [['.env', false]], clauses: [['cat', '{}']], follow: false, unmodelled: false });
  assert.deepStrictEqual(multi, {
    roots: ['a', 'b'], filters: [['X', true], ['Y', false]], clauses: [['head', '{}']], follow: false, unmodelled: false,
  });
  assert.deepStrictEqual(follow, { roots: ['src'], filters: [['z', false]], clauses: [], follow: true, unmodelled: false });
  assert.strictEqual(notFind, null);
});

test('find_spec ends an exec clause at + only when it follows {} (#1456)', () => {
  const [plus, literal] = parse(['find . -name .env -exec cat {} +', 'find . -name .env -exec cat + {} ;']);
  assert.deepStrictEqual(plus.clauses, [['cat', '{}']]);
  assert.deepStrictEqual(literal.clauses, [['cat', '+', '{}']]);
});

test('find_spec marks predicates it does not model (#1456)', () => {
  const rows = parse([
    'find . -name a -o -name b', 'find . ! -name a', 'find . -not -name a', 'find . -name a -printf x',
  ]);
  for (const row of rows) assert.strictEqual(row.unmodelled, true, JSON.stringify(row));
});

run('credential-find');
