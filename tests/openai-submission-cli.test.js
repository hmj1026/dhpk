'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { execute, parseRequest } = require('../scripts/lib/dhpk-distribution');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-cli-'));
  const root = path.join(directory, 'source');
  const output = path.join(directory, 'artifact');
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.mkdirSync(path.join(root, 'skills/alpha'), { recursive: true });
  const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value));
  write('.claude-plugin/plugin.json', { name: 'dhpk', version: '1.2.3' });
  write('manifests/distribution-inventory.json', {
    skills: [{ id: 'alpha', name: 'alpha', path: 'skills/alpha', surfaces: [], profiles: ['core'] }],
  });
  write('manifests/marketplace-selection.json', {
    skills: [{ id: 'alpha', kind: 'entry', owner: null, selection: 'common', authority: 'read-only' }],
  });
  fs.writeFileSync(path.join(root, 'skills/alpha/SKILL.md'), '---\nname: alpha\ndescription: Test skill.\n---\nInstructions.\n');
  const manifest = path.join(directory, 'listing.json');
  fs.writeFileSync(manifest, JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'dhpk', version: '1.2.3', description: 'A fixture workflow package.',
    extensions: { 'com.openai': { interface: {
      displayName: 'Fixture', shortDescription: 'Test workflow',
      longDescription: 'A test workflow package.', developerName: 'Fixture', category: 'Developer Tools',
    } } },
  }));
  const git = (args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
  };
  git(['init', '-q']);
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const generate = () => execute(['openai-submission', 'generate', '--output', output, '--manifest', manifest], root);
  return { directory, root, output, manifest, generate, git };
}

test('official submission generation requires a manifest and rejects partial catalog selectors', () => {
  assert.strictEqual(parseRequest(['openai-submission', 'generate']).ok, false);
  const valid = parseRequest(['openai-submission', 'generate', '--manifest', 'listing.json']);
  assert.strictEqual(valid.ok, true, valid.error);
  for (const selector of [['--skill', 'alpha'], ['--profile', 'minimal'], ['--standalone', 'alpha']]) {
    assert.strictEqual(parseRequest(['openai-submission', 'generate', '--manifest', 'listing.json', ...selector]).ok, false);
  }
});

test('the command generates and validates a reproducible artifact from a clean source commit', () => {
  const f = fixture();
  try {
    const first = f.generate();
    assert.strictEqual(first.ok, true, first.error || JSON.stringify(first.payload));
    const zip = fs.readFileSync(path.join(f.output, 'package.zip'));
    const second = f.generate();
    assert.strictEqual(second.ok, true, second.error);
    assert.deepStrictEqual(fs.readFileSync(path.join(f.output, 'package.zip')), zip);
    for (const operation of ['validate', 'verify']) {
      const checked = execute(['openai-submission', operation, '--output', f.output], f.root);
      assert.strictEqual(checked.ok, true, checked.error || JSON.stringify(checked.payload));
      assert.strictEqual(checked.payload.evidence.runtime, 'NOT_RUN');
    }
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('committed executable modes determine ZIP bytes when local filemode tracking is disabled', () => {
  const f = fixture();
  try {
    f.git(['config', 'core.filemode', 'false']);
    const first = f.generate();
    assert.strictEqual(first.ok, true, first.error);
    const before = fs.readFileSync(path.join(f.output, 'package.zip'));
    fs.chmodSync(path.join(f.root, 'skills/alpha/SKILL.md'), 0o755);
    const second = f.generate();
    assert.strictEqual(second.ok, true, second.error);
    assert.deepStrictEqual(fs.readFileSync(path.join(f.output, 'package.zip')), before);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('verify rejects malformed nested provenance even when the ZIP digest is unchanged', () => {
  const f = fixture();
  try {
    assert.strictEqual(f.generate().ok, true);
    const receiptPath = path.join(f.output, 'provenance.json');
    const original = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    for (const mutate of [
      (receipt) => { receipt.provenance.sourceIdentity.commit = 'not-a-commit'; },
      (receipt) => { receipt.provenance.fileFingerprints = {}; },
      (receipt) => { receipt.provenance.selectionDigest = '0'.repeat(64); },
    ]) {
      const receipt = JSON.parse(JSON.stringify(original));
      mutate(receipt);
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      const checked = execute(['openai-submission', 'verify', '--output', f.output], f.root);
      assert.strictEqual(checked.ok, false, 'malformed nested receipt must fail');
      assert.match(checked.error, /provenance|fingerprints/i);
    }
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('invalid source versions fail before an artifact is published', () => {
  const f = fixture();
  try {
    const listing = JSON.parse(fs.readFileSync(f.manifest, 'utf8'));
    fs.writeFileSync(f.manifest, JSON.stringify({ ...listing, version: 'garbage' }));
    const result = execute(['openai-submission', 'generate', '--output', f.output, '--manifest', f.manifest, '--version', 'garbage'], f.root);
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /version|SemVer/i);
    assert.strictEqual(fs.existsSync(f.output), false);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('oversized provenance is rejected before replacing the previous verifiable artifact', () => {
  const f = fixture();
  try {
    assert.strictEqual(f.generate().ok, true);
    const before = fs.readFileSync(path.join(f.output, 'package.zip'));
    const directory = path.join(f.root, 'skills/alpha/references', ...Array(14).fill('r'.repeat(120)));
    fs.mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 1300; index += 1) fs.writeFileSync(path.join(directory, `${index}.txt`), 'Resource.\n');
    f.git(['add', '.']);
    f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'long resource paths']);
    const result = f.generate();
    assert.strictEqual(result.ok, false, 'publication must not exceed the owner receipt read limit');
    assert.match(result.error, /receipt.*(?:exceed|limit|large)/i);
    assert.deepStrictEqual(fs.readFileSync(path.join(f.output, 'package.zip')), before);
    assert.strictEqual(execute(['openai-submission', 'verify', '--output', f.output], f.root).ok, true);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('dirty source and foreign output are rejected without replacing existing bytes', () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.output);
    fs.writeFileSync(path.join(f.output, 'keep.txt'), 'user owned');
    const foreign = f.generate();
    assert.strictEqual(foreign.ok, false);
    assert.match(foreign.error, /foreign|owner|receipt/i);
    assert.strictEqual(fs.readFileSync(path.join(f.output, 'keep.txt'), 'utf8'), 'user owned');
    fs.rmSync(f.output, { recursive: true });
    fs.appendFileSync(path.join(f.root, 'skills/alpha/SKILL.md'), 'Dirty source.\n');
    const dirty = f.generate();
    assert.strictEqual(dirty.ok, false);
    assert.match(dirty.error, /clean|dirty/i);
    assert.strictEqual(fs.existsSync(f.output), false);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('oversized listing input is rejected before parsing or publishing', () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.manifest, ' '.repeat(65537));
    const result = f.generate();
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /65536-byte limit/);
    assert.strictEqual(fs.existsSync(f.output), false);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('ignored per-skill files cannot enter an artifact from an otherwise clean Git checkout', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, '.gitignore'), '.env\n');
    f.git(['add', '.gitignore']);
    f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'ignore fixture']);
    fs.writeFileSync(path.join(f.root, 'skills/alpha/.env'), 'FIXTURE_ONLY=private-local-input\n');
    const status = spawnSync('git', ['-C', f.root, 'status', '--porcelain'], { encoding: 'utf8' });
    assert.strictEqual(status.stdout, '');
    const result = f.generate();
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /tracked|allowlist|Git tree/i);
    assert.match(result.error, /skills\/alpha\/\.env/);
    assert.strictEqual(fs.existsSync(f.output), false);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('invalid listing and symlink destinations preserve the previously generated artifact', () => {
  const f = fixture();
  try {
    assert.strictEqual(f.generate().ok, true);
    const bytes = fs.readFileSync(path.join(f.output, 'package.zip'));
    const listing = JSON.parse(fs.readFileSync(f.manifest, 'utf8'));
    listing.extensions['com.openai'].interface.displayName = 'x'.repeat(31);
    fs.writeFileSync(f.manifest, JSON.stringify(listing));
    assert.strictEqual(f.generate().ok, false);
    assert.deepStrictEqual(fs.readFileSync(path.join(f.output, 'package.zip')), bytes);
    const linked = path.join(f.directory, 'linked');
    fs.symlinkSync(f.output, linked, 'dir');
    const result = execute(['openai-submission', 'generate', '--manifest', f.manifest, '--output', linked], f.root);
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /symlink/i);
    assert.deepStrictEqual(fs.readFileSync(path.join(f.output, 'package.zip')), bytes);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

run('openai-submission-cli');
