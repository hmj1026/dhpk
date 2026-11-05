'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { runHook, ROOT } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

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
];
for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
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
      assert.match(result.stderr, /if available/i);
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

run('credential-read-policy');
