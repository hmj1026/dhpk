'use strict';

// (#1455) git 依設定或環境變數執行的命令：editor、fsmonitor、credential helper、gpg、askpass、external diff、
// filter、textconv、alias、ssh LocalCommand／KnownHostsCommand，以及 GIT_CONFIG_COUNT／--config-env／
// GIT_CONFIG_PARAMETERS 注入。字串裡可見的 Protected Path 讀取與直接寫出相同判定；外部腳本內容不讀取（ADR 0037）。
const { run, assert } = require('./_lib/tinytest');
const { batchTest: test } = require('./_lib/hookreplay');
const { mkRepo, rmRepo, runHook } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// 功能分支 fixture：分支閘門不會遮蔽 credential 判定；.env 內容為合成資料。
const REPO = mkRepo({ prefix: 'dhpk-credential-config-', gitConfig: true });
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
  // editor
  "GIT_EDITOR='cat .env' git commit --allow-empty",
  "VISUAL='cat .env' git commit --allow-empty",
  "EDITOR='cat .env' git commit --allow-empty",
  "GIT_SEQUENCE_EDITOR='cat .env' git rebase -i HEAD",
  "export GIT_EDITOR='cat .env'; git commit",
  "git -c core.editor='cat .env' config --edit",
  "git -c core.editor='cat .env' status",
  "git -c sequence.editor='cat .env' rebase -i HEAD",
  // hook-style config
  "git -c core.fsmonitor='cat .env >&2' status",
  "git -c credential.helper='!cat .env >&2' fetch",
  "git -c credential.https://example.com.helper='!cat .env' fetch",
  "git -c gpg.program='cat .env' log --show-signature",
  "git -c gpg.ssh.program='cat .env' commit -S",
  "GIT_ASKPASS='cat .env' git fetch",
  "SSH_ASKPASS='cat .env' git fetch",
  "git -c core.askPass='cat .env' fetch",
  "git -c core.hooksPath=.env commit",
  "git -c diff.external='cat .env' format-patch -1",
  "GIT_EXTERNAL_DIFF='cat .env' git format-patch -1",
  "git -c filter.x.clean='cat .env' add -A",
  "git -c filter.x.smudge='cat .env' checkout .",
  "git -c filter.x.process='cat .env' add -A",
  "git -c diff.x.textconv='cat .env' format-patch -1",
  "git -c alias.x='!cat .env' x",
  // ssh
  "ssh -o 'LocalCommand=cat .env' -o PermitLocalCommand=yes h",
  "ssh -o 'KnownHostsCommand=cat .env' h",
  "GIT_SSH_COMMAND='ssh -o \"LocalCommand=cat .env\" -o PermitLocalCommand=yes' git fetch",
  "GIT_SSH_COMMAND='ssh -o \"KnownHostsCommand=cat .env\"' git fetch",
  "git -c core.sshCommand='ssh -o \"KnownHostsCommand=cat .env\"' fetch",
  // injection
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.sshCommand GIT_CONFIG_VALUE_0='cat .env' git fetch h:x",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0='cat .env' git log",
  "GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x GIT_CONFIG_KEY_1=core.editor GIT_CONFIG_VALUE_1='cat .env' git commit",
  "GIT_CONFIG_PARAMETERS=\"'core.pager=cat .env'\" git log",
  "GIT_CONFIG_PARAMETERS=\"'core.editor'='cat .env'\" git commit",
  "V='cat .env' git --config-env=core.pager=V log",
  "V='cat .env' git --config-env core.editor=V commit",
  'git --config-env=core.sshCommand=UNSEEN fetch',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.sshCommand git fetch',
  "export GIT_CONFIG_VALUE_0='cat .env'; git fetch",
  // (#1455 r3) 多變數 export／declare
  "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0='cat .env >&2'; git status",
  "export GIT_CONFIG_PARAMETERS=\"'core.fsmonitor'='cat .env >&2'\"; git status",
  "export A=1 GIT_EDITOR='cat .env' B=2; git commit",
  "declare -x A=1 GIT_EDITOR='cat .env'; git commit",
  "declare -x A=1 B=2 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0='cat .env'; git log",
  "readonly A=1 GIT_PAGER='cat .env'; git log",
  // 前綴賦值經 shell 繼承
  "GIT_EDITOR='cat .env' bash -c 'git commit --allow-empty'",
  "GIT_PAGER='cat .env' sh -c 'git log'",
  "env GIT_EDITOR='cat .env' bash -c 'git commit --allow-empty'",
  "command env GIT_PAGER='cat .env' sh -c 'git log'",
  // 任何 -c 的值與注入的值
  "git -c some.future.key='cat .env' status",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=some.future.key GIT_CONFIG_VALUE_0='cat .env' git status",
  "GIT_CONFIG_PARAMETERS=\"'some.future.key=cat .env'\" git status",
  "V='cat .env' git --config-env=some.future.key=V status",
  // 遠端程式選項與 ext::
  "git fetch --upload-pack='cat .env' origin",
  'git fetch --upload-pack "cat .env" origin',
  "git pull --upload-pack='cat .env' origin",
  "git ls-remote --upload-pack='cat .env' origin",
  "git clone -u 'cat .env' h:x dest",
  "git clone --upload-pack='cat .env' h:x dest",
  "git push --receive-pack='cat .env' origin main",
  "git push --exec='cat .env' origin main",
  "git archive --exec='cat .env' --remote=h:x HEAD",
  "git clone 'ext::cat% .env' dest",
  "git fetch 'ext::sh -c \"cat% .env\"'",
  "git -c remote.o.url='ext::cat% .env' fetch o",
  // env -S
  "env -S 'cat .env'",
  "env --split-string='cat .env'",
  "env -S \"GIT_PAGER='cat .env' git log\"",
  "env -i -S 'cat .env'",
  // alias 解析
  "git -c alias.l=log -c core.pager='cat .env' l",
  "git -c core.pager='cat .env' unknownalias",
];
const allowed = [
  'GIT_EDITOR=vim git tag -a v1',
  "git -c core.editor='code --wait' tag -a v1",
  "EDITOR='vim -u NONE' git tag -a v1",
  'git -c credential.helper=store fetch',
  "git -c credential.helper='cache --timeout=3600' fetch",
  'git -c gpg.program=gpg2 tag -s v1',
  'git -c core.hooksPath=.githooks tag v1',
  'GIT_EXTERNAL_DIFF=./tool git format-patch -1',
  "git -c filter.lfs.clean='git-lfs clean -- %f' add -A",
  'git -c diff.x.textconv=iconv format-patch -1',
  "git -c core.editor='cat ordinary' status",
  "ssh -o 'LocalCommand=echo up' -o PermitLocalCommand=yes h",
  "ssh -o KnownHostsCommand='/usr/local/bin/lookup %H' h",
  "GIT_SSH_COMMAND='ssh -i ~/.ssh/id_x' git fetch",
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x git tag v1',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.editor GIT_CONFIG_VALUE_0=vim git tag -a v1',
  "GIT_CONFIG_PARAMETERS=\"'user.name=x'\" git tag v1",
  'V=less git --config-env=core.pager=V log',
  'git --config-env=user.name=NAME_VAR tag v1',
  'export A=1 B=2; git status',
  'declare -x A=1 B=2; git status',
  'GIT_EDITOR=vim bash -c "git commit"',
  "GIT_PAGER=less sh -c 'git log'",
  'git -c user.name=x tag v1',
  'git -c http.sslVerify=false -c user.email=a@b.c tag v1',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.email GIT_CONFIG_VALUE_0=a@b.c git tag v1',
  'git fetch --upload-pack=git-upload-pack origin',
  'git clone -u /usr/bin/git-upload-pack h:x dest',
  'git push --receive-pack=git-receive-pack origin main',
  'git clone https://example.com/r.git dest',
  "git clone 'ext::ssh -o BatchMode=yes h git-upload-pack /r' dest",
  "env -S 'ls -l'",
  'env -i PATH=/usr/bin ls',
];

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  for (const command of blocked) {
    test(`${hook} blocks Protected Path read behind git config command: ${command}`, () => {
      const result = at(hook, command);
      assert.strictEqual(result.status, 2, result.stderr);
      assert.match(result.stderr, /\[bash-guard\] blocked:/);
    });
  }
  for (const command of allowed) {
    test(`${hook} allows legitimate git config command: ${command}`, () => {
      const result = at(hook, command);
      assert.strictEqual(result.status, 0, result.stderr);
    });
  }
}

// Git Gate 不負責 credential 判定：功能分支上它放行這些命令，dispatcher 仍因 credential 擋下。
test('git gate leaves a feature-branch config command alone while the dispatcher blocks it', () => {
  const command = "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.editor GIT_CONFIG_VALUE_0='cat .env' git tag -a v1";
  assert.strictEqual(at('pretool-git-gate.sh', command).status, 0);
  assert.strictEqual(at('pre-bash-dispatch.sh', command).status, 2);
});

run('credential-git-config-commands');
