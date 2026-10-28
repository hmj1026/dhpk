#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { collectCodexRoleNeighborErrors } = require('./lib/codex-role-neighbors');

// Plugin root: this script lives in scripts/, so root is one level up.
const ROOT = path.join(__dirname, '..');
const DEFAULT_OUT_DIR = path.join(ROOT, 'codex', 'agents');
const OWNERSHIP_MANIFEST = path.join(ROOT, 'codex', 'agent-projection-manifest.json');
const ROLE_MAP = path.join(ROOT, 'codex', 'agent-role-map.json');

// Codex runtime metadata is explicit per role. Claude frontmatter describes the
// Claude runtime and must not silently overwrite the effective Codex model or
// reasoning effort.
const RUNTIME_METADATA = Object.freeze({
  architect: { model: 'gpt-6.1-sol', effort: 'high' },
  'code-reviewer': { model: 'gpt-6.1-sol', effort: 'medium' },
  'security-reviewer': { model: 'gpt-6.1-sol', effort: 'high' },
  'database-reviewer': { model: 'gpt-6.1-sol', effort: 'high' },
  'tdd-guide': { model: 'gpt-6-luna', effort: 'high' },
  'deep-reasoner': { model: 'gpt-6.1-sol', effort: 'high' },
  'doc-reviewer': { model: 'gpt-6-luna', effort: 'high' },
  planner: { model: 'gpt-6.1-sol', effort: 'high' },
  'frontend-reviewer': { model: 'gpt-6.1-sol', effort: 'medium' },
  'migration-reviewer': { model: 'gpt-6.1-sol', effort: 'high' },
  'e2e-runner': { model: 'gpt-6.1-sol', effort: 'medium' },
  'ui-verifier': { model: 'gpt-6.1-terra', effort: 'medium' },
  'docs-writer': { model: 'gpt-6.1-terra', effort: 'medium' },
  'scoped-worker': { model: 'gpt-6.1-terra', effort: 'medium' },
});

// Each Codex role names its canonical source explicitly. Existing shared roles
// continue to read from agents/; Codex-only roles stay in codex/agent-sources/.
// The 4 hand-maintained Codex roles (bug-investigator, explorer, monitor, worker)
// are intentionally absent and are never read or overwritten.
const AGENTS = [
  { name: 'architect', source: 'agents/architect.md' },
  { name: 'code-reviewer', source: 'agents/code-reviewer.md' },
  { name: 'security-reviewer', source: 'agents/security-reviewer.md' },
  { name: 'database-reviewer', source: 'agents/database-reviewer.md' },
  { name: 'tdd-guide', source: 'agents/tdd-guide.md' },
  { name: 'deep-reasoner', source: 'agents/deep-reasoner.md' },
  { name: 'doc-reviewer', source: 'agents/doc-reviewer.md' },
  { name: 'planner', source: 'agents/planner.md' },
  { name: 'frontend-reviewer', source: 'agents/frontend-reviewer.md' },
  { name: 'migration-reviewer', source: 'agents/migration-reviewer.md' },
  { name: 'e2e-runner', source: 'agents/e2e-runner.md' },
  { name: 'ui-verifier', source: 'codex/agent-sources/ui-verifier.md' },
  { name: 'docs-writer', source: 'codex/agent-sources/docs-writer.md' },
  { name: 'scoped-worker', source: 'codex/agent-sources/scoped-worker.md' },
];

const AGENT_SOURCES = Object.freeze(AGENTS.map((agent) => Object.freeze({ ...agent })));
const GENERATED_NAMES = Object.freeze(AGENT_SOURCES.map((agent) => agent.name));

// Read-only is an instruction plus the parent session's permission policy.
// These roles have no Write/Edit tool. The shared contract owns the rule;
// each projection only points at it.
const READ_ONLY_ROLES = new Set([
  'architect',
  'code-reviewer',
  'security-reviewer',
  'database-reviewer',
  'deep-reasoner',
  'doc-reviewer',
  'planner',
  'frontend-reviewer',
  'migration-reviewer',
  'ui-verifier',
]);

const CODEX_READ_ONLY_HANDOFF = [
  '## Codex result',
  'Return scope, source identity, verdict, findings, and evidence gaps inline.',
  'Follow .codex/dhpk/contracts/artifact-contract.md.',
  'Do not write an artifact. The parent persists this result when it has write authority.',
  'A complete inline result is finished even when no report file exists.',
  'Do not record unobserved evidence as PASS.',
].join('\n');

const CODEX_WRITER_HANDOFF = [
  '## Codex result',
  'Keep the summary inline: scope, source identity, verdict, findings, and evidence gaps.',
  'Assigned test traces and runner output may be written separately from that summary.',
  'Follow .codex/dhpk/contracts/artifact-contract.md.',
  'A complete inline summary is finished even when no summary file exists.',
  'Do not record unobserved evidence as PASS.',
].join('\n');

function readJson(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} is missing: ${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function sortedNames(values) {
  return [...new Set(values)].sort();
}

function readOwnershipManifest(outDir) {
  const manifest = readJson(OWNERSHIP_MANIFEST, 'Codex role ownership manifest');
  const generated = Array.isArray(manifest.generated_roles) ? manifest.generated_roles : null;
  const packageRoles = Array.isArray(manifest.package_roles) ? manifest.package_roles : null;
  const local = Array.isArray(manifest.workspace_local_extensions)
    ? manifest.workspace_local_extensions
    : null;
  if (!generated || !packageRoles || !local) {
    throw new Error(
      'Codex role ownership manifest must declare generated_roles, package_roles, and workspace_local_extensions arrays',
    );
  }
  if (sortedNames(generated).join('\n') !== sortedNames(GENERATED_NAMES).join('\n')) {
    throw new Error(
      `Codex role ownership manifest generated_roles drifted; expected [${sortedNames(GENERATED_NAMES).join(', ')}]`,
    );
  }
  const packageNames = new Set(packageRoles);
  for (const name of GENERATED_NAMES) {
    if (!packageNames.has(name)) {
      throw new Error(`Codex role ownership manifest omits generated package role '${name}'`);
    }
  }
  const sidecarPath = path.join(outDir, '.codex-agent-ownership.json');
  let sidecar = {};
  if (fs.existsSync(sidecarPath)) {
    sidecar = readJson(sidecarPath, 'workspace-local Codex role ownership manifest');
  }
  const sidecarLocal = Array.isArray(sidecar.workspace_local_extensions)
    ? sidecar.workspace_local_extensions
    : [];
  const localNames = new Set([...local, ...sidecarLocal]);
  for (const name of localNames) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
      throw new Error(`Invalid workspace-local Codex role name '${name}' in ownership manifest`);
    }
    if (packageNames.has(name)) {
      throw new Error(`Workspace-local Codex role '${name}' collides with a package-owned role`);
    }
  }
  return {
    generatedNames: new Set(GENERATED_NAMES),
    packageNames,
    localNames,
  };
}

function assertNoStaleToml(outDir, ownership) {
  if (!fs.existsSync(outDir)) return;
  const allowed = new Set([
    ...ownership.packageNames,
    ...ownership.generatedNames,
    ...ownership.localNames,
  ]);
  for (const entry of fs.readdirSync(outDir)) {
    if (!entry.endsWith('.toml')) continue;
    const role = entry.slice(0, -'.toml'.length);
    if (!allowed.has(role)) {
      throw new Error(
        `Stale package-owned Codex TOML '${path.join(outDir, entry)}' is outside the declared ownership manifest; remove it from the package or declare it as a workspace-local extension`,
      );
    }
  }
}

// Fixed, line-level boilerplate matchers. Every match is a Claude-only tooling
// reference irrelevant to Codex (cx/gitnexus routing, untrusted-input defense,
// or Claude-only lifecycle paths. Codex-readable trap-sheet, prompt-defense,
// and execution-policy references are retained and
// rewritten to receipt-managed `.codex/dhpk/` assets.
function isBoilerplate(line) {
  return (
    /^>\s*Exploration:/.test(line) ||
    /^>\s*Lookup:/.test(line) ||
    /^>\s*Use\s+`cx/.test(line) ||
    line.includes('${CLAUDE_PLUGIN_ROOT}/scripts/') ||
    line.includes('${CLAUDE_PLUGIN_ROOT}/skills/') ||
    line.includes('${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md')
  );
}

function usage() {
  return [
    'Generate Codex CLI role files from curated Claude agent definitions.',
    '',
    'Usage:',
    '  node scripts/gen-codex-agents.js [output-dir]',
    '',
    `Reads agents/<name>.md for the ${AGENTS.length}-agent allowlist and writes`,
    '<output-dir>/<name>.toml (default: codex/agents/). Deterministic: running',
    'twice with no source change produces byte-identical output.',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }
  const positional = argv.filter((arg) => !arg.startsWith('-'));
  if (positional.length > 1) {
    throw new Error('Expected at most one output directory argument');
  }
  return {
    help: false,
    outDir: path.resolve(positional[0] || DEFAULT_OUT_DIR),
  };
}

// YAML scalar unquoting: single-quoted ('' -> ') and double-quoted.
function unquoteYaml(value) {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

// Minimal, deterministic frontmatter reader. Handles bare scalars, quoted
// scalars, and folded/literal block scalars (>- / |-), which doc-reviewer's
// `description` uses. Only top-level (unindented) keys are captured; block
// scalar bodies are consumed by the inner loop.
function parseFrontmatter(block) {
  const lines = block.split('\n');
  const map = {};
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(/^([A-Za-z_][\w-]*):(.*)$/);
    if (!match) {
      i += 1;
      continue;
    }
    const key = match[1];
    const valuePart = match[2].trim();
    if (/^[|>][-+]?$/.test(valuePart)) {
      const folded = valuePart[0] === '>';
      const collected = [];
      i += 1;
      while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '') {
          collected.push('');
          i += 1;
          continue;
        }
        if (/^\s/.test(line)) {
          collected.push(line.replace(/^\s+/, ''));
          i += 1;
          continue;
        }
        break;
      }
      map[key] = folded
        ? collected.join(' ').replace(/\s+/g, ' ').trim()
        : collected.join('\n').replace(/\n+$/, '');
      continue;
    }
    map[key] = unquoteYaml(valuePart);
    i += 1;
  }
  return map;
}

function splitFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return { frontmatter: '', body: text };
  }
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

function stripArtifactSections(body) {
  const lines = body.split('\n');
  const kept = [];
  let index = 0;
  while (index < lines.length) {
    if (/^## (?:Closing — Artifact Output|Artifacts)\b/.test(lines[index])) {
      index += 1;
      while (index < lines.length && lines[index].trim() === '') index += 1;
      while (index < lines.length && lines[index].trim() !== '') index += 1;
      continue;
    }
    kept.push(lines[index]);
    index += 1;
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Drop Claude-only boilerplate lines, strip trailing whitespace, collapse the
// blank runs the deletions leave, and trim. Pure string transform -> stable.
// Blockquote-aware: when a boilerplate line opens a `>` blockquote block, its
// wrapped continuation lines (further `>` lines in the same block) are dropped
// too, so a two-line tip does not leave an orphaned sentence fragment.
function cleanBody(body) {
  const kept = [];
  let droppingBlockquote = false;
  for (const line of body.split('\n')) {
    const isQuote = /^>/.test(line);
    if (droppingBlockquote) {
      const keepsCodexAsset = line.includes('${CLAUDE_PLUGIN_ROOT}/agent-traps')
        || line.includes('${CLAUDE_PLUGIN_ROOT}/docs/contracts')
        || line.includes('${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md');
      if (isQuote && !keepsCodexAsset) continue; // still inside a Claude-only block
      droppingBlockquote = false;
    }
    if (isBoilerplate(line)) {
      if (isQuote) droppingBlockquote = true; // also drop its continuation lines
      continue;
    }
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Claude keeps specialist handoffs that depend on Claude's larger roster.
// The Codex projection must remain self-contained and only name roles that
// Codex can actually discover from codex/agents/.
function adaptCodexBody(agentName, body) {
  let adapted = body
    .replaceAll('${CLAUDE_PLUGIN_ROOT}/agent-traps', '.codex/dhpk/agent-traps')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}/docs/contracts', '.codex/dhpk/contracts')
    .replaceAll('../docs/contracts', '.codex/dhpk/contracts')
    .replaceAll('docs/contracts/', '.codex/dhpk/contracts/')
    .replaceAll('`agent-traps/', '`.codex/dhpk/agent-traps/')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md', '.codex/dhpk/policies/execution-policy.md')
    .replaceAll('rules/execution-policy.md', '.codex/dhpk/policies/execution-policy.md')
    .replaceAll('.claude/', '.codex/')
    .replaceAll('CLAUDE.md', 'AGENTS.md')
    .replaceAll('`/dhpk:do --plan`', 'Codex plan mode')
    .replaceAll('`/dhpk:do`', 'the Codex orchestrator')
    // Repo-relative skill paths do not exist in the .codex/ install layout, and
    // the named skill is cited (not dispatched) — drop the path, keep the name.
    .replace(/ \(`skills\/[a-z0-9-]+\/SKILL\.md`\)/g, '');
  if (agentName === 'code-reviewer') {
    adapted = adapted
      .replaceAll('`silent-failure-hunter`', '`deep-reasoner` (Codex fallback; otherwise perform the audit directly)')
      .replaceAll('`type-design-analyzer`', '`architect` (Codex fallback; otherwise perform the design check directly)');
  }
  if (agentName === 'planner') {
    adapted = adapted.replace(
      'spawn the built-in read-only `Explore` agent through\n  `Agent`. If `Explore` is unavailable, use a read-only `general-purpose` child.',
      'dispatch the direct Codex `explorer` role. If `explorer` is unavailable, return `VERDICT: RECONSULT` with the missing capability.',
    );
  }
  if (agentName === 'e2e-runner') {
    adapted = adapted
      .replaceAll('`smoke-tester`', 'perform the live probe directly (no Codex role)')
      .replaceAll('`ui-ux-verifier`', 'a manual page-vs-spec UI audit fallback')
      .replaceAll('**ui-ux-verifier**', '**manual page-vs-spec UI audit fallback**')
      .replaceAll('ui-ux-verifier', 'manual page-vs-spec UI audit fallback')
      .replace(
        /Verdict: PASS \| WARNING \| FAIL(?: \| BLOCKED)*/g,
        'Verdict: PASS | WARNING | FAIL | BLOCKED',
      )
      .replace(
        'Before reporting a RED/GREEN (or PASS/FAIL) verdict, run the project\'s typecheck command',
        "If Playwright or the browser capability is unavailable, return `Verdict: BLOCKED` as the first line with the missing capability and the exact command needed to resume. Before reporting a RED/GREEN (or PASS/FAIL) verdict, run the project's typecheck command",
      );
  }
  if (agentName === 'database-reviewer') {
    adapted = adapted
      .replaceAll('`performance-analyzer`', 'a dedicated performance pass (no Codex role; measure latency directly or escalate)');
  }
  if (agentName === 'security-reviewer') {
    adapted = adapted
      .replaceAll('`silent-failure-hunter`', '`deep-reasoner` (Codex fallback; otherwise perform the audit directly)');
  }
  if (agentName === 'doc-reviewer') {
    adapted = adapted
      .replaceAll('`doc-updater`', 'a documentation-refresh pass (no Codex role; update the docs directly)')
      .replaceAll('`docs-lookup`', 'a library-documentation lookup (no Codex role; consult the vendor docs directly)')
      .replace(
        '   `.codex/docs/doc-review-local.md` for Claude and AGY,\n'
        + '   `.codex/docs/doc-review-local.md` for Codex, or\n'
        + '   `.cursor/docs/doc-review-local.md` for Cursor.',
        '   `.codex/docs/doc-review-local.md` for Codex.',
      );
  }
  if (agentName === 'frontend-reviewer') {
    adapted = adapted
      .replaceAll('`modules/js/references/static-checks.md`', 'the project frontend lint and type-check configuration')
      .replaceAll('`modules/js/references/frontend-review-patterns.md`', 'the project frontend review patterns or a manual grep fallback')
      .replaceAll('skill `js-lint-config`', 'the project ESLint configuration')
      .replaceAll('skill `js-static-check-strategy`', 'the project TypeScript and static-check configuration')
      .replaceAll('`js-lint-config`', 'the project ESLint configuration')
      .replaceAll('`js-static-check-strategy`', 'the project TypeScript and static-check configuration')
      .replaceAll('`modules/js/hooks/_lib/js-tier-detect.sh`', 'the project stack-detection command, when one is provided');
  }
  if (agentName === 'migration-reviewer') {
    adapted = adapted
      .replaceAll('`dhpk:database-reviewer`', '`database-reviewer`')
      .replaceAll(
        '`code-trace` skill (cx / GitNexus / claude-mem routing for the symbol-level pre-edit lookups)',
        '`cx`/GitNexus symbol-level pre-edit guidance',
      )
      .replaceAll('`modules/yii-1.1/references/framework.md`', 'the project Yii migration API documentation')
      .replaceAll('`modules/laravel-*/`', 'the project Laravel migration documentation');
  }
  if (agentName === 'deep-reasoner') {
    // This projection IS the Codex backend, so the Claude-side "pick the codex
    // variant instead" fence has no referent here and its target is not a
    // dispatchable Codex role.
    adapted = adapted
      .replace(/^- `--reasoner=codex` backend variant → .*\n?/gm, '')
      .replaceAll('`dhpk:architect`', '`architect`')
      .replaceAll('`fast-worker`', '`worker`')
      .replaceAll('`e2e-runner`', 'a project-specific executable browser probe');
  }
  if (agentName === 'doc-reviewer') {
    adapted = adapted.replaceAll(
      '[`docs/agent-guidance/frontmatter-schema.md`](../docs/agent-guidance/frontmatter-schema.md)',
      'the Claude frontmatter schema when that file is present in the checkout; if it is absent, record the citation as UNAVAILABLE instead of a broken-link failure',
    );
  }
  if (agentName === 'architect') {
    adapted = adapted.replaceAll(
      'or is saved as an ADR at `.codex/artifacts/adr/ADR-{yyyymmdd}-{slug}.md`.',
      'or is returned in the inline handoff for the parent to persist when it has write authority.',
    );
  }
  adapted = stripArtifactSections(adapted);
  if (READ_ONLY_ROLES.has(agentName)) {
    adapted = adapted
      .replaceAll('Close out: write the artifact.', 'Close out: return the inline handoff. Do not write an artifact.')
      .replaceAll(
        "Writing the role's required review artifact remains allowed.",
        'Return the review inline. Do not write an artifact.',
      );
  }
  return adapted;
}

// TOML single-line basic string. Backslash first, then the rest.
function tomlBasicString(value) {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

// Content for a TOML multiline basic string ("""). Backslash MUST be escaped
// first: source bodies contain \{ and \. in bash snippets, which are invalid
// TOML escapes otherwise. Escaping every double-quote also neutralizes any
// literal """ and removes closing-delimiter ambiguity for a trailing quote.
function escapeMultiline(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '');
}

function buildToml(agent, frontmatter, body) {
  const fm = parseFrontmatter(frontmatter);
  const description = adaptCodexBody(agent.name, (fm.description || '').trim());
  if (!description) {
    throw new Error(`Empty description in ${agent.source}`);
  }
  const runtime = RUNTIME_METADATA[agent.name];
  if (!runtime) {
    throw new Error(`No Codex runtime metadata for ${agent.name}`);
  }
  // Keep the discovery description in the catalog field only. Repeating it in
  // the selected role prompt charges every spawn for metadata the router has
  // already exposed. The role id and canonical body remain the runtime
  // contract; route-specific detail stays behind the body's references.
  // A custom agent file cannot set sandbox_mode; the parent session owns it.
  const instructions = [
    `Role: ${agent.name}`,
    'Use the supplied scoped task packet and load only references required by the route.',
    '',
    adaptCodexBody(agent.name, cleanBody(body)),
    '',
    READ_ONLY_ROLES.has(agent.name) ? CODEX_READ_ONLY_HANDOFF : CODEX_WRITER_HANDOFF,
  ]
    .join('\n')
    .trim();
  if (!instructions) {
    throw new Error(`Empty developer_instructions for ${agent.name}`);
  }
  const lines = [
    `name = ${tomlBasicString(agent.name)}`,
    `description = ${tomlBasicString(description)}`,
    `model = ${tomlBasicString(runtime.model)}`,
    `model_reasoning_effort = ${tomlBasicString(runtime.effort)}`,
    '',
    'developer_instructions = """',
    escapeMultiline(instructions),
    '"""',
    '',
  ];
  return {
    toml: lines.join('\n'),
    effort: runtime.effort,
    description,
    instructions,
  };
}

function generate(outDir) {
  const ownership = readOwnershipManifest(outDir);
  assertNoStaleToml(outDir, ownership);
  const roleMap = readJson(ROLE_MAP, 'Codex role map');
  const plannedRoles = new Set([
    ...GENERATED_NAMES,
    ...ownership.packageNames,
  ]);
  const planned = [];
  const summary = [];
  for (const agent of AGENTS) {
    const sourcePath = path.join(ROOT, agent.source);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source agent not found: ${agent.source}`);
    }
    const text = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
    const { frontmatter, body } = splitFrontmatter(text);
    const built = buildToml(agent, frontmatter, body);
    planned.push({ agent, built });
  }

  // Validate the complete adapted batch before publishing any TOML.  Direct
  // targets therefore resolve independently of the order in which files are
  // eventually written.
  const neighborErrors = [];
  for (const { agent, built } of planned) {
    neighborErrors.push(...collectCodexRoleNeighborErrors({
      sourceRole: agent.name,
      text: `${built.description}\n${built.instructions}`,
      roleMap,
      generatedRoles: ownership.generatedNames,
      packageRoles: ownership.packageNames,
      resolvableTargets: plannedRoles,
      file: agent.source,
    }));
  }
  if (neighborErrors.length > 0) {
    throw new Error(neighborErrors.join('\n'));
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const { agent, built } of planned) {
    const { toml, effort } = built;
    const outFile = path.join(outDir, `${agent.name}.toml`);
    fs.writeFileSync(outFile, toml);
    summary.push(`wrote ${path.relative(ROOT, outFile)} [effort=${effort}]`);
  }
  return summary;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const summary = generate(options.outDir);
  console.log(summary.join('\n'));
  console.log(`Generated ${summary.length} Codex role file(s).`);
}

module.exports = { AGENT_SOURCES, RUNTIME_METADATA, generate };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
