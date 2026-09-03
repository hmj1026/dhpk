'use strict';

const fs = require('fs');
const path = require('path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const BILINGUAL_PAIRS = [
  ['README.md', 'README.zh-TW.md'],
  ['RELEASE.md', 'RELEASE.zh-TW.md'],
  ['docs/basic-operations.md', 'docs/basic-operations.zh-TW.md'],
  ['docs/configuration.md', 'docs/configuration.zh-TW.md'],
  ['docs/docker-setup.md', 'docs/docker-setup.zh-TW.md'],
  ['docs/distribution-surfaces.md', 'docs/distribution-surfaces.zh-TW.md'],
  ['docs/hook-extension.md', 'docs/hook-extension.zh-TW.md'],
  ['docs/skill-platform-migration.md', 'docs/skill-platform-migration.zh-TW.md'],
  ['codex/README.md', 'codex/README.zh-TW.md'],
  ['plugins/dhpk/README.md', 'plugins/dhpk/README.zh-TW.md'],
];

test('every active skill-platform document has an English and Traditional Chinese entry point', () => {
  for (const pair of BILINGUAL_PAIRS) {
    for (const relative of pair) {
      assert.ok(fs.existsSync(path.join(ROOT, relative)), `missing bilingual document: ${relative}`);
    }
    assert.match(read(pair[0]), /繁體中文/, `${pair[0]} must link to Traditional Chinese`);
    assert.match(read(pair[1]), /English/, `${pair[1]} must link to English`);
  }
});

test('active overview and operations docs use current command namespaces', () => {
  const active = [
    'README.md',
    'README.zh-TW.md',
    'docs/basic-operations.md',
    'docs/basic-operations.zh-TW.md',
    'commands/harness-audit.md',
    'commands/harness-govern.md',
  ];
  const staleCommand = /(?<![a-z0-9_.-])\/(?:harness-audit|harness-govern|harness-revise)\b/gi;
  for (const relative of active) {
    const matches = read(relative).match(staleCommand) || [];
    assert.deepStrictEqual(matches, [], `${relative} contains unnamespaced commands: ${matches.join(', ')}`);
  }
});

test('overview documents the current canonical, projection, native, hook, and command contracts', () => {
  const inventory = JSON.parse(read('manifests/distribution-inventory.json'));
  const canonicalCount = inventory.skills.length;
  const nativeCount = inventory.skills.filter((skill) => skill.surfaces.includes('codex-native')).length;
  const moduleCount = inventory.modules.length;
  const hookEvents = Object.keys(JSON.parse(read('hooks/hooks.json')).hooks);

  for (const relative of ['README.md', 'README.zh-TW.md']) {
    const text = read(relative);
    assert.ok(text.includes(`${canonicalCount}`), `${relative} missing canonical skill count`);
    assert.ok(text.includes(`${moduleCount}`), `${relative} missing module count`);
    assert.ok(text.includes(`${nativeCount}`), `${relative} missing native skill count`);
    assert.ok(text.includes('manifests/distribution-inventory.json'), `${relative} missing inventory SSOT`);
    assert.ok(text.includes('plugins/dhpk/'), `${relative} missing physical native package`);
    assert.ok(text.includes('skills/dhpk-'), `${relative} missing flat public-name contract`);
    for (const event of hookEvents) {
      assert.ok(text.includes(event), `${relative} missing hook event ${event}`);
    }
  }
});

test('Codex install docs cover every supported receipt operation and current experimental status', () => {
  const requiredFlags = ['--copy', '--update', '--migrate', '--uninstall', '--force'];
  const docs = [
    'docs/basic-operations.md',
    'docs/basic-operations.zh-TW.md',
    'codex/README.md',
    'codex/README.zh-TW.md',
  ];
  for (const relative of docs) {
    const text = read(relative);
    for (const flag of requiredFlags) {
      assert.ok(text.includes(flag), `${relative} missing ${flag}`);
    }
    assert.ok(text.includes('schema-v3'), `${relative} missing schema-v3 receipt contract`);
    assert.ok(text.includes('DHPK_ROOT=/absolute/path/to/dhpk'), `${relative} missing ordinary-terminal checkout form`);
  }

  for (const relative of ['README.md', 'README.zh-TW.md']) {
    const text = read(relative);
    assert.ok(!/until .*issue #88.*test passes|在 .*issue #88.*通過之前/is.test(text), `${relative} still says issue #88 proof has not passed`);
  }
});

test('basic-operation locales keep heading, command, and link parity', () => {
  const english = read('docs/basic-operations.md');
  const chinese = read('docs/basic-operations.zh-TW.md');
  const headingLevels = (text) => [...text.matchAll(/^(#{1,4})\s+/gm)].map((match) => match[1].length);
  assert.deepStrictEqual(headingLevels(chinese), headingLevels(english), 'locale heading structure drifted');

  const commandShape = (text) => text
    .split('\n')
    .filter((line) => /^(?:claude|codex|bash|DHPK_ROOT=|\/dhpk:|\$dhpk:|node scripts|git |openspec )/.test(line.trim()))
    .map((line) => line.trim().replace(/\.zh-TW(?=[.)`])/g, '').replace(/\s+#.*$/, ''));
  assert.deepStrictEqual(commandShape(chinese), commandShape(english), 'locale command examples drifted');

  const linkTargets = (text) => [...text.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0].replace(/\.zh-TW(?=\.md\b)/g, ''))
    .sort();
  assert.deepStrictEqual(linkTargets(chinese), linkTargets(english), 'locale link targets drifted');
});

test('Codex host guidance names the family entry points and never claims /dhpk:* is a Codex command', () => {
  const agents = read('codex/AGENTS.md');
  assert.ok(agents.includes('$flow-guide'), 'codex/AGENTS.md must contain $flow-guide');
  assert.ok(agents.includes('$flow-drive'), 'codex/AGENTS.md must contain $flow-drive');
  assert.match(agents, /has no `\/dhpk:do` command/,
    'codex/AGENTS.md must still state Codex has no /dhpk:do command');
  const keyDiffStart = agents.indexOf('## Key Differences from Claude Code');
  assert.ok(keyDiffStart >= 0, 'Key Differences heading missing');
  const nextHeading = agents.indexOf('\n### ', keyDiffStart);
  const keyDiff = agents.slice(keyDiffStart, nextHeading === -1 ? undefined : nextHeading);
  assert.ok(keyDiff.includes('$flow-drive'), 'Key Differences table must mention $flow-drive');
  assert.ok(keyDiff.includes('/agent'), 'Key Differences table must mention /agent');

  for (const relative of ['docs/basic-operations.md', 'docs/basic-operations.zh-TW.md']) {
    const text = read(relative);
    assert.ok(text.includes('$flow-drive'), `${relative} must mention $flow-drive`);
    assert.doesNotMatch(
      text,
      /\*\*route\*\* through `\/dhpk:do`/,
      `${relative} must not tell every host, including Codex, to route through /dhpk:do`,
    );
    assert.doesNotMatch(
      text,
      /(?:Codex workflows enter through|Codex 使用) `\/dhpk:do`/,
      `${relative} must not tell Codex users to run /dhpk:do`,
    );
    assert.doesNotMatch(
      text,
      /透過 `\/dhpk:do` 或明確 skill \*\*路由\*\*/,
      `${relative} must not keep the host-agnostic /dhpk:do route claim`,
    );
  }
});

test('basic-operation guides retain the safety and lifecycle decisions in both locales', () => {
  const required = [
    /wayfinder/i,
    /TDD/i,
    /impact/i,
    /NOT RUN/i,
    /(?:official.*(?:non-zero|非零)|(?:non-zero|非零).*official)/i,
    /openspec\/changes\//i,
    /archive/i,
    /DHPK_ROOT=\/absolute\/path\/to\/dhpk/,
  ];
  for (const relative of ['docs/basic-operations.md', 'docs/basic-operations.zh-TW.md']) {
    const text = read(relative);
    for (const pattern of required) assert.match(text, pattern, `${relative} missing ${pattern}`);
  }
});

test('module hook and uninstall ordering match the live dispatcher lifecycle', () => {
  const dispatcher = read('scripts/hooks/pre-bash-dispatch.sh');
  assert.match(dispatcher, /pre-bash-\*\.sh[\s\S]*pre-commit-\*\.sh/, 'dispatcher must own module Bash gates');
  for (const relative of ['README.md', 'README.zh-TW.md']) {
    const text = read(relative);
    assert.ok(text.includes('pre-bash-*.sh') && text.includes('pre-commit-*.sh'), `${relative} missing module Bash hooks`);
    assert.match(text, /automatically|自動執行/, `${relative} must say active-module Bash hooks are automatic`);
  }
  for (const relative of ['docs/basic-operations.md', 'docs/basic-operations.zh-TW.md']) {
    const text = read(relative);
    assert.ok(text.includes('plugin root') && text.includes('--uninstall'), `${relative} missing projection-first uninstall order`);
  }
});

test('all documented bundled-script handoffs are consumer-safe and canonical', () => {
  const markdown = [];
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(target);
      else if (entry.name.endsWith('.md')) markdown.push(target);
    }
  }
  collect(path.join(ROOT, 'commands'));
  collect(path.join(ROOT, 'skills'));

  const handoff = /bash\s+("?\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/run-skill\.sh"?|scripts\/run-skill\.sh)\s+([^\s`]+)\s+([^\s`]+)/g;
  const findings = [];
  let count = 0;
  for (const file of markdown) {
    const text = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = handoff.exec(text))) {
      count += 1;
      const relative = path.relative(ROOT, file);
      if (!match[1].includes('${CLAUDE_PLUGIN_ROOT}')) {
        findings.push(`${relative}: wrapper path is consumer-relative`);
      }
      const allowedTools = text.match(/^allowed-tools:\s*([^\n]+)$/m);
      if (allowedTools && !allowedTools[1].includes('Bash(bash:*)')) {
        findings.push(`${relative}: wrapper handoff is not authorized by allowed-tools`);
      }
      const helper = match[3].replace(/[),.;]+$/, '');
      const target = path.join(ROOT, 'skills', match[2], 'scripts', helper);
      if (!fs.existsSync(target)) findings.push(`${relative}: missing ${path.relative(ROOT, target)}`);
    }
  }
  assert.ok(count > 1, 'expected to inspect every documented run-skill handoff');
  assert.deepStrictEqual(findings, [], findings.join('\n'));

});

run('documentation-platform-parity');
