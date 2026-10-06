'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const distribution = require('../scripts/lib/dhpk-distribution');
const { resolveCapabilitySelection } = require('../scripts/lib/capability-bundle-selection');
const agentPackage = require('../scripts/lib/agent-plugin-package');
const cursorPackage = require('../scripts/lib/cursor-plugin-package');
const codexPackage = require('../scripts/lib/codex-native-package');
const agyPackage = require('../scripts/lib/agy-plugin-package');
const { createPreviewSourceSnapshot } = require('../scripts/lib/distribution-preview');

const ROOT = path.join(__dirname, '..');
const SURFACES = ['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin'];

function invoke(args, cwd = ROOT) {
  return spawnSync('bash', [path.join(cwd, 'bin', 'dhpk'), 'distribution', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function withTmpdirSymlinkAlias(callback) {
  const originalTmpdir = os.tmpdir;
  const hadTmpdirEnvironment = Object.prototype.hasOwnProperty.call(process.env, 'TMPDIR');
  const originalTmpdirEnvironment = process.env.TMPDIR;
  const physicalTmp = fs.realpathSync(originalTmpdir());
  const aliasRoot = fs.mkdtempSync(path.join(physicalTmp, 'dhpk-distribution-tmp-alias-'));
  const alias = path.join(aliasRoot, 'tmp');
  fs.symlinkSync(physicalTmp, alias, 'dir');
  os.tmpdir = () => alias;
  process.env.TMPDIR = alias;
  try {
    return callback({ physicalTmp, alias });
  } finally {
    if (hadTmpdirEnvironment) process.env.TMPDIR = originalTmpdirEnvironment;
    else delete process.env.TMPDIR;
    os.tmpdir = originalTmpdir;
    fs.rmSync(aliasRoot, { recursive: true, force: true });
  }
}

function withCleanWorktree(callback) {
  const worktreeParent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-distribution-clean-'));
  const worktreeRoot = path.join(worktreeParent, 'checkout');
  let worktreeAdded = false;
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktreeRoot, 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worktreeAdded = true;
    return callback(worktreeRoot);
  } finally {
    if (worktreeAdded) {
      execFileSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    fs.rmSync(worktreeParent, { recursive: true, force: true });
  }
}

function report(result) {
  return JSON.parse(result.stdout);
}

test('rejects an unknown retained surface before any package operation runs', () => {
  const result = invoke(['unknown-plugin', 'validate']);
  assert.strictEqual(result.status, 64);
  assert.match(result.stderr, /unknown surface/i);
});

test('rejects missing option values as usage instead of silently using defaults', () => {
  for (const args of [
    ['agy-plugin', 'validate', '--output', '--json'],
    ['agy-plugin', 'validate', '--output='],
    ['agy-plugin', 'validate', '--version='],
  ]) {
    const result = invoke(args);
    assert.strictEqual(result.status, 64, result.stderr);
    assert.match(result.stderr, /option value is required/i);
  }
});

test('distribution parser keeps standalone selection separate from additive overlays', () => {
  const parsed = distribution.parseRequest([
    'agent-plugin', 'validate', '--standalone', 'flow-guide', '--standalone=flow-guide', '--json',
  ]);
  assert.strictEqual(parsed.ok, true, parsed.error);
  assert.deepStrictEqual(parsed.options.standaloneSkillIds, ['flow-guide']);
  assert.deepStrictEqual(parsed.options.skillIds, []);
  assert.strictEqual(Object.hasOwn(parsed.options, 'profileId'), false);
  const mixed = distribution.parseRequest(['agent-plugin', 'validate', '--standalone', 'flow-guide', '--skill', 'tdd']);
  assert.strictEqual(mixed.ok, false);
  assert.match(mixed.error, /cannot be combined/i);
});

test('rejects every public profile selector before package generation can write output', () => {
  const retiredSelectors = [
    ['--profile', 'minimal'],
    ['--profile=full'],
    ['--profile', 'compat-v1'],
    ['--profile=common'],
  ];
  for (const surface of [...SURFACES, 'openai-submission']) {
    for (const selector of retiredSelectors) {
      const operation = surface === 'openai-submission' ? 'validate' : 'generate';
      const parsed = distribution.parseRequest([surface, operation, ...selector]);
      assert.strictEqual(parsed.ok, false, `${surface} ${selector.join(' ')}`);
      assert.strictEqual(parsed.status, 64);
      assert.match(parsed.error, /--profile.*(retired|unsupported|no longer)/i);
    }
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-distribution-profile-option-'));
  const output = path.join(temporaryRoot, 'package');
  try {
    const result = invoke(['agy-plugin', 'generate', '--output', output, '--profile', 'full', '--json']);
    assert.strictEqual(result.status, 64, result.stderr);
    assert.match(result.stderr, /--profile.*(retired|unsupported|no longer)/i);
    assert.strictEqual(fs.existsSync(output), false, 'a rejected profile selector must not materialize a package');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects preview for the formal OpenAI submission surface', () => {
  const parsed = distribution.parseRequest(['openai-submission', 'preview']);
  assert.strictEqual(parsed.ok, false);
  assert.strictEqual(parsed.status, 64);
  assert.match(parsed.error, /only for agent-plugin/i);
});

test('validates every retained package surface through one JSON command contract', () => {
  for (const surface of SURFACES) {
    const result = invoke([surface, 'validate', '--json']);
    assert.strictEqual(result.status, 0, `${surface}: ${result.stderr}`);
    const payload = report(result);
    assert.strictEqual(payload.surface, surface);
    assert.strictEqual(payload.operation, 'validate');
    assert.strictEqual(payload.verdict, 'PASS', JSON.stringify(payload));
  }
});

test('new distribution previews use the common collection by default', () => {
  const result = invoke(['agent-plugin', 'preview', '--json']);
  assert.strictEqual(result.status, 0, result.stderr);
  const output = report(result).output;
  try {
    const receipt = JSON.parse(fs.readFileSync(path.join(output, 'provenance.json'), 'utf8'));
    assert.strictEqual(receipt.profileId, 'common');
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('generates a disposable AGY package and validates that exact output', () => {
  withTmpdirSymlinkAlias(() => {
    const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-distribution-cli-'));
    const outDir = path.join(temporaryRoot, 'agy-package');
    try {
      withCleanWorktree((worktreeRoot) => {
        const generated = invoke(['agy-plugin', 'generate', '--output', outDir, '--version', '0.42.2', '--json'], worktreeRoot);
        assert.strictEqual(generated.status, 0, generated.stderr);
        assert.strictEqual(report(generated).verdict, 'PASS');
        assert.ok(fs.existsSync(path.join(outDir, 'plugin.json')));
        assert.strictEqual(fs.realpathSync(outDir), outDir);

        const validated = invoke(['agy-plugin', 'validate', '--output', outDir, '--version', '0.42.2', '--json'], worktreeRoot);
        assert.strictEqual(validated.status, 0, validated.stderr);
        assert.strictEqual(report(validated).verdict, 'PASS');
      });
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});

test('accepts a symlinked os.tmpdir alias but rejects a symlinked AGY output', () => {
  withTmpdirSymlinkAlias(({ physicalTmp }) => {
    const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-distribution-alias-'));
    const outDir = path.join(temporaryRoot, 'agy-package');
    const foreignRoot = fs.mkdtempSync(path.join(physicalTmp, 'dhpk-distribution-foreign-target-'));
    const foreignOut = path.join(temporaryRoot, 'foreign-package');
    fs.symlinkSync(foreignRoot, foreignOut, 'dir');
    try {
      assert.strictEqual(fs.realpathSync(foreignOut), foreignRoot);
      withCleanWorktree((worktreeRoot) => {
        const generated = invoke(['agy-plugin', 'generate', '--output', outDir, '--version', '0.42.2', '--json'], worktreeRoot);
        assert.strictEqual(generated.status, 0, generated.stderr);
        assert.ok(fs.existsSync(path.join(outDir, 'plugin.json')));

        const rejected = invoke(['agy-plugin', 'generate', '--output', foreignOut, '--version', '0.42.2', '--json'], worktreeRoot);
        assert.strictEqual(rejected.status, 1, rejected.stderr);
        assert.match(rejected.stderr, /foreign output|physical package directory/i);
        assert.strictEqual(fs.existsSync(path.join(foreignRoot, 'plugin.json')), false);
      });
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
      fs.rmSync(foreignRoot, { recursive: true, force: true });
    }
  });
});

test('rejects provenance-bound generation from a dirty source checkout before writing output', () => {
  const worktreeParent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-distribution-dirty-'));
  const worktreeRoot = path.join(worktreeParent, 'checkout');
  const outDir = path.join(worktreeParent, 'agent-package');
  let worktreeAdded = false;
  const marker = path.join(worktreeRoot, `.issue-237-dirty-source-${process.pid}`);
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktreeRoot, 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worktreeAdded = true;
    fs.writeFileSync(marker, 'uncommitted source input\n');
    const result = spawnSync('bash', [path.join(worktreeRoot, 'bin', 'dhpk'), 'distribution', 'agent-plugin', 'generate', '--output', outDir, '--json'], {
      cwd: worktreeRoot,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /source checkout must be clean/i);
    assert.strictEqual(fs.existsSync(outDir), false, 'dirty generation must abort before materializing output');
  } finally {
    fs.rmSync(marker, { force: true });
    if (worktreeAdded) {
      execFileSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    fs.rmSync(worktreeParent, { recursive: true, force: true });
  }
});

test('previews dirty source bytes without changing Git state and formal validation rejects the preview', () => {
  withCleanWorktree((worktreeRoot) => {
    const changed = path.join(worktreeRoot, 'CONTEXT.md');
    const added = path.join(worktreeRoot, 'skills', 'flow-guide', 'assets', 'preview-resource.txt');
    const link = path.join(worktreeRoot, 'docs', 'preview-contained-link');
    const originalMode = fs.statSync(changed).mode & 0o7777;
    let output = null;
    try {
      fs.appendFileSync(changed, 'preview source change\n');
      fs.mkdirSync(path.dirname(added), { recursive: true });
      fs.writeFileSync(added, 'relocatable preview resource\n');
      fs.symlinkSync('../SKILL.md', link);
      fs.chmodSync(changed, 0o600);
      const before = {
      status: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '-z'], { cwd: worktreeRoot, encoding: 'buffer' }),
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreeRoot, encoding: 'utf8' }),
      index: execFileSync('git', ['diff', '--cached', '--binary'], { cwd: worktreeRoot, encoding: 'buffer' }),
      indexBytes: fs.readFileSync(execFileSync('git', ['rev-parse', '--git-path', 'index'], { cwd: worktreeRoot, encoding: 'utf8' }).trim()),
      refs: execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: worktreeRoot, encoding: 'utf8' }),
      config: execFileSync('git', ['config', '--local', '--null', '--list'], { cwd: worktreeRoot, encoding: 'buffer' }),
    };
      const generated = invoke(['agent-plugin', 'preview', '--json'], worktreeRoot);
    assert.strictEqual(generated.status, 0, generated.stderr);
    assert.strictEqual(report(generated).verdict, 'PASS');
    output = report(generated).output;
    const receipt = JSON.parse(fs.readFileSync(path.join(output, 'provenance.json'), 'utf8'));
    assert.strictEqual(receipt.publicationMode, 'preview');
    assert.strictEqual(receipt.releaseEligible, false);
    assert.ok(receipt.origin.changeCounts.added >= 2);
    assert.ok(receipt.origin.changeCounts.modified >= 1);
    assert.ok(receipt.origin.changeCounts.bytes > 0);
    assert.strictEqual(fs.readFileSync(path.join(output, 'skills', 'flow-guide', 'assets', 'preview-resource.txt'), 'utf8'), 'relocatable preview resource\n');
    const formal = invoke(['agent-plugin', 'validate', '--output', output, '--json'], worktreeRoot);
    assert.strictEqual(formal.status, 1, formal.stdout);
    assert.match(report(formal).errors.join('\n'), /preview/i);
    assert.deepStrictEqual(execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '-z'], { cwd: worktreeRoot, encoding: 'buffer' }), before.status);
    assert.strictEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreeRoot, encoding: 'utf8' }), before.head);
    assert.deepStrictEqual(execFileSync('git', ['diff', '--cached', '--binary'], { cwd: worktreeRoot, encoding: 'buffer' }), before.index);
    assert.deepStrictEqual(fs.readFileSync(execFileSync('git', ['rev-parse', '--git-path', 'index'], { cwd: worktreeRoot, encoding: 'utf8' }).trim()), before.indexBytes);
    assert.strictEqual(execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: worktreeRoot, encoding: 'utf8' }), before.refs);
    assert.deepStrictEqual(execFileSync('git', ['config', '--local', '--null', '--list'], { cwd: worktreeRoot, encoding: 'buffer' }), before.config);
    } finally {
      fs.rmSync(added, { force: true });
      fs.rmSync(link, { force: true });
      if (typeof output === 'string') fs.rmSync(output, { recursive: true, force: true });
    }
  });
});

test('preview rejects a source symlink that escapes the disposable snapshot', () => {
  withCleanWorktree((worktreeRoot) => {
    const link = path.join(worktreeRoot, 'skills', 'flow-guide', 'assets', 'preview-escape-link');
    try {
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync('/tmp', link);
      const rejected = invoke(['agent-plugin', 'preview', '--json'], worktreeRoot);
      assert.strictEqual(rejected.status, 1, rejected.stdout);
      assert.match(rejected.stderr, /symlink escapes snapshot root/i);
    } finally {
      fs.rmSync(link, { force: true });
    }
  });
});

test('preview refuses an output path inside the source checkout', () => {
  const output = path.join(ROOT, `.dhpk-preview-output-${process.pid}`);
  const rejected = invoke(['agent-plugin', 'preview', '--output', output, '--json']);
  assert.strictEqual(rejected.status, 64, rejected.stdout);
  assert.match(rejected.stderr, /does not accept --output/i);
  assert.strictEqual(fs.existsSync(output), false);
});

test('preview snapshot retains tracked files that match ignore rules', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-preview-tracked-ignored-')));
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'tracked-ignored.txt\n');
    fs.writeFileSync(path.join(root, 'tracked-ignored.txt'), 'base bytes\n');
    const binaryPath = path.join(root, 'tracked-binary.bin');
    fs.writeFileSync(binaryPath, Buffer.alloc(2 * 1024 * 1024, 0x41));
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Preview Test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'preview-test@example.invalid'], { cwd: root });
    execFileSync('git', ['add', '-f', '.gitignore', 'tracked-ignored.txt', 'tracked-binary.bin'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
    fs.writeFileSync(path.join(root, 'tracked-ignored.txt'), 'preview bytes\n');
    fs.writeFileSync(binaryPath, Buffer.alloc(2 * 1024 * 1024, 0xB2));
    const snapshot = createPreviewSourceSnapshot(root);
    try {
      assert.strictEqual(fs.readFileSync(path.join(snapshot.root, 'tracked-ignored.txt'), 'utf8'), 'preview bytes\n');
      assert.deepStrictEqual(fs.readFileSync(path.join(snapshot.root, 'tracked-binary.bin')), Buffer.alloc(2 * 1024 * 1024, 0xB2));
      assert.match(execFileSync('git', ['ls-files', '--error-unmatch', 'tracked-ignored.txt'], { cwd: snapshot.root, encoding: 'utf8' }), /tracked-ignored\.txt/);
    } finally {
      snapshot.cleanup();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validate and verify still run on a dirty checkout because they do not write provenance', () => {
  const worktreeParent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-distribution-dirty-read-'));
  const worktreeRoot = path.join(worktreeParent, 'checkout');
  let worktreeAdded = false;
  const marker = path.join(worktreeRoot, `.issue-237-dirty-source-read-${process.pid}`);
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktreeRoot, 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worktreeAdded = true;
    fs.writeFileSync(marker, 'uncommitted source input\n');
    for (const operation of ['validate', 'verify']) {
      const result = spawnSync('bash', [
        path.join(worktreeRoot, 'bin', 'dhpk'),
        'distribution',
        'agent-plugin',
        operation,
        '--json',
      ], {
        cwd: worktreeRoot,
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.strictEqual(result.status, 0, `${operation}: ${result.stderr}`);
      assert.strictEqual(JSON.parse(result.stdout).verdict, 'PASS', `${operation}: ${result.stdout}`);
    }
  } finally {
    fs.rmSync(marker, { force: true });
    if (worktreeAdded) {
      execFileSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    fs.rmSync(worktreeParent, { recursive: true, force: true });
  }
});

test('refuses to replace a foreign output directory before package materialization', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-distribution-foreign-'));
  const outDir = path.join(temporaryRoot, 'foreign-package');
  fs.mkdirSync(outDir);
  const sentinel = path.join(outDir, 'user-owned.txt');
  fs.writeFileSync(sentinel, 'preserve me');
  try {
    withCleanWorktree((worktreeRoot) => {
      const result = invoke(['agent-plugin', 'generate', '--output', outDir, '--json'], worktreeRoot);
      assert.strictEqual(result.status, 1, result.stderr);
      assert.match(result.stderr, /owner receipt|foreign output/i);
      assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'preserve me');
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('standalone flow-guide materializes its declared dependency closure on every native surface', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const expected = [
    'rules/execution-policy-kernel.md',
    'rules/execution-policy.md',
    'scripts/lib/flow-handoff-contract.js',
  ];
  const physicalTmp = fs.realpathSync(os.tmpdir());
  const temporaryRoot = fs.mkdtempSync(path.join(physicalTmp, 'dhpk-standalone-surfaces-'));
  const sourceCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  try {
    const compileCases = [
      ['agent-plugin', agentPackage.compileAgentPluginPackage],
      ['cursor-plugin', cursorPackage.compileCursorPackage],
      ['codex-native', codexPackage.compileNativePackage],
    ];
    for (const [surface, compile] of compileCases) {
      const selection = resolveCapabilitySelection({ inventory, surface, standaloneSkillIds: ['flow-guide'] });
      assert.strictEqual(selection.ok, true, `${surface}: ${selection.error && selection.error.message}`);
      const compiled = compile({
        root: ROOT,
        outDir: path.join(temporaryRoot, surface),
        inventory,
        profileSelection: selection.value,
      });
      const destinations = new Set(compiled.plan.entries.map((entry) => entry.destination));
      for (const relative of expected) assert.ok(destinations.has(relative), `${surface} is missing ${relative}`);
    }

    const agySelection = resolveCapabilitySelection({ inventory, surface: 'agy-plugin', standaloneSkillIds: ['flow-guide'] });
    assert.strictEqual(agySelection.ok, true, agySelection.error && agySelection.error.message);
    const agyRoot = path.join(temporaryRoot, 'agy-plugin');
    const agy = agyPackage.materializeAgyPluginPackage({
      root: ROOT,
      inventory,
      outDir: agyRoot,
      sourceCommit,
      profileSelection: agySelection.value,
    });
    for (const relative of expected) assert.ok(agy.files.includes(relative), `agy-plugin is missing ${relative}`);
    assert.strictEqual(agyPackage.validateAgyPluginPackage(agyRoot, {
      inventory,
      profileSelection: agySelection.value,
    }).ok, true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('keeps structural validation separate from evidence-bound verification', () => {
  withCleanWorktree((worktreeRoot) => {
    for (const surface of SURFACES) {
      const result = invoke([surface, 'verify', '--json'], worktreeRoot);
      assert.strictEqual(result.status, 0, `${surface}: ${result.stderr}`);
      const payload = report(result);
      assert.strictEqual(payload.operation, 'verify');
      assert.strictEqual(payload.verdict, 'PASS', JSON.stringify(payload));
      assert.ok(payload.evidence, `${surface} must return verification evidence`);
      if (surface === 'codex-native') assert.strictEqual(payload.deterministic, 'PASS', JSON.stringify(payload));
    }
  });
});

// v1 GREEN contract (tests above): distribution CLI validate/generate/verify
// for retained surfaces, foreign-output refusal, evidence-bound verify.
// v2 GREEN contract: required_core includes `flow-drive` and validators must
// not keep an exact-nine count literal. See tests/dhpk-do-portable.test.js [5.1].

test('minimal required_core includes flow-drive without an exact-nine count literal', () => {
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    'utf8',
  ));
  const core = inventory.profile_policy.required_core_ids;
  assert.ok(Array.isArray(core), 'profile_policy.required_core_ids must be an array');
  assert.ok(core.includes('flow-drive'), "minimal required_core_ids must include stable id 'flow-drive'");
  const validator = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'distribution-inventory.js'), 'utf8');
  assert.doesNotMatch(validator, /length !== 9/);
  assert.doesNotMatch(validator, /exactly nine/);
  const installerSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), 'utf8');
  assert.doesNotMatch(installerSrc, /!= 9/);
  assert.doesNotMatch(installerSrc, /exactly nine/i);
  assert.doesNotMatch(installerSrc, /exactly the nine/);
});

run('dhpk-distribution');
