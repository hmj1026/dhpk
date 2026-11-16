'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { runHook: runHookAt, ROOT } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

// A recursive read of the checkout passes once a bounded scan finishes and finds
// no Protected Path, so outcomes must not depend on the checkout's size or the
// machine's speed. By default the hook runs in a fixed directory that holds one.
const FIXTURE_CWD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-credential-cwd-')));
fs.writeFileSync(path.join(FIXTURE_CWD, '.env'), 'synthetic');
fs.writeFileSync(path.join(FIXTURE_CWD, 'ordinary'), 'synthetic');
// Matches only the custom policy in the scoped-exclusion test, never a default pattern.
fs.mkdirSync(path.join(FIXTURE_CWD, 'config'));
fs.writeFileSync(path.join(FIXTURE_CWD, 'config', 'private.key'), 'synthetic');
process.on('exit', () => fs.rmSync(FIXTURE_CWD, { recursive: true, force: true }));
const runHook = (hook, options = {}) => runHookAt(hook, { cwd: FIXTURE_CWD, ...options });

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} blocks reading .env`, () => {
    const result = runHook(hook, { payload: { tool_input: { command: 'cat .env' } } });
    assert.strictEqual(result.status, 2, result.stderr);
  });
}

const blocked = [
  'cat .env.production', 'less my.cnf', 'head debian.cnf', 'tail private.pem',
  'awk "{print}" id_rsa.pub', 'grep password credentials.json', 'rg password .env',
  'sed -n p "some dir/.env"', 'cat .env.example .env', 'cat ./x/../.env',
  'cat ordinary; cat .env', 'cat ordinary && cat .env', 'cat ordinary || cat .env',
  'cat ordinary | cat .env', 'cat ordinary\ncat .env', 'cat < .env',
  'cat 3<.env', 'grep -f .env ordinary', 'grep -nf .env ordinary', 'grep --exclude-from=.env needle .', 'rg --ignore-file .env needle .', 'sed -f.env ordinary',
  'grep -rn needle .', 'rg needle .', 'rg needle --glob "!*.pem" .',
  'ssh -p 22 example "cat .env"', 'ssh example cat .env',
  'cat *.pem', 'cat .env.example; cat credentials.json',
  'python3 credential-extract.py --file .env --fields host',
  'head -5 .env', 'tail -20 my.cnf', "sed -i 's/a/b/' .env",
  // rg -E 是 --encoding（帶值）；若當成 grep 的 -E，pattern 會被誤認成檔案而跳過遞迴檢查。
  'rg -E utf8 package.json', 'rg -E . ordinary', 'rg -E utf8 -e x ordinary', 'grep -E "a|b" .env', 'grep -F needle credentials.json',
  // (#1453) 沒有可見來源的 parameter expansion 夾在字面中；去掉後可組成 Protected Path 就不能放行。
  'cat .e${x}nv', "cat .e$x'nv'", 'cat ${x}.env', 'cat .env${x}', 'base64 .e${x}nv', 'cat .e${x}n${y}v', 'cat "${x}.env"',
  // positional and special parameters, other input entrances, and values set in unseen ways
  'cat .e$1nv', 'cat .e${1}nv', 'cat .e$@nv', 'cat .e$!nv', "bash -c 'cat .e$1nv' _", 'f(){ cat .e${1}nv; }; f',
  'python3 x.py < .e${x}nv', 'source .e${x}nv', '. .e${x}nv', 'BASH_ENV=.e${x}nv bash -c true',
  'y=nv; x=y; cat .e${!x}', 'read x <<< nv; cat .e$x', 'printf -v x nv; cat .e$x',
];
const allowed = [
  "echo 'cat .env'", "echo '$(cat .env)'", 'echo literal#hash', "echo '# literal'", 'ls .env', 'stat .env', 'cat ordinary', 'cat .env.example', 'cat .env.sample',
  'cat .env.dist', 'cat .env.template', 'grep needle ordinary',
  'grep --reg=x ordinary', 'sed --expr=p ordinary', 'grep -nex ordinary',
  'grep -r --exclude="*" needle .', 'rg --glob "!*" needle .',
  // 數字簡寫與常見 grep 旗標不是讀取保護檔，舊版因語法表缺項而誤擋。
  'git tag | head -15', 'git log --oneline | tail -5', 'head -40 ordinary',
  'grep -E "a|b" ordinary', 'grep -F needle ordinary', 'grep -P "x+" ordinary', 'grep -h needle ordinary',
  "sed -i 's/\\r//' script.sh",
  // (#1453) 沒有受保護字面的 expansion、template 例外與 quoted 單獨變數仍可讀。
  'cat ordinary${x}', 'cat "$f"', 'cat $f', 'cat ${x}ordinary', 'cat .e${x}',
  'cat ordinary$1', 'echo $? $$ $1', 'read line; cat "$line"', 'python3 x.py < ordinary${x}', 'source ordinary${x}',
];
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} names a parameter expansion without a visible source and a rewrite direction (#1453)`, () => {
    const result = runHook(hook, { payload: { tool_input: { command: 'cat .e${x}nv' } } });
    assert.strictEqual(result.status, 2, result.stderr);
    assert.match(result.stderr, /ambiguous read target: target '\.e\$\{x\}nv' with a parameter expansion that has no visible source/);
    assert.match(result.stderr, /write the file name as one literal word/);
    assert.ok(!result.stderr.includes('synthetic'), 'no file content in the message');
  });
  test(`${hook} still reads a visible value that is not protected (#1453)`, () => {
    for (const command of ['x=; cat .e${x}nv', 'x=v; cat .e${x}nv']) {
      const result = runHook(hook, { payload: { tool_input: { command } } });
      assert.strictEqual(result.status, command.startsWith('x=;') ? 2 : 0, `${command}: ${result.stderr}`);
    }
  });
  test(`${hook} treats quoted heredoc content as data`, () => {
    const command = "cat > out.txt <<'EOF'\n$(cat .env)\nEOF\n";
    const result = runHook(hook, {payload: {tool_input: {command}}});
    assert.strictEqual(result.status, 0, result.stderr);
  });
  for (const command of [
      "printf '%s' '\n<<EOF\n'\ncat .env\nprintf '\nEOF\n'\n",
      "printf '%s\\n' '\n<<EOF; '\ncat .env\nEOF\n",
      "'bash' <<'EOF'\ncat .env\nEOF\n",
      "ba''sh <<'EOF'\ncat .env\nEOF\n",
      "true;# <<'EOF'\ncat .env\nEOF\n",
      "bash \\\n<<'EOF'\ncat .env\nEOF\n",
      "b\\ash <<'EOF'\ncat .env\nEOF\n",
      "cat <<'EOF' |\ncat .env\nEOF\nbash\n",
      "true # comment\u2028<<'EOF'\ncat .env\nEOF\n",
      "true # comment\r<<'EOF'\ncat .env\nEOF\n",
    ]) {
    test(`${hook} blocks multiline or quoted interpreter bypass: ${JSON.stringify(command)}`, () => {
      const result = runHook(hook, {payload: {tool_input: {command}}});
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
    });
  }
  test(`${hook} handles fixed strings and heredoc boundaries`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-heredoc-'));
    try {
      fs.writeFileSync(path.join(dir, 'ordinary.js'), 'ordinary');
      fs.writeFileSync(path.join(dir, '.env'), 'synthetic');
      const check = (command, status, reason) => {
        const result = runHook(hook, {cwd: dir, payload: {tool_input: {command}}});
        assert.strictEqual(result.status, status, `${command}: ${result.stderr}`);
        if (reason) assert.match(result.stderr, reason);
      };
      for (const option of ['-F', '--fixed-strings']) check(`rg ${option} needle ordinary.js`, 0);
      check('rg -n -F needle .', 2, /recursive read/);
      for (const delimiter of ["'EOF'", '"EOF"', "E'O'F", "''EOF", 'E\\OF']) {
        check(`cat > out.txt <<${delimiter}\nrg -l needle dir\n$(cat .env)\nEOF\n`, 0);
      }
      check('cat > out.txt <<EOF\n$(cat .env)\nEOF\n', 2, /protected path/);
      check('cat > out.txt <<EOF\n`cat .env`\nEOF\n', 2, /protected path/);
      check("cat > out.txt <<EOF\n'$(cat .env)'\nEOF\n", 2, /protected path/);
      check('cat > out.txt <<EOF\n# $(cat .env)\nEOF\n', 2, /protected path/);
      check('cat > out.txt <<EOF\n\\\\$(cat .env)\nEOF\n', 2, /protected path/);
      check('cat > out.txt <<EOF\n$(printf "%s" "$(cat .env)")\nEOF\n', 2, /protected path/);
      check('cat > out.txt <<EOF\n\\$(cat .env)\nEOF\n', 0);
      check('cat > out.txt <<EOF\nrg needle dir\nEOF\n', 0);
      check("cat > out.txt <<'EOF'\ndata\nEOF\ncat .env", 2, /protected path/);
      check("cat > out.txt <<'EOF'; cat .env\ndata\nEOF", 2, /protected path/);
      check("cat .env; cat > out.txt <<'EOF'\ndata\nEOF", 2, /protected path/);
      check("cat > .env <<'EOF'\ndata\nEOF", 2);
      check("cat > out.txt <<'EOF'\ncat .env", 2);
      check("cat > out.txt <<'EOF'\n$(cat .env)\nEOF\r\n", 2);
      check("cat > out.txt <<'EOF'\ndata\u2028$(cat .env)\nEOF\n", 0);
      check("bash <<'EOF'\ncat .env\nEOF", 2);
      check("cat <<'EOF' | bash\ncat .env\nEOF", 2);
      check("source /dev/stdin <<'EOF'\ncat .env\nEOF", 2);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });
  test(`${hook} offers reader-specific recovery without assuming tools`, () => {
    for (const [command, example] of [['rg needle .', /--glob/], ['grep -r needle .', /--exclude/], ['rg -Z needle .', /--glob/]]) {
      const result = runHook(hook, {payload: {tool_input: {command}}, env: {CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: '["secret.conf"]'}});
      assert.strictEqual(result.status, 2, result.stderr);
      assert.match(result.stderr, example);
      assert.match(result.stderr, /custom|consumer/i);
      assert.doesNotMatch(result.stderr, /git grep|python/i);
      assert.doesNotMatch(result.stderr, /Grep\/Read|if available/i);
    }
  });
  test(`${hook} points wildcard targets to literal paths or a git grep directory search (#1260)`, () => {
    for (const command of ['grep -n x scripts/lib/*.js', 'grep -n x .github/workflows/*.yml', 'git grep -n x -- scripts/lib/a*.js']) {
      const result = runHook(hook, {payload: {tool_input: {command}}});
      assert.strictEqual(result.status, 2, result.stderr);
      assert.match(result.stderr, /ambiguous read target/);
      assert.match(result.stderr, /git grep -n PATTERN -- <directory>/);
      assert.doesNotMatch(result.stderr, /Grep\/Read|if available/i);
    }
  });
}
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} protects target-scoped reads`, () => {
    for (const command of blocked) {
      const result = runHook(hook, { payload: { tool_input: { command } } });
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
    }
  });
  test(`${hook} allows safe controls`, () => {
    for (const command of allowed) {
      const result = runHook(hook, { payload: { tool_input: { command } } });
      assert.strictEqual(result.status, 0, `${command}: ${result.stderr}`);
    }
  });
  test(`${hook} names the block reason`, () => {
    const syntax = runHook(hook, { payload: { tool_input: { command: 'grep -Z needle ordinary' } } });
    assert.strictEqual(syntax.status, 2, syntax.stderr);
    assert.match(syntax.stderr, /unsupported reader syntax/);
    const recursive = runHook(hook, { payload: { tool_input: { command: 'grep -rn needle .' } } });
    assert.match(recursive.stderr, /recursive read/);
    const direct = runHook(hook, { payload: { tool_input: { command: 'cat .env' } } });
    assert.match(direct.stderr, /protected path/);
  });
  test(`${hook} reports ambiguous targets and inspection failures by name`, () => {
    for (const command of ['cat *.pem', 'cat < *.txt', 'grep -f "$X" needle ordinary', 'ssh example cat "$FILE"']) {
      const result = runHook(hook, { payload: { tool_input: { command } } });
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
      assert.match(result.stderr, /^\[bash-guard\] blocked: ambiguous read target: /, command);
      assert.doesNotMatch(result.stderr, /protected path|unsupported reader syntax/, command);
      assert.match(result.stderr, /explicit literal path/, command);
    }
    for (const [payload, env] of [['not json', {}], [{ tool_input: { command: 'cat ordinary' } }, { CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: 'invalid' }]]) {
      const result = runHook(hook, { payload, env });
      assert.strictEqual(result.status, 2, result.stderr);
      assert.match(result.stderr, /^\[bash-guard\] blocked: credential inspection failure: (payload|policy); /);
    }
    const rg = runHook(hook, { payload: { tool_input: { command: 'rg needle .' } } });
    assert.match(rg.stderr, /--glob/);
    assert.doesNotMatch(rg.stderr, /--exclude/);
    const grep = runHook(hook, { payload: { tool_input: { command: 'grep -r needle .' } } });
    assert.match(grep.stderr, /--exclude/);
    assert.doesNotMatch(grep.stderr, /--glob/);
  });
  test(`${hook} enforces additive custom policy and malformed inputs`, () => {
    for (const command of ['cat secret.conf', 'cat a/config/private.key', 'cat .env.example']) {
      const result = runHook(hook, { payload: { tool_input: { command } }, env: {
        CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: JSON.stringify(['secret.conf', 'config/private.key', '.env.example']),
      } });
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
    }
    for (const payload of ['not json', JSON.stringify({tool_input: {command: 4}})]) {
      assert.strictEqual(runHook(hook, { payload }).status, 2);
    }
    assert.strictEqual(runHook(hook, { payload: {tool_input: {command: ''}}, env: {CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: 'invalid'} }).status, 2);
  });
}

// #1290: the hooks run as subprocesses with the production 300 ms budget, which a
// loaded runner can exhaust. Test mode (and only test mode) may raise it.
const TEST_BUDGET_ENV = { DHPK_TEST_MODE: '1', DHPK_CREDENTIAL_TEST_MAX_SECONDS: '5' };

// A `git` that stalls past the production budget before running the real one.
function slowGitPath(delaySeconds) {
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-slow-git-')));
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nsleep ${delaySeconds}\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  process.on('exit', () => fs.rmSync(bin, { recursive: true, force: true }));
  return `${bin}${path.delimiter}${process.env.PATH}`;
}

function assertGitReadsJudged(hookEnv, label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-git-reader-')));
  const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' };
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, stdio: 'pipe' });
  try {
    git('init', '-q');
    fs.writeFileSync(path.join(dir, '.env'), 'synthetic');
    fs.writeFileSync(path.join(dir, 'ordinary.js'), 'synthetic');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
      const invoke = (command) => runHook(hook, { cwd: dir, env: hookEnv, timeout: 60000, payload: { tool_input: { command } } });
      for (const [command, reason] of [
        ['git grep -n x', /recursive read without credential exclusions: patterns '\.env'/],
        ['git grep -n x -- \'*\'', /ambiguous read target/],
        ['git grep -n x -- \'*.env\'', /ambiguous read target/],
        ['git show HEAD:.env', /protected path/],
        ['git cat-file -p HEAD:.env', /protected path/],
        ['git log -p -- .env', /protected path/],
        ['git diff HEAD -- .env', /protected path/],
        ['git show HEAD', /recursive read without credential exclusions/],
      ]) {
        const result = invoke(command);
        assert.strictEqual(result.status, 2, `${label}${hook} ${command}: ${result.stderr}`);
        assert.match(result.stderr, reason, `${label}${hook} ${command}`);
        assert.doesNotMatch(result.stderr, /--glob|--exclude/, `${hook} ${command}`);
      }
      for (const command of ['git status', 'git diff --stat', 'git log --oneline', 'git grep -n x -- ordinary.js', 'git show HEAD:ordinary.js']) {
        const result = invoke(command);
        assert.strictEqual(result.status, 0, `${label}${hook} ${command}: ${result.stderr}`);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('git reads are judged through both hook entrypoints (#1262)', () => {
  assertGitReadsJudged(TEST_BUDGET_ENV, '');
});

// Only the listing case the issue reproduces: every hook git call sleeps, so the
// full matrix would cost minutes and push this file toward its per-file timeout.
test('git reads stay judged when git is slower than the production budget (#1290)', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-slow-git-reader-')));
  const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' };
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, stdio: 'pipe' });
  try {
    git('init', '-q');
    fs.writeFileSync(path.join(dir, '.env'), 'synthetic');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    const hookEnv = { ...TEST_BUDGET_ENV, PATH: slowGitPath(0.35) };
    for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
      const result = runHook(hook, { cwd: dir, env: hookEnv, timeout: 60000, payload: { tool_input: { command: 'git grep -n x' } } });
      assert.strictEqual(result.status, 2, `slow git: ${hook}: ${result.stderr}`);
      assert.match(result.stderr, /recursive read without credential exclusions: patterns '\.env'/, `slow git: ${hook}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('all supported readers reject every default credential family', () => {
  const readers = ['cat', 'less', 'head', 'tail', 'sed -n p', 'awk "{print}"', 'grep needle', 'rg needle'];
  for (const reader of readers) {
    for (const target of ['.env', '.env.production', 'my.cnf', 'debian.cnf', 'private.pem', 'id_rsa.pub', 'credentials.json']) {
      const command = `${reader} ${target}`;
      assert.strictEqual(runHook('pre-bash-guard.sh', { payload: {tool_input: {command}} }).status, 2, command);
    }
  }
});

test('only the exact pinned extractor invocation is permitted', () => {
  const python = fs.realpathSync(execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {encoding: 'utf8'}).trim());
  const helper = path.join(ROOT, 'scripts/hooks/credential-extract.py');
  const exact = `${python} -I -S ${helper} --file /tmp/.env --fields host,dbname`;
  for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
    assert.strictEqual(runHook(hook, {payload: {tool_input: {command: exact}}}).status, 0);
    for (const command of [
      exact.replace(helper, `"${helper.replace('credential-extract.py', '\\credential-extract.py')}"`),
      `echo \"$(${exact})\"`, `${exact}; cat .env`, `${exact} | cat`, `VAR=x ${exact}`, `${exact} > output`,
      `${exact} --extra`, exact.replace('host,dbname', 'host,password'),
      `ssh example '${exact}'`,
    ]) {
      assert.strictEqual(runHook(hook, {payload: {tool_input: {command}}}).status, 2, command);
    }
  }
});

const regressions = {
  'clustered sed expression': 'sed -nep .env',
  'clustered grep expression': 'grep -nex .env',
  'command substitution': 'echo "$(cat .env)"',
  'backtick substitution': 'echo `cat .env`',
  'escaped newline in path': 'cat .en\\\nv',
  'escaped newline before path': 'cat \\\n.env',
  'grep recursive include': 'grep -r --exclude="*" --include=".env" needle .',
  'grep directories recurse': 'grep -d recurse needle .',
  'rg glob reinclusion': 'rg --glob "!*" -g.env needle .',
  'rg case insensitive reinclusion': 'rg --glob "!*" --iglob .env needle .',
  'abbreviated file option': 'grep --fi=.env needle ordinary',
  'unknown option file target': 'grep --mystery=.env needle ordinary',
  'grep abbreviated expression': 'grep --reg=x .env',
  'sed abbreviated expression': 'sed --expr=p .env',
  'grep abbreviated directories': 'grep --dir=recurse needle .',
  'grep abbreviated recursion': 'grep --recurs needle .',
  'grep clustered directories': 'grep -nd recurse needle .',
  'grep abbreviated inclusion': 'grep -r --exclude="*" --incl=.env needle .',
  'nested parentheses': 'echo "$( (cat .env) )"',
  'quoted parentheses in substitution': `echo "$(cat .env | sed 's/(x)//')"`,
  'awk source': `awk --source='{print}' .env`,
  'ssh abbreviated expression': 'ssh example "grep --reg=x .env"',
  'ambiguous long option': 'grep --ex=.env needle ordinary',
  'malformed active substitution': 'echo "$(cat .env"',
  'nested command substitution': 'echo "$(echo $(cat .env))"',
  'outer comment quote poisoning': `#'\necho "$(cat .env)"`,
  'continuation before outer comment': `\\\n#'\necho "$(cat .env)"`,
  'continuation before inner comment': `echo "$( \\\n# )\ncat .env)"`,
  'inner comment parenthesis poisoning': `echo "$( # )\ncat .env)"`,
  'inner backtick comment poisoning': 'echo `# `\ncat .env`',
  'escaped space preserves word boundary': 'echo \\ #$(cat .env)',
  'inner escaped space preserves word boundary': 'echo "$(echo \\ #$(cat .env))"',


};
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  for (const [description, command] of Object.entries(regressions)) {
    test(`${hook} blocks ${description}`, () => {
      assert.strictEqual(runHook(hook, {payload: {tool_input: {command}}}).status, 2);
    });
  }
  test(`${hook} rejects scoped exclusion as global basename proof`, () => {
    const command = 'grep -r --exclude=.env --exclude=.env.* --exclude=my.cnf --exclude=debian.cnf --exclude=*.pem --exclude=id_rsa* --exclude=credentials* --exclude=config/private.key needle .';
    assert.strictEqual(runHook(hook, {payload: {tool_input: {command}}, env: {CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: '["config/private.key"]'}}).status, 2);
  });
  test(`${hook} rejects config error before empty-command shortcut`, () => {
    assert.strictEqual(runHook(hook, {payload: {tool_input: {command: ''}}, env: {DHPK_CREDENTIAL_CONFIG_ERROR: '1'}}).status, 2);
  });
}

test('missing runtime or analyzer fails closed through both hook entrypoints', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-credential-runtime-'));
  try {
    const hooks = path.join(temp, 'scripts/hooks');
    fs.cpSync(path.join(ROOT, 'scripts/hooks'), hooks, {recursive: true});
    const bin = path.join(temp, 'bin');
    fs.mkdirSync(bin);
    for (const name of ['bash', 'dirname', 'cat']) {
      const executable = execFileSync('which', [name], {encoding: 'utf8'}).trim();
      fs.symlinkSync(executable, path.join(bin, name));
    }
    for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
      const options = {payload: {tool_input: {command: ''}}, pluginRoot: temp, projectDir: temp};
      const hookPath = path.join(hooks, hook);
      const missingPython = runHook(hookPath, {...options, env: {PATH: bin}});
      assert.strictEqual(missingPython.status, 2, `${hook}: ${missingPython.stderr}`);
      const analyzer = path.join(hooks, '_lib/credential-read.py');
      fs.renameSync(analyzer, `${analyzer}.off`);
      try {
        const missingAnalyzer = runHook(hookPath, options);
        assert.strictEqual(missingAnalyzer.status, 2, `${hook}: ${missingAnalyzer.stderr}`);
      } finally { fs.renameSync(`${analyzer}.off`, analyzer); }
      for (const moduleName of ['credential_options.py', 'credential_scan.py']) {
      const modulePath = path.join(hooks, '_lib', moduleName);
      fs.renameSync(modulePath, `${modulePath}.off`);
      try {
        const missingModule = runHook(hookPath, options);
        assert.strictEqual(missingModule.status, 2, `${hook}: ${missingModule.stderr}`);
        assert.doesNotMatch(missingModule.stderr, /Traceback|ModuleNotFoundError/);
      } finally { fs.renameSync(`${modulePath}.off`, modulePath); }
      }
    }
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});

test('extractor identity rejects altered and symlinked helper in both entrypoints', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-credential-identity-'));
  try {
    const hooks = path.join(temp, 'scripts/hooks');
    fs.cpSync(path.join(ROOT, 'scripts/hooks'), hooks, {recursive: true});
    const helper = path.join(hooks, 'credential-extract.py');
    const original = fs.readFileSync(helper);
    const python = fs.realpathSync(execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {encoding: 'utf8'}).trim());
    const command = `${python} -I -S ${helper} --file /tmp/.env --fields host`;
    for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
      const options = {payload: {tool_input: {command}}, pluginRoot: temp, projectDir: temp};
      const hookPath = path.join(hooks, hook);
      assert.strictEqual(runHook(hookPath, options).status, 0);
      fs.appendFileSync(helper, '\n# modified\n');
      assert.strictEqual(runHook(hookPath, options).status, 2);
      fs.unlinkSync(helper);
      fs.symlinkSync(path.join(ROOT, 'scripts/hooks/credential-extract.py'), helper);
      assert.strictEqual(runHook(hookPath, options).status, 2);
      fs.unlinkSync(helper);
      fs.writeFileSync(helper, original);
    }
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} normalizes repeated leading separators in both policy and operands`, () => {
    for (const [pattern, command] of [
      ['/srv/private.key', 'cat //srv/private.key'],
      ['/srv/private.key', 'ssh example "cat //srv/private.key"'],
      ['//srv/private.key', 'cat /srv/private.key'],
      ['//srv/private.key', 'ssh example "cat /srv/private.key"'],
    ]) {
      const result = runHook(hook, {payload: {tool_input: {command}}, env: {
        CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: JSON.stringify([pattern]),
      }});
      assert.strictEqual(result.status, 2, `${pattern}: ${command}: ${result.stderr}`);
    }
  });
}

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} resolves dot-dot after symlinks for recursive roots and auxiliary files`, () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-symlink-dotdot-'));
    const dir = path.join(parent, 'clean');
    const outside = path.join(parent, 'outside');
    fs.mkdirSync(dir);
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(outside, 'child'));
    fs.mkdirSync(path.join(outside, 'secrets'));
    fs.mkdirSync(path.join(outside, 'safe-dir'));
    fs.mkdirSync(path.join(dir, 'secrets'));
    fs.mkdirSync(path.join(dir, 'safe-dir'));
    fs.writeFileSync(path.join(outside, 'secrets', '.env'), 'synthetic');
    fs.writeFileSync(path.join(outside, '.env'), 'synthetic');
    fs.writeFileSync(path.join(dir, 'alias'), 'synthetic');
    fs.writeFileSync(path.join(dir, 'safe'), 'synthetic');
    fs.writeFileSync(path.join(outside, 'safe'), 'synthetic');
    fs.writeFileSync(path.join(dir, 'ordinary.js'), 'synthetic');
    fs.symlinkSync(path.join(outside, 'child'), path.join(dir, 'link'));
    fs.symlinkSync(path.join(outside, '.env'), path.join(outside, 'alias'));
    const invoke = (command) => runHook(hook, {cwd: dir, payload: {tool_input: {command}}});
    try {
      const failures = [];
      for (const [command, status] of [
        ['rg foo link/../secrets', 2],
        ['rg --ignore-file link/../alias foo ordinary.js', 2],
        ['rg foo link/../safe-dir', 0],
        ['rg --ignore-file link/../safe foo ordinary.js', 0],
      ]) {
        const result = invoke(command);
        if (result.status !== status) failures.push(`${command}: ${result.status}, expected ${status}: ${result.stderr}`);
      }
      assert.deepStrictEqual(failures, []);
    } finally { fs.rmSync(parent, {recursive: true, force: true}); }
  });
  test(`${hook} validates nested cwd and auxiliary file aliases`, () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-proof-boundary-'));
    const dir = path.join(parent, 'clean');
    const other = path.join(parent, 'other');
    fs.mkdirSync(dir);
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, '.env'), 'synthetic');
    fs.writeFileSync(path.join(dir, 'ordinary.js'), 'synthetic');
    const invoke = (command) => runHook(hook, {cwd: dir, payload: {tool_input: {command}}});
    try {
      const failures = [];
      for (const command of ["c''d ../other; echo \"$(rg foo .)\"", 'c\\d ../other; echo "$(rg foo .)"',
        'command cd ../other; echo "$(rg foo .)"', 'pushd ../other; echo "$(rg foo .)"',
        'source ordinary.js; echo "$(rg foo .)"', '$CMD ../other; echo "$(rg foo .)"']) {
        const result = invoke(command);
        if (result.status !== 2) failures.push(command);
      }
      fs.symlinkSync(path.join(other, '.env'), path.join(dir, 'alias'));
      for (const command of ['rg --ignore-file alias foo ordinary.js', 'grep --exclude-from alias foo ordinary.js',
        'grep -f alias ordinary.js', 'rg --ignore-file "$VAR" foo ordinary.js',
        "rg --glob '!*' --ignore-file alias foo .", 'grep -f missing ordinary.js']) {
        const result = invoke(command);
        if (result.status !== 2) failures.push(command);
      }
      fs.unlinkSync(path.join(dir, 'alias'));
      assert.strictEqual(invoke('grep -f ordinary.js ordinary.js').status, 0);
      assert.strictEqual(invoke('rg --ignore-file ordinary.js foo .').status, 0);
      fs.symlinkSync('loop', path.join(dir, 'loop'));
      assert.strictEqual(invoke('grep -f loop ordinary.js').status, 2);
      fs.unlinkSync(path.join(dir, 'loop'));
      const result = invoke("cat <<'EOF'\ncd elsewhere\nEOF\nrg foo .");
      if (result.status !== 0) failures.push('inert heredoc cd');
      assert.deepStrictEqual(failures, []);
    } finally { fs.rmSync(parent, {recursive: true, force: true}); }
  });
  test(`${hook} proves absence across local recursive roots`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-absence-'));
    const invoke = (command, env = {}) => runHook(hook, { cwd: dir, payload: { tool_input: { command } }, env });
    try {
      fs.writeFileSync(path.join(dir, '.env.example'), 'synthetic');
      fs.writeFileSync(path.join(dir, 'ordinary.js'), 'synthetic');
      for (const command of ['rg -l foo .', 'rg --no-ignore-parent foo .', 'grep -rn --include=*.js foo .']) {
        const result = invoke(command);
        assert.strictEqual(result.status, 0, result.stderr);
      }
      const customTemplate = invoke('rg foo .', {CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: '[".env.example"]'});
      assert.strictEqual(customTemplate.status, 2, customTemplate.stderr);
      for (const command of ['cd . && rg foo .', 'echo $(cd .; rg foo .)', 'rg -L foo .', 'rg foo "$ROOT"', 'env rg foo .', 'ssh example "rg foo ."']) {
        const result = invoke(command);
        assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
      }
      for (const command of ['rg --pre tool foo ordinary.js', 'rg --files-from list foo ordinary.js', 'rg -L foo ordinary.js', "rg -L --glob '!*' foo ."]) {
        const result = invoke(command);
        assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
      }
      fs.writeFileSync(path.join(dir, '.env'), 'synthetic');
      let result = invoke('rg foo .');
      assert.strictEqual(result.status, 2, result.stderr);
      assert.match(result.stderr, /\.env/);
      result = invoke("rg --glob '!.env' foo .");
      assert.strictEqual(result.status, 0, result.stderr);
      for (const command of ['ssh example "rg foo ."', 'env rg foo .', 'rg --pre x foo .', 'rg --files-from x foo .']) {
        result = invoke(command);
        assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test(`${hook} reports up to three paths and scans clean symlink roots`, () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-proof-diagnostics-'));
    const dir = path.join(parent, 'root');
    const target = path.join(parent, 'clean-target');
    fs.mkdirSync(dir);
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(dir, 'root-link'));
    const invoke = (command) => runHook(hook, {cwd: dir, payload: {tool_input: {command}}});
    try {
      assert.strictEqual(invoke('rg foo root-link').status, 0);
      for (const name of ['.env', '.env.prod', 'my.cnf', 'test.pem']) fs.writeFileSync(path.join(dir, name), 'synthetic');
      const result = invoke('rg foo .');
      assert.strictEqual(result.status, 2, result.stderr);
      const detail = result.stderr.split('paths ')[1].split(';')[0];
      assert.strictEqual((detail.match(/dhpk-proof-diagnostics-/g) || []).length, 3, result.stderr);
      assert.match(result.stderr, /patterns .*\.env/);
      assert.match(result.stderr, /patterns .*my\.cnf/);
      assert.match(result.stderr, /patterns .*\*\.pem/);
    } finally { fs.rmSync(parent, {recursive: true, force: true}); }
  });
  test(`${hook} fails closed on unsafe roots and directory links`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-absence-links-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-absence-target-'));
    const invoke = (command, env = {}) => runHook(hook, { cwd: dir, payload: { tool_input: { command } }, env });
    try {
      for (const command of ['rg foo missing', 'cd . && rg foo .', 'ssh example "rg foo ."', 'env rg foo .']) {
        assert.strictEqual(invoke(command).status, 2, command);
      }
      fs.mkdirSync(path.join(outside, 'sub'));
      fs.writeFileSync(path.join(outside, '.env'), 'synthetic');
      fs.symlinkSync(outside, path.join(dir, 'root-link'));
      assert.strictEqual(invoke('rg foo root-link').status, 2);
      fs.unlinkSync(path.join(dir, 'root-link'));
      fs.mkdirSync(path.join(dir, 'unreadable'), 0o000);
      assert.strictEqual(invoke('rg foo .').status, 2);
      assert.strictEqual(invoke('rg foo unreadable').status, 2);
      fs.chmodSync(path.join(dir, 'unreadable'), 0o700);
      fs.rmdirSync(path.join(dir, 'unreadable'));
      fs.symlinkSync(path.join(outside, '.env'), path.join(dir, 'alias'));
      let result = invoke("rg --glob '!.env' foo .");
      assert.strictEqual(result.status, 2, result.stderr);
      fs.unlinkSync(path.join(dir, 'alias'));
      fs.symlinkSync(path.join(outside, 'sub'), path.join(dir, 'link'));
      assert.strictEqual(invoke('grep -r foo .').status, 0);
      assert.strictEqual(invoke('grep -R foo .').status, 2);
      fs.writeFileSync(path.join(dir, 'custom.secret'), 'synthetic');
      result = invoke('rg foo .', {CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: '["custom.secret"]'});
      assert.strictEqual(result.status, 2, result.stderr);
      assert.match(result.stderr, /custom\.secret/);
      fs.unlinkSync(path.join(dir, 'custom.secret'));
      fs.mkdirSync(path.join(dir, 'one'));
      fs.mkdirSync(path.join(dir, 'two'));
      fs.writeFileSync(path.join(dir, 'two', '.env'), 'synthetic');
      assert.strictEqual(invoke('rg foo one two').status, 2);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); fs.rmSync(outside, {recursive: true, force: true}); }
  });
}

// #1396: a quote inside a heredoc body that sits in `$(...)` is data. The
// reader once lexed it as code, so an apostrophe opened a quote that never
// closed and a legitimate commit message was blocked as unsupported syntax.
const heredocMessages = [
  "git commit -m \"$(cat <<'EOF'\nfix: don't drop the marker\nEOF\n)\"",
  "git commit -m \"$(cat <<'EOF'\nfix: don't drop it\n\nit's the marker's job\nEOF\n)\"",
  "git commit -m \"$(cat <<'EOF'\nfix: the \" char isn't special\nEOF\n)\"",
  "git commit -m \"$(cat <<-'EOF'\n\tfix: don't drop the marker\n\tEOF\n)\"",
  "git commit -m \"$(cat <<EOF\nfix: don't drop $(git rev-parse HEAD)\nEOF\n)\"",
  "git commit -m \"$(cat <<'A' <<'B'\nit's a\nA\nit's b\nB\n)\"",
  "git commit -m \"$(echo ${x:-a}; cat <<'EOF'\nit's closed\nEOF\n)\"",
];
const heredocAttacks = [
  ["git commit -m 'it", /unfinished quote/],
  ["git commit -m \"$(cat <<'EOF'\nok\nEOF\n\"", /unfinished substitution/],
  ["git commit -m \"$(cat <<'EOF'\ndon't\nEOF\ncat .env\n)\"", /protected path/],
  ["git commit -m \"$(cat <<EOF\ndon't $(cat .env)\nEOF\n)\"", /protected path/],
  ["echo \"$(cat <<EOF\nx\nEOF)\"; cat .env\nEOF\n", /ambiguous heredoc delimiter/],
  // output that runs as a command keeps the pre-#1396 reading of the body
  ["eval \"$(cat <<'EOF'\ncat .env; don't\nEOF\n)\"", /unfinished substitution/],
  ["$(cat <<'EOF'\ncat .env\nEOF\n)", null],
  ["env $(cat <<'EOF'\ncat .env\nEOF\n)", null],
  ["bash <<'A' <<'B'\nx\nA\ncat .env\nB\n", null],
  // `<<` inside arithmetic, `${...}` or `$[...]` is not a heredoc; the next lines run
  ['y=$( (( z = 1 << x ))\ncat .env\nx\n)', /protected path/],
  ['z=$(echo ${x:-<< y }\ncat .env\ny\n)', /protected path/],
  ['(( z = 1 << x ))\ncat .env\nx\n', /protected path/],
  ['echo ${x:-<< y }\ncat .env\ny\n', /protected path/],
  ['echo $[1 << x ]\ncat .env\nx\n', /protected path/],
  // an unquoted substitution splits its output into operands or code, so its body is not data
  ['cat $(cat <<EOF\n.env\nEOF\n)', null],
  ["tcsh -c $(cat <<'EOF'\ncat .env\nEOF\n)", null],
  ["python3 -c \"$(cat <<'EOF'\nopen('.env'); it's\nEOF\n)\"", null],
];
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} allows a heredoc commit message whose body holds quotes (#1396)`, () => {
    for (const command of heredocMessages) {
      const result = runHook(hook, { payload: { tool_input: { command } } });
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });
  test(`${hook} still blocks unterminated syntax outside heredoc bodies (#1396)`, () => {
    for (const [command, reason] of heredocAttacks) {
      const result = runHook(hook, { payload: { tool_input: { command } } });
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      if (reason) assert.match(result.stderr, reason, JSON.stringify(command));
    }
  });
}

test('pretool-git-gate allows a heredoc commit message whose body holds quotes (#1396)', () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-heredoc-gate-')));
  try {
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'init');
    git('branch', '-M', 'feature/x');
    for (const command of heredocMessages) {
      const result = runHook('pretool-git-gate.sh', {
        cwd: repo, payload: { tool_input: { command } }, env: { DHPK_BRANCH_SAFETY: 'block' },
      });
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

// #1432: a substitution shortcut trusts a familiar command name, so a visible
// function of that name invalidates it. Every shadowed form keeps a control
// where the same function names are unrelated to the substitution.
const shadowedSubstitutions = [
  'pwd(){ echo .env; }; cat $(pwd)',
  'function pwd { echo .env; }; cat $(pwd)',
  'pwd () { echo .env; }; cat "$(pwd)"',
  'function pwd() { echo .env; }; cat $(pwd)',
  '"pwd"(){ echo .env; }; cat $(pwd)',
  'pwd(){ echo .; }; cat $(pwd)/ordinary',
  'git(){ echo .env; }; cat $(git rev-parse --show-toplevel)',
  'git(){ echo .; }; cat $(git rev-parse --show-toplevel)/ordinary',
  'pwd(){ echo .env; }; echo "$(cat $(pwd))"',
  'pwd(){ echo .env; }\ncat $(pwd)',
  'pwd(){ echo .env; } && cat $(pwd)',
];
const unshadowedSubstitutions = [
  'cat $(pwd)/ordinary',
  'cat "$(pwd)/ordinary"',
  'cat $(git rev-parse --show-toplevel)/ordinary',
  'ls(){ echo x; }; cat $(pwd)/ordinary',
  'git(){ :; }; cat $(pwd)/ordinary',
  'pwd(){ :; }; cat $(git rev-parse --show-toplevel)/ordinary',
  'echo pwd; cat $(pwd)/ordinary',
  'echo "pwd(){ echo .env; }"; cat $(pwd)/ordinary',
  'pwd; cat $(pwd)/ordinary',
];
// Reader operands that a substitution produces stay blocked: its output is unknown before it runs.
const substitutionOperands = [
  'cat $(echo .env)', 'cat `echo .env`', 'cat "$(ls)"', 'cat $(cat list)', 'cat $(pwd; echo .env)',
  'cat $(pwd)/$(echo .env)', 'head -n 1 $(basename ordinary)',
];
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  const decide = (command) => runHook(hook, { payload: { tool_input: { command } } });
  test(`${hook} blocks a trusted substitution shortcut when a visible function shadows it (#1432)`, () => {
    for (const command of shadowedSubstitutions) {
      const result = decide(command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /command substitution/, JSON.stringify(command));
      assert.ok(!result.stderr.includes('synthetic'), 'no file content in the reason');
    }
  });
  test(`${hook} keeps the pwd and git toplevel shortcuts when no function shadows them (#1432)`, () => {
    for (const command of unshadowedSubstitutions) {
      const result = decide(command);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    }
    assert.strictEqual(decide('cat $(pwd)/.env').status, 2);
    assert.strictEqual(decide('cat $(git rev-parse --show-toplevel)/.env').status, 2);
  });
  test(`${hook} keeps a reason and a rewrite direction for a Reader substitution operand (#1432)`, () => {
    for (const command of substitutionOperands) {
      const result = decide(command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /command substitution/, JSON.stringify(command));
      assert.match(result.stderr, /explicit|literal|narrow/i, `rewrite direction: ${result.stderr}`);
    }
  });
}

// xargs hands its standard input to the Reader as operands (#1433). A visible protected path in a text
// producer upstream of the pipe is a Reader operand; the same pipeline split over lines judges the same.
const xargsPipelines = [
  // [single-line form, multiline form]
  ['echo .env | xargs cat', 'echo .env |\nxargs cat'],
  ['echo .env | xargs cat', 'echo .env \\\n| xargs cat'],
  ['echo .env | xargs cat', 'echo .env\n| xargs cat'],
  ['echo .env |& xargs cat', 'echo .env |&\nxargs cat'],
  ['echo ordinary | xargs cat', 'echo ordinary |\n\nxargs cat'],
  ['printf "%s\\n" .env | xargs head', 'printf "%s\\n" .env |\n  xargs head'],
  ['echo .env | tr a a | xargs cat', 'echo .env |\ntr a a |\nxargs cat'],
];
const xargsBlocked = [
  'echo .env | xargs cat', 'echo ordinary .env | xargs cat', 'echo .env | xargs -n1 cat', 'echo .env | xargs -0 cat',
  'echo .env | xargs -I{} cat {}', 'echo .env | xargs grep -l needle', 'echo .env | xargs -r head -n 1',
  "printf '%s\\n' .env | xargs head", "printf '.env\\n' | xargs cat", 'echo ./.env | xargs cat', 'echo config/.env.production | xargs cat',
  'echo .env | tr a a | xargs cat', 'echo .env | env xargs cat', 'echo .env | command xargs cat', 'echo .env |& xargs cat',
  'f=.env; echo $f | xargs cat', 'echo .env | xargs sh -c \'cat "$1"\' _', 'echo .env | xargs bash -c \'cat "$@"\' _',
  '(echo .env) | xargs cat', '{ echo .env; } | xargs cat', 'time echo .env | xargs cat',
  'xargs cat <<< .env',
  'echo my.cnf | xargs cat', 'echo private.pem | xargs cat',
];
const xargsAmbiguous = ['echo .e* | xargs cat', 'echo $(echo .env) | xargs cat', 'echo `echo .env` | xargs cat', 'echo .env | xargs -a x cat; echo .e* | xargs head'];
const xargsAllowed = [
  'echo ordinary | xargs cat', 'echo .env.example | xargs cat', 'printf "%s\\n" ordinary | xargs head -n 1', 'cat ordinary | xargs cat',
  'echo .env | xargs echo', 'echo .env | xargs ls', 'echo .env | xargs wc -c; echo ordinary | xargs cat', 'echo ordinary | xargs sh -c \'cat "$1"\' _',
  '(echo ordinary) | xargs cat', '{ echo ordinary; } | xargs cat',
  'echo .env; xargs cat', 'echo .env\nxargs cat', 'echo .env && xargs cat', 'echo $x | xargs cat', 'echo .env | cat | xargs echo',
  'echo ordinary | xargs -I{} cat {}', 'echo .env | xargs -I{} echo {}',
];
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  const decide = (command) => runHook(hook, { payload: { tool_input: { command } } });
  test(`${hook} blocks a visible protected path fed to an xargs Reader through a pipe (#1433)`, () => {
    for (const command of xargsBlocked) {
      const result = decide(command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /protected path/, JSON.stringify(command));
      assert.ok(!result.stderr.includes('synthetic'), 'no file content in the reason');
    }
  });
  test(`${hook} fails closed on a glob or substitution that feeds an xargs Reader with a rewrite direction (#1433)`, () => {
    for (const command of xargsAmbiguous) {
      const result = decide(command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /xargs stdin/, JSON.stringify(command));
      assert.match(result.stderr, /explicit|literal/i, `rewrite direction: ${result.stderr}`);
    }
  });
  test(`${hook} allows ordinary xargs pipelines and inert consumers (#1433)`, () => {
    for (const command of xargsAllowed) {
      const result = decide(command);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });
  test(`${hook} judges a multiline xargs pipeline like its single-line form (#1433)`, () => {
    for (const [single, multi] of xargsPipelines) {
      const a = decide(single);
      const b = decide(multi);
      assert.strictEqual(b.status, a.status, `${JSON.stringify(multi)}: ${b.stderr} vs ${a.stderr}`);
    }
    assert.strictEqual(decide('echo ordinary |\nxargs cat').status, 0);
    assert.strictEqual(decide('echo .env |\nxargs cat').status, 2);
  });
}

// Heredoc text read by xargs, parallel, read, readarray, mapfile or exec (#1433): each restriction is judged on
// what consumes the text. Text that only an inert consumer prints or stores stays data; the rest stays blocked.
const SHL = '<' + '<';
const heredocInert = [
  `xargs echo ${SHL}'EOF'\nhello\nEOF\n`, `xargs ${SHL}'EOF'\nhello\nEOF\n`, `xargs -n1 echo ${SHL}'EOF'\nhello\nEOF\n`,
  `xargs -I{} echo {} ${SHL}'EOF'\nhello\nEOF\n`, `xargs echo ${SHL}'EOF'\ncat .env\nEOF\n`, `cat ${SHL}'EOF' | xargs echo\ncat .env\nEOF\n`,
  `gh issue create --title "fix xargs bug" --body-file - ${SHL}'EOF'\nhello\nEOF\n`, `git commit -m "xargs docs" -F - ${SHL}'EOF'\nhello\nEOF\n`,
  `'xargs' echo ${SHL}'EOF'\nhello\nEOF\n`, `x"args" echo ${SHL}'EOF'\nhello\nEOF\n`,
  `echo read ${SHL}'EOF'\nhello\nEOF\n`, `read x ${SHL}'EOF'\nhello\nEOF\n`, `mapfile -t lines ${SHL}'EOF'\ncat .env\nEOF\n`,
  `readarray -t lines ${SHL}'EOF'\nhello\nEOF\n`, `while read -r l; do :; done ${SHL}'EOF'\nhello\nEOF\n`,
];
const heredocBlocked = [
  `xargs cat ${SHL}'EOF'\n.env\nEOF\n`, `xargs cat ${SHL}'EOF'\nordinary\nEOF\n`, `xargs -I{} sh -c {} ${SHL}'EOF'\ncat .env\nEOF\n`,
  `xargs -I{} {} ${SHL}'EOF'\ncat .env\nEOF\n`, `xargs -I echo echo ${SHL}'EOF'\ncat .env\nEOF\n`, `xargs echo ${SHL}'EOF'\nhello\nEOF\nxargs cat ${SHL}'E'\n.env\nE\n`,
  `parallel echo ${SHL}'EOF'\nhello\nEOF\n`, `parallel ${SHL}'EOF'\ncat .env\nEOF\n`, `env xargs echo ${SHL}'EOF'\nhello\nEOF\n`,
  `exec cat ${SHL}'EOF'\n.env\nEOF\n`, `exec 3${SHL}'EOF'\ncat .env\nEOF\n`, `read x ${SHL}'EOF'\ncat .env\nEOF\ncat $x`,
  `read x ${SHL}'EOF'\ncat .env\nEOF\neval "$x"`, `while read -r l; do $l; done ${SHL}'EOF'\ncat .env\nEOF\n`,
  `while read -r l; do cat $l; done ${SHL}'EOF'\n.env\nEOF\n`, `mapfile -C "cat .env" -c 1 a ${SHL}'EOF'\nx\nEOF\n`,
  `read PATH ${SHL}'EOF'\nx\nEOF\n`, `xargs echo ${SHL}'EOF'\nhello\nEOF\nread y ${SHL}'E'\ncat .env\nE\n$y`,
  `'xargs' cat ${SHL}'EOF'\n.env\nEOF\n`, `x'ar'gs cat ${SHL}'EOF'\n.env\nEOF\n`, `'parallel' cat ${SHL}'EOF'\n.env\nEOF\n`,
  `ex"ec" cat ${SHL}'EOF'\n.env\nEOF\n`, `'read' X ${SHL}'EOF'\nx\nEOF\n`,
  `bash -c 'xargs cat' ${SHL}'EOF'\n.env\nEOF\n`, `xargs echo ${SHL}'EOF' |\nsh\nhello\nEOF\n`,
];
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  const decide = (command) => runHook(hook, { payload: { tool_input: { command } } });
  test(`${hook} keeps heredoc text read by an inert consumer as data (#1433)`, () => {
    for (const command of heredocInert) {
      const result = decide(command);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });
  test(`${hook} keeps blocking heredoc text an xargs, parallel, exec or read consumer may run or read as paths (#1433)`, () => {
    for (const command of heredocBlocked) {
      const result = decide(command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });
  test(`${hook} still reads an expansion inside an unquoted heredoc given to an inert consumer (#1433)`, () => {
    const result = decide(`xargs echo ${SHL}EOF\n$(cat .env)\nEOF\n`);
    assert.strictEqual(result.status, 2, result.stderr);
    assert.match(result.stderr, /protected path/);
  });
}

// (#1456) Values visible in the command text reach a Reader through positional parameters: `set --`,
// a function call's arguments, and `shift`. Each blocked row spells a Protected Path out of those values.
const positionalBlocked = [
  'set -- .env; cat "$1"', 'set -- nv; cat .e$1', 'f(){ cat "$1"; }; f .env', 'f(){ cat .e$1; }; f nv',
  'set -- ordinary .env; cat "$2"', 'set -- .env; cat "$@"', 'set -- ordinary .env; shift; cat "$1"',
  'f(){ local x=$1; cat "$x"; }; f .env', 'set -- x; f(){ cat .e${1}nv; }; f',
];
const positionalAllowed = [
  'set -- a b; echo "$1"', 'f(){ cat "$1"; }; f ordinary', 'set -e; cat "$1"', 'set -- ordinary; cat "$1"',
  'tmp=$(mktemp -d); cat "$tmp/out.txt"', 'cmd=(git log --oneline); "${cmd[@]}"',
];
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  const decide = (command) => runHook(hook, { payload: { tool_input: { command } } });
  test(`${hook} blocks a Protected Path spelled by visible positional parameters (#1456)`, () => {
    for (const command of positionalBlocked) {
      const result = decide(command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /\[bash-guard\] blocked:/, JSON.stringify(command));
      assert.ok(!result.stderr.includes('synthetic'), 'no file content in the reason');
    }
  });
  test(`${hook} still allows ordinary positional parameters and unrelated command substitutions (#1456)`, () => {
    for (const command of positionalAllowed) {
      const result = decide(command);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });
}

// (#1456 review) Fail closed where positional modelling stops: more than nine words, `${10}`, loops over
// positionals, and an empty `set` argument.
const positionalLimitBlocked = [
  'set -- x x x x x x x x x .env; cat "${10}"', 'set -- .env x x x x x x x x x; cat "$1"', 'set -- x x x x x x x x x .env; cat "$@"',
  'f(){ cat "${10}"; }; f x x x x x x x x x .env', "set -- .env; for a; do cat \"$a\"; done",
  'set -- .env; for a in "$@"; do cat "$a"; done', "set '' .env; cat \"$2\"", 'set -- ordinary .env; for a; do cat "$a"; done',
  'set -- x .env; shift 12; cat "$1"',
];
const positionalLimitAllowed = [
  'set -- a b; echo "$1"', 'set -- ordinary; cat "$1"', 'set -- ordinary; for a; do cat "$a"; done',
  'set -- a b c d e f g h i j; echo "${10}"',
];
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  const decide = (command) => runHook(hook, { payload: { tool_input: { command } } });
  test(`${hook} blocks a Protected Path read through positional parameters past the modelling limit (#1456)`, () => {
    for (const command of positionalLimitBlocked) {
      const result = decide(command);
      assert.strictEqual(result.status, 2, `${JSON.stringify(command)}: ${result.stderr}`);
      assert.match(result.stderr, /\[bash-guard\] blocked:/, JSON.stringify(command));
    }
  });
  test(`${hook} still allows ordinary positional use near the limit (#1456)`, () => {
    for (const command of positionalLimitAllowed) {
      const result = decide(command);
      assert.strictEqual(result.status, 0, `${JSON.stringify(command)}: ${result.stderr}`);
    }
  });
}

run('credential-read-policy');
