'use strict';

// Characterization of dhpk_config_csv (runtime-config.sh) and active_modules_list
// (modules.sh) trimming. Expected values were captured from the awk/xargs
// implementation, so the pure-bash replacement must reproduce them exactly:
// quotes, whitespace runs, empty fields, glob characters and leading dashes.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const LIB_DIR = path.join(__dirname, '..', 'scripts', 'hooks', '_lib');

// Runs `body` in a scratch cwd that holds files named x and y, so an unguarded
// glob would expand `*` / `?` into file names.
function sh(body, env) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-csv-'));
  fs.writeFileSync(path.join(cwd, 'x'), '');
  fs.writeFileSync(path.join(cwd, 'y'), '');
  try {
    const clean = { ...process.env };
    delete clean.DHPK_ACTIVE_MODULES;
    delete clean.CLAUDE_PLUGIN_OPTION_MODULES;
    return spawnSync('bash', ['-c', `source "${LIB_DIR}/modules.sh"; ${body}`], {
      cwd, encoding: 'utf8', timeout: 10000, env: Object.assign(clean, env),
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

const csv = (raw) => sh("dhpk_config_csv modules ''", { CLAUDE_PLUGIN_OPTION_MODULES: raw });
const mods = (raw) => {
  const res = sh('active_modules_list', { DHPK_ACTIVE_MODULES: raw });
  return { list: res.stdout.split('\n').filter(Boolean), res };
};

const CSV_CASES = [
  [' a , b ', 'a,b'],
  ['a,,b,', 'a,b'],
  [',,,', ''],
  ['   ', ''],
  ['a  b ,\tc', 'a b,c'],
  ['\ta\t', 'a'],
  ['*,?', '*,?'],
  ['a "b" c', 'a "b" c'],
  ["it's, x", "it's,x"],
  ["'php',\"react\"", "'php',\"react\""],
  ['a,b\nc,d', 'a,b'],
  ['-n,-e,ok', '-n,-e,ok'],
];

for (const [raw, expected] of CSV_CASES) {
  test(`dhpk_config_csv ${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`, () => {
    const res = csv(raw);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, expected);
  });
}

test('dhpk_config_csv leaves glob state of the caller untouched', () => {
  const res = sh("dhpk_config_csv modules '' >/dev/null; echo \"flags=$-\"; echo *", { CLAUDE_PLUGIN_OPTION_MODULES: ' a , b ' });
  assert.ok(!/flags=.*f/.test(res.stdout), res.stdout);
  assert.ok(/x y/.test(res.stdout), 'caller globbing must still work');
});

test('dhpk_config_csv keeps the caller IFS', () => {
  const res = sh("IFS=:; dhpk_config_csv modules '' >/dev/null; printf '%s' \"$IFS\"", { CLAUDE_PLUGIN_OPTION_MODULES: 'a, b' });
  assert.strictEqual(res.stdout, ':');
});

const MODULE_CASES = [
  [' a , b ', ['a', 'b']],
  ['a,,b,', ['a', 'b']],
  ['a  b ,\tc', ['a b', 'c']],
  ['*,?', ['*', '?']],
  ['a "b" c', ['a b c']],
  ["'php',\"react\"", ['php', 'react']],
  ['"a b"', ['a b']],
  ['-n,-e,-x,ok', ['-x', 'ok']],
  ['php,php, php', ['php']],
  ['\ra\r\tb, \rc ', ['a\r b', 'c']],
  ['a\\b', ['ab']],
];

for (const [raw, expected] of MODULE_CASES) {
  test(`active_modules_list ${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`, () => {
    const { list, res } = mods(raw);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(list, expected);
  });
}

test("active_modules_list drops an item with an unmatched quote (xargs rejects it)", () => {
  const { list } = mods("it's, x");
  assert.deepStrictEqual(list, ['x']);
});

run('runtime-config-csv');
