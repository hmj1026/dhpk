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
  "bash --init-file <(printf 'cat .env\\n') -i </dev/null",
];

const allowed = [
  // 沒有讀取語意或不是 Protected Path 的字串
  "eval 'cat ordinary'",
  'eval "cat .env.example"',
  'eval : .env',
  "eval 'echo .env'",
  'eval "$cmd"',
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
  "python3 -c 'print(1)'",
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
