'use strict';

// Receipt-aware pilot migration fixtures deliberately run the supported
// installer twice.  The first package is the historical physical layout (an
// old helper plus the retired per-Skill skill-package.json descriptor); the
// second package is the self-contained Skill without a descriptor.  Receipts
// are always produced by install-codex-skills.sh itself.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ROOT,
  runInstaller,
  projectRoot,
  copyDistributionInventory,
  completeTreeFingerprint,
  materializationFailureShim,
  materializeFixtureSkill,
} = require('./_lib/install-codex-skills-fixtures');

const PILOTS = [
  ['precommit', 'precommit-runner.js'],
  ['repo-verify', 'verify-runner.js'],
];

const CANONICAL_PILOT_PATHS = [
  path.join(ROOT, 'skills', 'precommit'),
  path.join(ROOT, 'skills', 'repo-verify'),
  path.join(ROOT, 'scripts', 'precommit-runner.js'),
  path.join(ROOT, 'scripts', 'verify-runner.js'),
  path.join(ROOT, 'scripts', 'lib', 'utils.js'),
  path.join(ROOT, 'scripts', 'lib', 'runner-utils.js'),
];
const CANONICAL_PILOT_FINGERPRINTS = new Map(
  CANONICAL_PILOT_PATHS.map((candidate) => [candidate, canonicalFingerprint(candidate)]),
);

function canonicalFingerprint(candidate) {
  try { fs.lstatSync(candidate); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return completeTreeFingerprint(candidate);
}

const HISTORICAL_RUNNERS = {
  'precommit-runner.js': '#!/usr/bin/env node\nconst { oldHelper } = require(\'./lib/utils\');\nconsole.log(`precommit old ${oldHelper()}`);\n',
  'verify-runner.js': '#!/usr/bin/env node\nconst { oldHelper } = require(\'./lib/utils\');\nconsole.log(`repo-verify old ${oldHelper()}`);\n',
};
const HISTORICAL_UTILS = 'module.exports = { oldHelper: () => "fixture" };\n';

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertContained(candidate, root, label) {
  const rootReal = fs.realpathSync(root);
  const candidateReal = fs.realpathSync(candidate);
  const relative = path.relative(rootReal, candidateReal);
  assert.ok(
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${label} escaped fixture root: ${candidateReal}`,
  );
}

function assertCanonicalPilotSourcesUnchanged() {
  for (const [candidate, fingerprint] of CANONICAL_PILOT_FINGERPRINTS) {
    assert.strictEqual(
      canonicalFingerprint(candidate),
      fingerprint,
      `canonical pilot source changed: ${candidate}`,
    );
  }
}

function makeHistoricalPilotPlugin() {
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pilot-history-')));
  fs.cpSync(path.join(ROOT, 'codex'), path.join(plugin, 'codex'), {
    recursive: true,
    dereference: true,
  });

  // cpSync does not reliably dereference links nested below codex/skills on
  // every supported Node release. Materialize before touching any Skill
  // metadata so a fixture write can never reach the canonical checkout.
  for (const [skill] of PILOTS) {
    materializeFixtureSkill(plugin, skill);
    const skillRoot = path.join(plugin, 'codex', 'skills', skill);
    assertContained(skillRoot, plugin, `fixture Skill ${skill}`);
  }

  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, '.claude-plugin', 'plugin.json'),
    path.join(plugin, '.claude-plugin', 'plugin.json'),
  );
  copyDistributionInventory(plugin);

  // Historical installs materialized the old helper and the retired
  // descriptor physically inside each Skill.  No receipt is written here.
  for (const [skill, runner] of PILOTS) {
    const skillRoot = path.join(plugin, 'codex', 'skills', skill);
    fs.rmSync(path.join(skillRoot, 'scripts'), { recursive: true, force: true });
    fs.mkdirSync(path.join(skillRoot, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'scripts', runner), HISTORICAL_RUNNERS[runner], { mode: 0o755 });
    fs.chmodSync(path.join(skillRoot, 'scripts', runner), 0o755);
    fs.writeFileSync(path.join(skillRoot, 'scripts', 'lib', 'utils.js'), HISTORICAL_UTILS);
    writeJson(path.join(skillRoot, 'skill-package.json'), {
      schema: 'dhpk.skill-package.v1',
      id: skill,
      version: '1.0.0',
      entry: 'SKILL.md',
      resources: [
        { path: 'SKILL.md', kind: 'entry', required: true },
        { path: `scripts/${runner}`, kind: 'runtime', required: true },
        { path: 'scripts/lib/utils.js', kind: 'runtime', required: true },
      ],
    });
  }
  return plugin;
}

function publishSelfContainedPilot(plugin) {
  for (const [skill, runner] of PILOTS) {
    const skillRoot = path.join(plugin, 'codex', 'skills', skill);
    fs.rmSync(path.join(skillRoot, 'skill-package.json'), { force: true });
    const scripts = path.join(skillRoot, 'scripts');
    fs.rmSync(scripts, { recursive: true, force: true });
    fs.mkdirSync(path.join(scripts, 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(scripts, runner),
      `#!/usr/bin/env node\nrequire('./lib/runner-utils');\nconsole.log('${skill} pilot');\n`,
      { mode: 0o755 },
    );
    fs.chmodSync(path.join(scripts, runner), 0o755);
    fs.writeFileSync(path.join(scripts, 'lib', 'runner-utils.js'), 'module.exports = { pilot: true };\n');
  }
}

function withPilotFixture(callback) {
  const plugin = makeHistoricalPilotPlugin();
  const project = projectRoot();
  try {
    const initial = runInstaller(project, ['--copy', '--force'], plugin);
    assert.strictEqual(initial.status, 0, `${initial.stdout}\n${initial.stderr}`);
    const receiptPath = path.join(project, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    for (const [skill] of PILOTS) {
      assert.ok(receipt.managed_entries.skills[skill], `historical receipt must own ${skill}`);
    }
    return callback({ plugin, project, receiptPath });
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
    assertCanonicalPilotSourcesUnchanged();
  }
}

test('receipt-owned unchanged historical helpers and descriptors migrate to the self-contained Skill', () => {
  withPilotFixture(({ plugin, project, receiptPath }) => {
    const oldUtils = path.join(project, '.codex', 'skills', 'precommit', 'scripts', 'lib', 'utils.js');
    assert.ok(fs.existsSync(oldUtils), 'historical package must materialize the old helper');
    for (const [skill] of PILOTS) {
      assert.ok(fs.existsSync(path.join(project, '.codex', 'skills', skill, 'skill-package.json')),
        `historical package must materialize the retired descriptor for ${skill}`);
    }
    publishSelfContainedPilot(plugin);
    const migrated = runInstaller(project, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    const target = path.join(project, '.codex', 'skills', 'precommit', 'scripts');
    assert.ok(fs.existsSync(path.join(target, 'lib', 'runner-utils.js')));
    assert.ok(!fs.existsSync(path.join(target, 'lib', 'utils.js')), 'unchanged old overlay should be retired');
    for (const [skill, runner] of PILOTS) {
      const scripts = path.join(project, '.codex', 'skills', skill, 'scripts');
      assert.ok(fs.existsSync(path.join(scripts, runner)), `migrated runner missing for ${skill}`);
      assert.ok(fs.existsSync(path.join(scripts, 'lib', 'runner-utils.js')), `migrated helper missing for ${skill}`);
      assert.ok(!fs.existsSync(path.join(scripts, 'lib', 'utils.js')), `old helper remains for ${skill}`);
      assert.ok(!fs.existsSync(path.join(project, '.codex', 'skills', skill, 'skill-package.json')),
        `unchanged receipt-owned descriptor must be removed for ${skill}`);
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const installedSkill = path.join(project, '.codex', 'skills', skill);
      assert.strictEqual(
        receipt.managed_entries.skills[skill].source_fingerprint,
        completeTreeFingerprint(installedSkill),
        `receipt fingerprint must match installed ${skill}`,
      );
      const executed = spawnSync(process.execPath, [path.join(scripts, runner)], {
        cwd: project,
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.strictEqual(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
      assert.match(executed.stdout, new RegExp(`${skill} pilot`));
    }
  });
});

test('pilot migration preserves edited and unowned legacy files with an actionable collision', () => {
  withPilotFixture(({ plugin, project }) => {
    const skillRoot = path.join(project, '.codex', 'skills', 'precommit');
    const edited = path.join(skillRoot, 'scripts', 'lib', 'utils.js');
    const unowned = path.join(skillRoot, 'scripts', 'lib', 'consumer-legacy.js');
    const descriptor = path.join(skillRoot, 'skill-package.json');
    fs.appendFileSync(edited, '\nconsumer edit\n');
    fs.appendFileSync(descriptor, '\n');
    const editedDescriptor = fs.readFileSync(descriptor, 'utf8');
    fs.writeFileSync(unowned, 'consumer-owned legacy helper\n');
    publishSelfContainedPilot(plugin);
    const migrated = runInstaller(project, ['--copy', '--update', '--force'], plugin);
    const output = `${migrated.stdout}\n${migrated.stderr}`;
    assert.notStrictEqual(migrated.status, 0, output);
    assert.match(output, /collision|preserv|orphan|manual/i);
    assert.strictEqual(fs.readFileSync(edited, 'utf8').includes('consumer edit'), true);
    assert.strictEqual(fs.readFileSync(unowned, 'utf8'), 'consumer-owned legacy helper\n');
    assert.strictEqual(fs.readFileSync(descriptor, 'utf8'), editedDescriptor, 'an edited descriptor is preserved');
  });
});

test('pilot migration rolls back to the receipt-owned old artifact after materialization failure', () => {
  withPilotFixture(({ plugin, project, receiptPath }) => {
    const oldSkill = path.join(project, '.codex', 'skills', 'precommit');
    const beforeTree = completeTreeFingerprint(oldSkill);
    const beforeReceipt = fs.readFileSync(receiptPath, 'utf8');
    publishSelfContainedPilot(plugin);
    const shim = materializationFailureShim();
    const cwdAudit = path.join(shim, 'cwd-audit.txt');
    try {
      const pythonPath = [shim, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
      const failed = runInstaller(project, ['--copy', '--update', '--force'], plugin, {
        PYTHONPATH: pythonPath,
        DHPK_TEST_CWD_AUDIT_FILE: cwdAudit,
      });
      assert.notStrictEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
      assert.match(`${failed.stdout}\n${failed.stderr}`, /controlled materialization failure|rollback/i);
      assert.strictEqual(completeTreeFingerprint(oldSkill), beforeTree);
      assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), beforeReceipt);
      assert.ok(fs.existsSync(path.join(oldSkill, 'scripts', 'lib', 'utils.js')));
      assert.ok(fs.existsSync(path.join(oldSkill, 'skill-package.json')), 'rollback keeps the historical descriptor');
      assert.ok(!fs.existsSync(path.join(oldSkill, 'scripts', 'lib', 'runner-utils.js')));
    } finally {
      fs.rmSync(shim, { recursive: true, force: true });
    }
  });
});

run('skill-pilot-install-migration');
