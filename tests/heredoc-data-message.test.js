'use strict';

// #1434 (spec #1422, REQ-8): a heredoc message is data only when the consumer
// and its actual argument semantics prove it. Quoting a heredoc delimiter does
// not make text inert when a shell, eval or an option that runs a command
// consumes it, so every allow below has an executing counterpart that stays
// blocked. Fixtures are synthetic; no payload is ever executed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { runHook } = require('./_lib/hookharness');

const SHL = '<' + '<';
const ALLOW = 0;
const BLOCK = 2;
const BLOCK_MODE = { DHPK_BRANCH_SAFETY: 'block' };

// A feature-branch repo that holds a Protected Path, so neither the branch
// gate nor the credential guard can mask the verdict under test.
const REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-heredoc-data-')));
const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: REPO });
git('init', '-q');
git('commit', '-q', '--allow-empty', '-m', 'init');
git('branch', '-M', 'feature/x');
fs.writeFileSync(path.join(REPO, '.env'), 'synthetic');
fs.writeFileSync(path.join(REPO, 'ordinary'), 'synthetic');
process.on('exit', () => fs.rmSync(REPO, { recursive: true, force: true }));

const verdict = (hook, command) => runHook(hook, {
  cwd: REPO,
  payload: { tool_input: { command } },
  env: BLOCK_MODE,
  deleteEnv: ['DHPK_ALLOW_NO_VERIFY'],
});

const heredoc = (body, delimiter = "'EOF'") => `$(cat ${SHL}${delimiter}\n${body}\nEOF\n)`;
const stored = (body, consumer) => `body=${heredoc(body)}\n${consumer}`;

const READER_TEXT = 'cat .env\nand then more words';
const GUARD_LAYERS = ['pre-bash-guard.sh', 'pre-bash-dispatch.sh'];

// Credential layer: the guard and the dispatcher, from a variable-held message.
const dataConsumers = [
  'gh issue create --title t --body "$body"',
  'gh pr comment 1 -b "$body"',
  'git commit -m "$body"',
  'git commit --message="$body"',
  'git -C . commit -am "$body"',
  'git tag -a v1 -m "$body"',
  'glab issue create --description "$body"',
  'echo "$body"',
  "printf '%s\\n' \"$body\"",
];
const executingConsumers = [
  'bash -c "$body"',
  'sh -c "$body"',
  'eval "$body"',
  '$body',
  'echo "$body" | sh',
  'echo "$body" | xargs sh -c',
  'git commit -m $body',
  'git rebase --exec "$body" main',
  'git -c core.sshCommand="$body" fetch',
  'gh alias set x "$body"',
  'gh issue create --body "${body@P}"',
  'git commit -m "$body"; $body',
  'git commit -m "$body"\nbash <<< "$body"',
];

for (const hook of GUARD_LAYERS) {
  test(`${hook} allows a variable-held heredoc message read only by a data consumer (#1434)`, () => {
    for (const consumer of dataConsumers) {
      for (const body of [READER_TEXT, 'cat .env\n$(cat .env)\nsource .env', 'plain words only']) {
        const command = stored(body, consumer);
        const result = verdict(hook, command);
        assert.strictEqual(result.status, ALLOW, `${JSON.stringify(command)}: ${result.stderr}`);
      }
    }
  });

  test(`${hook} blocks a variable-held heredoc message that an executing consumer reads (#1434)`, () => {
    for (const consumer of executingConsumers) {
      const command = stored(READER_TEXT, consumer);
      const result = verdict(hook, command);
      assert.strictEqual(result.status, BLOCK, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });

  test(`${hook} judges an inline heredoc message by the option that consumes it (#1434)`, () => {
    for (const consumer of [
      `gh issue create --title t --body "${heredoc(READER_TEXT)}"`,
      `git commit -m "${heredoc(READER_TEXT)}"`,
      `git commit --message="${heredoc(READER_TEXT)}"`,
      `echo "${heredoc(READER_TEXT)}"`,
    ]) {
      const result = verdict(hook, consumer);
      assert.strictEqual(result.status, ALLOW, `${JSON.stringify(consumer)}: ${result.stderr}`);
    }
    for (const consumer of [
      `git rebase --exec "${heredoc(READER_TEXT)}" main`,
      `git -c core.sshCommand="${heredoc(READER_TEXT)}" fetch`,
      `gh alias set x "${heredoc(READER_TEXT)}"`,
      `git commit -m x --exec "${heredoc(READER_TEXT)}"`,
    ]) {
      const result = verdict(hook, consumer);
      assert.strictEqual(result.status, BLOCK, `${JSON.stringify(consumer)}: ${result.stderr}`);
    }
  });

  test(`${hook} keeps an unquoted heredoc message with a live substitution blocked (#1434)`, () => {
    const command = `gh issue create --title t --body "${heredoc('see $(cat .env)', 'EOF')}"`;
    assert.strictEqual(verdict(hook, command).status, BLOCK);
    const stash = stored('see $(cat .env)', 'gh issue create --body "$body"').replace("'EOF'", 'EOF');
    assert.strictEqual(verdict(hook, stash).status, BLOCK);
  });
}

// Git layer: a heredoc fed to gh or glab on standard input is data for a
// recognised subcommand, and a script for any other consumer.
const COMMAND_SHAPED = 'steps:\nsource .venv/bin/activate && git commit -m x\ngit push origin main --no-verify\ncat .env';
const GIT_LAYERS = ['pre-bash-guard.sh', 'pretool-git-gate.sh', 'pre-bash-dispatch.sh'];

for (const hook of GIT_LAYERS) {
  test(`${hook} allows an issue description heredoc that holds command-shaped source and git text (#1434)`, () => {
    for (const head of [
      'gh issue create --title t --body-file -',
      'gh issue comment 1 --body-file -',
      'gh pr create --title t --body-file -',
      'gh issue create --title t -F -',
      'glab issue create --title t --description -',
      'git commit -F -',
    ]) {
      for (const body of [COMMAND_SHAPED, 'plain words only']) {
        const command = `${head} ${SHL}'EOF'\n${body}\nEOF\n`;
        const result = verdict(hook, command);
        assert.strictEqual(result.status, ALLOW, `${JSON.stringify(command)}: ${result.stderr}`);
      }
    }
  });

  test(`${hook} still blocks the same text when a script consumer or live code follows (#1434)`, () => {
    for (const command of [
      `gh issue create --body-file - ${SHL}'EOF' | bash\n${COMMAND_SHAPED}\nEOF\n`,
      `bash ${SHL}'EOF'\n${COMMAND_SHAPED}\nEOF\n`,
      `gh unknown-extension --body-file - ${SHL}'EOF'\n${COMMAND_SHAPED}\nEOF\n`,
      `gh issue create --body-file - ${SHL}'EOF'\nplain\nEOF\nsource .venv/bin/activate && git commit -m x`,
    ]) {
      const result = verdict(hook, command);
      assert.strictEqual(result.status, BLOCK, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });
}

// Only the guard layers read --no-verify; a live substitution in an unquoted body is still scanned.
for (const hook of GUARD_LAYERS) {
  test(`${hook} still scans a live substitution inside an unquoted issue description heredoc (#1434)`, () => {
    const command = `gh issue create --body-file - ${SHL}EOF\n$(git commit -m x --no-verify)\nEOF\n`;
    assert.strictEqual(verdict(hook, command).status, BLOCK);
  });
}

run('heredoc-data-message');
