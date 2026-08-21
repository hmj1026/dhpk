'use strict';

// SessionStart/config parsing consumes option values, not manifest descriptions.
// Characterize the same option payload against legacy and compact manifests so
// metadata compaction cannot silently become an activation change.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const metadata = require('../scripts/lib/plugin-user-config-metadata');

const ROOT = path.join(__dirname, '..');
const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const source = metadata.loadAuthoritativeMetadata({ root: ROOT, legacyManifest: legacy });
const generated = metadata.generateUserConfigMetadata({ root: ROOT, legacyManifest: legacy, source });

function probe(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-user-config-behavior-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({
      pluginConfigs: { 'dhpk@dhpk': { options } },
    }));
    const script = path.join(ROOT, 'scripts', 'hooks', '_lib', 'load-project-config.sh');
    const result = spawnSync('bash', ['-c', `ROOT="$1"; . "$2"; printf '%s\\n' "$(dhpk_config_csv modules '')" "$(dhpk_config_get hook_profile '')"`, '_', dir, script], { encoding: 'utf8' });
    return { status: result.status, output: result.stdout };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('description-only candidate preserves SessionStart/config option behavior', () => {
  assert.strictEqual(generated.ok, true, JSON.stringify(generated));
  const options = { modules: ['php', 'yii-1.1'], hook_profile: 'minimal' };
  const legacyProbe = probe(options);
  const compactProbe = probe(options);
  assert.strictEqual(legacyProbe.status, 0, JSON.stringify(legacyProbe));
  assert.strictEqual(compactProbe.status, 0, JSON.stringify(compactProbe));
  assert.strictEqual(compactProbe.output, legacyProbe.output);
  assert.deepStrictEqual(
    metadata.contractEntries(legacy),
    metadata.contractEntries(generated.value.manifest),
  );
});

run('plugin-user-config-behavior');
