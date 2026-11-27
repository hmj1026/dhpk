'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(ROOT, 'scripts', 'setup', 'install-assets.sh');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-assets-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(source, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(source, 'scripts', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(source, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(source, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(source, 'hooks', 'hooks.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{ hooks: [{ args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/guard.sh'] }] }],
    },
  }) + '\n');
  fs.writeFileSync(path.join(source, 'scripts', 'hooks', 'guard.sh'), '#!/usr/bin/env bash\necho guard\n');
  fs.chmodSync(path.join(source, 'scripts', 'hooks', 'guard.sh'), 0o755);
  fs.writeFileSync(path.join(source, 'rules', 'execution-policy.md'), '# policy\n');
  fs.writeFileSync(path.join(source, 'rules', 'tool-routing.md'), '# routing\n');
  fs.writeFileSync(path.join(source, 'scripts', 'lib', 'runner.js'), 'module.exports = 1;\n');
  for (const [skill, relative, content, mode] of [
    ['precommit', 'scripts/precommit-runner.js', '#!/usr/bin/env node\nconsole.log("precommit pilot");\n', 0o755],
    ['precommit', 'scripts/lib/runner-utils.js', 'module.exports = { pilot: "precommit" };\n', 0o644],
    ['repo-verify', 'scripts/verify-runner.js', '#!/usr/bin/env node\nconsole.log("repo-verify pilot");\n', 0o755],
    ['repo-verify', 'scripts/lib/runner-utils.js', 'module.exports = { pilot: "repo-verify" };\n', 0o644],
    ['harness-audit', 'scripts/harness-audit.js', '#!/usr/bin/env node\nconsole.log("harness-audit fixture");\n', 0o755],
  ]) {
    const file = path.join(source, 'skills', skill, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { mode });
    fs.chmodSync(file, mode);
  }
  return { root, source, target };
}

function install(ctx, args, env = {}) {
  return spawnSync('bash', [INSTALLER, '--source', ctx.source, '--target', ctx.target, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, ...env },
  });
}

function allowlistedToolPath(ctx, names) {
  const bin = path.join(ctx.root, 'allowlisted-tools');
  fs.mkdirSync(bin, { recursive: true });
  const searchPath = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    let resolved = null;
    for (const directory of searchPath) {
      const candidate = path.join(directory, name);
      try {
        if (fs.statSync(candidate).isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK);
          resolved = fs.realpathSync(candidate);
          break;
        }
      } catch (_) { /* try the next ordinary host tool */ }
    }
    assert.ok(resolved, `required fixture tool is unavailable: ${name}`);
    fs.symlinkSync(resolved, path.join(bin, name));
  }
  return bin;
}

function rulesStubPath(target) {
  return path.join(path.dirname(target), 'rules', 'dhpk-overrides.md');
}

function fileSnapshot(root) {
  if (!fs.existsSync(root)) return null;
  const files = [];
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(prefix, entry.name);
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full, relative);
      else files.push([relative, fs.readFileSync(full, 'utf8'), fs.statSync(full).mode & 0o777]);
    }
  }
  visit(root);
  return files;
}

test('dry run reports source and target without writing files', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'hooks', '--dry-run']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /DRY-RUN .*hooks\.json/);
    assert.ok(!fs.existsSync(ctx.target), 'dry-run must not create the target directory');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('real install fails before mutation when Python3 is unavailable', () => {
  const ctx = fixture();
  const tools = ['bash', 'dirname', 'find', 'cmp', 'mkdir', 'cp', 'chmod'];
  try {
    const before = fileSnapshot(ctx.target);
    const pathWithoutPython = allowlistedToolPath(ctx, tools);
    const res = install(ctx, ['--install', 'scripts'], { PATH: pathWithoutPython });
    assert.strictEqual(res.status, 2, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /python3|python|capability|unavailable/i);
    assert.deepStrictEqual(fileSnapshot(ctx.target), before,
      'missing Python must not mutate the installation target');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('dry run remains available without Python3', () => {
  const ctx = fixture();
  const tools = ['bash', 'dirname', 'find', 'cmp', 'mkdir', 'cp', 'chmod'];
  try {
    const pathWithoutPython = allowlistedToolPath(ctx, tools);
    const res = install(ctx, ['--install', 'scripts', '--dry-run'], { PATH: pathWithoutPython });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /DRY-RUN .*runner-utils\.js/);
    assert.ok(!fs.existsSync(ctx.target), 'dry-run without Python must not create the target');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('install copies selected assets and preserves executable source files', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'hooks']);
    const copied = path.join(ctx.target, 'scripts', 'hooks', 'guard.sh');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(ctx.target, 'hooks', 'hooks.json')));
    assert.ok(fs.existsSync(copied));
    assert.ok((fs.statSync(copied).mode & 0o100) !== 0, 'executable source must stay executable');
    assert.ok(!res.stdout.includes('DRY-RUN'), `real install must not print dry-run actions:\n${res.stdout}`);
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('installed hooks manifest resolves every plugin-root hook argument inside the target', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'hooks']);
    assert.strictEqual(res.status, 0, res.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(ctx.target, 'hooks', 'hooks.json'), 'utf8'));
    const hookArgs = manifest.hooks.PreToolUse.flatMap((entry) => entry.hooks.flatMap((hook) => hook.args || []));
    for (const arg of hookArgs) {
      const resolved = arg.replace('${CLAUDE_PLUGIN_ROOT}', ctx.target);
      assert.ok(fs.existsSync(resolved), `manifest target must exist: ${resolved}`);
    }
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('a conflicting target is reported without overwrite unless --force is explicit', () => {
  const ctx = fixture();
  try {
    fs.mkdirSync(path.join(ctx.target, 'rules'), { recursive: true });
    const target = path.join(ctx.target, 'rules', 'execution-policy.md');
    fs.writeFileSync(target, '# local policy\n');
    const blocked = install(ctx, ['--install', 'rules', '--vendor']);
    assert.strictEqual(blocked.status, 3, blocked.stderr);
    assert.match(blocked.stderr, /CONFLICT/);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '# local policy\n');
    const forced = install(ctx, ['--install', 'rules', '--vendor', '--force']);
    assert.strictEqual(forced.status, 0, forced.stderr);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '# policy\n');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('a symlinked destination is rejected without writing outside the selected target', () => {
  const ctx = fixture();
  try {
    const outside = path.join(ctx.root, 'outside-policy.md');
    fs.mkdirSync(path.join(ctx.target, 'rules'), { recursive: true });
    fs.writeFileSync(outside, '# outside policy\n');
    fs.symlinkSync(outside, path.join(ctx.target, 'rules', 'execution-policy.md'));
    const res = install(ctx, ['--install', 'rules', '--vendor', '--force']);
    assert.strictEqual(res.status, 4, res.stderr);
    assert.match(res.stderr, /UNSAFE SYMLINK/);
    assert.strictEqual(fs.readFileSync(outside, 'utf8'), '# outside policy\n');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('a symlinked destination ancestor is rejected before any pilot copy', () => {
  const ctx = fixture();
  const outside = path.join(ctx.root, 'outside-skills');
  try {
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(ctx.target, { recursive: true });
    const skillsTarget = path.join(ctx.target, 'skills');
    fs.symlinkSync(outside, skillsTarget, 'dir');
    const res = install(ctx, ['--install', 'scripts', '--force']);
    assert.strictEqual(res.status, 4, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /UNSAFE SYMLINK|symlink/i);
    assert.deepStrictEqual(fileSnapshot(outside), [],
      'a static symlinked ancestor must not receive pilot files');
    assert.ok(fs.lstatSync(skillsTarget).isSymbolicLink(), 'ancestor symlink must remain intact');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('an existing directory at a required file destination is rejected even with --force', () => {
  const ctx = fixture();
  try {
    fs.mkdirSync(path.join(ctx.target, 'rules', 'execution-policy.md'), { recursive: true });
    const res = install(ctx, ['--install', 'rules', '--vendor', '--force']);
    assert.strictEqual(res.status, 4, res.stderr);
    assert.match(res.stderr, /UNSAFE DESTINATION/);
    assert.ok(fs.statSync(path.join(ctx.target, 'rules', 'execution-policy.md')).isDirectory());
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--install all copies hooks and scripts and writes the rules stub', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'all']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(ctx.target, 'hooks', 'hooks.json')));
    assert.ok(fs.existsSync(rulesStubPath(ctx.target)));
    assert.ok(!fs.existsSync(path.join(ctx.target, 'rules')));
    assert.ok(fs.existsSync(path.join(ctx.target, 'scripts', 'lib', 'runner.js')));
    assert.ok(!fs.existsSync(path.join(ctx.target, 'skills', 'harness-audit', 'scripts', 'harness-audit.js')));
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--install rules writes a project-delta stub and does not vendor upstream rules', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'rules']);
    const stub = rulesStubPath(ctx.target);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(fs.existsSync(stub), `missing stub: ${stub}`);
    const body = fs.readFileSync(stub, 'utf8');
    assert.ok(Buffer.byteLength(body, 'utf8') < 2048, `stub must stay under 2 KB, got ${Buffer.byteLength(body, 'utf8')}`);
    assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/rules\//);
    assert.match(body, /Hot tables/);
    assert.match(body, /Extra reviewer trigger paths/);
    assert.match(body, /Hook profile/);
    assert.ok(!fs.existsSync(path.join(ctx.target, 'rules')), 'default rules install must not write .claude/dhpk/rules/');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--install rules leaves an edited stub unchanged on re-run', () => {
  const ctx = fixture();
  try {
    const stub = rulesStubPath(ctx.target);
    fs.mkdirSync(path.dirname(stub), { recursive: true });
    fs.writeFileSync(stub, '# edited override\n');
    const res = install(ctx, ['--install', 'rules']);
    assert.strictEqual(res.status, 3, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /CONFLICT/);
    assert.strictEqual(fs.readFileSync(stub, 'utf8'), '# edited override\n');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--install rules --vendor copies the upstream rules tree byte for byte', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'rules', '--vendor']);
    const output = `${res.stdout}\n${res.stderr}`;
    assert.strictEqual(res.status, 0, output);
    assert.match(output, /VENDOR COPY|discouraged/i);
    assert.deepStrictEqual(
      fileSnapshot(path.join(ctx.target, 'rules')),
      fileSnapshot(path.join(ctx.source, 'rules')),
    );
    assert.ok(!fs.existsSync(rulesStubPath(ctx.target)), 'vendor copy must not also write the delta stub');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--install rules stages the stub through a physical temp path even when TMPDIR is a symlink', () => {
  const ctx = fixture();
  try {
    const realTmp = path.join(ctx.root, 'real-tmp');
    const linkedTmp = path.join(ctx.root, 'linked-tmp');
    fs.mkdirSync(realTmp);
    fs.symlinkSync(realTmp, linkedTmp);
    const res = install(ctx, ['--install', 'rules'], { TMPDIR: linkedTmp });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(fs.existsSync(rulesStubPath(ctx.target)));
    assert.ok(!fs.existsSync(path.join(ctx.target, 'rules')));
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('existing vendored rules are reported as legacy and left untouched', () => {
  const ctx = fixture();
  try {
    const vendored = path.join(ctx.target, 'rules', 'execution-policy.md');
    fs.mkdirSync(path.dirname(vendored), { recursive: true });
    fs.writeFileSync(vendored, '# leftover vendor copy\n');
    const planned = install(ctx, ['--install', 'rules', '--dry-run']);
    const plannedOutput = `${planned.stdout}\n${planned.stderr}`;
    assert.strictEqual(planned.status, 0, plannedOutput);
    assert.match(plannedOutput, /LEGACY PRESERVED/);
    assert.match(plannedOutput, /dhpk-overrides\.md/);
    assert.strictEqual(fs.readFileSync(vendored, 'utf8'), '# leftover vendor copy\n');
    assert.ok(!fs.existsSync(rulesStubPath(ctx.target)), 'dry-run must not write the stub');

    const applied = install(ctx, ['--install', 'rules']);
    const appliedOutput = `${applied.stdout}\n${applied.stderr}`;
    assert.strictEqual(applied.status, 0, appliedOutput);
    assert.match(appliedOutput, /LEGACY PRESERVED/);
    assert.match(appliedOutput, /dhpk-overrides\.md/);
    assert.strictEqual(fs.readFileSync(vendored, 'utf8'), '# leftover vendor copy\n');
    assert.ok(fs.existsSync(rulesStubPath(ctx.target)));
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

for (const group of ['scripts', 'all']) {
  test(`--install ${group} copies complete Skill runner trees and local neutral helpers`, () => {
    const ctx = fixture();
    try {
      const res = install(ctx, ['--install', group]);
      assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      for (const [skill, relative] of [
        ['precommit', 'scripts/precommit-runner.js'],
        ['precommit', 'scripts/lib/runner-utils.js'],
        ['repo-verify', 'scripts/verify-runner.js'],
        ['repo-verify', 'scripts/lib/runner-utils.js'],
      ]) {
        const target = path.join(ctx.target, 'skills', skill, relative);
        assert.ok(fs.existsSync(target), `missing Skill resource: ${target}`);
      }
      assert.ok((fs.statSync(path.join(ctx.target, 'skills', 'precommit', 'scripts', 'precommit-runner.js')).mode & 0o100) !== 0);
      assert.ok((fs.statSync(path.join(ctx.target, 'skills', 'repo-verify', 'scripts', 'verify-runner.js')).mode & 0o100) !== 0);
      assert.ok(!fs.existsSync(path.join(ctx.target, 'skills', 'harness-audit')));
      assert.ok(!fs.existsSync(path.join(ctx.target, 'scripts', 'harness-audit.js')),
        'clean installation must not distribute an old root harness-audit runner shim');
    } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
  });
}

for (const group of ['scripts', 'all']) {
  test(`--install ${group} preflights every pilot resource before mutating the target`, () => {
    const ctx = fixture();
    try {
      fs.rmSync(path.join(ctx.source, 'skills', 'repo-verify', 'scripts', 'lib', 'runner-utils.js'));
      const before = fileSnapshot(ctx.target);
      const res = install(ctx, ['--install', group]);
      assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.match(`${res.stdout}\n${res.stderr}`, /missing|pilot|runner-utils/i);
      assert.deepStrictEqual(fileSnapshot(ctx.target), before, 'failed preflight must not mutate the target');
    } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
  });
}

for (const group of ['scripts', 'all']) {
  test(`--install ${group} installs retained runners without the retired harness-audit package`, () => {
    const ctx = fixture();
    try {
      fs.rmSync(path.join(ctx.source, 'skills', 'harness-audit'), { recursive: true });
      const res = install(ctx, ['--install', group]);
      assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.ok(fs.existsSync(path.join(ctx.target, 'skills', 'precommit', 'scripts', 'precommit-runner.js')));
      assert.ok(fs.existsSync(path.join(ctx.target, 'skills', 'repo-verify', 'scripts', 'verify-runner.js')));
      assert.ok(!fs.existsSync(path.join(ctx.target, 'skills', 'harness-audit')));
    } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
  });
}

test('scripts installation preserves and reports unowned legacy runner files', () => {
  const ctx = fixture();
  try {
    fs.mkdirSync(path.join(ctx.target, 'scripts'), { recursive: true });
    const legacy = {
      precommit: path.join(ctx.target, 'scripts', 'precommit-runner.js'),
      verify: path.join(ctx.target, 'scripts', 'verify-runner.js'),
    };
    fs.writeFileSync(legacy.precommit, 'consumer-owned precommit runner\n');
    fs.writeFileSync(legacy.verify, 'consumer-owned verify runner\n');
    const res = install(ctx, ['--install', 'scripts', '--force']);
    const output = `${res.stdout}\n${res.stderr}`;
    assert.match(output, /legacy|manual|preserv|unowned|old runner/i);
    assert.strictEqual(fs.readFileSync(legacy.precommit, 'utf8'), 'consumer-owned precommit runner\n');
    assert.strictEqual(fs.readFileSync(legacy.verify, 'utf8'), 'consumer-owned verify runner\n');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('scripts installation reports a pilot conflict without overwriting the target', () => {
  const ctx = fixture();
  try {
    const target = path.join(ctx.target, 'skills', 'precommit', 'scripts', 'precommit-runner.js');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'consumer-owned pilot runner\n');
    const res = install(ctx, ['--install', 'scripts']);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /CONFLICT|preserv|manual|pilot/i);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'consumer-owned pilot runner\n');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

for (const group of ['scripts', 'all']) {
  test(`${group} installation preserves an unowned legacy harness-audit runner with an actionable conflict`, () => {
    const ctx = fixture();
    try {
      const target = path.join(ctx.target, 'scripts', 'harness-audit.js');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'consumer-owned legacy harness-audit runner\n');
      const res = install(ctx, ['--install', group, '--force']);
      const output = `${res.stdout}\n${res.stderr}`;
      assert.strictEqual(res.status, 3, output);
      assert.match(output, /LEGACY CONFLICT/);
      assert.match(output, /harness-audit\.js.*manual|manual.*harness-audit\.js/i);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'consumer-owned legacy harness-audit runner\n');
    } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
  });
}

for (const component of ['leaf', 'ancestor']) {
  test(`scripts installation rejects a symlinked required pilot source ${component} before mutation`, () => {
    const ctx = fixture();
    try {
      const source = path.join(ctx.source, 'skills', 'repo-verify', 'scripts', 'lib', ...(component === 'leaf' ? ['runner-utils.js'] : []));
      const outside = path.join(ctx.root, `external-${component}`);
      fs.renameSync(source, outside);
      fs.symlinkSync(outside, source);
      const before = fileSnapshot(ctx.target);
      const res = install(ctx, ['--install', 'scripts']);
      assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.deepStrictEqual(fileSnapshot(ctx.target), before, 'source rejection must precede all target writes');
      assert.ok(fs.existsSync(outside), 'external source must remain intact');
    } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
  });
}

test('scripts installation reports leftover legacy resume helpers without blocking or deleting them', () => {
  const ctx = fixture();
  try {
    const legacyDir = path.join(ctx.target, 'scripts', 'opsx-apply-resume');
    fs.mkdirSync(legacyDir, { recursive: true });
    const helper = path.join(legacyDir, 'post-obs.sh');
    fs.writeFileSync(helper, 'consumer-edited helper\n');
    const res = install(ctx, ['--install', 'scripts']);
    const output = `${res.stdout}\n${res.stderr}`;
    assert.strictEqual(res.status, 0, output);
    assert.match(output, new RegExp(`LEGACY PRESERVED ${helper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(output, /opsx-apply-resume Skill/);
    assert.doesNotMatch(output, /LEGACY PRESERVED .*detect-phase\.sh/);
    assert.strictEqual(fs.readFileSync(helper, 'utf8'), 'consumer-edited helper\n');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

const RECEIPT_NAME = '.dhpk-asset-receipt.json';
const BACKUP_DIR = '.dhpk-asset-backups';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function setSourceVersion(ctx, version) {
  fs.writeFileSync(path.join(ctx.source, 'package.json'), `${JSON.stringify({ name: 'dhpk', version })}\n`);
}

function readReceipt(ctx) {
  return JSON.parse(fs.readFileSync(path.join(ctx.target, RECEIPT_NAME), 'utf8'));
}

function receiptDigests(receipt) {
  return Object.fromEntries(receipt.entries.map((entry) => [`${entry.anchor}:${entry.path}`, entry.sha256]));
}

function planJson(ctx, args) {
  const res = install(ctx, [...args, '--plan', '--json']);
  let report = null;
  try { report = JSON.parse(res.stdout); } catch (error) {
    assert.fail(`--plan --json stdout must be JSON (${error.message}):\n${res.stdout}\n${res.stderr}`);
  }
  return { res, report };
}

function planStates(report) {
  return Object.fromEntries(report.entries.map((entry) => [`${entry.anchor}:${entry.path}`, entry.state]));
}

function installedState(ctx) {
  return { target: fileSnapshot(ctx.target), siblingRules: fileSnapshot(path.join(path.dirname(ctx.target), 'rules')) };
}

test('install writes an Asset Receipt with the source version and SHA-256 digests of every copied asset', () => {
  const ctx = fixture();
  try {
    setSourceVersion(ctx, '1.2.3');
    const res = install(ctx, ['--install', 'all']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const receipt = readReceipt(ctx);
    assert.strictEqual(receipt.schema, 'dhpk.asset-receipt.v1');
    assert.strictEqual(receipt.source_version, '1.2.3');
    const digests = receiptDigests(receipt);
    for (const relative of [
      'hooks/hooks.json',
      'scripts/hooks/guard.sh',
      'scripts/lib/runner.js',
      'skills/precommit/scripts/precommit-runner.js',
      'skills/repo-verify/scripts/lib/runner-utils.js',
    ]) {
      assert.strictEqual(digests[`target:${relative}`], sha256(path.join(ctx.target, relative)), relative);
    }
    assert.strictEqual(digests['target-parent:rules/dhpk-overrides.md'], sha256(rulesStubPath(ctx.target)),
      'the sibling rule-override stub must be receipt-owned');
    assert.strictEqual(Object.keys(digests).length, receipt.entries.length, 'receipt entries must be unique');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--plan --json classifies every target path in four states without writing', () => {
  const ctx = fixture();
  try {
    setSourceVersion(ctx, '1.0.0');
    assert.strictEqual(install(ctx, ['--install', 'rules', '--vendor']).status, 0);
    fs.writeFileSync(path.join(ctx.target, 'rules', 'tool-routing.md'), '# routing, edited locally\n');
    fs.writeFileSync(path.join(ctx.target, 'rules', 'review.md'), '# consumer review notes\n');
    setSourceVersion(ctx, '1.1.0');
    fs.writeFileSync(path.join(ctx.source, 'rules', 'execution-policy.md'), '# policy v2\n');
    fs.writeFileSync(path.join(ctx.source, 'rules', 'tool-routing.md'), '# routing v2\n');
    fs.writeFileSync(path.join(ctx.source, 'rules', 'review.md'), '# review v2\n');
    fs.writeFileSync(path.join(ctx.source, 'rules', 'new-rule.md'), '# brand new\n');
    fs.writeFileSync(path.join(ctx.source, 'rules', 'stable.md'), '# stable\n');
    fs.writeFileSync(path.join(ctx.target, 'rules', 'stable.md'), '# stable\n');
    const before = installedState(ctx);

    const { res, report } = planJson(ctx, ['--install', 'rules', '--vendor']);
    assert.strictEqual(res.status, 3, `${res.stdout}\n${res.stderr}`);
    assert.deepStrictEqual(installedState(ctx), before, '--plan --json must not write');
    assert.strictEqual(report.schema, 'dhpk.asset-plan.v1');
    assert.strictEqual(report.source_version, '1.1.0');
    assert.strictEqual(report.receipt.source_version, '1.0.0');
    assert.deepStrictEqual(planStates(report), {
      'target:rules/execution-policy.md': 'updatable',
      'target:rules/new-rule.md': 'updatable',
      'target:rules/review.md': 'unmanaged-existing',
      'target:rules/stable.md': 'unchanged',
      'target:rules/tool-routing.md': 'user-modified',
    });
    assert.deepStrictEqual(report.summary, { updatable: 2, unchanged: 1, 'user-modified': 1, 'unmanaged-existing': 1 });
    assert.strictEqual(report.verdict, 'CONFLICT');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('a receipt-owned unchanged snapshot updates without --force while user edits stay protected', () => {
  const ctx = fixture();
  try {
    setSourceVersion(ctx, '1.0.0');
    assert.strictEqual(install(ctx, ['--install', 'hooks']).status, 0);
    const guard = path.join(ctx.target, 'scripts', 'hooks', 'guard.sh');
    const manifest = path.join(ctx.target, 'hooks', 'hooks.json');
    setSourceVersion(ctx, '1.1.0');
    fs.writeFileSync(path.join(ctx.source, 'scripts', 'hooks', 'guard.sh'), '#!/usr/bin/env bash\necho guard v2\n');

    const updated = install(ctx, ['--install', 'hooks']);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.strictEqual(fs.readFileSync(guard, 'utf8'), '#!/usr/bin/env bash\necho guard v2\n');
    assert.strictEqual(readReceipt(ctx).source_version, '1.1.0');
    assert.strictEqual(receiptDigests(readReceipt(ctx))['target:scripts/hooks/guard.sh'], sha256(guard));

    fs.writeFileSync(manifest, '{"hooks":{}}\n');
    fs.writeFileSync(path.join(ctx.source, 'scripts', 'hooks', 'guard.sh'), '#!/usr/bin/env bash\necho guard v3\n');
    const receiptBefore = fs.readFileSync(path.join(ctx.target, RECEIPT_NAME), 'utf8');
    const blocked = install(ctx, ['--install', 'hooks']);
    assert.strictEqual(blocked.status, 3, `${blocked.stdout}\n${blocked.stderr}`);
    assert.match(blocked.stderr, /CONFLICT .*hooks\.json.*user-modified/);
    assert.strictEqual(fs.readFileSync(manifest, 'utf8'), '{"hooks":{}}\n', 'user edit must be preserved');
    assert.strictEqual(fs.readFileSync(guard, 'utf8'), '#!/usr/bin/env bash\necho guard v2\n',
      'a blocked run must not update other files');
    assert.strictEqual(fs.readFileSync(path.join(ctx.target, RECEIPT_NAME), 'utf8'), receiptBefore);
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('first upgrade of a pre-receipt snapshot adopts identical files and fails closed on differing ones', () => {
  const ctx = fixture();
  try {
    setSourceVersion(ctx, '2.0.0');
    fs.mkdirSync(path.join(ctx.target, 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(ctx.target, 'scripts', 'hooks'), { recursive: true });
    fs.copyFileSync(path.join(ctx.source, 'hooks', 'hooks.json'), path.join(ctx.target, 'hooks', 'hooks.json'));
    const guard = path.join(ctx.target, 'scripts', 'hooks', 'guard.sh');
    fs.writeFileSync(guard, '#!/usr/bin/env bash\necho older snapshot\n');

    const { res: planned, report } = planJson(ctx, ['--install', 'hooks']);
    assert.strictEqual(planned.status, 3, `${planned.stdout}\n${planned.stderr}`);
    assert.strictEqual(report.receipt.state, 'absent');
    assert.deepStrictEqual(planStates(report), {
      'target:hooks/hooks.json': 'unchanged',
      'target:scripts/hooks/guard.sh': 'unmanaged-existing',
    });
    assert.ok(!fs.existsSync(path.join(ctx.target, RECEIPT_NAME)), 'plan must not adopt');

    const applied = install(ctx, ['--install', 'hooks']);
    assert.strictEqual(applied.status, 3, `${applied.stdout}\n${applied.stderr}`);
    assert.match(applied.stderr, /CONFLICT .*guard\.sh.*unmanaged-existing/);
    assert.strictEqual(fs.readFileSync(guard, 'utf8'), '#!/usr/bin/env bash\necho older snapshot\n');
    const receipt = readReceipt(ctx);
    assert.deepStrictEqual(receiptDigests(receipt), {
      'target:hooks/hooks.json': sha256(path.join(ctx.source, 'hooks', 'hooks.json')),
    });
    assert.ok(!fs.existsSync(path.join(ctx.target, BACKUP_DIR)), 'fail-closed adoption must not create backups');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--force saves a timestamped backup inside the target before overwriting differing files', () => {
  const ctx = fixture();
  try {
    setSourceVersion(ctx, '3.0.0');
    const policy = path.join(ctx.target, 'rules', 'execution-policy.md');
    fs.mkdirSync(path.dirname(policy), { recursive: true });
    fs.writeFileSync(policy, '# local policy\n');
    const stub = rulesStubPath(ctx.target);
    fs.mkdirSync(path.dirname(stub), { recursive: true });
    fs.writeFileSync(stub, '# edited override\n');

    const forcedVendor = install(ctx, ['--install', 'rules', '--vendor', '--force']);
    assert.strictEqual(forcedVendor.status, 0, `${forcedVendor.stdout}\n${forcedVendor.stderr}`);
    const backups = fs.readdirSync(path.join(ctx.target, BACKUP_DIR));
    assert.strictEqual(backups.length, 1, `expected one backup run: ${backups}`);
    assert.match(backups[0], /^\d{8}T\d{6}Z/);
    const backupRoot = path.join(ctx.target, BACKUP_DIR, backups[0]);
    assert.ok(forcedVendor.stdout.includes(`BACKUP ${backupRoot}`), forcedVendor.stdout);
    assert.strictEqual(fs.readFileSync(path.join(backupRoot, 'target', 'rules', 'execution-policy.md'), 'utf8'), '# local policy\n');
    assert.ok(!fs.existsSync(path.join(backupRoot, 'target', 'rules', 'tool-routing.md')),
      'only overwritten differing files are backed up');
    assert.strictEqual(fs.readFileSync(policy, 'utf8'), '# policy\n');

    const forcedStub = install(ctx, ['--install', 'rules', '--force']);
    assert.strictEqual(forcedStub.status, 0, `${forcedStub.stdout}\n${forcedStub.stderr}`);
    const stubBackups = fs.readdirSync(path.join(ctx.target, BACKUP_DIR)).filter((name) => name !== backups[0]);
    assert.strictEqual(stubBackups.length, 1, `expected a second backup run: ${stubBackups}`);
    assert.strictEqual(
      fs.readFileSync(path.join(ctx.target, BACKUP_DIR, stubBackups[0], 'target-parent', 'rules', 'dhpk-overrides.md'), 'utf8'),
      '# edited override\n',
    );
    assert.match(fs.readFileSync(stub, 'utf8'), /dhpk execution-policy overrides/);
    assert.strictEqual(receiptDigests(readReceipt(ctx))['target-parent:rules/dhpk-overrides.md'], sha256(stub));
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--plan --json reports a structured blocker when Python3 is unavailable', () => {
  const ctx = fixture();
  try {
    const tools = ['bash', 'dirname', 'find', 'cmp', 'mkdir', 'cp', 'chmod'];
    const res = install(ctx, ['--install', 'hooks', '--plan', '--json'], { PATH: allowlistedToolPath(ctx, tools) });
    assert.strictEqual(res.status, 2, `${res.stdout}\n${res.stderr}`);
    const report = JSON.parse(res.stdout);
    assert.strictEqual(report.verdict, 'BLOCKED');
    assert.strictEqual(report.reasonCode, 'PYTHON_UNAVAILABLE');
    assert.ok(!fs.existsSync(ctx.target));
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--json without --plan is a usage error', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'hooks', '--json']);
    assert.strictEqual(res.status, 64, `${res.stdout}\n${res.stderr}`);
    assert.ok(!fs.existsSync(ctx.target));
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

run('setup-install-assets');
