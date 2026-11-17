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
// (#1462) A subdirectory without a protected file whose parent holds one: a wrapper that moves the directory up reaches it.
const SUB_CWD = path.join(FIXTURE_CWD, 'clean');
fs.mkdirSync(SUB_CWD);
fs.writeFileSync(path.join(SUB_CWD, 'sample.js'), 'synthetic');
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

// (#1462 review) env -S runs its string as the command; options that move the directory or root stay blocked.
const envSplitBlocked = [
  ['R-env-S-1', 'env -S find . -name .env -exec cat {} +'],
  ['R-env-S-2', 'env -S find . -exec cat {} +'],
  ['R-env-S-3', 'env --split-string find . -name .env -exec cat {} +'],
  ['R-env-S-4', 'echo .env | env -S xargs cat'],
  ['R-env-S-5', 'env -S find . -name .env | xargs cat'],
  ['R-env-S-6', "env -S 'find . -name .env -exec cat {} +'"],
  ['R-env-S-7', "echo .env | env --split-string 'xargs cat'"],
];
const relocBlocked = [
  ['R-reloc-1', 'env --c=.. find . -exec cat {} +'],
  ['R-reloc-2', 'env --chd=.. find . -exec cat {} +'],
  ['R-reloc-3', 'env --c=.. find . | xargs cat'],
  ['R-reloc-4', 'sudo --chroot=.. find . -exec cat {} +'],
  ['R-reloc-5', 'sudo -R.. find . -exec cat {} +'],
  ['R-reloc-6', 'sudo --chd=.. find . -exec cat {} +'],
  ['R-reloc-7', 'sudo --lo find . -exec cat {} +'],
  ['R-reloc-8', 'doas sudo --chroot=.. find . -exec cat {} +'],
  ['R-reloc-9', 'sudo -i find . -exec cat {} +'],
  ['R-reloc-10', 'env -C .. find . -exec cat {} +'],
];
const relocAllowed = [
  ['A-reloc-1', 'nice --adjustment 5 find . -exec cat {} +'],
  ['A-reloc-2', 'timeout -s KILL 5 find . -exec cat {} +'],
  ['A-reloc-3', 'timeout --signal KILL 5 find . -exec cat {} +'],
  ['A-reloc-4', 'timeout --foreground 5 find . -exec cat {} +'],
  ['A-reloc-5', 'sudo --user root find . -exec cat {} +'],
  ['A-reloc-6', 'sudo -n -E find . -exec cat {} +'],
  ['A-reloc-7', 'env -i find . -exec cat {} +'],
  ['A-reloc-8', 'env -u NAME FOO=1 find . -exec cat {} +'],
  ['A-reloc-9', 'stdbuf -oL find . -exec cat {} +'],
  ['A-reloc-10', 'ionice -c 3 find . -exec cat {} +'],
  ['A-reloc-11', 'time -p find . -exec cat {} +'],
  ['A-reloc-12', 'nohup find . -exec cat {} +'],
  ['A-reloc-13', 'doas -u root find . -exec cat {} +'],
];
for (const hook of HOOKS) {
  for (const [id, command] of envSplitBlocked) {
    test(`${hook} blocks ${id} (#1462): ${command}`, () => {
      const result = decide(hook, command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /\[bash-guard\] blocked:/);
    });
  }
  for (const [id, command] of relocBlocked) {
    test(`${hook} blocks ${id} from a clean subdirectory (#1462): ${command}`, () => {
      const result = decide(hook, command, SUB_CWD);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /\[bash-guard\] blocked:/);
    });
  }
  for (const [id, command] of relocAllowed) {
    test(`${hook} allows ${id} from a clean subdirectory (#1462): ${command}`, () => {
      const result = decide(hook, command, SUB_CWD);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    });
  }
}

// (#1468) env split-string clusters, wrapper value clusters, text producers behind wrappers and xargs option clusters.
// Each block lists commands judged from one cwd; blocked rows exit 2 with a blocked reason, allowed rows exit 0.
const envSplit1468Blocked = [
  'env --split-string=cat .env', 'env --split-str=cat .env', "env --split-str='cat .env'", "env --s='cat .env'",
  'env -Scat .env', "env -iS 'cat .env'", "env -vS 'cat .env'", 'env -iScat .env', "env -iS 'cat\\_.env'",
  "echo .env | env -iS 'xargs cat'", 'env -S "$X"', 'env -iS "cat $X"',
  "find . -name .env | env -uFOOa -S 'xargs cat'", "find . -name .env | env -iuFOO -S 'xargs cat'", "env -uFOOa -S 'cat .env'",
];
const envSplit1468Allowed = ["env -S 'cat ordinary'", "env -iS 'cat ordinary'", 'env --split-string=cat ordinary', 'env ls -S', `X='cat ordinary'; env -S "$X"`, "env -uFOOa -S 'cat ordinary'"];
const wrapperValue1468Blocked = [
  'sudo -nu root find . -name .env -exec cat {} \\;', 'sudo -Eu root find . -name .env -exec cat {} \\;', "sudo -nu root bash -c 'cat .env'",
  'stdbuf --output L find . -name .env -exec cat {} \\;', "stdbuf --output L bash -c 'cat .env'",
  'ionice --class 3 find . -name .env -exec cat {} \\;', 'exec -a x find . -name .env -exec cat {} \\;',
  'doas -a x find . -name .env -exec cat {} \\;', 'nsenter -t 1 find . -name .env -exec cat {} \\;',
  'unshare -r find . -name .env -exec cat {} \\;', 'find . -name .env | sudo -nu root xargs cat',
  'find . -name .env | stdbuf --output L xargs cat', 'find . -name .env | ionice --class 3 xargs cat',
];
const wrapperValue1468SubBlocked = ['sudo -nu root -D .. find . -exec cat {} +', 'nsenter -t 1 find . -exec cat {} +', 'unshare -w .. find . -exec cat {} +'];
const wrapperValue1468SubAllowed = [
  'sudo -nu root find . -exec cat {} +', 'sudo -Eu root find . -exec cat {} +', 'stdbuf --output L find . -exec cat {} +', 'ionice --class 3 find . -exec cat {} +',
];
const producer1468Blocked = [
  'nice echo .env | xargs cat', 'env echo .env | xargs cat', 'command echo .env | xargs cat',
  "sudo -u root printf '%s\\n' .env | xargs cat", 'env -C .. echo .env | xargs cat',
];
const producer1468Allowed = ['nice echo ordinary | xargs cat', 'env -C .. echo ordinary | xargs cat'];
const xargsCluster1468Blocked = [
  'find . -name .env | xargs -rn1 cat', 'find . -name .env -print0 | xargs -0n1 cat', 'find . -name .env | xargs --max-args 1 cat',
  'echo .env | xargs -rn1 cat', 'echo .env | xargs -rn 1 cat', "xargs -rn1 cat <<'EOF'\n.env\nEOF",
  "xargs -on1 echo <<'EOF'\nordinary\nEOF", "xargs -pn1 echo <<'EOF'\nordinary\nEOF",
  'echo .env | xargs -rI{} cat {}', "printf '%s\\n' * | xargs -rn1 cat", "xargs -rn1 sh -c 'cat .env'",
];
const xargsCluster1468Allowed = [
  "xargs -rn1 echo <<'EOF'\nordinary\nEOF", "xargs -0n1 echo <<'EOF'\nordinary\nEOF",
  'echo ordinary | xargs -rn1 cat', "find . -name '*.js' | xargs -rn1 cat", "find . -name '*.js' | xargs --max-args 1 cat",
];
const rows1468 = [
  ['blocked', 'env split', FIXTURE_CWD, envSplit1468Blocked], ['allowed', 'env split', FIXTURE_CWD, envSplit1468Allowed],
  ['blocked', 'wrapper value cluster', FIXTURE_CWD, wrapperValue1468Blocked],
  ['blocked', 'wrapper value cluster from a subdirectory', SUB_CWD, wrapperValue1468SubBlocked],
  ['allowed', 'wrapper value cluster from a subdirectory', SUB_CWD, wrapperValue1468SubAllowed],
  ['blocked', 'wrapped text producer', FIXTURE_CWD, producer1468Blocked], ['allowed', 'wrapped text producer', FIXTURE_CWD, producer1468Allowed],
  ['blocked', 'xargs option cluster', FIXTURE_CWD, xargsCluster1468Blocked], ['allowed', 'xargs option cluster', FIXTURE_CWD, xargsCluster1468Allowed],
];
for (const hook of HOOKS) {
  for (const [kind, label, cwd, commands] of rows1468) {
    test(`${hook} ${kind === 'blocked' ? 'blocks' : 'allows'} ${label} (#1468)`, () => {
      for (const command of commands) {
        const result = decide(hook, command, cwd);
        assert.strictEqual(result.status, kind === 'blocked' ? 2 : 0, `${JSON.stringify(command)}: ${result.stderr}`);
        if (kind === 'blocked') assert.match(result.stderr, /\[bash-guard\] blocked:/, JSON.stringify(command));
      }
    });
  }
  test(`${hook} reports an ambiguous env split string for a dynamic source (#1468)`, () => {
    const result = decide(hook, 'env -S "$X"');
    assert.strictEqual(result.status, 2, result.stderr);
    assert.match(result.stderr, /ambiguous read target: env split string/);
  });
}

for (const hook of HOOKS) {
  test(`${hook} names the recursive scan in the W1 reason and the protected path in the X1 reason (#1462)`, () => {
    const w1 = decide(hook, 'busybox find . -exec cat {} +');
    assert.strictEqual(w1.status, 2, w1.stderr);
    assert.match(w1.stderr, /blocked: recursive read without credential exclusions: patterns '\.env'; paths /);
    assert.ok(!w1.stderr.includes('synthetic'), 'no file content in the reason');
    const x1 = decide(hook, 'echo .env | nice -n 5 xargs cat');
    assert.strictEqual(x1.status, 2, x1.stderr);
    assert.match(x1.stderr, /blocked: protected path; use controlled extraction/);
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
