'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const reduction = require('../scripts/lib/claude-directory-reduction');
const {
  DIRECTORY_PLUGIN_NAME,
  DIRECTORY_SKILL_NAMES,
  SKILL_NEXT_MAP_PATH,
  OMITTED_AGENTS,
  FORBIDDEN_EXACT_PATHS,
  ALLOWED_EXTENSIONS,
  SKILL_FRONTMATTER_KEYS,
  AGENT_FRONTMATTER_KEYS,
  isAllowedDirectoryFile,
  reduceSkillFrontmatter,
  reduceAgentFrontmatter,
  rewriteDirectoryNamespace,
  renderDirectoryManifest,
  renderDirectoryReadme,
  reduceToDirectoryPlugin,
} = reduction;

const VERSION = '1.2.3';

function entry(content, mode = 0o644) {
  return { content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), mode };
}

function sampleFullPluginMap() {
  const manifest = {
    $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
    name: 'dhpk',
    displayName: 'DHPK Dev Harness',
    version: VERSION,
    description: 'Full plugin fixture',
    author: { name: 'hmj1026', url: 'https://github.com/hmj1026' },
    license: 'MIT',
    homepage: 'https://github.com/hmj1026/dhpk',
    repository: 'https://github.com/hmj1026/dhpk',
    icon: './.claude-plugin/icon.png',
    bugs: 'https://github.com/hmj1026/dhpk/issues',
    keywords: ['harness'],
    agents: [
      './agents/agy-worker.md',
      './agents/code-reviewer.md',
      './agents/codex-reasoner.md',
      './agents/codex-worker.md',
      './agents/doc-reviewer.md',
    ],
    userConfig: {
      hook_profile: { type: 'string', default: 'standard' },
    },
  };

  return new Map([
    ['.claude-plugin/plugin.json', entry(`${JSON.stringify(manifest, null, 2)}\n`)],
    ['.claude-plugin/icon.png', entry(Buffer.from('pngbytes'))],
    ['README.md', entry('# Full README\n')],
    ['LICENSE', entry('MIT\n')],
    ['provenance.json', entry('{"schema":"dhpk.claude-marketplace-catalog.v1"}\n')],
    ['hooks/hooks.json', entry('{"hooks":{}}\n')],
    ['hooks.json', entry('{"hooks":{}}\n')],
    ['.mcp.json', entry('{"mcpServers":{}}\n')],
    ['.lsp.json', entry('{}\n')],
    ['monitors.json', entry('{}\n')],
    ['bin/dhpk', entry('#!/usr/bin/env node\n', 0o755)],
    ['scripts/hooks/pre-edit-guard.sh', entry('#!/usr/bin/env bash\n', 0o755)],
    ['manifests/distribution-inventory.json', entry('{}\n')],
    ['templates/dhpk-versions.json', entry('{"ok":true}\n')],
    ['templates/settings.local.example.json', entry('{}\n')],
    ['templates/sample.example', entry('{}\n')],
    ['templates/notes.txt', entry('plain text note\n')],
    ['templates/config.yaml', entry('key: value\n')],
    ['templates/shebang.txt', entry('#!/bin/sh\necho hi\n')],
    ['templates/bom-shebang.md', entry('\uFEFF#!/usr/bin/env bash\necho hi\n')],
    ['skills/flow-guide/assets/dhpk-icon.svg', entry('<svg/>\n')],
    ['skills/flow-guide/SKILL.md', entry('---\nname: flow-guide\ndescription: Router\n---\n# Flow Guide\nUse `$flow-drive` and `node ${CLAUDE_SKILL_DIR}/scripts/action-runner.js` or [manual](references/manual-procedure.md).\n')],
    ['skills/flow-guide/references/manual-procedure.md', entry('# Flow Guide Manual\nRead `references/skill-next-map.json`.\n')],
    ['skills/precommit/SKILL.md', entry('---\nname: precommit\ndescription: Precommit\n---\n# Precommit\n')],
    ['skills/git-smart-commit/SKILL.md', entry('---\nname: git-smart-commit\ndescription: Commit\n---\n# Commit\n')],
    ['skills/harness-setup/SKILL.md', entry('---\nname: harness-setup\ndescription: Setup\n---\n# Setup\nUse the native package installer.\n')],
    ['skills/harness-setup/references/manual-procedure.md', entry('# Setup Manual\n')],
    ['skills/release-creator/SKILL.md', entry('---\nname: release-creator\ndescription: Release\n---\n# Release\n')],
    ['skills/opsx-apply-resume/SKILL.md', entry('---\nname: opsx-apply-resume\ndescription: Resume\n---\n# Resume\n')],
    ['skills/change-verdict/SKILL.md', entry([
      '---',
      'name: change-verdict',
      "description: 'Review code, PRs, security, tests, and docs.'",
      "allowed-tools: 'Read, Grep, Glob, Bash(git diff:*)'",
      'argument-hint: "<mode>"',
      'disable-model-invocation: true',
      'context: fork',
      'metadata:',
      '  dhpk-capability-id: dhpk.skill.change-verdict',
      '  dhpk-invocation-class: implicit-eligible',
      '  dhpk-modes: [code, docs]',
      '  dhpk-next:',
      '    PASS: none',
      "    'code:PASS': precommit",
      "    'docs:PASS': git-smart-commit",
      '---',
      '',
      '# Change Verdict',
      '',
      'Dispatch `dhpk:code-reviewer`, `/dhpk:doc-maintain`, `/dhpk:precommit`, or `$flow-drive`.',
      'Run `node ${CLAUDE_SKILL_DIR}/scripts/risk-analyze.js --json`.',
      'See https://github.com/hmj1026/dhpk/blob/main/docs/dhpk:example and `dhpk-stacks`.',
      '',
    ].join('\n'))],
    ['skills/change-verdict/references/guide.md', entry('# Guide\nUse `dhpk:code-reviewer` and [project-audit](project-audit/SKILL.md).\n')],
    ['skills/doc-maintain/SKILL.md', entry([
      '---',
      'name: doc-maintain',
      "description: 'Maintain documentation.'",
      'metadata:',
      '  dhpk-invocation-class: implicit-eligible',
      '  dhpk-modes: [update]',
      '  dhpk-next:',
      '    PASS: none',
      "    'update:PASS': git-smart-commit",
      '---',
      '',
      '# Doc Maintain',
      '',
    ].join('\n'))],
    ['skills/change-verdict/references/project-audit/SKILL.md', entry([
      '---',
      'name: project-audit',
      "description: 'Audit project health.'",
      "allowed-tools: 'Read, Bash(node ${CLAUDE_SKILL_DIR}/scripts/audit.js:*)'",
      'metadata:',
      '  dhpk-invocation-class: implicit-eligible',
      '---',
      '',
      '# Project Audit',
      'Run `node "$SKILL_DIR/scripts/audit.js" --json` and see `SKILL.md`.',
      '',
    ].join('\n'))],
    ['skills/change-verdict/scripts/risk-analyze.js', entry('console.log(1);\n', 0o755)],
    ['skills/code-trace/references/diagnose/wait-for-helper.ts', entry('export const x = 1;\n')],
    ['agents/INDEX.md', entry('# Agent Index\nSee `.claude-plugin/plugin.json`.\n')],
    ['agents/agy-worker.md', entry('---\nname: agy-worker\ndescription: Agy\ntools: Bash\nmodel: sonnet\neffort: low\nskills: ["tdd-workflow"]\n---\n# Agy\n')],
    ['agents/codex-worker.md', entry('---\nname: codex-worker\ndescription: Codex\ntools: Bash\nmodel: sonnet\neffort: low\n---\n# Codex\n')],
    ['agents/codex-reasoner.md', entry('---\nname: codex-reasoner\ndescription: Codex reasoner\ntools: Read\nmodel: sonnet\neffort: low\n---\n# Codex Reasoner\n')],
    ['agents/code-reviewer.md', entry([
      '---',
      'name: code-reviewer',
      "description: 'Review code quality.'",
      'tools: Read, Grep, Glob, Bash',
      'model: sonnet',
      'color: blue',
      'effort: medium',
      'skills: ["tdd-workflow"]',
      '---',
      '',
      '# Code Reviewer',
      '',
      'Calls `dhpk:silent-failure-hunter`.',
      '',
    ].join('\n'))],
    ['agents/doc-reviewer.md', entry([
      '---',
      'name: doc-reviewer',
      'description: >-',
      '  Lightweight policy and',
      '  harness doc reviewer.',
      'tools: Read, Grep, Glob',
      'model: haiku',
      'effort: medium',
      '---',
      '',
      '# Doc Reviewer',
      '',
    ].join('\n'))],
    ['rules/execution-policy.md', entry('# Policy\nUse `dhpk:fast-worker` and `dhpk:deep-reasoner`.\n')],
  ]);
}

test('reviewed omission lists and allowlists match the specification', () => {
  assert.strictEqual(DIRECTORY_PLUGIN_NAME, 'dhpk-lite');
  assert.strictEqual(SKILL_NEXT_MAP_PATH, 'skill-next-map.json');
  assert.strictEqual(reduction.OMITTED_SKILLS, undefined);
  assert.strictEqual(DIRECTORY_SKILL_NAMES.length, 17);
  assert.deepStrictEqual([...OMITTED_AGENTS].sort(), [
    'agy-worker',
    'codex-reasoner',
    'codex-worker',
  ]);
  assert.ok(FORBIDDEN_EXACT_PATHS.includes('agents/INDEX.md'));
  assert.deepStrictEqual(SKILL_FRONTMATTER_KEYS, ['name', 'description']);
  assert.deepStrictEqual(AGENT_FRONTMATTER_KEYS, ['name', 'description', 'model', 'color', 'tools']);
  for (const ext of ['.md', '.txt', '.json', '.yaml', '.yml', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']) {
    assert.ok(ALLOWED_EXTENSIONS.includes(ext), `missing allowed extension ${ext}`);
  }
});

test('isAllowedDirectoryFile drops disallowed extensions, shebangs, and forbidden paths', () => {
  assert.strictEqual(isAllowedDirectoryFile('LICENSE', Buffer.from('MIT\n')), true);
  assert.strictEqual(isAllowedDirectoryFile('templates/notes.txt', Buffer.from('ok\n')), true);
  assert.strictEqual(isAllowedDirectoryFile('templates/config.yaml', Buffer.from('a: 1\n')), true);
  assert.strictEqual(isAllowedDirectoryFile('templates/dhpk-versions.json', Buffer.from('{}\n')), true);
  assert.strictEqual(isAllowedDirectoryFile('templates/settings.local.example.json', Buffer.from('{}\n')), true);
  assert.strictEqual(isAllowedDirectoryFile('templates/sample.example', Buffer.from('{}\n')), false);
  assert.strictEqual(isAllowedDirectoryFile('skills/code-trace/references/wait.ts', Buffer.from('x')), false);
  assert.strictEqual(isAllowedDirectoryFile('skills/flow-guide/assets/dhpk-icon.svg', Buffer.from('<svg/>')), false);
  assert.strictEqual(isAllowedDirectoryFile('templates/shebang.txt', Buffer.from('#!/bin/sh\n')), false);
  assert.strictEqual(isAllowedDirectoryFile('templates/bom.md', Buffer.from('\uFEFF#!/usr/bin/env node\n')), false);
  assert.strictEqual(isAllowedDirectoryFile('hooks/hooks.json', Buffer.from('{}')), false);
  assert.strictEqual(isAllowedDirectoryFile('hooks.json', Buffer.from('{}')), false);
  assert.strictEqual(isAllowedDirectoryFile('.mcp.json', Buffer.from('{}')), false);
  assert.strictEqual(isAllowedDirectoryFile('.lsp.json', Buffer.from('{}')), false);
  assert.strictEqual(isAllowedDirectoryFile('monitors.json', Buffer.from('{}')), false);
  assert.strictEqual(isAllowedDirectoryFile('agents/INDEX.md', Buffer.from('# Index\n')), false);
  assert.strictEqual(isAllowedDirectoryFile('bin/dhpk', Buffer.from('x')), false);
  assert.strictEqual(isAllowedDirectoryFile('scripts/a.md', Buffer.from('x')), false);
  assert.strictEqual(isAllowedDirectoryFile('manifests/x.json', Buffer.from('{}')), false);
  assert.strictEqual(isAllowedDirectoryFile('skills/change-verdict/scripts/a.md', Buffer.from('x')), false);
});

test('reduceSkillFrontmatter keeps only name and description as plain key: value lines', () => {
  const input = [
    '---',
    'name: change-verdict',
    "description: 'Review code and docs.'",
    "allowed-tools: 'Read, Bash'",
    'argument-hint: "<mode>"',
    'disable-model-invocation: true',
    'context: fork',
    'metadata:',
    '  dhpk-invocation-class: implicit-eligible',
    '---',
    '# Body',
    '',
  ].join('\n');
  const reduced = reduceSkillFrontmatter(input, 'skills/change-verdict/SKILL.md');
  const fm = reduced.match(/^---\n([\s\S]*?)\n---/)[1].split('\n');
  assert.strictEqual(fm.length, 2);
  assert.strictEqual(fm[0], 'name: change-verdict');
  assert.strictEqual(fm[1], 'description: "Review code and docs."');
  assert.ok(reduced.includes('# Body'));
});

test('reduceAgentFrontmatter keeps only name, description, model, color, tools and flattens folded descriptions', () => {
  const input = [
    '---',
    'name: doc-reviewer',
    'description: >-',
    '  Lightweight policy and',
    '  harness doc reviewer.',
    'tools: Read, Grep, Glob',
    'model: haiku',
    'color: cyan',
    'effort: medium',
    'skills: ["tdd-workflow"]',
    '---',
    '# Doc Reviewer',
    '',
  ].join('\n');
  const reduced = reduceAgentFrontmatter(input, 'agents/doc-reviewer.md');
  const fm = reduced.match(/^---\n([\s\S]*?)\n---/)[1].split('\n');
  assert.deepStrictEqual(fm, [
    'name: doc-reviewer',
    'description: "Lightweight policy and harness doc reviewer."',
    'model: haiku',
    'color: cyan',
    'tools: Read, Grep, Glob',
  ]);
  assert.ok(reduced.includes('# Doc Reviewer'));
});

test('reduceAgentFrontmatter fails naming file and key on a YAML list value for tools or any kept key', () => {
  const blockList = [
    '---',
    'name: list-agent',
    'description: "Agent with list tools."',
    'tools:',
    '  - Read',
    '  - Grep',
    '---',
    '',
  ].join('\n');
  assert.throws(
    () => reduceAgentFrontmatter(blockList, 'agents/list-agent.md'),
    (error) => error.message.includes('agents/list-agent.md') && error.message.includes('tools'),
  );

  const inlineList = [
    '---',
    'name: list-agent',
    'description: "Agent with inline list tools."',
    'tools: [Read, Grep]',
    '---',
    '',
  ].join('\n');
  assert.throws(
    () => reduceAgentFrontmatter(inlineList, 'agents/list-agent.md'),
    (error) => error.message.includes('agents/list-agent.md') && error.message.includes('tools'),
  );
});

test('rewriteDirectoryNamespace rewrites whole-token dhpk: names and $skill-name tokens while preserving URLs and dhpk-stacks', () => {
  const text = [
    'Use `dhpk:code-reviewer`, `/dhpk:doc-maintain`, `$flow-drive`, `$flow-guide`, and `$precommit`.',
    'Do not break https://github.com/hmj1026/dhpk/issues, https://example.com/dhpk:foo, or https://example.com/$flow-drive.',
    'Keep `dhpk-stacks`, `$SKILL_DIR`, and `dhpk:` alone.',
  ].join('\n');
  const rewritten = rewriteDirectoryNamespace(text);
  assert.ok(rewritten.includes('`dhpk-lite:code-reviewer`'));
  assert.ok(rewritten.includes('`/dhpk-lite:doc-maintain`'));
  assert.ok(rewritten.includes('`/dhpk-lite:flow-drive`'));
  assert.ok(rewritten.includes('`/dhpk-lite:flow-guide`'));
  assert.ok(rewritten.includes('`/dhpk-lite:precommit`'));
  assert.ok(rewritten.includes('https://example.com/dhpk:foo'));
  assert.ok(rewritten.includes('https://example.com/$flow-drive'));
  assert.ok(rewritten.includes('`dhpk-stacks`'));
  assert.ok(rewritten.includes('`$SKILL_DIR`'));
  assert.ok(!/(?<![:/A-Za-z0-9-])dhpk:[a-z]/.test(rewritten.replace(/https?:\/\/\S+/g, '')));
});

test('renderDirectoryManifest produces dhpk-lite manifest without userConfig or omitted agents', () => {
  const full = sampleFullPluginMap().get('.claude-plugin/plugin.json').content;
  const manifest = JSON.parse(renderDirectoryManifest(full, { version: '2.0.0' }).toString('utf8'));
  assert.strictEqual(manifest.name, 'dhpk-lite');
  assert.strictEqual(manifest.version, '2.0.0');
  assert.ok(!Object.hasOwn(manifest, 'icon'));
  assert.strictEqual(manifest.bugs, 'https://github.com/hmj1026/dhpk/issues');
  assert.strictEqual(manifest.userConfig, undefined);
  assert.strictEqual(manifest.hooks, undefined);
  assert.strictEqual(manifest.mcpServers, undefined);
  assert.strictEqual(manifest.monitors, undefined);
  assert.deepStrictEqual(manifest.agents, ['./agents/code-reviewer.md', './agents/doc-reviewer.md']);
});

test('renderDirectoryReadme describes manual-procedure skills, omissions, mutual exclusion, and Full Plugin install steps', () => {
  const readme = renderDirectoryReadme().toString('utf8');
  const words = readme.trim().split(/\s+/).filter(Boolean);
  assert.ok(words.length >= 40, `README must have at least 40 words, got ${words.length}`);
  for (const name of [
    'flow-guide',
    'opsx-apply-resume',
    'git-smart-commit',
    'harness-setup',
    'precommit',
    'release-creator',
    'mode: manual',
    'agents/INDEX.md',
    ...OMITTED_AGENTS,
  ]) {
    assert.ok(readme.includes(name), `README must mention ${name}`);
  }
  assert.match(readme, /dhpk-lite/);
  assert.match(readme, /\/plugin install dhpk-lite/);
  assert.match(readme, /\/plugin marketplace add hmj1026\/dhpk/);
  assert.match(readme, /\/plugin install dhpk@dhpk/);
});

test('reduceToDirectoryPlugin reduces a Full Plugin map purely, admits manual-procedure skills, normalizes nested references, and strips scripts/', () => {
  const input = sampleFullPluginMap();
  const snapshotBefore = new Map([...input].map(([k, v]) => [k, { mode: v.mode, hex: v.content.toString('hex') }]));

  const output = reduceToDirectoryPlugin(input, { version: VERSION });

  // Input map and buffers were not mutated.
  assert.strictEqual(input.size, snapshotBefore.size);
  for (const [k, v] of snapshotBefore) {
    assert.strictEqual(input.get(k).mode, v.mode);
    assert.strictEqual(input.get(k).content.toString('hex'), v.hex);
  }

  for (const forbidden of [
    'hooks/hooks.json', 'hooks.json', '.mcp.json', '.lsp.json', 'monitors.json', 'bin/dhpk',
    'scripts/hooks/pre-edit-guard.sh', 'manifests/distribution-inventory.json', 'provenance.json',
    'templates/sample.example', 'templates/shebang.txt', 'templates/bom-shebang.md',
    '.claude-plugin/icon.png', 'skills/flow-guide/assets/dhpk-icon.svg', 'skills/change-verdict/scripts/risk-analyze.js',
    'skills/change-verdict/references/project-audit/SKILL.md',
    'skills/code-trace/references/diagnose/wait-for-helper.ts',
    'agents/INDEX.md', 'agents/agy-worker.md', 'agents/codex-worker.md', 'agents/codex-reasoner.md',
  ]) {
    assert.strictEqual(output.has(forbidden), false, `Directory Plugin must omit ${forbidden}`);
  }

  for (const kept of [
    '.claude-plugin/plugin.json', 'README.md', 'LICENSE',
    'templates/dhpk-versions.json', 'templates/settings.local.example.json', 'templates/notes.txt', 'templates/config.yaml',
    'skills/flow-guide/SKILL.md', 'skills/flow-guide/references/manual-procedure.md',
    'skills/precommit/SKILL.md', 'skills/git-smart-commit/SKILL.md',
    'skills/harness-setup/SKILL.md', 'skills/release-creator/SKILL.md',
    'skills/opsx-apply-resume/SKILL.md',
    'skills/change-verdict/SKILL.md', 'skills/change-verdict/references/guide.md',
    'skills/change-verdict/references/project-audit/REFERENCE.md',
    'agents/code-reviewer.md', 'agents/doc-reviewer.md', 'rules/execution-policy.md',
    SKILL_NEXT_MAP_PATH,
  ]) {
    assert.ok(output.has(kept), `Directory Plugin must retain ${kept}`);
    assert.strictEqual(output.get(kept).mode, 0o644, `${kept} must be 0644`);
  }

  // Nested Specialist Reference is renamed to REFERENCE.md without frontmatter,
  // and links/mentions to it are rewritten.
  const nestedRef = output.get('skills/change-verdict/references/project-audit/REFERENCE.md').content.toString('utf8');
  assert.doesNotMatch(nestedRef, /^---\r?\n/);
  assert.ok(nestedRef.includes('REFERENCE.md'));
  assert.ok(!/(?<![A-Za-z0-9_-])scripts\/[A-Za-z0-9_.-]+/.test(nestedRef));

  const guide = output.get('skills/change-verdict/references/guide.md').content.toString('utf8');
  assert.ok(guide.includes('project-audit/REFERENCE.md'), guide);

  // Namespace and script rewrites ran across kept markdown files.
  const body = output.get('skills/change-verdict/SKILL.md').content.toString('utf8');
  assert.ok(body.includes('dhpk-lite:code-reviewer'));
  assert.ok(body.includes('/dhpk-lite:doc-maintain'));
  assert.ok(body.includes('/dhpk-lite:precommit'));
  assert.ok(body.includes('/dhpk-lite:flow-drive'));
  assert.ok(body.includes('https://github.com/hmj1026/dhpk/blob/main/docs/dhpk:example'));
  assert.ok(body.includes('dhpk-stacks'));
  assert.ok(!/(?<![A-Za-z0-9_-])scripts\/[A-Za-z0-9_.-]+/.test(body));

  const flowGuideBody = output.get('skills/flow-guide/SKILL.md').content.toString('utf8');
  assert.ok(flowGuideBody.includes('references/manual-procedure.md'), flowGuideBody);
  assert.ok(!flowGuideBody.includes('action-runner.js'), flowGuideBody);
  assert.ok(flowGuideBody.includes('/dhpk-lite:flow-drive'), flowGuideBody);
  assert.ok(!/(?<![A-Za-z0-9_-])scripts\/[A-Za-z0-9_.-]+/.test(flowGuideBody));

  const setupBody = output.get('skills/harness-setup/SKILL.md').content.toString('utf8');
  assert.match(setupBody, /only on an explicit user request/);
  assert.match(setupBody, /user confirmation before writing/);
  assert.match(setupBody, /references\/manual-procedure\.md/);
  assert.doesNotMatch(setupBody, /native package installer/);

  const flowGuideManual = output.get('skills/flow-guide/references/manual-procedure.md').content.toString('utf8');
  assert.ok(!flowGuideManual.includes('references/skill-next-map.json'));
  assert.ok(flowGuideManual.includes('skill-next-map.json'));

  for (const [rel, item] of output) {
    if (rel.startsWith('skills/') && (rel.endsWith('.md') || rel.endsWith('.json'))) {
      const stripped = item.content.toString('utf8').replace(/https?:\/\/[^\s)>\]"'`]+/g, '');
      assert.strictEqual(
        /(?<![A-Za-z0-9_-])scripts\/[A-Za-z0-9_.-]+/.test(stripped),
        false,
        `${rel} must not retain scripts/ references`,
      );
    }
  }

  // Materialize on disk and read skill-next-map.json relative to a kept skill reference path.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dir-reduce-'));
  try {
    for (const [rel, item] of output) {
      const target = path.join(temp, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, item.content, { mode: item.mode });
    }
    const refPath = path.join(temp, 'skills/change-verdict/references/guide.md');
    const resolvedMap = path.resolve(path.dirname(refPath), '../../../', SKILL_NEXT_MAP_PATH);
    const mapText = fs.readFileSync(resolvedMap, 'utf8');
    const mapData = JSON.parse(mapText);
    assert.strictEqual(mapText, JSON.stringify(mapData, null, 2) + '\n');
    assert.strictEqual(mapData.schema, 'dhpk.skill-next-map.v1');
    assert.strictEqual(mapData.skills['change-verdict'].invocationClass, 'implicit-eligible');
    assert.deepStrictEqual(mapData.skills['change-verdict'].modes, ['code', 'docs']);
    assert.strictEqual(mapData.skills['change-verdict'].next.PASS, 'none');
    assert.strictEqual(mapData.skills['change-verdict'].next['code:PASS'], 'precommit');
    assert.strictEqual(mapData.skills['change-verdict'].next['docs:PASS'], 'git-smart-commit');
    assert.strictEqual(mapData.skills['doc-maintain'].next.PASS, 'none');
    assert.strictEqual(mapData.skills['doc-maintain'].next['update:PASS'], 'git-smart-commit');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('reduceToDirectoryPlugin README counts follow the shipped skills and agents', () => {
  const output = reduceToDirectoryPlugin(sampleFullPluginMap(), { version: VERSION });
  const keys = [...output.keys()];
  const skillCount = keys.filter((k) => /^skills\/[^/]+\/SKILL\.md$/.test(k)).length;
  const agentCount = keys.filter((k) => /^agents\/[^/]+\.md$/.test(k)).length;
  const readme = Buffer.from(output.get('README.md').content).toString('utf8');
  assert.ok(readme.includes(`all ${skillCount} workflow skills`), readme);
  assert.ok(readme.includes(`${agentCount} specialist agents`), readme);
});

test('user-only skills retain explicit-user-request guard in description and body after frontmatter reduction', () => {
  const repoRoot = path.join(__dirname, '..');
  for (const skill of ['release-creator', 'git-smart-commit', 'harness-setup', 'opsx-apply-resume']) {
    const raw = fs.readFileSync(path.join(repoRoot, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.match(raw, /^disable-model-invocation:\s*true/m, `${skill} must keep disable-model-invocation in canonical SKILL.md`);
    const reduced = reduceSkillFrontmatter(raw, `skills/${skill}/SKILL.md`);
    const fm = reduced.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    assert.ok(fm, `${skill} reduced SKILL.md must keep frontmatter`);
    assert.doesNotMatch(fm[1], /disable-model-invocation/, `${skill} Directory Plugin frontmatter must drop disable-model-invocation`);
    assert.match(fm[1], /Explicit user request only/, `${skill} description must keep explicit-user-request guard`);
    const bodyHead = fm[2].trimStart().split('\n').slice(0, 5).join('\n');
    assert.match(bodyHead, /Run this skill only on an explicit user request/, `${skill} body start must keep explicit-user-request guard`);
  }
});

run('claude-directory-reduction');
