'use strict';

// (#1450) Credential Guard 與 eval 等價的程式碼字串：eval、送進 shell 的 here-string、bash/sh -c、
// trap 動作、alias 改綁、算術 consumer 與啟動檔 process substitution。字串裡可見的 Protected Path 讀取
// 與直接寫出相同判定；python/node 等 interpreter 程式碼字串仍在範圍外（ADR 0037）。
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, runHook } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HS = '<' + '<<'; // here-string operator, built so this file stays plain data

// main 與功能分支兩種 fixture：分支閘門不得遮蔽 credential 判定，兩者結果必須相同。.env 內容為合成資料。
function fixture(branch) {
  const repo = mkRepo({ prefix: 'dhpk-credential-code-', gitConfig: true });
  const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('branch', '-M', 'main');
  if (branch !== 'main') git('checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(repo, '.env'), 'synthetic');
  fs.writeFileSync(path.join(repo, 'ordinary'), 'synthetic');
  process.on('exit', () => rmRepo(repo));
  return repo;
}
const REPOS = { main: fixture('main'), feature: fixture('feature/x') };

const at = (hook, command, cwd) =>
  runHook(hook, { cwd, env: { DHPK_BRANCH_SAFETY: 'block' }, payload: { tool_input: { command } } });

const blocked = [
  // eval 的引號字串（C06 X01 X02）
  "eval 'cat .env'",
  'eval "cat .env"',
  'eval cat .env',
  'f=.env; eval "cat $f"',
  "f=.env; eval 'cat $f'",
  // 送進 shell 的 here-string（X06 B04）與 bash -c / sh -c（X04 X05）
  `bash ${HS} 'cat .env'`,
  `sh ${HS} 'cat .env'`,
  `BASH_ENV=/dev/stdin bash -c : ${HS} 'cat .env'`,
  "bash -c 'cat .env'",
  "sh -c 'cat .env'",
  "bash -lc 'cat .env'",
  "bash -e -c 'cat .env' arg0",
  "env bash -c 'cat .env'",
  "sudo -u nobody sh -c 'cat .env'",
  "f=.env; bash -c 'cat $f'",
  'bash -c "bash -c \\"cat .env\\""',
  // source 與 dot 在字串裡也走 #1430 的執行入口判定
  'bash -c ". .env"',
  'eval "source .env"',
  // trap 動作（T03 T05 T08）
  "trap 'cat .env' DEBUG; :",
  "trap 'cat .env' EXIT",
  "x='cat .env'; trap \"$x\" EXIT",
  "f=.env; trap 'cat $f' EXIT",
  // alias 改綁（L02 L04 L05）
  "shopt -s expand_aliases\nalias echo=eval\necho 'cat .env'",
  "shopt -s expand_aliases\nalias show=cat\nshow .env",
  "shopt -s expand_aliases\nalias printf=cat\nprintf .env",
  "alias show=cat; alias view=show; view .env",
  // 算術 consumer（A02 A04 A06 A08 A09 A10 A16 A17）
  "x='a[$(cat .env)]'; (( x ))",
  "x='a[$(cat .env)]'; [[ x -eq 0 ]]",
  "x='a[$(cat .env)]'; let y=x",
  "let 'y=a[$(cat .env)]'",
  "x='a[$(cat .env)]'; echo $(( x ))",
  "x='a[$(cat .env)]'; declare -i y; y=x",
  "x='a[$(cat .env)]'; [[ $x -eq 0 ]]",
  "x='a[$(cat .env)]'; b=(1); echo \"${b[x]}\"",
  "x='a[`cat .env`]'; (( x ))",
  "y='x'; x='a[$(cat .env)]'; (( y ))",
  // 巢狀 bash -c 內的算術（N03 N04）
  'bash -c "let \'y=a[\\$(cat .env)]\'"',
  'bash -c "x=\'a[\\$(cat .env)]\'; (( x ))"',
  // 啟動檔 process substitution（B02 R02）
  "BASH_ENV=<(echo 'cat .env') bash -c :",
  "bash --rcfile <(echo 'cat .env') -i </dev/null",
  "bash --init-file <(printf 'cat .env\\n') -i </dev/null",  // (#1456) positional parameters, su, watch and a dynamic command word
  "bash -c 'cat \"$1\"' _ .env", "bash -c 'cat .e$1' _ nv", "su -c 'cat .env'", "su root -c 'cat .env'", "su - root --command='cat .env'",
  "su -lc 'cat .env'", "watch 'cat .env'", 'watch -n 2 cat .env', "$SHELL -c 'cat .env'",
  // (#1456 review) $0, glob arguments and loop-variable arguments reach the string unresolved
  "bash -c 'cat \"$0\"' .env", "sh -c 'cat \"${0}\"' .env", "bash -c 'cat \"$1\"' _ .e*",
  "for f in .env; do bash -c 'cat \"$1\"' _ \"$f\"; done",
  // (#1460) su with a glued -c value and other executors that run a command string
  "su -c'cat .env'", 'su -ccat\\ .env', "su -lc'cat .env'", "runuser root -c 'cat .env'", "runuser -l root -c 'cat .env'",
  "sg root -c 'cat .env'", "sg root 'cat .env'", "flock /tmp/l -c 'cat .env'", "flock -n /tmp/l sh -c 'cat .env'",
  "script -qc 'cat .env' /dev/null", "script --command='cat .env' /dev/null", "busybox sh -c 'cat .env'",
  "chroot / sh -c 'cat .env'", "chroot --userspec=nobody / sh -c 'cat .env'",
  // (#1460) shell strings run by find and xargs
  "find . -maxdepth 0 -exec sh -c 'cat .env' \\;", "find . -exec bash -c 'cat .env' _ {} \\;",
  "find . -name '*.js' -execdir sh -c 'cat .env' \\;", "find . -maxdepth 0 -exec sh -c 'cat \"$1\"' _ .env \\;",
  "echo x | xargs sh -c 'cat .env'", "echo x | xargs -0 -n1 bash -c 'cat .env' _", "echo x | xargs env sh -c 'cat .env'",
  "echo x | xargs -a list sh -c 'cat .env'",
  // (#1460 review) flock command option anywhere, script -t[file], repeated -c, long-option abbreviations, chroot values, xargs fallback
  "flock -c 'cat .env' /tmp/l", "flock -x -c 'cat .env' /tmp/l", "flock -nc 'cat .env' /tmp/l", "flock --command='cat .env' /tmp/l",
  "flock /tmp/l -x -c 'cat .env'", "flock /tmp/l -nc 'cat .env'", "script -t/x/c -c 'cat .env' /dev/null",
  "su -c ls -c 'cat .env'", "runuser root -c ls -c 'cat .env'", "script -c ls -c 'cat .env' /dev/null",
  "su --comm='cat .env'", "su --comm 'cat .env'", "script --comm='cat .env' /dev/null",
  "chroot --userspec root / sh -c 'cat .env'", "chroot --groups a,b / sh -c 'cat .env'",
  "echo x | xargs -a /dev/null su -c 'cat .env'", "echo x | xargs --arg-file=/dev/null flock /tmp/l -c 'cat .env'",
  "echo x | xargs -l runuser root -c 'cat .env'",
];

const allowed = [
  // 沒有讀取語意或不是 Protected Path 的字串
  "eval 'cat ordinary'",
  'eval "cat .env.example"',
  'eval : .env',
  "eval 'echo .env'",
  'eval "echo ok"',
  `bash ${HS} 'echo hello'`,
  "bash -c 'cat ordinary'",
  "bash -c 'git status'",
  "bash -c 'ls -l'",
  'bash -c ". ordinary"',
  'eval "source ordinary"',
  'bash -c "$cmd"',
  'bash ./script.sh',
  "echo bash -c 'cat .env'",
  "trap 'echo git commit' EXIT",
  "trap 'rm -f ./tmp.lock' EXIT",
  'trap - DEBUG',
  "trap '' INT",
  "alias ll='ls -l'",
  "alias show=cat; show ordinary",
  "alias cat='cat -n'; cat ordinary",
  // 算術與資料
  'i=0; (( i++ )); let j=i+2; [[ i -eq 1 ]]',
  '(( x ))',
  "echo 'a[$(cat .env)]'",
  "x='a[$(cat .env)]'; echo \"$x\"",
  "x='a[$(cat .env)]'; [[ \"$x\" == y ]]",
  // 啟動檔不讀內容，process substitution 只是無害設定
  'BASH_ENV=./hook.sh bash -c :',
  'bash --rcfile ./hook.sh -i -c : </dev/null',
  "bash --rcfile <(echo 'alias ll=ls') -i </dev/null",
  // interpreter 程式碼字串仍在範圍外（ADR 0037）
  "python3 -c 'print(1)'",  // (#1456) positional parameters are data; su and watch run harmless commands
  "bash -c 'echo \"$1\"' _ .env", "su - -c 'git status'", 'watch -n1 git status', "su -s /bin/sh -c 'ls'", 'su root',
  // (#1456 review) $0 is data to echo; a literal ordinary $1 or $0 is data to cat
  "bash -c 'echo \"$0\"' .env", "bash -c 'cat \"$1\"' _ ordinary", "bash -c 'cat \"$0\"' ordinary",
  // (#1460) harmless commands through the same executors
  "su -c'git status'", 'su -sc /bin/sh', "runuser root -c 'ls'", "sg root -c 'ls'", "flock /tmp/l -c 'ls'",
  "script -qc 'ls' /dev/null", "busybox sh -c 'ls'", "chroot / sh -c 'ls'",
  "find . -name '*.js' -exec cat {} \\;", "find . -name '*.js' -exec sh -c 'cat \"$1\"' _ {} \\;",
  "find . -maxdepth 0 -exec sh -c 'ls' \\;", "echo x | xargs sh -c 'echo \"$1\"' _",
  "echo ordinary | xargs sh -c 'cat \"$1\"' _",
  // (#1460 review)
  "flock -n /tmp/l ls", "chroot --userspec root / sh -c 'ls'", "su -c ls -c 'ls -l'", "script -t/x/c -c 'ls' /dev/null",
];

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  for (const [label, repo] of Object.entries(REPOS)) {
    for (const command of blocked) {
      test(`${hook} on ${label} blocks Protected Path read in code string: ${JSON.stringify(command)}`, () => {
        const result = at(hook, command, repo);
        assert.strictEqual(result.status, 2, result.stderr);
        assert.match(result.stderr, /\[bash-guard\] blocked:/);
      });
    }
    for (const command of allowed) {
      test(`${hook} on ${label} allows legitimate code string: ${JSON.stringify(command)}`, () => {
        const result = at(hook, command, repo);
        assert.strictEqual(result.status, 0, result.stderr);
      });
    }
  }
}

// 阻擋理由是 Protected Path 判定本身；不得洩露檔案內容。
test('block reason names the policy and never echoes file content', () => {
  const result = at('pre-bash-guard.sh', "eval 'cat .env'", REPOS.feature);
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /protected path/i);
  assert.doesNotMatch(result.stderr, /synthetic/);
});

run('credential-code-strings');
