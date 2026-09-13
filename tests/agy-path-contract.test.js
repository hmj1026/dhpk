'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  DEFAULT_PATH_CONTRACT,
  loadAgyPathContract,
  resolveAgyConsumerPath,
  resolveAgyInstallPaths,
  validateAgyPathContract,
} = require('../scripts/lib/agy-path-contract');

test('loads the inventory-owned canonical and legacy AGY paths', () => {
  const contract = loadAgyPathContract();
  assert.strictEqual(contract.canonical_relative, '.gemini/antigravity-cli/plugins/dhpk');
  assert.deepStrictEqual(contract.legacy_relatives, ['.gemini/config/plugins/dhpk']);
  assert.strictEqual(resolveAgyConsumerPath(contract), '/home/agy/.gemini/antigravity-cli/plugins/dhpk');
});

test('resolves canonical and legacy paths under an isolated home', () => {
  const paths = resolveAgyInstallPaths('/tmp/agy-home', DEFAULT_PATH_CONTRACT);
  assert.strictEqual(paths.canonical, '/tmp/agy-home/.gemini/antigravity-cli/plugins/dhpk');
  assert.deepStrictEqual(paths.legacy, ['/tmp/agy-home/.gemini/config/plugins/dhpk']);
});

test('rejects unsafe, duplicate, and incomplete path contracts', () => {
  const cases = [
    { ...DEFAULT_PATH_CONTRACT, canonical_relative: '/outside/dhpk' },
    { ...DEFAULT_PATH_CONTRACT, canonical_relative: '../outside/dhpk' },
    { ...DEFAULT_PATH_CONTRACT, legacy_relatives: ['.gemini/config/plugins/dhpk', '.gemini/config/plugins/dhpk'] },
    { ...DEFAULT_PATH_CONTRACT, legacy_relatives: ['.gemini/antigravity-cli/plugins/dhpk'] },
    { ...DEFAULT_PATH_CONTRACT, legacy_relatives: [] },
  ];
  for (const candidate of cases) assert.strictEqual(validateAgyPathContract(candidate).ok, false);
});

test('rejects a non-absolute home and malformed sandbox home', () => {
  assert.throws(() => resolveAgyInstallPaths('relative-home', DEFAULT_PATH_CONTRACT), /absolute/);
  assert.strictEqual(validateAgyPathContract({ ...DEFAULT_PATH_CONTRACT, sandbox_home: 'home/agy' }).ok, false);
});

run('agy-path-contract');
