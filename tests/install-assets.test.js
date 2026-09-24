'use strict';

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
    assert.ok(fs.existsSync(path.join(ctx.target, 'skills', 'harness-audit', 'scripts', 'harness-audit.js')));
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
        ['harness-audit', 'scripts/harness-audit.js'],
      ]) {
        const target = path.join(ctx.target, 'skills', skill, relative);
        assert.ok(fs.existsSync(target), `missing Skill resource: ${target}`);
      }
      assert.ok((fs.statSync(path.join(ctx.target, 'skills', 'precommit', 'scripts', 'precommit-runner.js')).mode & 0o100) !== 0);
      assert.ok((fs.statSync(path.join(ctx.target, 'skills', 'repo-verify', 'scripts', 'verify-runner.js')).mode & 0o100) !== 0);
      assert.ok((fs.statSync(path.join(ctx.target, 'skills', 'harness-audit', 'scripts', 'harness-audit.js')).mode & 0o100) !== 0);
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
  test(`--install ${group} preflights the required harness-audit runner before mutation`, () => {
    const ctx = fixture();
    try {
      fs.rmSync(path.join(ctx.source, 'skills', 'harness-audit', 'scripts', 'harness-audit.js'));
      const before = fileSnapshot(ctx.target);
      const res = install(ctx, ['--install', group]);
      assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.match(`${res.stdout}\n${res.stderr}`, /missing|required|harness-audit/i);
      assert.deepStrictEqual(fileSnapshot(ctx.target), before,
        'missing required harness-audit runner must not mutate the target');
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

run('setup-install-assets');
