'use strict';

// (#1431) Git 會執行指令字串的入口：rebase --exec、submodule foreach、difftool --extcmd、
// SSH 指令（core.sshCommand、GIT_SSH_COMMAND）。字串裡可見的 Protected Path 讀取與直接寫出相同判定。
const { run, assert } = require('./_lib/tinytest');
const { batchTest: test } = require('./_lib/hookreplay');
const { mkRepo, rmRepo, runHook } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// 功能分支 fixture：分支閘門不會遮蔽 credential 判定；.env 內容為合成資料。
const REPO = mkRepo({ prefix: 'dhpk-credential-exec-', gitConfig: true });
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
  'git rebase --exec "cat .env" main',
  "git rebase -x 'cat .env' main",
  'git rebase --exec=cat\\ .env main',
  'git rebase -i -x "head -1 .env" main',
  'git rebase -x "cd sub && cat .env" main',
  'git submodule foreach "cat .env"',
  "git submodule foreach --recursive 'cat .env'",
  'git submodule foreach cat .env',
  'git difftool -x "cat .env" HEAD',
  'git difftool --extcmd "cat .env" HEAD',
  'git difftool --extcmd=cat\\ .env HEAD',
  "git -c difftool.x.cmd='cat .env' difftool -t x HEAD",
  'git -c core.sshCommand="cat .env" fetch',
  'GIT_SSH_COMMAND="cat .env" git fetch',
  'export GIT_SSH_COMMAND="cat .env"; git fetch',
  'env GIT_SSH_COMMAND="cat .env" git fetch',
  'git bisect run "cat .env"',
];
const allowed = [
  'git rebase --exec "cat ordinary" main',
  'git rebase -x "npm test" main',
  'git rebase -x "cat .env.example" main',
  'git rebase -x "echo .env" main',
  'git rebase -x "$TEST_COMMAND" main',
  "git submodule foreach 'git status'",
  'git submodule foreach "cat ordinary"',
  'git difftool -x "diff -u" HEAD',
  'git difftool --extcmd=vimdiff HEAD',
  "git -c difftool.x.cmd='diff $LOCAL $REMOTE' difftool -t x HEAD",
  'git -c core.sshCommand="ssh -i ~/.ssh/deploy_key -o BatchMode=yes" fetch',
  'GIT_SSH_COMMAND="ssh -i key" git fetch',
  'export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=yes"; git fetch',
  'git bisect run "cat ordinary"',
];

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  for (const command of blocked) {
    test(`${hook} blocks Protected Path read inside Git exec string: ${command}`, () => {
      const result = at(hook, command);
      assert.strictEqual(result.status, 2, result.stderr);
      assert.match(result.stderr, /\[bash-guard\] blocked:/);
    });
  }
  for (const command of allowed) {
    test(`${hook} allows legitimate Git exec string: ${command}`, () => {
      const result = at(hook, command);
      assert.strictEqual(result.status, 0, result.stderr);
    });
  }
}

// Git Gate 不負責 credential 判定；功能分支上 rebase --exec 不得被它擋下，保護分支上仍照常擋下。
test('git gate leaves a feature-branch rebase --exec alone and still blocks the protected branch', () => {
  const feature = at('pretool-git-gate.sh', 'git rebase --exec "cat ordinary" main');
  assert.strictEqual(feature.status, 0, feature.stderr);
  git('checkout', '-q', 'main');
  try {
    const protectedBranch = at('pretool-git-gate.sh', 'git rebase --exec "cat ordinary" feature/x');
    assert.strictEqual(protectedBranch.status, 2, protectedBranch.stderr);
    assert.strictEqual(at('pre-bash-dispatch.sh', 'git rebase --exec "cat .env" feature/x').status, 2);
  } finally {
    git('checkout', '-q', 'feature/x');
  }
});

run('credential-git-exec');
