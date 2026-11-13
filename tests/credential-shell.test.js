'use strict';

// In-process seam for the #1259 lexer: one `lex` call yields the word tokens,
// substitution bodies, and heredoc expansions the policy judges, all read by
// one quote/escape/comment state machine. Hook-boundary outcomes for the same
// inputs stay in credential-read-policy.test.js.
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT } = require('./_lib/hookharness');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const LIB = path.join(ROOT, 'scripts/hooks/_lib');

// Token flags: g = unquoted wildcard, d = active expansion, o = operator.
const lexed = [
  ["cat > out.txt <<'EOF'\n$(cat .env)\nEOF\n", 'cat >:o out.txt <<:o EOF ;:o', []],
  ['cat > out.txt <<EOF\n$(cat .env)\nEOF\n', 'cat >:o out.txt <<:o EOF ;:o', ['cat .env']],
  ["cat > out.txt <<EOF\n'$(cat .env)'\nEOF\n", 'cat >:o out.txt <<:o EOF ;:o', ['cat .env']],
  ['cat > out.txt <<EOF\n\\$(cat .env)\nEOF\n', 'cat >:o out.txt <<:o EOF ;:o', []],
  ['cat > out.txt <<EOF\n`cat .env`\nEOF\n', 'cat >:o out.txt <<:o EOF ;:o', ['cat .env']],
  // heredoc markers inside quotes or comments are not declarations
  ["printf '%s' '\n<<EOF\n'\ncat .env\n", null, []],
  ["true;# <<'EOF'\ncat .env\nEOF\n", 'true ;:o ;:o cat .env ;:o EOF ;:o', []],
  // a shell reading the heredoc keeps the body as commands
  ["'bash' <<'EOF'\ncat .env\nEOF\n", 'bash <<:o EOF ;:o cat .env ;:o EOF ;:o', []],
  ["echo \"$(cat .env | sed 's/(x)//')\"", null, ["cat .env | sed 's/(x)//'"]],
  ['echo "$(echo $(cat .env))"', null, ['echo $(cat .env)']],
  // comments and continuations must not poison the quote state
  ["#'\necho \"$(cat .env)\"", ';:o echo $(cat\\u0020.env):d', ['cat .env']],
  ['echo "$( \\\n# )\ncat .env)"', null, [' \\\n# )\ncat .env']],
  ['echo `# `\ncat .env`', null, ['# `\ncat .env']],
  ['echo \\ #$(cat .env)', 'echo \\u0020#$:d (:o cat .env ):o', ['cat .env']],
  ['cat .en\\\nv', 'cat .env', []],
  // the word view lexes substitution bodies inline
  ['echo $(cat .env)', 'echo $:d (:o cat .env ):o', ['cat .env']],
  ["git commit -m \"$(cat <<'EOF'\nmsg\nEOF\n)\"", null, ["cat <<'EOF'\nmsg\nEOF\n"]],
  // an unquoted substitution in assignment position keeps its heredoc body (#1407)
  ["x=$(cat <<'EOF'\nhi\nEOF\n)", null, ["cat <<'EOF'\nhi\nEOF\n"]],
  // a heredoc inside a double-quoted substitution belongs to its body; quotes there are data (#1396)
  ["git commit -m \"$(cat <<'EOF'\nfix: don't\nEOF\n)\"", 'git commit -m $(cat\\u0020<<\'EOF\'\n):d', ["cat <<'EOF'\nfix: don't\nEOF\n"]],
  ["git commit -m \"$(cat <<'EOF'\nsay \"hi\nEOF\n)\"", null, ["cat <<'EOF'\nsay \"hi\nEOF\n"]],
  ["git commit -m \"$(cat <<-'EOF'\n\tit's\n\tEOF\n)\"", null, ["cat <<-'EOF'\n\tit's\n\tEOF\n"]],
  ["echo \"$(cat <<EOF\nit's $(git rev-parse HEAD)\nEOF\n)\"", null, ["cat <<EOF\nit's $(git rev-parse HEAD)\nEOF\n"]],
  ["echo \"$(cat <<'EOF'\n)\nit's\nEOF\n)\"", null, ["cat <<'EOF'\n)\nit's\nEOF\n"]],
  ["echo \"$(cat <<'A' <<'B'\nit's\nA\nit's\nB\n)\"", null, ["cat <<'A' <<'B'\nit's\nA\nit's\nB\n"]],
  ["cat <<-'EOF'\n\tit's\n\tEOF\n", 'cat <<-:o EOF ;:o', []],
  // several heredocs on one line are read in order
  ["cat <<A <<'B'\nit's\nA\n$(x)\nB\n", 'cat <<:o A <<:o B ;:o', []],
  ['echo \'a b\' "c*" d* "\\x" $x', 'echo a\\u0020b c* d*:g \\x $x:d', []],
  ['a&&b||c|&d;;e>&f', 'a &&:o b ||:o c |&:o d ;;:o e >&:o f', []],
];

const failures = [
  ['echo "$(cat .env"', 'unfinished substitution'],
  ["echo 'x", 'unfinished quote'],
  ['echo x\\', 'unfinished escape'],
  ["cat <<'EOF'\ncat .env", 'unterminated heredoc'],
  ['bash <<A <<B\nA\nB\n', 'ambiguous heredoc'],
  // output that runs as a command keeps the pre-#1396 reading of the body
  ["eval \"$(cat <<'EOF'\ndon't\nEOF\n)\"", 'unfinished substitution'],
  ["echo \"$(cat <<'EOF'\ndon't\n)\"", 'unterminated heredoc'],
  ['echo "$(cat <<EOF\nx\nEOF)"', 'ambiguous heredoc delimiter'],
  ['cat <<EOF "$(echo\n)"\nx\nEOF\n', 'ambiguous heredoc substitution'],
  ["echo \"$(cat <<'EOF'\nok\nEOF\n)\" 'x", 'unfinished quote'],
  ["cat <<'EOF' |\ncat .env\nEOF\n", 'ambiguous heredoc pipeline'],
  ['cat <<EOF\n`echo "x"`\nEOF\n', 'ambiguous heredoc backtick'],
  ["cat <<'E\nF'\nx\nE\n", 'ambiguous heredoc declaration quote'],
  ['cat <<E\\\n\nE\n', 'ambiguous heredoc declaration continuation'],
  ['cat <<$X\nx\n$X\n', 'unsupported heredoc delimiter'],
  ['cat <<E\nx\\\nE\n', 'ambiguous heredoc continuation'],
  [`echo ${'$('.repeat(65)}${')'.repeat(65)}`, 'substitution depth'],
];

const PROBE = String.raw`
import json, sys
from credential_shell import lex

def flags(token):
    return ''.join(f for f, on in (('g', token.glob), ('d', token.dynamic), ('o', token.operator)) if on)

out = []
for command in json.load(sys.stdin):
    try:
        result = lex(command)
        out.append({'tokens': [[t.value, flags(t)] for t in result.tokens], 'bodies': result.bodies})
    except ValueError as error:
        out.append({'error': str(error)})
json.dump(out, sys.stdout)
`;

function lexAll(commands) {
  const result = spawnSync('python3', ['-B', '-c', PROBE], {
    input: JSON.stringify(commands), env: { ...process.env, PYTHONPATH: LIB }, encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// 'cat >:o' → [['cat', ''], ['>', 'o']]; ` ` keeps a space inside one word.
function parseTokens(spec) {
  return spec.split(' ').map((word) => {
    const at = word.lastIndexOf(':');
    const [value, flags] = at > 0 && /^[gdo]+$/.test(word.slice(at + 1)) ? [word.slice(0, at), word.slice(at + 1)] : [word, ''];
    return [value.replace(/\\u0020/g, ' '), flags];
  });
}

test('lex yields tokens, substitution bodies, and heredoc expansions from one pass', () => {
  const results = lexAll(lexed.map(([command]) => command));
  lexed.forEach(([command, tokens, bodies], index) => {
    const actual = results[index];
    assert.ok(!actual.error, `${JSON.stringify(command)}: ${actual.error}`);
    if (tokens !== null) assert.deepStrictEqual(actual.tokens, parseTokens(tokens), JSON.stringify(command));
    assert.deepStrictEqual(actual.bodies, bodies, JSON.stringify(command));
  });
});

test('malformed shell fails closed with a fixed reason that carries no command text', () => {
  const results = lexAll(failures.map(([command]) => command));
  failures.forEach(([command, reason], index) => {
    assert.deepStrictEqual(results[index], { error: reason }, JSON.stringify(command));
  });
});

test('the hook library keeps one shell quote state machine', () => {
  // Heuristic tripwire, not a proof: it catches the toggle shape the three
  // pre-#1259 scanners each repeated (`quote is None or quote == ch`). The
  // behavior tests above and the decision snapshot carry the real guarantee.
  const toggle = /\(\s*(?:not\s+)?\w*quot\w*(?:\s+is\s+None)?\s+or\s+\w*quot\w*\s*==\s*\w+\s*\)/g;
  const found = fs.readdirSync(LIB).filter((name) => name.endsWith('.py'))
    .flatMap((name) => (fs.readFileSync(path.join(LIB, name), 'utf8').match(toggle) || []).map(() => name));
  assert.deepStrictEqual(found, ['credential_shell.py']);
});

run('credential-shell');
