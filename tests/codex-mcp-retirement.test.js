'use strict';

// RED contract for migrate-codex-mcp-capabilities-and-retire-runtime.
//
// The migrated skills are Markdown interfaces rather than executable modules,
// so their no-second-opinion behavior is observed through the published
// frontmatter/instruction contract.  The tests deliberately do not import or
// reimplement a skill's prose; they scan the canonical files, run the real CI
// validators, and exercise the real route-result parser at its public seam.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  createRouteResult,
  validateRouteResult,
} = require('../skills/flow-guide/scripts/route-result');

const ROOT = path.join(__dirname, '..');
const MATRIX = path.join(ROOT, 'docs', 'codex-mcp-capability-parity.md');
const CODEX_MCP = /mcp__codex__codex(?:-reply)?/;
const RETIRED_ROUTE_IDS = new Set([
  'dhpk-codex-architect',
  'dhpk-codex-implement',
  'dhpk-change-review',
  'dhpk-doc-review',
  'dhpk-test-review',
  'dhpk-codebase-exploration',
  'dhpk-feature-verify',
  'dhpk-issue-analyze',
  'dhpk-feasibility-study',
  'codex-review',
  'codex-review-branch',
  'codex-review-doc',
  'codex-review-fast',
  'codex-security',
  'codex-test-gen',
  'codex-test-review',
  'review-spec',
]);

const MIGRATION_TARGETS = [
  { id: 'codex-architect', pattern: /codex[- ]architect/i },
  { id: 'codex-implement', pattern: /codex[- ]implement/i },
  { id: 'codex-code-review', pattern: /codex[- ]code[- ]review/i },
  { id: 'doc-review', pattern: /doc[- ]review/i },
  { id: 'test-review', pattern: /test[- ]review/i },
  { id: 'codebase-exploration', pattern: /codebase[- ]exploration/i },
  { id: 'feature-verify', pattern: /feature[- ]verify/i },
  {
    id: 'issue-analyze + feasibility-study',
    pattern: /issue[- ]analyze[\s\S]{0,160}feasibility[- ]study|feasibility[- ]study[\s\S]{0,160}issue[- ]analyze/i,
  },
];

const REQUIRED_MATRIX_COLUMNS = [
  { label: 'original capability', matches: (header) => /original.*capabil/i.test(header) },
  { label: 'original MCP behavior', matches: (header) => /(?:original.*mcp|mcp).*behavior/i.test(header) },
  { label: 'new owner', matches: (header) => /new.*owner/i.test(header) },
  { label: 'retained transport', matches: (header) => /retained.*transport/i.test(header) },
  { label: 'gate / verification', matches: (header) => /gate.*verif/i.test(header) },
  { label: 'session-continuity difference', matches: (header) => /session.*continu/i.test(header) },
  { label: 'migration evidence', matches: (header) => /migration.*evidence/i.test(header) },
  { label: 'rollback path', matches: (header) => /rollback/i.test(header) },
];

const DEGRADATION_SKILLS = [
  'dhpk-feature-verify',
  'dhpk-issue-analyze',
  'change-verdict',
];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function runNode(relative, args = []) {
  const result = spawnSync('node', [path.join(ROOT, relative), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function runMcpFreeSettingsCheck(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return {
      status: 2,
      output: error && error.message ? error.message : String(error),
    };
  }

  // A detected grant fails the policy check; an absent grant passes it.
  return {
    status: content.match(CODEX_MCP) ? 1 : 0,
    output: '',
  };
}

function frontmatter(content) {
  const match = String(content).replace(/^\uFEFF/, '')
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1] : '';
}

function canonicalSkillFiles() {
  return fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(ROOT, 'skills', entry.name, 'SKILL.md'))
    .filter((file) => fs.existsSync(file))
    .sort();
}

function commandFiles() {
  return fs.readdirSync(path.join(ROOT, 'commands'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md')
    .map((entry) => path.join(ROOT, 'commands', entry.name))
    .sort();
}

function splitMarkdownRow(line) {
  const text = line.trim();
  if (!text.startsWith('|') || !text.endsWith('|')) return null;

  const cells = [];
  let cell = '';
  let escaped = false;
  for (let i = 1; i < text.length - 1; i += 1) {
    const char = text[i];
    if (escaped) {
      cell += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
      cell += char;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function parseParityTable(content) {
  const rows = content.split(/\r?\n/)
    .map(splitMarkdownRow)
    .filter((row) => row && row.length > 0);
  const separator = /^:?-{3,}:?$/;
  const headerIndex = rows.findIndex((row, index) => {
    if (index + 1 >= rows.length || row.some((cell) => !cell)) return false;
    return rows[index + 1].length === row.length
      && rows[index + 1].every((cell) => separator.test(cell.replace(/\s/g, '')))
      && row.some((cell) => /original.*capabil/i.test(cell));
  });
  assert.ok(headerIndex >= 0, 'parity matrix must contain a Markdown table header and separator');
  const header = rows[headerIndex].map((cell) => cell.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  const body = [];
  for (let i = headerIndex + 2; i < rows.length; i += 1) {
    if (rows[i].length !== header.length) break;
    body.push(rows[i]);
  }
  return { header, body };
}

function evidenceCellIsCited(cell) {
  return /(?:[\w./-]+:\d+|tests?\/[\w./-]+|(?:node|bash|npm|openspec|git|phpunit)\s+|[\w-]+test(?:::\w+)?)/i.test(cell);
}

function assertExplicitCodexExec(content, relative) {
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/\bcodex exec\b/i.test(line)) return;
    const context = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join(' ');
    assert.match(
      context,
      /explicit|optional|opt[- ]?in|second opinion|blind/i,
      `${relative}: codex exec must be explicitly opted into`,
    );
    assert.doesNotMatch(
      context,
      /(?:^|\s)(?:default|automatically|automatic)(?:\s|$)/i,
      `${relative}: codex exec must not be a silent default`,
    );
  });
}

test('parity matrix has exactly eight complete, cited rows', () => {
  assert.ok(fs.existsSync(MATRIX), `missing migration parity matrix: ${path.relative(ROOT, MATRIX)}`);
  const matrix = fs.readFileSync(MATRIX, 'utf8');
  const { header, body } = parseParityTable(matrix);

  const columnIndexes = REQUIRED_MATRIX_COLUMNS.map((required) => {
    const index = header.findIndex(required.matches);
    assert.ok(index >= 0, `parity matrix missing required column: ${required.label}`);
    return index;
  });

  assert.strictEqual(body.length, MIGRATION_TARGETS.length, 'parity matrix must contain one row per migration target');
  for (const target of MIGRATION_TARGETS) {
    const matches = body.filter((row) => target.pattern.test(row.join(' | ')));
    assert.strictEqual(matches.length, 1, `expected exactly one matrix row for ${target.id}`);
    const row = matches[0];
    for (const index of columnIndexes) {
      assert.ok(row[index].trim(), `${target.id}: required matrix cell ${header[index]} is empty`);
    }
    const evidence = row[columnIndexes[6]];
    assert.ok(evidenceCellIsCited(evidence), `${target.id}: migration evidence must cite a file, test, or verification run`);
    assert.match(row[columnIndexes[7]], /0\.46\.1|version[- ]pin|last compatible|previous release/i,
      `${target.id}: rollback must pin a compatible release rather than restore a hidden MCP fallback`);
  }

  assert.match(matrix, /pr[- ]review/i, 'matrix must record the codex-code-review/pr-review ownership decision');
  assert.match(matrix, /(?:merge|separate|stay separate|remain distinct)/i,
    'matrix must record a rationale for the codex-code-review/pr-review decision');
});

test('canonical skill and command frontmatter has no Codex MCP grants after retirement', () => {
  const findings = [];
  for (const file of [...canonicalSkillFiles(), ...commandFiles()]) {
    const grant = frontmatter(fs.readFileSync(file, 'utf8')).match(CODEX_MCP);
    if (grant) findings.push(`${path.relative(ROOT, file)}: ${grant[0]}`);
  }
  assert.deepStrictEqual(findings, [], `active allowed-tools MCP grants remain:\n${findings.join('\n')}`);
});

test('Claude project settings stay MCP-free and reject a reintroduced grant', () => {
  const settingsPath = path.join(ROOT, '.claude', 'settings.json');
  assert.ok(fs.existsSync(settingsPath), 'canonical Claude settings must exist');
  const baseline = runMcpFreeSettingsCheck(settingsPath);
  assert.strictEqual(baseline.status, 0, `canonical Claude settings contain a retired MCP grant:\n${baseline.output}`);

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-settings-'));
  const fixturePath = path.join(fixtureRoot, '.claude', 'settings.json');
  try {
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    const fixture = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    fixture.permissions = fixture.permissions || {};
    fixture.permissions.allow = [...(fixture.permissions.allow || []), 'mcp__codex__codex'];
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);

    const reintroduced = runMcpFreeSettingsCheck(fixturePath);
    assert.strictEqual(reintroduced.status, 1,
      'the MCP-free settings scanner must fail when a retired grant is reintroduced');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('catalog and invocation validators execute successfully with a zero MCP surface', () => {
  const catalogCheck = runNode('scripts/ci/catalog.js', ['--check']);
  assert.strictEqual(catalogCheck.status, 0, catalogCheck.output);

  const catalogTable = runNode('scripts/ci/catalog.js');
  assert.strictEqual(catalogTable.status, 0, catalogTable.output);
  assert.match(catalogTable.output, /codex:\s+0 MCP-backed skills \+ 0 commands/,
    `catalog must report the retired zero surface:\n${catalogTable.output}`);

  const invocation = runNode('scripts/ci/validate-invocation-policy.js');
  assert.strictEqual(invocation.status, 0, invocation.output);
  assert.doesNotMatch(invocation.output, CODEX_MCP);
});

test('default route table never targets retired MCP entries', () => {
  const routeTable = JSON.parse(read('skills/flow-guide/references/route-table.json'));
  const retiredTargets = routeTable.rules
    .map((rule) => rule.target && rule.target.id)
    .filter((id) => RETIRED_ROUTE_IDS.has(id));
  assert.deepStrictEqual(retiredTargets, [], `default route table still targets retired entries: ${retiredTargets.join(', ')}`);

  const result = createRouteResult({
    host: 'claude',
    argv: ['--route-only', 'review this diff with an independent second opinion'],
  });
  assert.doesNotThrow(() => validateRouteResult(result));
  assert.ok(result.target == null || !RETIRED_ROUTE_IDS.has(result.target.id),
    `route parser selected a retired MCP target: ${result.target && result.target.id}`);
});

test('--codex no longer resolves to a peer, worker, reasoner, or replacement route', () => {
  let result;
  try {
    result = createRouteResult({ host: 'claude', argv: ['--codex'] });
  } catch (error) {
    assert.match(String(error && error.message), /deprecated|unsupported|retired|unknown/i);
    return;
  }

  assert.doesNotThrow(() => validateRouteResult(result));
  assert.strictEqual(result.target, null, 'a retired flag alone must not resolve a workflow target');
  assert.ok(!result.options || result.options.codexPeer !== true,
    'a retired flag must not set the legacy MCP-peer option');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'backendSelection'), false,
    'v3 result must not expose the retired worker/reasoner backend field');
});

test('migrated owners are MCP-free and any codex exec mention is explicit-only', () => {
  const owners = [
    'dhpk-module-design',
    'flow-drive',
    'change-verdict',
    'code-trace',
    'dhpk-feature-verify',
    'dhpk-issue-analyze',
    'dhpk-module-design',
  ];
  for (const owner of owners) {
    const relative = `skills/${owner}/SKILL.md`;
    assert.ok(fs.existsSync(path.join(ROOT, relative)), `missing migrated owner: ${relative}`);
    const content = read(relative);
    assert.doesNotMatch(content, CODEX_MCP, `${relative}: live MCP runtime reference remains`);
    assertExplicitCodexExec(content, relative);
  }
});

test('blind-verdict owners report primary-only degraded state without a second opinion', () => {
  for (const owner of DEGRADATION_SKILLS) {
    const relative = `skills/${owner}/SKILL.md`;
    assert.ok(fs.existsSync(path.join(ROOT, relative)), `missing degraded-state owner: ${relative}`);
    const content = read(relative);
    assert.match(content, /degrad(?:ed|ation)/i, `${relative}: missing degraded-state vocabulary`);
    assert.match(content, /second opinion|independent|blind/i, `${relative}: missing second-opinion boundary`);
    assert.match(
      content,
      /(?:only|alone|without)[^\n]{0,100}(?:primary|current|in-process)[^\n]{0,100}(?:model|review|verdict)|(?:primary|current|in-process)[^\n]{0,100}(?:model|review|verdict)[^\n]{0,100}(?:only|alone|without)/i,
      `${relative}: must state that no independent verdict exists when no second opinion runs`,
    );
  }
});

test('retired Codex review command aliases are absent after family cutover', () => {
  for (const name of ['codex-review.md', 'codex-review-branch.md', 'codex-review-doc.md', 'codex-review-fast.md', 'codex-security.md', 'codex-test-review.md', 'review-spec.md']) {
    assert.strictEqual(fs.existsSync(path.join(ROOT, 'commands', name)), false, `${name} must remain retired`);
  }
  const retained = read('commands/review-pending.md');
  assert.doesNotMatch(frontmatter(retained), CODEX_MCP);
});

run('codex-mcp-retirement');
