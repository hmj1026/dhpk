#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { collectCodexRoleNeighborErrors } = require('./lib/codex-role-neighbors');

// Plugin root: this script lives in scripts/, so root is one level up.
const ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'agents');
const DEFAULT_OUT_DIR = path.join(ROOT, 'codex', 'agents');
const OWNERSHIP_MANIFEST = path.join(ROOT, 'codex', 'agent-projection-manifest.json');
const ROLE_MAP = path.join(ROOT, 'codex', 'agent-role-map.json');

// Codex runtime metadata is explicit per role. Claude frontmatter describes the
// Claude runtime and must not silently overwrite the effective Codex model or
// reasoning effort.
const RUNTIME_METADATA = Object.freeze({
  architect: { model: 'gpt-5.6-sol', effort: 'high' },
  'code-reviewer': { model: 'gpt-5.6-terra', effort: 'medium' },
  'security-reviewer': { model: 'gpt-5.6-sol', effort: 'high' },
  'database-reviewer': { model: 'gpt-5.6-terra', effort: 'high' },
  'tdd-guide': { model: 'gpt-5.6-luna', effort: 'max' },
  'deep-reasoner': { model: 'gpt-5.6-sol', effort: 'high' },
  'doc-reviewer': { model: 'gpt-5.6-luna', effort: 'medium' },
  planner: { model: 'gpt-5.6-sol', effort: 'high' },
  'spec-miner': { model: 'gpt-5.6-sol', effort: 'high' },
  'frontend-reviewer': { model: 'gpt-5.6-terra', effort: 'high' },
  'migration-reviewer': { model: 'gpt-5.6-sol', effort: 'high' },
  'e2e-runner': { model: 'gpt-5.6-terra', effort: 'high' },
});

// Curated allowlist — EXACTLY these 12, in emit order. Each entry pins a
// category (not the source frontmatter's effort). The 4 hand-maintained Codex
// roles (bug-investigator, explorer, monitor, worker) are intentionally absent
// and are never read or overwritten: any drift check scopes to these names.
const AGENTS = [
  { name: 'architect' },
  { name: 'code-reviewer' },
  { name: 'security-reviewer' },
  { name: 'database-reviewer' },
  { name: 'tdd-guide' },
  { name: 'deep-reasoner' },
  { name: 'doc-reviewer' },
  { name: 'planner' },
  { name: 'spec-miner' },
  { name: 'frontend-reviewer' },
  { name: 'migration-reviewer' },
  { name: 'e2e-runner' },
];

const GENERATED_NAMES = Object.freeze(AGENTS.map((agent) => agent.name));

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
// execution-policy, and reviewer-contract references are retained and
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

function parseToolList(raw) {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((tool) => tool.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

// sandbox_mode is DERIVED from the source tools list, never hardcoded.
function deriveSandbox(toolsRaw) {
  const tools = parseToolList(toolsRaw);
  const writes = tools.includes('Write') || tools.includes('Edit');
  return writes ? 'workspace-write' : 'read-only';
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
    .replaceAll(/Trigger: sentinel `\.pending-[^`]+`/g, 'Trigger: an explicit review request')
    .replaceAll(/sentinel = `\.pending-[^`]+`/g, 'without an automatic marker')
    .replaceAll(/`\.pending-[^`]+`/g, 'the matching review request')
    .replaceAll(/Sentinel-scoped precedence/g, 'Review precedence')
    // Case-preserving: a sentence-initial "Sentinel-driven" must not fall
    // through to the bare /sentinel/gi rule and become "review marker-driven".
    .replaceAll(/([Ss])entinel-driven/g, (_match, initial) => (initial === 'S' ? 'Review-gated' : 'review-gated'))
    .replaceAll(/sentinel review chain/g, 'review chain')
    .replaceAll(/sentinel/gi, 'review marker')
    .replaceAll(/No sentinel/g, 'No automatic marker')
    .replaceAll(/sentinel clearance is hook-owned/g, 'the parent flow owns lifecycle')
    .replaceAll(/review marker clearance is hook-owned/g, 'the parent flow owns lifecycle')
    .replaceAll(/sentinel clearance/g, 'review lifecycle')
    .replaceAll(/subagent-stop-verify\.sh/g, 'the parent review flow')
    .replaceAll(/clear-sentinel\.sh/g, 'a host-specific lifecycle helper')
    .replaceAll(/post-edit-remind\.sh/g, 'the parent review flow')
    .replaceAll(/, sentinel = [^\n.]+\./g, '.')
    .replace(/the parent flow owns lifecycle: only a fresh canonical artifact with leading delimited frontmatter and required reviewer fields plus `APPROVE` or `PASS` clears the matching review request; warning, fail, or malformed evidence leaves it armed\. This reviewer\'s job ends at writing the artifact\./g,
      'The parent flow does not auto-clear Codex state. Write the final review under `.codex/artifacts/reviews/` with the role\'s required frontmatter and final verdict; a human or host integration manually records any review-lifecycle completion after reading that evidence.')
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
      .replaceAll('Verdict: PASS | WARNING | FAIL', 'Verdict: PASS | WARNING | FAIL | BLOCKED')
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
      .replaceAll('`docs-lookup`', 'a library-documentation lookup (no Codex role; consult the vendor docs directly)');
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
        '`dhpk:dhpk-tool-routing` skill (cx / gitnexus / claude-mem routing for the symbol-level pre-edit lookups)',
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
    throw new Error(`Empty description in agents/${agent.name}.md`);
  }
  const runtime = RUNTIME_METADATA[agent.name];
  if (!runtime) {
    throw new Error(`No Codex runtime metadata for ${agent.name}`);
  }
  const sandbox = deriveSandbox(fm.tools);
  // Keep the discovery description in the catalog field only. Repeating it in
  // the selected role prompt charges every spawn for metadata the router has
  // already exposed. The role id and canonical body remain the runtime
  // contract; route-specific detail stays behind the body's references.
  const instructions = [
    `Role: ${agent.name}`,
    'Use the supplied scoped task packet and load only references required by the route.',
    '',
    adaptCodexBody(agent.name, cleanBody(body)),
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
    `sandbox_mode = ${tomlBasicString(sandbox)}`,
    '',
    'developer_instructions = """',
    escapeMultiline(instructions),
    '"""',
    '',
  ];
  return {
    toml: lines.join('\n'),
    effort: runtime.effort,
    sandbox,
    description,
    instructions,
  };
}

function generate(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
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
    const sourcePath = path.join(SOURCE_DIR, `${agent.name}.md`);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source agent not found: ${sourcePath}`);
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
      file: `agents/${agent.name}.md`,
    }));
  }
  if (neighborErrors.length > 0) {
    throw new Error(neighborErrors.join('\n'));
  }

  for (const { agent, built } of planned) {
    const { toml, effort, sandbox } = built;
    const outFile = path.join(outDir, `${agent.name}.toml`);
    fs.writeFileSync(outFile, toml);
    summary.push(
      `wrote ${path.relative(ROOT, outFile)} [effort=${effort}, sandbox=${sandbox}]`
    );
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

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
