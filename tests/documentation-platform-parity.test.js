'use strict';

const fs = require('fs');
const path = require('path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function tableRow(text, firstCell, relative) {
  const row = text.split('\n').find((line) => line.startsWith(`| ${firstCell} |`));
  assert.ok(row, `${relative} is missing the ${firstCell} table row`);
  return row;
}

function introduction(text, opening, relative) {
  const start = text.indexOf(opening);
  assert.ok(start >= 0, `${relative} is missing its opening introduction`);
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end < 0 ? undefined : end);
}

const BILINGUAL_PAIRS = [
  ['README.md', 'README.zh-TW.md'],
  ['RELEASE.md', 'RELEASE.zh-TW.md'],
  ['docs/basic-operations.md', 'docs/basic-operations.zh-TW.md'],
  ['docs/configuration.md', 'docs/configuration.zh-TW.md'],
  ['docs/docker-setup.md', 'docs/docker-setup.zh-TW.md'],
  ['docs/distribution-surfaces.md', 'docs/distribution-surfaces.zh-TW.md'],
  ['docs/hook-extension.md', 'docs/hook-extension.zh-TW.md'],
  ['docs/skill-command-cheat-sheet.md', 'docs/skill-command-cheat-sheet.zh-TW.md'],
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
    const canonicalRow = tableRow(text, 'Canonical skills', relative);
    const nativeRow = tableRow(text, relative === 'README.md' ? 'Codex dual-track' : 'Codex 雙軌', relative);
    const hookRow = tableRow(text, 'Hooks', relative);
    assert.match(
      canonicalRow,
      relative === 'README.md'
        ? new RegExp(`\\|\\s*${canonicalCount}\\s+flat packages\\b`)
        : new RegExp(`\\|\\s*${canonicalCount}\\s+個扁平 package\\b`),
      `${relative} must attach the canonical count to the canonical-skills claim`,
    );
    assert.match(
      nativeRow,
      relative === 'README.md'
        ? new RegExp(`\\|\\s*${nativeCount}\\s+entries \\(\\d+ invokable\\)`)
        : new RegExp(`\\|\\s*${nativeCount}\\s+筆項目（\\d+ 個可呼叫）`),
      `${relative} must attach the native count to the Codex package claim`,
    );
    assert.match(
      hookRow,
      relative === 'README.md'
        ? new RegExp(`\\|\\s*${hookEvents.length}\\s+events\\b`)
        : new RegExp(`\\|\\s*${hookEvents.length}\\s+個事件`),
      `${relative} must attach the event count to the Hooks claim`,
    );
    for (const event of hookEvents) {
      assert.ok(hookRow.includes(event), `${relative} Hooks row missing event ${event}`);
    }

    const intro = relative === 'README.md'
      ? introduction(text, 'A generic, install-and-go Claude Code harness.', relative)
      : introduction(text, '通用、安裝即用的 Claude Code harness。', relative);
    assert.match(
      intro,
      relative === 'README.md'
        ? new RegExp(`\\b${moduleCount} opt-in stack modules\\b`)
        : new RegExp(`${moduleCount} 個可選技術棧模組`),
      `${relative} must attach the module count to the introduction's module claim`,
    );
    assert.ok(text.includes('manifests/distribution-inventory.json'), `${relative} missing inventory SSOT`);
    assert.ok(text.includes('plugins/dhpk/'), `${relative} missing physical native package`);
    assert.ok(text.includes('skills/dhpk-'), `${relative} missing flat public-name contract`);
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

test('canonical commands and Skills never hand off through the plugin-root run-skill wrapper', () => {
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
  // Self-contained Skills invoke their own local scripts (ADR-0022); a plugin-root
  // run-skill wrapper handoff in canonical commands or Skills is a regression.
  assert.strictEqual(count, 0, `canonical docs must not route through run-skill.sh:\n${findings.join('\n')}`);

});

test('issue 534 default documentation names the exact four-capability minimal profile', () => {
  const expected = ['change-verdict', 'code-trace', 'flow-drive', 'flow-guide'];
  const inventory = JSON.parse(read('manifests/distribution-inventory.json'));
  const profiles = JSON.parse(read('manifests/install-profiles.json'));
  assert.deepStrictEqual(inventory.profile_policy.required_core_ids.slice().sort(), expected);
  assert.deepStrictEqual(profiles.profiles.minimal.skillIds.slice().sort(), expected);

  const currentDocs = [
    'README.md',
    'README.zh-TW.md',
    'docs/configuration.md',
    'docs/configuration.zh-TW.md',
    'docs/distribution-surfaces.md',
    'docs/distribution-surfaces.zh-TW.md',
    'docs/skill-command-cheat-sheet.md',
    'docs/skill-command-cheat-sheet.zh-TW.md',
    'docs/skill-platform-migration.md',
    'docs/skill-platform-migration.zh-TW.md',
    'openspec/specs/capability-bundle-selection/spec.md',
    'openspec/specs/claude-capability-bundle/spec.md',
    'openspec/specs/skill-discovery-context-budget/spec.md',
  ];
  for (const relative of currentDocs) {
    const text = read(relative);
    assert.doesNotMatch(text, /minimal\s*=\s*8|eight-capability|eight canonical IDs|eight required core IDs|8 個 skill/i,
      `${relative} still describes the retired eight-capability default`);
  }

  for (const relative of [
    'README.md', 'README.zh-TW.md',
    'docs/skill-command-cheat-sheet.md', 'docs/skill-command-cheat-sheet.zh-TW.md',
  ]) {
    const text = read(relative);
    for (const name of expected) assert.ok(text.includes(name), `${relative} missing default capability ${name}`);
  }
});

test('issue 534 user guides expose one evidence-scoped path per host', () => {
  const pairs = [
    ['README.md', 'README.zh-TW.md'],
    ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md'],
    ['docs/skill-platform-migration.md', 'docs/skill-platform-migration.zh-TW.md'],
    ['RELEASE.md', 'RELEASE.zh-TW.md'],
  ];
  const required = [
    'scripts/install.sh',
    'install-codex-skills.sh',
    'install-cursor-harness.sh',
    'install-agy-plugin.js',
    'NOT_RUN',
    'BLOCKED',
    'UNAVAILABLE',
  ];
  for (const pair of pairs) {
    for (const relative of pair) {
      const text = read(relative);
      for (const token of required) assert.ok(text.includes(token), `${relative} missing ${token}`);
    }
  }

  for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
    const text = read(relative);
    assert.ok(text.includes('NOT_IMPLEMENTED'), `${relative} must keep generic lifecycle writes fail-closed`);
    assert.match(text, /Claude/, `${relative} must document the Claude minimal-profile route`);
  }
});



// Consolidated source suite: platform-installation-docs (tests/platform-installation-docs.test.js).
{
  // Cross-file contract for the platform installation SSOT. This deliberately
  // checks links and status vocabulary rather than attempting to prove a live
  // Codex or Cursor consumer from repository prose.

  const fs = require('node:fs');
  const path = require('node:path');

  const ROOT = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const CURRENT_VERSION = JSON.parse(read('.claude-plugin/plugin.json')).version;
  const STATUS = ['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE'];

  function section(text, heading) {
    const start = text.indexOf(heading);
    assert.ok(start >= 0, `missing section ${heading}`);
    const next = text.indexOf('\n## ', start + heading.length);
    return text.slice(start, next >= 0 ? next : text.length);
  }

  function currentCodexRoleCounts() {
    const roles = fs.readdirSync(path.join(ROOT, 'codex', 'agents'))
      .filter((entry) => entry.endsWith('.toml'));
    const projection = JSON.parse(read('codex/agent-projection-manifest.json'));
    return {
      direct: roles.length,
      generated: projection.generated_roles.length,
    };
  }

  test('bilingual installation SSOT exists and exposes every canonical status', () => {
    const english = read('docs/platform-installation.md');
    const chinese = read('docs/platform-installation.zh-TW.md');
    for (const status of STATUS) {
      assert.ok(english.includes(`\`${status}\``), `English SSOT missing ${status}`);
      assert.ok(chinese.includes(`\`${status}\``), `Traditional Chinese SSOT missing ${status}`);
    }
    assert.ok(english.includes('platform-installation.zh-TW.md'));
    assert.ok(chinese.includes('platform-installation.md'));
  });

  test('bilingual SSOT documents the read-only unified lifecycle slice without claiming write support', () => {
    for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
      const text = read(relative);
      const compact = text.replace(/\s+/g, ' ');
      assert.ok(text.includes('dhpk-install cursor plan --scope project --json'), `${relative} must document the JSON plan command`);
      assert.ok(text.includes('NOT_IMPLEMENTED'), `${relative} must disclose unavailable write actions`);
      assert.ok(compact.includes('INSTALL_PASS + CONSUMER_BLOCKED'), `${relative} must distinguish lifecycle aggregate from consumer evidence`);
    }
  });

  test('bilingual SSOT pins Codex collision exit and AGY import-only discovery', () => {
    for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
      const text = read(relative);
      assert.ok(
        text.includes('exits non-zero') || text.includes('非零'),
        `${relative} must say --update without --adopt exits non-zero while a collision remains`,
      );
      assert.ok(
        text.includes('import-only') || text.includes('只列 import') || text.includes('只列出 import'),
        `${relative} must say agy plugins list is import-only`,
      );
      assert.ok(
        text.includes('isolated `agy agents`') || text.includes('隔離 HOME 的 `agy agents`'),
        `${relative} must say isolated agy agents is the native load signal`,
      );
    }
  });

  test('installation routes remain separate and point to the SSOT', () => {
    const docs = [
      'README.md', 'README.zh-TW.md',
      'docs/basic-operations.md', 'docs/basic-operations.zh-TW.md',
      'docs/configuration.md', 'docs/configuration.zh-TW.md',
      'docs/distribution-surfaces.md', 'docs/distribution-surfaces.zh-TW.md',
      'docs/skill-platform-migration.md', 'docs/skill-platform-migration.zh-TW.md',
      'codex/README.md', 'codex/README.zh-TW.md', 'codex/AGENTS.md',
      'cursor/AGENTS.md',
      '.codex-plugin/README.md', 'plugins/dhpk/README.md', 'plugins/dhpk/README.zh-TW.md',
    ];
    for (const rel of docs) {
      const text = read(rel);
      assert.match(text, /platform-installation(?:\.zh-TW)?\.md/, `${rel} must link the canonical guide`);
    }
    const english = read('docs/platform-installation.md');
    for (const token of [
      'install-codex-skills.sh',
      'install-cursor-harness.sh',
      '.cursor/.dhpk-installed.json',
      'schema-v3',
      'codex plugin marketplace add',
      'plugins/dhpk-agent/',
      'plugins/dhpk-cursor/',
      'Cursor CLI',
      '--plugin-dir',
      'cursor-agent status',
      'Authentication required',
      'non-interactive `plugin install`',
      'experimental/conditional',
      'mcp.json',
      'plugins/dhpk-agy/',
      'install-agy-plugin.js',
      'install-agy-plugin.js plan',
      'install-agy-plugin.js status',
      'FOREIGN_CHECKOUT',
      `--version=${CURRENT_VERSION}`,
      '--trust',
      'ignores stdin',
      'exits non-zero',
      'import-only',
      'isolated `agy agents`',
      '--targets agy',
      '--agy-runtime-probe',
      'agy plugins list',
      'SKIP_INCOMPATIBLE',
      'UNAVAILABLE',
    ]) assert.ok(english.includes(token), `SSOT missing ${token}`);
  });

  test('bilingual SSOT pins the unified AGY generator to the current plugin version', () => {
    const expected = `bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=${CURRENT_VERSION}`;
    for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
      const text = read(relative);
      assert.ok(
        text.includes(expected),
        `${relative} must document ${expected}`,
      );
    }
  });

  test('AGY installation docs separate consumer install from maintainer generation', () => {
    const sections = [
      section(read('docs/platform-installation.md'), '## AGY / Antigravity CLI plugin (Experimental)'),
      section(read('docs/platform-installation.zh-TW.md'), '## AGY／Antigravity CLI plugin（Experimental）'),
    ];
    for (const agy of sections) {
      const compact = agy.replace(/\s+/g, ' ');
      assert.ok(compact.includes('install-agy-plugin.js install'), 'AGY docs must show direct consumer installation');
      assert.ok(compact.includes('--source plugins/dhpk-agy'), 'consumer install must use the checked-in package');
      assert.ok(compact.includes('/tmp/dhpk-agy-staging'), 'local generation must use an external staging path');
      assert.ok(/maintainer/i.test(compact) || /維護/.test(compact), 'AGY docs must identify generation as maintainer work');
      assert.ok(/tracked|追蹤/.test(compact), 'AGY docs must warn about the tracked package path');
    }
  });

  test('Cursor CLI documentation keeps authentication, launch scope, and UI routes distinct', () => {
    const english = read('docs/platform-installation.md');
    const chinese = read('docs/platform-installation.zh-TW.md');
    const cliSections = [
      section(english, '## Cursor CLI (launch-scoped probe)'),
      section(chinese, '## Cursor CLI（launch-scoped probe）'),
    ];
    for (const cli of cliSections) {
      assert.ok(cli.includes('--plugin-dir "$HOME/.cursor/plugins/local/dhpk-agent"'),
        'Cursor CLI probe must pass the portable Agent Plugin path');
      assert.ok(cli.includes('--plugin-dir "$HOME/.cursor/plugins/local/dhpk-cursor"'),
        'Cursor CLI probe must pass the native Cursor Plugin path');
      assert.ok(cli.includes('cursor-agent-probe.js'), 'Cursor CLI route must use the bounded wrapper');
      assert.ok(cli.includes('--timeout-ms 60000'), 'Cursor CLI route must declare a finite timeout');
      assert.ok(cli.includes('--max-output-bytes 262144'), 'Cursor CLI route must cap output');
      assert.ok(cli.includes('5-minute') || cli.includes('5 分鐘'), 'Cursor CLI route must state the timeout ceiling');
      assert.ok(cli.includes('4 MiB'), 'Cursor CLI route must state the output ceiling');
      assert.ok(cli.includes('timed_out: true'), 'Cursor CLI route must document timeout evidence');
      assert.ok(cli.includes('SKIP_INCOMPATIBLE'), 'Cursor CLI route must document silent-hang incompatibility');
      assert.ok(cli.includes('no_stdout: true'), 'Cursor CLI route must document empty-timeout evidence');
      assert.ok(cli.includes('output_limited: true'), 'Cursor CLI route must document output-limit evidence');
      assert.ok(cli.includes('capability-negative') || cli.includes('capability 的'), 'Cursor CLI route must reject negative discovery evidence');
      assert.ok(cli.includes('--mode ask'), 'Cursor CLI route must be read-only for the verification probe');
      assert.ok(cli.includes('--trust'), 'Cursor CLI probe must skip the workspace trust prompt');
      assert.ok(cli.includes('stdin') || cli.includes('TTY'), 'Cursor CLI probe must document ignored stdin / no inherited TTY');
      assert.ok(cli.includes("-p 'Read only. Return exactly: dhpk skills commands agents rules loaded. CURSOR_SMOKE_OK. Do not call tools or edit files.'"),
        'Cursor CLI probe must state its read-only discovery prompt');
      assert.ok(cli.includes('--output-format stream-json'), 'Cursor CLI route must preserve machine-readable stream evidence');
      assert.ok(cli.includes('--stream-partial-output'), 'Cursor CLI route must expose bounded partial output');
      assert.ok(cli.includes('cursor-agent login'), 'Cursor CLI route must document authentication');
      assert.ok(cli.includes('cursor-agent status'), 'Cursor CLI route must document auth status');
      assert.ok(cli.includes('~/.cursor/plugins/local/'), 'Cursor persistent local route must remain documented');
      assert.ok(cli.includes('marketplace add'), 'Cursor marketplace route must remain distinct from install');
      assert.ok(cli.includes('launch-scoped'), 'Cursor CLI route must define its invocation scope');
    }
  });

  test('Cursor runtime documentation pins cursor-agent evidence and required status boundaries', () => {
    for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
      const compact = read(relative).replace(/\s+/g, ' ');
      assert.ok(compact.includes('cursor-agent --plugin-dir <agent-package>'), `${relative} must document the portable single-directory probe shape`);
      assert.ok(compact.includes('cursor-agent --plugin-dir <agent-package> --plugin-dir <cursor-package>'), `${relative} must document the dual-directory Cursor probe shape`);
      assert.ok(compact.includes('--mode ask --trust -p <smoke-prompt> --output-format stream-json --stream-partial-output'), `${relative} must document the exact bounded probe flag shape`);
      assert.ok(compact.includes('cursor-sync') && compact.includes('NOT_RUN'), `${relative} must document the expected cursor-sync installer state`);
      assert.ok(compact.includes('cursor desktop') || compact.includes('Cursor desktop'), `${relative} must identify desktop/UI paths as separate from CLI proof`);
      assert.ok(compact.includes('`cursor`') || compact.includes('cursor binary'), `${relative} must reject the desktop cursor binary as runtime evidence`);
      assert.ok(compact.includes('Authentication required') && compact.includes('BLOCKED'), `${relative} must classify unauthenticated Cursor output as BLOCKED`);
      assert.ok(compact.includes('missing CLI') && compact.includes('UNAVAILABLE'), `${relative} must classify missing cursor-agent as UNAVAILABLE`);
      assert.ok(!compact.includes('logged-in Cursor CLI (or an API key)') && !compact.includes('已登入 Cursor CLI（或 API key）'), `${relative} must not treat API-key-only auth as runtime proof`);
    }
  });

  test('Codex verification commands declare consumer and checkout roots', () => {
    for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
      const text = read(relative);
      assert.ok(text.includes('test -f .codex/.dhpk-installed.json'),
        `${relative} must keep the consumer-root receipt check`);
      assert.ok(text.includes('DHPK_ROOT=/absolute/path/to/dhpk'),
        `${relative} must declare the dhpk checkout root`);
      assert.ok(text.includes('node "$DHPK_ROOT/scripts/ci/validate-openai-metadata.js" --root "$DHPK_ROOT"'),
        `${relative} must qualify the metadata validator with DHPK_ROOT`);
      assert.ok(text.includes('node "$DHPK_ROOT/tests/install-codex-skills.test.js"'),
        `${relative} must qualify the installer test with DHPK_ROOT`);
      assert.ok(!text.includes('node scripts/ci/validate-openai-metadata.js --root .'),
        `${relative} must not run the source validator from the consumer root`);
      assert.ok(!text.includes('node tests/install-codex-skills.test.js'),
        `${relative} must not run the source test from the consumer root`);
    }
  });

  test('Cursor project-local verification commands declare consumer and checkout roots', () => {
    for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
      const text = read(relative);
      assert.ok(text.includes('test -f .cursor/.dhpk-installed.json'),
        `${relative} must keep the consumer-root Cursor receipt check`);
      assert.ok(text.includes('node "$DHPK_ROOT/scripts/ci/validate-cursor-sync.js"'),
        `${relative} must qualify the Cursor layout validator with DHPK_ROOT`);
      assert.ok(text.includes('node "$DHPK_ROOT/tests/install-cursor-harness.test.js"'),
        `${relative} must qualify the Cursor installer test with DHPK_ROOT`);
      assert.ok(!text.includes('node tests/install-cursor-harness.test.js'),
        `${relative} must not run the Cursor installer test from the consumer root`);
    }
  });

  test('bilingual SSOT says Cursor marketplace hash cache is not the installed version', () => {
    const english = read('docs/platform-installation.md');
    const chinese = read('docs/platform-installation.zh-TW.md');
    assert.ok(english.includes('~/.cursor/plugins/cache/dhpk/dhpk/'),
      'English SSOT must name the Cursor marketplace hash-cache path');
    assert.ok(chinese.includes('~/.cursor/plugins/cache/dhpk/dhpk/'),
      'Traditional Chinese SSOT must name the Cursor marketplace hash-cache path');
    assert.ok(english.includes('not SSOT') || english.includes('is not SSOT'),
      'English SSOT must say the hash cache is not SSOT');
    assert.ok(chinese.includes('不是 SSOT') || chinese.includes('並非 SSOT'),
      'Traditional Chinese SSOT must say the hash cache is not SSOT');
    assert.ok(english.includes('cursor_marketplace_hash_cache_drift'),
      'English SSOT must name the --plan warning code');
    assert.ok(chinese.includes('cursor_marketplace_hash_cache_drift'),
      'Traditional Chinese SSOT must name the --plan warning code');
  });

  test('current Codex operational docs match the projection role counts', () => {
    const { direct, generated } = currentCodexRoleCounts();
    for (const relative of [
      'docs/basic-operations.md',
      'docs/basic-operations.zh-TW.md',
      'docs/configuration.md',
      'docs/configuration.zh-TW.md',
    ]) {
      const text = read(relative);
      assert.ok(text.includes('codex/agents/'), `${relative} must identify the Codex agent projection`);
      assert.match(text, new RegExp(`${direct}[\\s\\S]{0,120}(?:direct\\s+roles?|個\\s+direct\\s+role)`, 'i'),
        `${relative} must document ${direct} direct Codex roles`);
      assert.match(text, new RegExp(`${generated}[\\s\\S]{0,120}(?:generated|產生)`, 'i'),
        `${relative} must document ${generated} generated Codex roles`);
    }
  });

  test('inventory declares explicit platform matrix and frontmatter ownership', () => {
    const inventory = JSON.parse(read('manifests/distribution-inventory.json'));
    assert.deepStrictEqual(inventory.surfaces.slice(-4), ['agent-plugin', 'cursor-plugin', 'cursor-sync', 'agy-plugin']);
    assert.ok(Array.isArray(inventory.surface_membership['agent-plugin']));
    assert.ok(Array.isArray(inventory.surface_membership['cursor-plugin']));
    assert.ok(Array.isArray(inventory.surface_membership['cursor-sync']));
    assert.ok(Array.isArray(inventory.surface_membership['agy-plugin']));
    assert.strictEqual(inventory.platform_matrix.schema, 'dhpk.platform-capability-matrix.v1');
    assert.ok(inventory.platform_matrix.entries.length >= 5);
    const agentSkills = inventory.platform_matrix.entries.find((entry) => entry.id === 'dhpk.platform.agent-plugin.skills');
    const cursorSkills = inventory.platform_matrix.entries.find((entry) => entry.id === 'dhpk.platform.cursor-plugin.skills');
    assert.strictEqual(agentSkills.projection_mode, 'owner');
    assert.strictEqual(cursorSkills.projection_mode, 'shared');
    assert.strictEqual(cursorSkills.shared_surface, 'agent-plugin');
    assert.strictEqual(cursorSkills.destination, 'plugins/dhpk-agent/skills/');
    const agy = inventory.platform_matrix.entries.find((entry) => entry.id === 'dhpk.platform.agy-plugin.native');
    assert.strictEqual(agy.surface, 'agy-plugin');
    assert.strictEqual(agy.destination, 'plugins/dhpk-agy/');
    assert.ok(inventory.portable_frontmatter.allowlist.includes('metadata'));
    assert.ok(inventory.portable_frontmatter.client_owned.includes('agents/openai.yaml'));
  });

  test('generated package READMEs point back to the bilingual installation SSOT', () => {
    for (const file of [
      'plugins/dhpk-agent/README.md',
      'plugins/dhpk-agent/README.zh-TW.md',
      'plugins/dhpk-cursor/README.md',
      'plugins/dhpk-cursor/README.zh-TW.md',
    ]) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.match(text, /platform-installation(?:\.zh-TW)?\.md/);
    }
  });

  test('package paths and marketplace entries are inventory-visible and exact', () => {
    const agent = JSON.parse(read('plugins/dhpk-agent/plugin.json'));
    const cursor = JSON.parse(read('plugins/dhpk-cursor/.cursor-plugin/plugin.json'));
    const marketplace = JSON.parse(read('plugins/dhpk-cursor/.cursor-plugin/marketplace.json'));
    assert.strictEqual(agent.name, 'dhpk');
    assert.strictEqual(cursor.name, 'dhpk-cursor');
    assert.strictEqual(cursor.skills, './skills/');
    assert.strictEqual(cursor.hooks, './hooks/hooks.json');
    assert.deepStrictEqual(fs.readdirSync(path.join(ROOT, 'plugins', 'dhpk-cursor', 'skills')).sort(), [
      'dhpk-agy-fast-worker', 'dhpk-cli-dispatch-context', 'dhpk-cli-transport', 'dhpk-codex-bridge',
    ]);
    const cursorProvenance = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'dhpk-cursor', 'provenance.json'), 'utf8'));
    assert.strictEqual(cursorProvenance.skillProjectionMode, 'overlay');
    assert.deepStrictEqual(cursorProvenance.selectedSkillIds, ['agy-fast-worker', 'cli-dispatch-context', 'cli-transport', 'codex-bridge']);
    assert.strictEqual(cursorProvenance.sharedSkillSurface, 'agent-plugin');
    assert.strictEqual(cursorProvenance.sharedSkillSource, 'plugins/dhpk-agent/skills/');
    assert.ok(cursorProvenance.sharedSkillIds.length > 0);
    assert.strictEqual(marketplace.plugins.length, 1);
    assert.strictEqual(marketplace.plugins[0].source, '.');
  });

  test('generated package Markdown has no broken relative links', () => {
    for (const packageRoot of ['plugins/dhpk-agent', 'plugins/dhpk-cursor', 'plugins/dhpk-agy']) {
      const broken = [];
      const walk = (directory) => {
        for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
          const relative = path.join(directory, entry.name);
          const absolute = path.join(ROOT, relative);
          if (entry.isDirectory()) walk(relative);
          else if (/\.md$/i.test(entry.name)) {
            const content = fs.readFileSync(absolute, 'utf8');
            for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
              const target = match[1].trim();
              if (!target || target.startsWith('#') || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(target)) continue;
              const pathPart = target.split('#', 1)[0].trim();
              if (pathPart && !fs.existsSync(path.resolve(path.dirname(absolute), pathPart))) broken.push(`${relative} -> ${target}`);
            }
          }
        }
      };
      walk(packageRoot);
      assert.deepStrictEqual(broken, [], `${packageRoot} has broken links: ${broken.join(', ')}`);
    }
  });
}

// Consolidated source suite: workflow-docs (tests/workflow-docs.test.js).
{
  const fs = require('node:fs');
  const path = require('node:path');

  const ROOT = path.resolve(__dirname, '..');

  function read(relative) {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
  }

  test('workflow guides expose the route-first user contract in both locales', () => {
    const required = [
      'inspect → verify surface → route → plan/classify → implement → review → verify → handoff',
      'flow-guide route',
      'route --go',
      'MATCH',
      'NO_MATCH',
      'NO_QUERY',
      'implicit-eligible',
      'explicit-only',
      '--worker=',
      '--reasoner=',
      'CODEX=on',
      'TDD',
      'impact',
      'wayfinder',
      'openspec/changes/',
      'archive',
      'NOT_RUN',
      'NO_SHIP',
      'harness-workflow',
      'machine-readable',
    ];
    for (const relative of ['docs/basic-operations.md', 'docs/basic-operations.zh-TW.md']) {
      const text = read(relative);
      for (const token of required) {
        assert.ok(text.includes(token), `${relative} missing workflow token: ${token}`);
      }
    }
  });

  test('update-docs command and doc-updater agent follow the writing contract', () => {
    const command = read('commands/update-docs.md');
    const skill = read('skills/update-docs/SKILL.md');
    const agent = read('agents/doc-updater.md');
    // The command is a thin front door; the procedure contract lives in the Skill.
    assert.match(command, /\$update-docs/);
    assert.match(command, /\$ARGUMENTS` unchanged/);
    for (const [label, text] of [['skills/update-docs/SKILL.md', skill], ['agents/doc-updater.md', agent]]) {
      assert.match(text, /writing-for-agents/i, `${label} must point to writing-for-agents`);
      assert.match(text, /Need Human|BLOCKED/i, `${label} must define an escalation boundary`);
      assert.match(text, /NOT_RUN|PASS/i, `${label} must define observable validation`);
      for (const stale of ['src/service', 'src/provider', 'src/entity', 'docs/features']) {
        assert.strictEqual(text.includes(stale), false, `${label} contains stale placeholder path ${stale}`);
      }
    }
    assert.match(command, /dhpk-invocation-class:\s*implicit-eligible/);
    assert.match(agent, /^model:\s*(?:haiku|sonnet|opus)$/m);
    assert.strictEqual(/\n\/update-docs\b/.test(command), false, 'command examples must keep the dhpk namespace');
    assert.match(skill, /manifests\/distribution-inventory\.json/);
    assert.match(skill, /rules\/execution-policy\.md/);
    assert.match(agent, /cx overview/);
    assert.match(agent, /GitNexus/i);
  });

  test('README and command index point users to the capability-family route entry', () => {
    for (const relative of ['README.md', 'README.zh-TW.md']) {
      const text = read(relative);
      assert.match(text, /flow-guide[^\n]*route|flow-guide[\s\S]*route --go/);
      assert.match(text, /explicit-only/);
      assert.match(text, /basic-operations(?:\.zh-TW)?\.md/);
      assert.doesNotMatch(text, /\/dhpk:do --route-only/);
    }
    const index = read('commands/INDEX.md');
    assert.match(index, /flow-guide.*help\|route\|rules\|next\|close/i);
    assert.match(index, /former review aliases are retired/i);
    assert.doesNotMatch(index, /create-dev.*alias/i);
  });
}

run('documentation-platform-parity');
