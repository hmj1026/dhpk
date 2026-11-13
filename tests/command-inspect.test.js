'use strict';

// Owner coverage for scripts/hooks/_lib/command-inspect.sh. The library is
// sourced and never executes the inspected command.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const LIB = path.join(__dirname, '..', 'scripts', 'hooks', '_lib', 'command-inspect.sh');

function inspect(command, cwd = '/session') {
  const res = spawnSync('bash', ['-c', `
    set -u
    # shellcheck disable=SC1090
    . "$DHPK_CI_LIB"
    dhpk_inspect_command "$DHPK_CI_CMD" "$DHPK_CI_CWD"
    i=0
    printf 'count=%s\\n' "$DHPK_GIT_COUNT"
    while [ "$i" -lt "$DHPK_GIT_COUNT" ]; do
      printf 'sub=%s\\nrepo=%s\\nstate=%s\\nno_verify=%s\\nexempt=%s\\n' \\
        "\${DHPK_GIT_SUB[$i]}" \\
        "\${DHPK_GIT_REPO[$i]}" \\
        "\${DHPK_GIT_REPO_STATE[$i]}" \\
        "\${DHPK_GIT_NO_VERIFY[$i]}" \\
        "\${DHPK_GIT_EXEMPT[$i]}"
      i=$((i + 1))
    done
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DHPK_CI_LIB: LIB,
      DHPK_CI_CMD: command,
      DHPK_CI_CWD: cwd,
    },
  });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  const fields = {};
  for (const line of res.stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    fields[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return fields;
}

test('a commit message of --dry-run is not an exemption', () => {
  const got = inspect('git commit -m "--dry-run"');
  assert.strictEqual(got.sub, 'commit');
  assert.strictEqual(got.exempt, '0', got.exempt);
  assert.strictEqual(got.no_verify, '0');
});

test('a commit message of --no-verify is not a bypass flag', () => {
  const got = inspect('git commit -m "--no-verify"');
  assert.strictEqual(got.sub, 'commit');
  assert.strictEqual(got.no_verify, '0');
  assert.strictEqual(got.exempt, '0');
});

test('joined message forms do not become flags', () => {
  const message = inspect('git commit --message=--dry-run');
  assert.strictEqual(message.exempt, '0');
  assert.strictEqual(message.no_verify, '0');
  const attached = inspect('git commit -m--no-verify');
  assert.strictEqual(attached.no_verify, '0');
  assert.strictEqual(attached.exempt, '0');
});

test('stacked -C resolves each relative path from the directory already chosen', () => {
  const got = inspect('git -C /repoA -C sub commit -m test');
  assert.strictEqual(got.sub, 'commit');
  assert.strictEqual(got.repo, '/repoA/sub');
  assert.strictEqual(got.state, 'literal');
  assert.strictEqual(got.exempt, '0');
});

test('a real --dry-run and a real --no-verify stay flags', () => {
  const dry = inspect('git commit --dry-run');
  assert.strictEqual(dry.exempt, '1');
  assert.strictEqual(dry.no_verify, '0');
  const bypass = inspect('git commit --no-verify');
  assert.strictEqual(bypass.no_verify, '1');
  assert.strictEqual(bypass.exempt, '0');
  const both = inspect('git commit -m "--dry-run" --no-verify');
  assert.strictEqual(both.exempt, '0');
  assert.strictEqual(both.no_verify, '1');
});

test('commit -n and a short cluster with n before a value letter are no-verify', () => {
  for (const command of ['git commit -n -m x', 'git commit -nm x', 'git commit -anm x']) {
    const got = inspect(command);
    assert.strictEqual(got.sub, 'commit', command);
    assert.strictEqual(got.no_verify, '1', `${command} no_verify=${got.no_verify}`);
  }
});

test('a message of -n or n, and -n on push or merge, is not no-verify', () => {
  const cases = [
    ['git commit -m -n', 'commit'],
    ['git commit -mn', 'commit'],
    ['git push -n origin x', 'push'],
    ['git merge -n feature', 'merge'],
  ];
  for (const [command, sub] of cases) {
    const got = inspect(command);
    assert.strictEqual(got.sub, sub, command);
    assert.strictEqual(got.no_verify, '0', `${command} no_verify=${got.no_verify}`);
  }
});

test('a dynamic -C stays unresolved and does not fall back to the session cwd', () => {
  const got = inspect('git -C "$UNRESOLVED_REPO" commit -m test');
  assert.strictEqual(got.state, 'unresolved');
  assert.strictEqual(got.repo, '');
  assert.strictEqual(got.exempt, '0');
});

// Decoded argv and redirect targets, one JSON line per array (#1389).
function decoded(command) {
  const res = spawnSync('bash', ['-c', `
    set -u
    # shellcheck disable=SC1090
    . "$DHPK_CI_LIB"
    dhpk_inspect_command "$DHPK_CI_CMD" /session
    c=0
    while [ "$c" -lt "\${#DHPK_CMD_START[@]}" ]; do
      k="\${DHPK_CMD_START[$c]}"
      end=$((k + DHPK_CMD_LEN[c]))
      printf 'cmd'
      while [ "$k" -lt "$end" ]; do printf '\\037%s' "\${DHPK_WORDS[$k]}"; k=$((k + 1)); done
      printf '\\036'
      c=$((c + 1))
    done
    for t in \${DHPK_REDIRECT_TARGETS[@]+"\${DHPK_REDIRECT_TARGETS[@]}"}; do printf 'redir\\037%s\\036' "$t"; done
    printf 'stripped\\037%s\\036' "$DHPK_STRIPPED"
  `], { encoding: 'utf8', env: { ...process.env, DHPK_CI_LIB: LIB, DHPK_CI_CMD: command } });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  const out = { cmds: [], redirects: [], stripped: '' };
  for (const rec of res.stdout.split('\x1e')) {
    if (!rec) continue;
    const [kind, ...rest] = rec.split('\x1f');
    if (kind === 'cmd') out.cmds.push(rest);
    else if (kind === 'redir') out.redirects.push(rest[0]);
    else out.stripped = rest[0];
  }
  return out;
}

test("$'...' ANSI-C quoting decodes escapes into the argv word", () => {
  assert.deepStrictEqual(decoded("$'git' $'\\x63om'$'\\155it' $'a\\tb' $'it\\'s' $'\\u0067'").cmds, [
    ['git', 'commit', 'a\tb', "it's", 'g'],
  ]);
});

test("$'...' keeps unknown escapes and non-ASCII \\u values in backslash form", () => {
  assert.deepStrictEqual(decoded("x $'\\q' $'\\x' $'\\u00e9'").cmds, [['x', '\\q', '\\x', '\\u00e9']]);
});

test("$'git' is recognised as a git invocation", () => {
  const got = inspect("$'git' commit --no-verify -m x");
  assert.strictEqual(got.sub, 'commit');
  assert.strictEqual(got.no_verify, '1');
});

test("$'...' ends at a decoded NUL, as bash does, and \\cX is a control character", () => {
  assert.deepStrictEqual(decoded("$'git\\x00q' $'a\\0b'c $'x\\c@\\'y' $'p\\cAq' $'o\\400k' $'z\\u0000w'").cmds, [
    ['git', 'ac', 'x', 'p\x01q', 'o', 'z'],
  ]);
});

// Oracles below were checked against bash 5.2: the $'...' end is found
// first (a backslash pairs with exactly one character), then the body is
// decoded, so no escape can swallow the closing quote.
test("$'\\c' before the closing quote stays literal and the string ends there", () => {
  const got = decoded("echo $'\\c' ; git commit --no-verify -m x #'");
  assert.deepStrictEqual(got.cmds, [['echo', '\\c'], ['git', 'commit', '--no-verify', '-m', 'x']]);
  assert.strictEqual(inspect("echo $'\\c' ; git commit --no-verify -m x #'").no_verify, '1');
});

test("$'\\c\\\\' is one unit (0x1c) and $'\\c\\'' keeps the quote inside the string", () => {
  assert.deepStrictEqual(decoded("$'a\\c\\\\b' $'a\\c\\xb' $'a\\c\\'b' next").cmds, [
    ['a\x1cb', 'a\x1cxb', "a\x1c'b", 'next'],
  ]);
});

// bash 5.2 oracle: `echo $$'\' ; echo SECOND` prints PID\ and SECOND, so
// $$ is the PID parameter and the following '...' is an ordinary string.
test("$$ before a quote is the PID parameter, not the start of $'...'", () => {
  const got = decoded("echo $$'\\' ; git commit --no-verify -m x #'");
  assert.deepStrictEqual(got.cmds, [['echo', '$$\\'], ['git', 'commit', '--no-verify', '-m', 'x']]);
});

test("$$$'...' is $$ followed by an ANSI-C string", () => {
  assert.deepStrictEqual(decoded("$$$'\\x67it' x").cmds, [['$$git', 'x']]);
  // bash 5.2: $$$$'\x67it' is PID PID then a plain '...' string.
  assert.deepStrictEqual(decoded("$$$$'\\x67it' x").cmds, [['$$$$\\x67it', 'x']]);
});

test("special parameters before a quote never start $'...'", () => {
  for (const param of ['$#', '$?', '$-', '$!', '$@', '$*', '$0', '$9', '${x}', '${#x}']) {
    const got = decoded(`echo ${param}'\\' ; git commit --no-verify -m x #'`);
    assert.deepStrictEqual(got.cmds, [['echo', `${param}\\`], ['git', 'commit', '--no-verify', '-m', 'x']], param);
  }
});

test('inside double quotes a backslash escapes only $ ` " \\ and joins a newline', () => {
  assert.deepStrictEqual(decoded('"gi\\\nt" "a\\b" "\\$x\\`\\"\\\\"').cmds, [['git', 'a\\b', '$x`"\\']]);
});

test('concatenated quoting decodes to one word', () => {
  assert.deepStrictEqual(decoded('r"m" -rf ".e"nv \'a b\'c $"d"').cmds, [['rm', '-rf', '.env', 'a bc', 'd']]);
});

test('redirect targets are decoded and kept out of argv', () => {
  const got = decoded('echo x > ".e"nv 2>$\'.env\' >>"dir with space/f" >|g &>h &>>i 1<>j >&2');
  assert.deepStrictEqual(got.cmds, [['echo', 'x']]);
  assert.deepStrictEqual(got.redirects, ['.env', '.env', 'dir with space/f', 'g', 'h', 'i', 'j', '2']);
});

test('a quoted > is data, not a redirect', () => {
  const got = decoded('echo "a > b" \'>\' c');
  assert.deepStrictEqual(got.cmds, [['echo', 'a > b', '>', 'c']]);
  assert.deepStrictEqual(got.redirects, []);
});

test('the stripped command text keeps the raw quoting', () => {
  const command = "echo $'a\\'b' > \".e\"nv &>> x";
  assert.strictEqual(decoded(command).stripped, command);
});

test('a redirect between git options still exposes a later --no-verify', () => {
  const got = inspect('git commit -m x &>/dev/null --no-verify');
  assert.strictEqual(got.sub, 'commit');
  assert.strictEqual(got.no_verify, '1');
});

run('command-inspect');
