'use strict';

// Covers the catalog CLI's retired-surface and projection-integrity behavior
// using temporary repositories, without mutating the real source tree.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

// Copy the input and resource subtrees required by the catalog's machine-readable
// checks. The CLI resolves its root from its own location, so the copied script
// sees this fixture as its repository.
function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-catalog-'));
  for (const rel of ['scripts', 'agents', 'modules', 'skills', 'commands', 'hooks', 'tests', 'manifests']) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, rel), { recursive: true });
  }
  return tmp;
}

function runCatalog(repo, flag) {
  const res = spawnSync('node', [path.join(repo, 'scripts', 'ci', 'catalog.js'), flag],
    { encoding: 'utf8' });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

function runCheck(repo) {
  return runCatalog(repo, '--check');
}

// The suite-admission tests need real Git history because catalog only considers
// tests added after an explicit base commit. Keep the fixture small: copy the CLI,
// let it resolve its read-only library dependencies through a symlink, and provide
// only the manifests required for an otherwise-clean --check.
function makeAdmissionGitRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-admission-'));
  fs.mkdirSync(path.join(tmp, 'scripts', 'ci'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'ci', 'catalog.js'),
    path.join(tmp, 'scripts', 'ci', 'catalog.js')
  );
  fs.symlinkSync(path.join(ROOT, 'scripts', 'lib'), path.join(tmp, 'scripts', 'lib'), 'dir');
  for (const dir of ['agents', 'modules', 'skills', 'commands', 'tests', 'manifests']) {
    fs.mkdirSync(path.join(tmp, dir), { recursive: true });
  }
  // Keep this suite in the Git baseline so the admission check only reports suites
  // added after the fixture's base commit.
  fs.writeFileSync(path.join(tmp, 'tests', 'catalog-claims.test.js'), '// fixture baseline\n');
  for (const name of [
    'distribution-inventory.json',
    'install-profiles.json',
    'module-catalog.json',
    'profile-projection-sets.json',
  ]) {
    fs.copyFileSync(path.join(ROOT, 'manifests', name), path.join(tmp, 'manifests', name));
  }

  runGit(tmp, ['init', '--quiet', '--initial-branch=main']);
  runGit(tmp, ['config', 'user.name', 'Catalog admission fixture']);
  runGit(tmp, ['config', 'user.email', 'catalog-admission@example.invalid']);
  commitAdmissionFixture(tmp, 'baseline');
  return tmp;
}

function runGit(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  const out = (result.stdout || '') + (result.stderr || '');
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} failed:\n${out}`);
  return (result.stdout || '').trim();
}

function commitAdmissionFixture(repo, message) {
  runGit(repo, ['add', '-A']);
  runGit(repo, ['commit', '--quiet', '-m', message]);
}

function admissionBase(repo) {
  return runGit(repo, ['rev-parse', 'HEAD']);
}

function addAdmissionSuite(repo, rel) {
  const fp = path.join(repo, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, '// newly added fixture suite\n');
}

function addSuiteOwnerRegistration(repo, suiteRel, ownerRel) {
  const catalogPath = path.join(repo, 'scripts', 'ci', 'catalog.js');
  const source = fs.readFileSync(catalogPath, 'utf8');
  const table = /const SUITE_OWNER_REGISTRY\s*=\s*(?:Object\.freeze\s*\(\s*)?\{/;
  const match = source.match(table);
  const row = `\n  ${JSON.stringify(suiteRel)}: ${JSON.stringify(ownerRel)},`;
  let updated;
  if (match) {
    const openingBrace = source.indexOf('{', match.index);
    updated = `${source.slice(0, openingBrace + 1)}${row}${source.slice(openingBrace + 1)}`;
  } else {
    // Keep the fixture executable against the pre-feature CLI during RED. Once
    // the registry exists, the branch above inserts a row into that real table.
    updated = source.replace(
      "'use strict';",
      `'use strict';\n\nconst SUITE_OWNER_REGISTRY = {${row}\n};`
    );
  }
  assert.notStrictEqual(updated, source, 'fixture should add a suite owner registration');
  fs.writeFileSync(catalogPath, updated);
}

function runAdmissionCheck(repo, baseSha) {
  const result = spawnSync('node', [
    path.join(repo, 'scripts', 'ci', 'catalog.js'),
    '--check', 'all', '--diff-base', baseSha,
  ], { cwd: repo, encoding: 'utf8' });
  return { status: result.status, out: (result.stdout || '') + (result.stderr || '') };
}

function suiteWarningPattern(suiteRel) {
  const escaped = suiteRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:warn(?:ing)?[^\\n]*${escaped}|${escaped}[^\\n]*warn(?:ing)?)`, 'i');
}

const repo = makeTempRepo();
process.on('exit', () => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best effort */ } });

test('faithful temp copy passes --check as-is', () => {
  const { status, out } = runCheck(repo);
  assert.strictEqual(status, 0, `baseline temp copy should pass --check, got:\n${out}`);
});

test('retired Codex MCP policy rejects any frontmatter grant', () => {
  const dir = path.join(repo, 'skills', 'new-codex-mcp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), [
    '---',
    "name: dhpk-new-codex-mcp",
    "description: 'unreviewed Codex MCP skill'",
    "allowed-tools: 'mcp__codex__codex'",
    'metadata:',
    '  dhpk-invocation-class: explicit-only',
    '---',
    'body',
  ].join('\n'));
  try {
    const result = runCheck(repo);
    assert.strictEqual(result.status, 1);
    assert.match(result.out, /MCP-backed Codex skill surface is retired: expected 0, computed 1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retired Codex MCP policy rejects an unreviewed command grant', () => {
  const commandPath = path.join(repo, 'commands', 'new-mcp.md');
  fs.writeFileSync(commandPath, [
    '---',
    'description: unreviewed Codex MCP command',
    "allowed-tools: 'mcp__codex__codex'",
    'metadata:',
    '  dhpk-invocation-class: explicit-only',
    '---',
    'body',
  ].join('\n'));
  try {
    const result = runCheck(repo);
    assert.strictEqual(result.status, 1);
    assert.match(result.out, /MCP-backed Codex command grants are retired: expected 0, computed 1/);
  } finally {
    fs.rmSync(commandPath, { force: true });
  }
});

test('hookEvents equals the distinct top-level event-key count of hooks/hooks.json', () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const expected = Object.keys(hooksJson.hooks || {}).length;
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'catalog.js')], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  const m = res.stdout.match(/hooks:\s+(\d+) events/);
  assert.ok(m, `expected the printed table to report hook-event count, got:\n${res.stdout}`);
  assert.strictEqual(Number(m[1]), expected, 'printed hookEvents must equal hooks.json top-level key count');
});

test('a script without a dedicated test does not block --check', () => {
  const fixtureRel = path.join('scripts', 'zz-synthetic-unowned-script.sh');
  const fixtureFp = path.join(repo, fixtureRel);
  fs.writeFileSync(fixtureFp, '#!/usr/bin/env bash\necho fixture\n');
  try {
    const { status, out } = runCheck(repo);
    assert.strictEqual(status, 0, `an unowned script must not block --check, got:\n${out}`);
  } finally {
    fs.rmSync(fixtureFp, { force: true });
  }
});

// Per-profile projection sets (#618). The manifest declares, per install profile
// and Host, the skill IDs the installers project into the Shared Project
// Projection; catalog.js --check fails when a declared set is stale.
const PROJECTION_SETS_REL = path.join('manifests', 'profile-projection-sets.json');
// Kept independent of HOST_SURFACES in the library on purpose: the test is the
// oracle for which Hosts and surfaces the manifest must cover.
const PROJECTION_HOSTS = ['codex-sync', 'cursor'];

function readProjectionSets(base) {
  return JSON.parse(fs.readFileSync(path.join(base, PROJECTION_SETS_REL), 'utf8'));
}

function withProjectionSets(mutate, body) {
  const fp = path.join(repo, PROJECTION_SETS_REL);
  const original = fs.readFileSync(fp, 'utf8');
  try {
    const manifest = JSON.parse(original);
    mutate(manifest);
    fs.writeFileSync(fp, `${JSON.stringify(manifest, null, 2)}\n`);
    body(fp, original);
  } finally {
    fs.writeFileSync(fp, original);
  }
}

test('every install profile declares a projection set for the cursor and codex-sync Hosts', () => {
  const profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8')).profiles;
  const declared = readProjectionSets(ROOT).profiles;
  assert.deepStrictEqual(Object.keys(declared).sort(), Object.keys(profiles).sort());
  for (const [profileId, sets] of Object.entries(declared)) {
    assert.deepStrictEqual(Object.keys(sets).sort(), PROJECTION_HOSTS, `${profileId} must declare exactly the projection Hosts`);
    for (const host of PROJECTION_HOSTS) {
      assert.ok(Array.isArray(sets[host]), `${profileId}.${host} must be an array`);
      assert.deepStrictEqual(sets[host], sets[host].slice().sort(), `${profileId}.${host} must be sorted`);
    }
  }
});

test('the minimal profile projects the same four core skills into Cursor as before', () => {
  const declared = readProjectionSets(ROOT).profiles.minimal;
  assert.deepStrictEqual(declared.cursor, ['change-verdict', 'code-trace', 'flow-drive', 'flow-guide']);
});

test('a projection set only lists skills whose inventory entry names that Host surface', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const surfaceOf = { cursor: 'cursor-sync', 'codex-sync': 'codex-sync' };
  const byId = new Map(inventory.skills.map((entry) => [entry.id, entry]));
  for (const [profileId, sets] of Object.entries(readProjectionSets(ROOT).profiles)) {
    for (const host of PROJECTION_HOSTS) {
      for (const id of sets[host]) {
        const entry = byId.get(id);
        assert.ok(entry && entry.surfaces.includes(surfaceOf[host]), `${profileId}.${host} lists '${id}' without the ${surfaceOf[host]} surface`);
      }
    }
  }
});

test('a stale projection set fails --check and names the profile and surface', () => {
  withProjectionSets((manifest) => {
    manifest.profiles.minimal.cursor = manifest.profiles.minimal.cursor.filter((id) => id !== 'code-trace');
  }, () => {
    const { status, out } = runCheck(repo);
    assert.strictEqual(status, 1, `drifted projection set must fail --check, got:\n${out}`);
    assert.match(out, /profile 'minimal' Host 'cursor' \(surface 'cursor-sync'\).*missing: code-trace/);
  });
});

test('an extra ID in a projection set fails --check', () => {
  withProjectionSets((manifest) => {
    manifest.profiles.full['codex-sync'] = [...manifest.profiles.full['codex-sync'], 'zz-not-a-skill'].sort();
  }, () => {
    const { status, out } = runCheck(repo);
    assert.strictEqual(status, 1, `extra projection ID must fail --check, got:\n${out}`);
    assert.match(out, /profile 'full' Host 'codex-sync' \(surface 'codex-sync'\).*unexpected: zz-not-a-skill/);
  });
});

test('a profile without a declared projection set fails --check', () => {
  withProjectionSets((manifest) => {
    delete manifest.profiles['js-only'];
  }, () => {
    const { status, out } = runCheck(repo);
    assert.strictEqual(status, 1, `missing profile must fail --check, got:\n${out}`);
    assert.match(out, /profile 'js-only' Host 'codex-sync'.*no declared projection set/);
    assert.match(out, /profile 'js-only' Host 'cursor'.*no declared projection set/);
  });
});

test('a projection set declared for an unknown profile fails --check', () => {
  withProjectionSets((manifest) => {
    manifest.profiles['zz-ghost'] = { cursor: [], 'codex-sync': [] };
  }, () => {
    const { status, out } = runCheck(repo);
    assert.strictEqual(status, 1, `unknown profile must fail --check, got:\n${out}`);
    assert.match(out, /profile 'zz-ghost' Host 'cursor'.*not generated/);
  });
});

test('an unparseable projection manifest fails --check with a descriptive error', () => {
  const fp = path.join(repo, PROJECTION_SETS_REL);
  const original = fs.readFileSync(fp, 'utf8');
  try {
    fs.writeFileSync(fp, '{ not json');
    const { status, out } = runCheck(repo);
    assert.strictEqual(status, 1, `invalid JSON must fail --check, got:\n${out}`);
    assert.match(out, /profile-projection-sets\.json: invalid JSON/);
  } finally {
    fs.writeFileSync(fp, original);
  }
});

test('--write repairs a stale projection set and a second --write changes nothing', () => {
  withProjectionSets((manifest) => {
    manifest.profiles.minimal.cursor = [];
  }, (fp, original) => {
    assert.strictEqual(runCatalog(repo, '--write').status, 0);
    const repaired = fs.readFileSync(fp, 'utf8');
    assert.strictEqual(repaired, original, '--write must regenerate the declared manifest byte-for-byte');
    assert.strictEqual(runCatalog(repo, '--write').status, 0);
    assert.strictEqual(fs.readFileSync(fp, 'utf8'), repaired, 're-running --write must be a no-op');
    assert.strictEqual(runCheck(repo).status, 0);
  });
});

test('a newly added suite without an owner warns without changing --check status', () => {
  const admissionRepo = makeAdmissionGitRepo();
  const suiteRel = 'tests/zz-admission-unregistered.test.js';
  try {
    const base = admissionBase(admissionRepo);
    const baseline = runAdmissionCheck(admissionRepo, base);
    assert.strictEqual(baseline.status, 0, `Git fixture baseline should pass, got:\n${baseline.out}`);

    addAdmissionSuite(admissionRepo, suiteRel);
    commitAdmissionFixture(admissionRepo, 'add unregistered suite');
    const result = runAdmissionCheck(admissionRepo, base);

    assert.strictEqual(result.status, baseline.status,
      `an admission warning must not change catalog status, got:\n${result.out}`);
    assert.match(result.out, suiteWarningPattern(suiteRel),
      `expected a warning naming the new unregistered suite, got:\n${result.out}`);
  } finally {
    fs.rmSync(admissionRepo, { recursive: true, force: true });
  }
});

test('a newly added suite with a valid owner registration stays silent', () => {
  const admissionRepo = makeAdmissionGitRepo();
  const suiteRel = 'tests/zz-admission-valid.test.js';
  try {
    const base = admissionBase(admissionRepo);
    addAdmissionSuite(admissionRepo, suiteRel);
    addSuiteOwnerRegistration(admissionRepo, suiteRel, 'scripts/ci/catalog.js');
    commitAdmissionFixture(admissionRepo, 'add registered suite');

    const result = runAdmissionCheck(admissionRepo, base);
    assert.strictEqual(result.status, 0, `valid owner registration should pass, got:\n${result.out}`);
    assert.doesNotMatch(result.out, suiteWarningPattern(suiteRel),
      `valid owner registration should not warn for ${suiteRel}, got:\n${result.out}`);
  } finally {
    fs.rmSync(admissionRepo, { recursive: true, force: true });
  }
});

test('a malformed owner registration fails closed with a warn-only signal', () => {
  const admissionRepo = makeAdmissionGitRepo();
  const suiteRel = 'tests/zz-admission-malformed.test.js';
  try {
    const base = admissionBase(admissionRepo);
    const baseline = runAdmissionCheck(admissionRepo, base);
    assert.strictEqual(baseline.status, 0, `Git fixture baseline should pass, got:\n${baseline.out}`);

    addAdmissionSuite(admissionRepo, suiteRel);
    addSuiteOwnerRegistration(admissionRepo, suiteRel, '../scripts/ci/catalog.js');
    commitAdmissionFixture(admissionRepo, 'add malformed registration');
    const result = runAdmissionCheck(admissionRepo, base);

    assert.strictEqual(result.status, baseline.status,
      `malformed registration warnings must remain warn-only, got:\n${result.out}`);
    assert.match(result.out, suiteWarningPattern(suiteRel),
      `malformed registration should warn for ${suiteRel}, got:\n${result.out}`);
  } finally {
    fs.rmSync(admissionRepo, { recursive: true, force: true });
  }
});

test('an owner registration pointing to a symlink warns without changing --check status', () => {
  const admissionRepo = makeAdmissionGitRepo();
  const suiteRel = 'tests/zz-admission-symlink-owner.test.js';
  const ownerRel = 'scripts/ci/catalog-owner-link.js';
  try {
    const base = admissionBase(admissionRepo);
    const baseline = runAdmissionCheck(admissionRepo, base);
    assert.strictEqual(baseline.status, 0, `Git fixture baseline should pass, got:\n${baseline.out}`);
    addAdmissionSuite(admissionRepo, suiteRel);
    fs.symlinkSync(
      path.join(admissionRepo, 'scripts', 'ci', 'catalog.js'),
      path.join(admissionRepo, ownerRel),
      'file'
    );
    addSuiteOwnerRegistration(admissionRepo, suiteRel, ownerRel);
    commitAdmissionFixture(admissionRepo, 'add suite with symlink owner');

    const result = runAdmissionCheck(admissionRepo, base);

    assert.strictEqual(result.status, baseline.status,
      `a symlink owner warning must not change catalog status, got:\n${result.out}`);
    assert.match(result.out, suiteWarningPattern(suiteRel),
      `a symlink owner must fail closed and warn for ${suiteRel}, got:\n${result.out}`);
  } finally {
    fs.rmSync(admissionRepo, { recursive: true, force: true });
  }
});

test('an existing unchanged suite does not trigger an admission warning', () => {
  const admissionRepo = makeAdmissionGitRepo();
  try {
    const base = admissionBase(admissionRepo);
    const result = runAdmissionCheck(admissionRepo, base);
    assert.strictEqual(result.status, 0, `unchanged Git fixture should pass, got:\n${result.out}`);
    assert.doesNotMatch(result.out, suiteWarningPattern('tests/catalog-claims.test.js'),
      `a suite already present at the Git base should not warn, got:\n${result.out}`);
  } finally {
    fs.rmSync(admissionRepo, { recursive: true, force: true });
  }
});

run('catalog-claims');
