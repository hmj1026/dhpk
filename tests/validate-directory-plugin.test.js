'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { validateDirectoryPlugin } = require('../scripts/ci/validate-directory-plugin');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'validate-directory-plugin.js');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function validDirectoryFiles(overrides = {}) {
  const base = {
    '.claude-plugin/plugin.json': JSON.stringify({
      name: 'dhpk-lite',
      version: PKG_VERSION,
      description: 'Instruction-only DHPK directory plugin.',
      homepage: 'https://github.com/hmj1026/dhpk',
      repository: 'https://github.com/hmj1026/dhpk',
      icon: './.claude-plugin/icon.png',
      bugs: 'https://github.com/hmj1026/dhpk/issues',
      agents: ['./agents/code-reviewer.md'],
    }, null, 2),
    '.claude-plugin/icon.png': Buffer.from('pngbytes'),
    LICENSE: 'MIT\n',
    'README.md': [
      '# dhpk-lite',
      '',
      'Instruction-only Directory Plugin for Claude Code without hooks, scripts, or userConfig.',
      'It ships all 17 workflow skills (including Manual Procedures with mode: manual) and omits',
      'codex-worker, codex-reasoner, agy-worker. Do not enable both dhpk and dhpk-lite together.',
      'Install the Full Plugin from the Repository Marketplace with /plugin marketplace add hmj1026/dhpk',
      'and /plugin install dhpk@dhpk.',
      '',
    ].join('\n'),
    'skill-next-map.json': JSON.stringify({
      schema: 'dhpk.skill-next-map.v1',
      skills: {
        'code-trace': { invocationClass: 'implicit-eligible' },
      },
    }, null, 2),
    'skills/code-trace/SKILL.md': [
      '---',
      'name: code-trace',
      'description: "Trace code flows."',
      '---',
      '# Code Trace',
      'Use `dhpk-lite:code-reviewer` and see [next map](../../skill-next-map.json).',
      '',
    ].join('\n'),
    'agents/code-reviewer.md': [
      '---',
      'name: code-reviewer',
      'description: "Review code."',
      'model: sonnet',
      'tools: Read, Grep, Glob',
      '---',
      '# Code Reviewer',
      '',
    ].join('\n'),
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return base;
}

function withDir(overrides, fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dir-gate-'));
  try {
    writeFiles(temp, validDirectoryFiles(overrides));
    return fn(temp);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('conformant Directory Plugin passes with no errors', () => {
  withDir({}, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, true, JSON.stringify(res.errors));
    assert.deepStrictEqual(res.errors, []);
  });
});

test('disallowed file extension fails and names file and rule', () => {
  for (const [file, body] of [
    ['templates/sample.example', '{}'],
    ['skills/code-trace/icon.svg', '<svg/>'],
    ['helper.js', 'module.exports = 1;\n'],
  ]) {
    withDir({ [file]: body }, (dir) => {
      const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
      assert.strictEqual(res.ok, false, file);
      assert.ok(res.errors.some((e) => e.file === file && e.rule === 'allowed-file-type'), JSON.stringify(res.errors));
    });
  }
});

test('shebang file fails and names file and rule', () => {
  for (const [file, body] of [
    ['skills/code-trace/references/run.txt', '#!/bin/sh\necho hi\n'],
    ['skills/code-trace/references/bom.md', '\uFEFF#!/usr/bin/env node\n'],
  ]) {
    withDir({ [file]: body }, (dir) => {
      const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
      assert.strictEqual(res.ok, false, file);
      assert.ok(res.errors.some((e) => e.file === file && e.rule === 'no-shebang'), JSON.stringify(res.errors));
    });
  }
});

test('forbidden paths fail and name file and rule', () => {
  for (const file of [
    'hooks/hooks.json',
    'hooks.json',
    '.mcp.json',
    '.lsp.json',
    'monitors.json',
    'agents/INDEX.md',
    'bin/tool.txt',
    'scripts/helper.txt',
    'manifests/m.json',
    'skills/code-trace/scripts/run.md',
  ]) {
    withDir({ [file]: 'content\n' }, (dir) => {
      const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
      assert.strictEqual(res.ok, false, file);
      assert.ok(res.errors.some((e) => e.file === file && e.rule === 'forbidden-path'), JSON.stringify(res.errors));
    });
  }
});

test('omitted external CLI agents fail while admitted manual-procedure skills pass', () => {
  withDir({ 'skills/flow-guide/SKILL.md': '---\nname: flow-guide\ndescription: "Router"\n---\n' }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, true, JSON.stringify(res.errors));
  });
  withDir({ 'agents/codex-worker.md': '---\nname: codex-worker\ndescription: "Worker"\n---\n' }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'agents/codex-worker.md' && e.rule === 'omitted-agent'), JSON.stringify(res.errors));
  });
});

test('nested SKILL.md or REFERENCE.md carrying frontmatter fails no-nested-skill-md', () => {
  withDir({ 'skills/code-trace/references/sub/SKILL.md': '# Nested Skill\n' }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'skills/code-trace/references/sub/SKILL.md' && e.rule === 'no-nested-skill-md'), JSON.stringify(res.errors));
  });
  withDir({ 'skills/code-trace/references/sub/REFERENCE.md': '---\nname: sub\ndescription: "Sub"\n---\n# Nested\n' }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'skills/code-trace/references/sub/REFERENCE.md' && e.rule === 'no-nested-skill-md'), JSON.stringify(res.errors));
  });
  withDir({ 'skills/code-trace/references/sub/REFERENCE.md': '# Nested\n' }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, true, JSON.stringify(res.errors));
  });
});

test('disallowed skill frontmatter keys fail and name file and rule', () => {
  for (const extra of [
    'allowed-tools: Read',
    'argument-hint: "<id>"',
    'disable-model-invocation: true',
    'context: fork',
    'metadata:\n  dhpk-invocation-class: implicit-eligible',
  ]) {
    const content = `---\nname: code-trace\ndescription: "Trace"\n${extra}\n---\n# Body\n`;
    withDir({ 'skills/code-trace/SKILL.md': content }, (dir) => {
      const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
      assert.strictEqual(res.ok, false, extra);
      assert.ok(res.errors.some((e) => e.file === 'skills/code-trace/SKILL.md' && e.rule === 'skill-frontmatter'), JSON.stringify(res.errors));
    });
  }
});

test('disallowed agent frontmatter keys or block scalars fail and name file and rule', () => {
  for (const content of [
    '---\nname: code-reviewer\ndescription: "Review"\nmodel: sonnet\ntools: Read\neffort: medium\n---\n',
    '---\nname: code-reviewer\ndescription: "Review"\nmodel: sonnet\ntools: Read\nskills: ["tdd-workflow"]\n---\n',
    '---\nname: code-reviewer\ndescription: >-\n  Multi line\nmodel: sonnet\ntools: Read\n---\n',
  ]) {
    withDir({ 'agents/code-reviewer.md': content }, (dir) => {
      const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
      assert.strictEqual(res.ok, false, content);
      assert.ok(res.errors.some((e) => e.file === 'agents/code-reviewer.md' && e.rule === 'agent-frontmatter'), JSON.stringify(res.errors));
    });
  }
});

test('unrewritten dhpk: namespace or $skill-name token fails and names file and rule', () => {
  const md = '---\nname: code-trace\ndescription: "Trace"\n---\nUse `dhpk:code-reviewer`.\n';
  withDir({ 'skills/code-trace/SKILL.md': md }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'skills/code-trace/SKILL.md' && e.rule === 'namespace-rewrite'), JSON.stringify(res.errors));
  });
  const dollarMd = '---\nname: code-trace\ndescription: "Trace"\n---\nUse `$flow-drive`.\n';
  withDir({ 'skills/code-trace/SKILL.md': dollarMd }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'skills/code-trace/SKILL.md' && e.rule === 'namespace-rewrite' && e.message.includes('$flow-drive')), JSON.stringify(res.errors));
  });
});

test('manifest userConfig, wrong name, or version mismatch fails with manifest-contract rule', () => {
  const baseManifest = JSON.parse(validDirectoryFiles()['.claude-plugin/plugin.json']);
  for (const mut of [
    (m) => { m.name = 'dhpk'; },
    (m) => { m.version = '0.0.1'; },
    (m) => { m.userConfig = { hook_profile: { type: 'string' } }; },
    (m) => { m.hooks = './hooks/hooks.json'; },
    (m) => { delete m.bugs; },
  ]) {
    const m = JSON.parse(JSON.stringify(baseManifest));
    mut(m);
    withDir({ '.claude-plugin/plugin.json': JSON.stringify(m) }, (dir) => {
      const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
      assert.strictEqual(res.ok, false);
      assert.ok(res.errors.some((e) => e.file === '.claude-plugin/plugin.json' && e.rule === 'manifest-contract'), JSON.stringify(res.errors));
    });
  }
});

test('missing skill-next-map.json or broken skill-next-map reference fails and names file and rule', () => {
  withDir({ 'skill-next-map.json': null }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'skill-next-map.json' && e.rule === 'skill-next-map'), JSON.stringify(res.errors));
  });
  const brokenRef = '---\nname: code-trace\ndescription: "Trace"\n---\nSee `skills/flow-guide/references/skill-next-map.json`.\n';
  withDir({ 'skills/code-trace/SKILL.md': brokenRef }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'skills/code-trace/SKILL.md' && e.rule === 'skill-next-map'), JSON.stringify(res.errors));
  });
});

test('references to omitted agents emit warnings without failing CLI', () => {
  const body = '---\nname: code-trace\ndescription: "Trace"\n---\nDelegate to `codex-worker` or `agy-worker`.\n';
  const jsonFile = JSON.stringify({ agent: 'codex-reasoner' });
  withDir({
    'skills/code-trace/SKILL.md': body,
    'skills/code-trace/references/routing.json': jsonFile,
  }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, true, JSON.stringify(res.errors));
    assert.ok(res.warnings.some((w) => w.file === 'skills/code-trace/SKILL.md' && w.target === 'codex-worker'), JSON.stringify(res.warnings));
    assert.ok(res.warnings.some((w) => w.file === 'skills/code-trace/SKILL.md' && w.target === 'agy-worker'), JSON.stringify(res.warnings));
    assert.ok(res.warnings.some((w) => w.file === 'skills/code-trace/references/routing.json' && w.target === 'codex-reasoner' && w.rule === 'omitted-reference'), JSON.stringify(res.warnings));

    const cli = spawnSync(process.execPath, [CLI, '--dir', dir, '--version', PKG_VERSION], { encoding: 'utf8' });
    assert.strictEqual(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    assert.match(cli.stdout + cli.stderr, /WARN.*codex-worker/);
    assert.match(cli.stdout, /omitted-reference: 3/);
  });
});

test('kept-skill text naming a removed scripts/ path fails validation with removed-script-reference', () => {
  const body = [
    '---',
    'name: code-trace',
    'description: "Trace"',
    '---',
    'Run `node ${CLAUDE_SKILL_DIR}/scripts/risk-analyze.js` or `scripts/verify-runner.js`.',
    '',
  ].join('\n');
  withDir({ 'skills/code-trace/SKILL.md': body }, (dir) => {
    // No Full Plugin tree to compare against: every scripts/ reference is an error.
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION, fullPluginDir: path.join(dir, 'no-full-plugin') });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'skills/code-trace/SKILL.md' && e.rule === 'removed-script-reference' && e.message.includes('scripts/risk-analyze.js')), JSON.stringify(res.errors));
    assert.ok(res.errors.some((e) => e.file === 'skills/code-trace/SKILL.md' && e.rule === 'removed-script-reference' && e.message.includes('scripts/verify-runner.js')), JSON.stringify(res.errors));
  });
});

test('removed-script error names only paths the Full Plugin ships and the Directory Plugin removed', () => {
  const body = [
    '---',
    'name: code-trace',
    'description: "Trace"',
    '---',
    'Run `scripts/risk-analyze.js`, then the consumer `scripts/verify-runner.js`.',
    '',
  ].join('\n');
  const full = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-full-plugin-'));
  try {
    writeFiles(full, { 'skills/code-trace/scripts/risk-analyze.js': '// stub\n' });
    withDir({ 'skills/code-trace/SKILL.md': body }, (dir) => {
      const res = validateDirectoryPlugin(dir, { version: PKG_VERSION, fullPluginDir: full });
      assert.strictEqual(res.ok, false);
      const scriptErrors = res.errors.filter((e) => e.rule === 'removed-script-reference');
      assert.deepStrictEqual(scriptErrors.map((e) => e.target), ['scripts/risk-analyze.js'], JSON.stringify(scriptErrors));
    });
  } finally {
    fs.rmSync(full, { recursive: true, force: true });
  }
});

test('CLI fails with removed-script-reference and emits omitted-reference warning count when both appear', () => {
  const body = '---\nname: code-trace\ndescription: "Trace"\n---\nUse codex-worker and `scripts/ci/_lib/frontmatter.js`.\n';
  withDir({ 'skills/code-trace/SKILL.md': body }, (dir) => {
    const cli = spawnSync(process.execPath, [CLI, '--dir', dir, '--version', PKG_VERSION], { encoding: 'utf8' });
    assert.strictEqual(cli.status, 1, `${cli.stdout}\n${cli.stderr}`);
    assert.match(cli.stderr, /FAIL \[validate-directory-plugin\] skills\/code-trace\/SKILL\.md \(removed-script-reference\)/);
    assert.match(cli.stderr, /WARN \[validate-directory-plugin\] skills\/code-trace\/SKILL\.md \(omitted-reference\)/);
  });
});

test('skill name mismatching its directory fails skill-frontmatter', () => {
  withDir({
    'skills/wrong-dir/SKILL.md': '---\nname: other-name\ndescription: "Mismatch"\n---\n',
  }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'skills/wrong-dir/SKILL.md' && e.rule === 'skill-frontmatter'), JSON.stringify(res.errors));
  });
});

test('shipped skill missing from DIRECTORY_SKILL_NAMES fails skill-allowlist', () => {
  withDir({
    'skills/new-skill/SKILL.md': '---\nname: new-skill\ndescription: "New."\n---\n# New\n',
  }, (dir) => {
    const res = validateDirectoryPlugin(dir, { version: PKG_VERSION });
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === 'skills/new-skill/SKILL.md' && e.rule === 'skill-allowlist'), JSON.stringify(res.errors));
  });
});

run('validate-directory-plugin');
