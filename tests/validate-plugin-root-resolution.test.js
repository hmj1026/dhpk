'use strict';

// Guardrail for ADR 0038: runtime scripts must resolve their package root
// through the shared resolvers, never by reading CLAUDE_PLUGIN_ROOT directly.

const { test, run, assert } = require('./_lib/tinytest');
const { checkSources, isScanned, EXEMPTIONS } = require('../scripts/ci/validate-plugin-root-resolution');

function violations(file, source) {
  return checkSources([{ path: file, source }]);
}

const SH = 'scripts/hooks/example.sh';
const JS = 'scripts/lib/example.js';

const SHELL_REJECTS = [
  ['braced read', 'root="${CLAUDE_PLUGIN_ROOT}"'],
  ['default form', 'root="${CLAUDE_PLUGIN_ROOT:-$HOME/x}"'],
  ['alternate form', 'root="${CLAUDE_PLUGIN_ROOT:+set}"'],
  ['bare read', 'cd "$CLAUDE_PLUGIN_ROOT/scripts"'],
  ['env injection', 'CLAUDE_PLUGIN_ROOT="$p" node child.js'],
  ['export injection', 'export CLAUDE_PLUGIN_ROOT=/x'],
];

const JS_REJECTS = [
  ['process.env dot', 'const r = process.env.CLAUDE_PLUGIN_ROOT;'],
  ['destructured env dot', "const r = env.CLAUDE_PLUGIN_ROOT || '';"],
  ['spawn env object key', "spawnSync('x', [], { env: { ...process.env, CLAUDE_PLUGIN_ROOT: root } });"],
  ['quoted object key', "const e = { 'CLAUDE_PLUGIN_ROOT': root };"],
  ['bracket access', "const r = process.env['CLAUDE_PLUGIN_ROOT'];"],
];

for (const [name, line] of SHELL_REJECTS) {
  test(`rejects shell ${name}`, () => {
    const found = violations(SH, `#!/usr/bin/env bash\n${line}\n`);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].file, SH);
    assert.strictEqual(found[0].line, 2);
    assert.match(found[0].message, /CLAUDE_PLUGIN_ROOT/);
  });
}

for (const [name, line] of JS_REJECTS) {
  test(`rejects js ${name}`, () => {
    const found = violations(JS, `'use strict';\n${line}\n`);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].line, 2);
  });
}

test('rejects in other scoped locations', () => {
  const line = 'root="${CLAUDE_PLUGIN_ROOT}"\n';
  for (const file of [
    'scripts/hooks/_lib/plugin-root.sh',
    'modules/core/hooks/a.sh',
    'scripts/release/x.sh',
    'skills/foo/scripts/run.sh',
    'scripts/top-level.sh',
    'scripts/setup/install.sh',
  ]) {
    assert.strictEqual(violations(file, line).length, 1, file);
  }
  assert.strictEqual(violations('scripts/lib/package-root.js', 'x = process.env.CLAUDE_PLUGIN_ROOT;\n').length, 1);
});

test('allows shell and js comments', () => {
  assert.deepStrictEqual(violations(SH, '# uses ${CLAUDE_PLUGIN_ROOT} historically\n   # $CLAUDE_PLUGIN_ROOT\n'), []);
  assert.deepStrictEqual(violations(JS, '// process.env.CLAUDE_PLUGIN_ROOT is banned\n  // CLAUDE_PLUGIN_ROOT: x\n'), []);
  assert.deepStrictEqual(violations(JS, '/*\n * process.env.CLAUDE_PLUGIN_ROOT\n */\nconst a = 1;\n/* env.CLAUDE_PLUGIN_ROOT */\n'), []);
});

test('flags code after a closed block comment', () => {
  assert.strictEqual(violations(JS, '/* c */ const r = process.env.CLAUDE_PLUGIN_ROOT;\n').length, 1);
});

test('allows unrelated variables', () => {
  assert.deepStrictEqual(violations(SH, 'root="${DHPK_INSTALLER_ROOT}"\nx=$CLAUDE_PLUGIN_ROOTS_OTHER\n'), []);
  assert.deepStrictEqual(violations(JS, 'const r = process.env.DHPK_INSTALLER_ROOT;\n'), []);
});

test('does not scan markdown, tests, generated, or out-of-scope paths', () => {
  const bad = 'root="${CLAUDE_PLUGIN_ROOT}"\n';
  for (const file of [
    'docs/adr/0038.md',
    'scripts/hooks/README.md',
    'tests/hook.sh',
    'scripts/hooks/tests/x.sh',
    'dist/claude-marketplace/package/scripts/hooks/a.sh',
    'commands/foo.sh',
    'docs/tool.sh',
  ]) {
    assert.strictEqual(isScanned(file), false, file);
    assert.deepStrictEqual(violations(file, bad), [], file);
  }
});

test('exempts only explicit files, each with a reason', () => {
  const expected = [
    'scripts/lib/cursor-harness-adapt.js',
    'scripts/lib/marketplace-skill-content.js',
    'scripts/lib/native-agent-support.js',
    'scripts/validate/test-hooks.sh',
  ];
  assert.deepStrictEqual(Object.keys(EXEMPTIONS).sort(), expected);
  for (const reason of Object.values(EXEMPTIONS)) assert.ok(reason.length > 10);
  for (const file of expected) {
    assert.deepStrictEqual(violations(file, 'x = process.env.CLAUDE_PLUGIN_ROOT;\nroot="${CLAUDE_PLUGIN_ROOT}"\n'), []);
  }
});

test('resolvers are never exempt', () => {
  assert.ok(!('scripts/hooks/_lib/plugin-root.sh' in EXEMPTIONS));
  assert.ok(!('scripts/lib/package-root.js' in EXEMPTIONS));
});

test('reports every violation with its line number', () => {
  const found = violations(SH, 'a=1\nb="$CLAUDE_PLUGIN_ROOT"\nc=2\nd="${CLAUDE_PLUGIN_ROOT:-x}"\n');
  assert.deepStrictEqual(found.map((v) => v.line), [2, 4]);
});

const HEREDOC_BODY = 'echo "${CLAUDE_PLUGIN_ROOT}/x"';

for (const open of ["cat > f <<'EOF'", 'cat > f <<"EOF"', 'cat > f <<\\EOF', "cat > f <<-'EOF'", 'cat > f <<-"EOF"', "cat > f << 'EOF'"]) {
  test(`skips quoted heredoc body: ${open}`, () => {
    assert.deepStrictEqual(violations(SH, `${open}\n${HEREDOC_BODY}\nEOF\n`), []);
  });
}

test('skips tab-indented closing tag for <<- heredoc', () => {
  assert.deepStrictEqual(violations(SH, `cat <<-'EOF'\n\t${HEREDOC_BODY}\n\tEOF\n`), []);
});

test('scans code after a quoted heredoc closes', () => {
  const found = violations(SH, `cat <<'EOF'\n${HEREDOC_BODY}\nEOF\nroot="$CLAUDE_PLUGIN_ROOT"\n`);
  assert.deepStrictEqual(found.map((v) => v.line), [4]);
});

test('still scans unquoted heredoc bodies', () => {
  assert.strictEqual(violations(SH, `cat <<EOF\n${HEREDOC_BODY}\nEOF\n`).length, 1);
  assert.strictEqual(violations(SH, `cat <<-EOF\n${HEREDOC_BODY}\nEOF\n`).length, 1);
});

test('does not treat a mismatched tag as the heredoc end', () => {
  assert.deepStrictEqual(violations(SH, `cat <<'EOF'\nEOFX\n${HEREDOC_BODY}\nEOF\n`), []);
});

for (const here of ["grep x <<<'abc'", 'grep x <<<"abc"']) {
  test(`here-string is not a heredoc: ${here}`, () => {
    const found = violations(SH, `${here}\necho "$CLAUDE_PLUGIN_ROOT"\n`);
    assert.deepStrictEqual(found.map((v) => v.line), [2]);
  });
}

for (const line of [
  'const { CLAUDE_PLUGIN_ROOT } = process.env;',
  'const { CLAUDE_PLUGIN_ROOT } = env;',
  'const { A, CLAUDE_PLUGIN_ROOT } = process.env;',
  'const { CLAUDE_PLUGIN_ROOT, B } = process.env;',
  'const { A, CLAUDE_PLUGIN_ROOT: root, B } = process.env;',
  'const { CLAUDE_PLUGIN_ROOT = "x" } = process.env;',
]) {
  test(`rejects js destructuring: ${line}`, () => {
    const found = violations(JS, `'use strict';\n${line}\n`);
    assert.ok(found.length >= 1, line);
    assert.strictEqual(found[0].line, 2);
  });
}

test('destructuring of unrelated or non-env names is allowed', () => {
  assert.deepStrictEqual(violations(JS, 'const { HOME, DHPK_INSTALLER_ROOT } = process.env;\n'), []);
});

test('scans every tracked runtime dir, including formerly out-of-scope ones', () => {
  const bad = 'root="${CLAUDE_PLUGIN_ROOT}"\n';
  for (const file of [
    'scripts/ci/other.js',
    'scripts/ci/run.sh',
    'scripts/validate/helper.sh',
    'scripts/sub/deep/x.sh',
    'bin/dhpk',
    'modules/core/scripts/x.sh',
    'modules/core/lib/x.js',
    'skills/foo/scripts/lib/x.sh',
  ]) {
    const source = file === 'bin/dhpk' ? '#!/usr/bin/env bash\n' + bad : bad;
    assert.strictEqual(violations(file, file.endsWith('.js') ? 'x = process.env.CLAUDE_PLUGIN_ROOT;\n' : source).length, 1, file);
  }
});

test('exemptions are file-specific, not directory-wide', () => {
  const bad = 'root="${CLAUDE_PLUGIN_ROOT}"\n';
  for (const file of Object.keys(EXEMPTIONS)) {
    assert.deepStrictEqual(violations(file, bad), [], file);
    assert.strictEqual(violations(file + '.sibling.sh', bad).length, 1, file);
    const dir = file.slice(0, file.lastIndexOf('/'));
    assert.strictEqual(violations(dir + '/zz-neighbor.sh', bad).length, 1, file);
  }
});

run('validate-plugin-root-resolution');
