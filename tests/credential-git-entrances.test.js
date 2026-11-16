'use strict';

// (#1454) #1431 之外仍會執行指令字串的 Git 入口：ssh ProxyCommand（含 GIT_SSH_COMMAND、core.sshCommand 內）、
// GIT_SSH、core.pager／GIT_PAGER／PAGER、mergetool／difftool 的 cmd 設定。字串裡可見的 Protected Path 讀取
// 與直接寫出相同判定；外部腳本內容不讀取（ADR 0037）。
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, runHook } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// 功能分支 fixture：分支閘門不會遮蔽 credential 判定；.env 內容為合成資料。
const REPO = mkRepo({ prefix: 'dhpk-credential-entrances-', gitConfig: true });
const git = (...args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
git('commit', '-q', '--allow-empty', '-m', 'init');
git('branch', '-M', 'main');
git('checkout', '-q', '-b', 'feature/x');
fs.writeFileSync(path.join(REPO, '.env'), 'synthetic');
fs.writeFileSync(path.join(REPO, 'ordinary'), 'synthetic');
process.on('exit', () => rmRepo(REPO));

const at = (hook, command, cwd = REPO) =>
  runHook(hook, { cwd, env: { DHPK_BRANCH_SAFETY: 'block' }, payload: { tool_input: { command } } });

const blocked = [
  // ssh ProxyCommand
  "ssh -o ProxyCommand='cat .env' host",
  "ssh -o 'ProxyCommand cat .env' host",
  "ssh -oProxyCommand='cat .env' host",
  "ssh -o proxycommand='head -1 .env' host true",
  "GIT_SSH_COMMAND=\"ssh -o ProxyCommand='cat .env'\" git fetch",
  "git -c core.sshCommand=\"ssh -o ProxyCommand='cat .env'\" fetch",
  "export GIT_SSH_COMMAND=\"ssh -o ProxyCommand='cat .env'\"; git fetch",
  // GIT_SSH
  'GIT_SSH="cat .env" git fetch',
  'GIT_SSH=.env git fetch',
  'export GIT_SSH="cat .env"; git fetch',
  'env GIT_SSH="cat .env" git fetch',
  // pager
  "git -c core.pager='cat .env' log",
  "git -c core.pager='cat .env' diff",
  "git -ccore.pager='cat .env' show",
  "GIT_PAGER='cat .env' git log",
  "PAGER='cat .env' git diff",
  "export GIT_PAGER='cat .env'; git log",
  "export PAGER='cat .env'",
  // mergetool / difftool cmd
  "git -c mergetool.x.cmd='cat .env' mergetool -t x",
  "git -c difftool.x.cmd='cat .env' difftool -t x HEAD",
  // (#1454 round 2) ssh 短選項叢集與 -F／-J
  "ssh -vo 'ProxyCommand=cat .env' h",
  "ssh -4vo 'ProxyCommand=cat .env' h",
  "ssh -4oProxyCommand='cat .env' h",
  "ssh -v -o 'ProxyCommand=cat .env' h",
  "GIT_SSH_COMMAND='ssh -vo \"ProxyCommand=cat .env\"' git fetch",
  'ssh -F .env h',
  'ssh -vF .env h',
  'ssh -J .env h',
  // pager.<cmd>、-p、擴充的分頁子命令、declare -x
  "git -c pager.log='cat .env' log",
  "git -c pager.status='cat .env' status",
  "git -p -c core.pager='cat .env' status",
  "git --paginate -c core.pager='cat .env' status",
  "GIT_PAGER='cat .env' git -p status",
  "GIT_PAGER='cat .env' git range-diff a b c",
  "declare -x GIT_PAGER='cat .env'; git log",
  "typeset -x PAGER='cat .env'; git log",
];
const allowed = [
  "ssh -o ProxyCommand='ssh -W %h:%p bastion' host",
  "ssh -oProxyCommand='ssh -W %h:%p bastion' host",
  "ssh -o 'ProxyCommand nc %h %p' host",
  "ssh -o ProxyCommand='cat ordinary' host",
  "GIT_SSH_COMMAND='ssh -i ~/.ssh/id_x' git fetch",
  "GIT_SSH_COMMAND=\"ssh -o ProxyCommand='ssh -W %h:%p bastion'\" git fetch",
  "git -c core.sshCommand=\"ssh -o ProxyCommand='ssh -W %h:%p bastion'\" fetch",
  'GIT_SSH=./wrapper.sh git fetch',
  'GIT_SSH=/usr/bin/ssh git fetch',
  'GIT_SSH="ssh -i key" git fetch',
  'git -c core.pager=less log',
  "GIT_PAGER='less -R' git log",
  'PAGER=less git log -n 1',
  "export PAGER=less; git log",
  // pager 變數不會被不分頁的子指令執行
  "git -c core.pager='cat .env' status",
  "PAGER='cat .env' git status",
  "git -c mergetool.vim.cmd='vim -d $LOCAL $REMOTE' mergetool",
  "git -c difftool.vim.cmd='vim -d $LOCAL $REMOTE' difftool",
  "git -c mergetool.x.cmd='cat ordinary' mergetool -t x",
  "ssh -vo 'ProxyCommand=ssh -W %h:%p bastion' h",
  "ssh -4vo ProxyCommand='ssh -W %h:%p bastion' h",
  "GIT_SSH_COMMAND='ssh -vo \"ProxyCommand=ssh -W %h:%p bastion\"' git fetch",
  'ssh -F ~/.ssh/config h',
  'ssh -vF cfg -J jump h',
  "git -c pager.log=less log",
  "git --no-pager -c core.pager='cat .env' log",
  "git -P -c core.pager='cat .env' log",
  "declare -x GIT_PAGER=less; git log",
];

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  for (const command of blocked) {
    test(`${hook} blocks Protected Path read inside Git entrance: ${command}`, () => {
      const result = at(hook, command);
      assert.strictEqual(result.status, 2, result.stderr);
      assert.match(result.stderr, /\[bash-guard\] blocked:/);
    });
  }
  for (const command of allowed) {
    test(`${hook} allows legitimate Git entrance: ${command}`, () => {
      const result = at(hook, command);
      assert.strictEqual(result.status, 0, result.stderr);
    });
  }
}

// Git Gate 不負責 credential 判定：功能分支上它放行這些命令，dispatcher 仍因 credential 擋下。
test('git gate leaves a feature-branch entrance alone while the dispatcher blocks it', () => {
  const command = "git -c core.pager='cat .env' log";
  assert.strictEqual(at('pretool-git-gate.sh', command).status, 0);
  assert.strictEqual(at('pre-bash-dispatch.sh', command).status, 2);
});

run('credential-git-entrances');
