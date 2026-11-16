'use strict';

// #1429: tar and cp are Readers with their own source grammar (spec #1422, REQ-6, REQ-9).
// Source versus destination roles come from each command's own options; no generic argv parser.
// Every block has a legitimate-use allow beside it, every allow a dangerous counterpart.
const { test, run, assert } = require('./_lib/tinytest');
const { runHook: runHookAt } = require('./_lib/hookharness');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FIXTURE_CWD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-credential-tarcp-')));
for (const name of ['.env', '.env.example', 'ordinary', 'ordinary2']) fs.writeFileSync(path.join(FIXTURE_CWD, name), 'synthetic');
process.on('exit', () => fs.rmSync(FIXTURE_CWD, { recursive: true, force: true }));
const runHook = (hook, command) => runHookAt(hook, { cwd: FIXTURE_CWD, payload: { tool_input: { command } } });

// tar: sources in create/append/update, the archive in extract/list/diff.
const protectedTar = [
  'tar cf out.tar .env', 'tar -cf out.tar .env', 'tar czf - .env', 'tar --create --file=out.tar .env',
  'tar -cvf out.tar ordinary .env', 'tar cf out.tar -- .env', 'tar -rf out.tar .env', 'tar uf out.tar .env',
  'tar -C . -cf out.tar .env', 'tar -C sub -cf out.tar credentials.json', 'tar cf out.tar ./x/../.env',
  'tar -cf out.tar -C sub credentials.json', 'tar cf - .env | gzip',
  'tar xf .env', 'tar -xf .env', 'tar tf .env', 'tar -tvf .env', 'tar --extract --file .env', 'tar -xzf .env -C out',
  'tar --list --file=.env', 'tar -xf credentials.json', 'tar -df .env', 'tar -d -f ordinary .env',
  'tar -xf ordinary -T .env', 'tar -xf ordinary --exclude-from=.env', 'tar cf out.tar --exclude-from .env ordinary',
  'tar Af ordinary .env',
  'sudo tar cf out .env', 'env tar cf out .env', 'FOO=1 tar cf out .env', '/bin/tar cf out .env',
];
const ordinaryTar = [
  'tar cf out.tar ordinary', 'tar czf out.tgz ordinary .env.example', 'tar -cvf out.tar ordinary ordinary2',
  'tar xf ordinary', 'tar -tf ordinary', 'tar tvf ordinary', 'tar --list --file=ordinary', 'tar -xzf ordinary --strip-components=1',
  'tar -xf ordinary --transform s/a/b/', 'tar xf -', 'echo hi | tar xf -', 'tar cf - ordinary | tar xf - -C out',
  'tar --version', 'tar --help', 'tar -cf out.tar',
  // `.env` as extract member name, extract directory or output archive is not a read of that file.
  'tar xf ordinary .env', 'tar -xf ordinary -C .env', 'tar cf .env ordinary', 'tar -cf .env ordinary',
  'tar -tf ordinary .env', 'tar cf out.tar --no-recursion ordinary',
  'tar cf out.tar --exclude=.env ordinary',
  'cd out && tar xf ordinary',
  'sudo tar xf ordinary', 'FOO=1 tar tf ordinary',
  // Words that merely name the program are not an invocation.
  'which tar', 'apt install tar gzip', 'ls tar cp', 'man tar', 'echo tar cf x .env',
];
// cp: every operand but the last (or all of them with -t) is a source; the last is the destination.
const protectedCp = [
  'cp .env out', 'cp .env /tmp/o', 'cp -a .env out', 'cp -p .env out', 'cp -f ordinary .env out',
  'cp -t out .env', 'cp --target-directory=out .env', 'cp --target-directory out .env', 'cp -T .env out', 'cp -- .env out',
  'cp ./x/../.env out', 'cp -v -- ./.env out', 'cp credentials.json out', 'cp -l .env out', 'cp --parents .env out',
  'cp -S .bak .env out', 'cp --backup=numbered .env out', 'cp -t out -- .env', 'cp -tout .env', 'cp ordinary .env out',
  'cp .env.example .env out', 'cp -u -- ordinary credentials.json out',
  'sudo cp .env out', 'env cp .env out', 'FOO=1 cp .env out', '/bin/cp .env out', 'cp .env out | cat',
];
const ordinaryCp = [
  'cp ordinary out', 'cp .env.example out', 'cp ordinary ordinary2 out', 'cp -a ordinary out', 'cp -p ordinary out',
  'cp -r ordinary out', 'cp -R ordinary out', 'cp -rf ordinary out', 'cp -- ordinary out', 'cp --version', 'cp --help', 'cp',
  'cp -S .env ordinary out', 'cp -t out -S .env ordinary', 'cp --backup=numbered ordinary out', 'cp -v ordinary out',
  // `.env` as destination is not a read; no write policy is added here.
  'cp ordinary .env', 'cp -f ordinary .env', 'cp -t .env ordinary', 'cp --target-directory=.env ordinary',
  'cp ordinary "$(mktemp -d)"', 'FOO=1 cp ordinary out', 'sudo cp ordinary out',
  'cp -T ordinary .env', 'cp ordinary ordinary2 .env', 'cp -- ordinary .env',
];
// Directory sources are scanned like any other recursive read.
const recursive = [
  'tar cf out.tar .', 'tar czf out.tgz .', 'tar -C . -cf out.tar .', 'tar cf out.tar --exclude=ordinary .', 'cp -r . out', 'cp -R . out', 'cp -a . out',
  'cp -t out -r .', 'tar -df ordinary .', 'tar cf out.tar --exclude-from=ordinary .',
];
const allDefaultsExcluded = ['.env', '.env.*', 'my.cnf', 'debian.cnf', '*.pem', 'id_rsa*', 'credentials*']
  .map((p) => `--exclude='${p}'`).join(' ');
const excludedRecursive = [`tar cf out.tar ${allDefaultsExcluded} .`, 'tar cf out.tar --exclude=.env .', 'tar cf out.tar --no-recursion .', 'cp . out'];
// Visible risk the grammar cannot resolve fails closed.
const ambiguous = [
  'tar cf out.tar *.pem', 'tar cf out.tar $(echo .env)', 'tar xf *.pem', 'tar xf $(echo .env)',
  'cp *.pem out', 'cp $(echo .env) out', 'cp -t out *.pem', 'cp `echo .env` out',
];
const unsupported = [
  'cp --bogus ordinary out', 'cp -Q ordinary out', 'cp -t', 'cp --target-directory',
  'tar --bogus ordinary', 'tar -Z ordinary', 'tar cf', 'tar ordinary', 'tar cxf out ordinary',
  'tar cf out -T list ordinary', 'tar cf out --files-from list', 'tar -I cat -cf out ordinary', 'tar cf out --to-command=cat ordinary',
  'tar cf out --checkpoint-action=exec=cat ordinary',
];

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  const expectBlock = (list, pattern, extra) => {
    for (const command of list) {
      const result = runHook(hook, command);
      assert.strictEqual(result.status, 2, `${command}: ${result.stderr}`);
      assert.match(result.stderr, pattern, command);
      assert.doesNotMatch(result.stderr, /synthetic/, command);
      if (extra) extra(result, command);
    }
  };
  const expectAllow = (list) => {
    for (const command of list) {
      const result = runHook(hook, command);
      assert.strictEqual(result.status, 0, `${command}: ${result.stderr}`);
    }
  };
  test(`${hook} blocks tar reading a Protected Path as archive or source (#1429)`, () => expectBlock(protectedTar, /protected path/));
  test(`${hook} allows tar on ordinary inputs and Protected Path names that are not read (#1429)`, () => expectAllow(ordinaryTar));
  test(`${hook} blocks cp reading a Protected Path as a source (#1429)`, () => expectBlock(protectedCp, /protected path/));
  test(`${hook} allows cp on ordinary sources and a Protected Path destination (#1429)`, () => expectAllow(ordinaryCp));
  test(`${hook} scans directory sources of tar and cp (#1429)`, () => {
    expectBlock(recursive, /recursive read without credential exclusions/);
    expectAllow(excludedRecursive);
  });
  test(`${hook} blocks unresolvable tar and cp sources with a literal-path rewrite (#1429)`, () => {
    expectBlock(ambiguous, /^\[bash-guard\] blocked: ambiguous read target: /, (result, command) => {
      assert.match(result.stderr, /explicit literal path/, command);
      assert.doesNotMatch(result.stderr, /git grep/, command);
    });
  });
  test(`${hook} fails closed on tar and cp syntax it does not model (#1429)`, () => expectBlock(unsupported, /unsupported reader syntax/));
}

run('credential-tar-cp');
