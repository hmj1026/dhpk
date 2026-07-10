#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Plugin root: this script lives in scripts/, so root is one level up.
const ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'agents');
const DEFAULT_OUT_DIR = path.join(ROOT, 'codex', 'agents');

// Single source of truth for the model. A model bump is one edit here; the
// source agent's own `model:` field is intentionally NOT copied.
const MODEL = 'gpt-5.5';

// Curated allowlist — EXACTLY these 7, in emit order. Each entry pins a
// category (not the source frontmatter's effort). The 4 hand-maintained Codex
// roles (bug-investigator, explorer, monitor, worker) are intentionally absent
// and are never read or overwritten: any drift check scopes to these names.
const AGENTS = [
  { name: 'architect', category: 'design' },
  { name: 'code-reviewer', category: 'reviewer' },
  { name: 'security-reviewer', category: 'reviewer' },
  { name: 'database-reviewer', category: 'reviewer' },
  { name: 'tdd-guide', category: 'implementer' },
  { name: 'deep-reasoner', category: 'reasoning' },
  { name: 'doc-reviewer', category: 'reviewer' },
];

// Design D4: reviewers -> high, implementers -> medium, monitors -> low.
// architect (design) and deep-reasoner (reasoning) are read-only,
// reasoning-dominant roles whose output quality scales with deliberation
// depth, so they share the reviewer high-effort tier. `monitor` is defined for
// scheme completeness; no monitor is in this allowlist.
const EFFORT_BY_CATEGORY = {
  reviewer: 'high',
  design: 'high',
  reasoning: 'high',
  implementer: 'medium',
  monitor: 'low',
};

// Fixed, line-level boilerplate matchers. Every match is a Claude-only tooling
// reference irrelevant to Codex (cx/gitnexus routing, untrusted-input defense,
// or a ${CLAUDE_PLUGIN_ROOT} filesystem path: trap-sheet loader, prompt-defense,
// execution-policy, clear-sentinel hook). Substantive checklist prose never
// matches, so removal preserves the review/design content.
function isBoilerplate(line) {
  return (
    /^>\s*Exploration:/.test(line) ||
    /^>\s*Lookup:/.test(line) ||
    /^>\s*Use\s+`cx/.test(line) ||
    /^>\s*\*\*Untrusted input\*\*/.test(line) ||
    line.includes('${CLAUDE_PLUGIN_ROOT}')
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
      if (isQuote) continue; // still inside the boilerplate blockquote block
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
  const description = (fm.description || '').trim();
  if (!description) {
    throw new Error(`Empty description in agents/${agent.name}.md`);
  }
  const effort = EFFORT_BY_CATEGORY[agent.category];
  if (!effort) {
    throw new Error(`No effort mapping for category "${agent.category}" (${agent.name})`);
  }
  const sandbox = deriveSandbox(fm.tools);
  const instructions = [`Role: ${agent.name}`, '', description, '', cleanBody(body)]
    .join('\n')
    .trim();
  if (!instructions) {
    throw new Error(`Empty developer_instructions for ${agent.name}`);
  }
  const lines = [
    `name = ${tomlBasicString(agent.name)}`,
    `description = ${tomlBasicString(description)}`,
    `model = ${tomlBasicString(MODEL)}`,
    `model_reasoning_effort = ${tomlBasicString(effort)}`,
    `sandbox_mode = ${tomlBasicString(sandbox)}`,
    '',
    'developer_instructions = """',
    escapeMultiline(instructions),
    '"""',
    '',
  ];
  return { toml: lines.join('\n'), effort, sandbox };
}

function generate(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const summary = [];
  for (const agent of AGENTS) {
    const sourcePath = path.join(SOURCE_DIR, `${agent.name}.md`);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source agent not found: ${sourcePath}`);
    }
    const text = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
    const { frontmatter, body } = splitFrontmatter(text);
    const { toml, effort, sandbox } = buildToml(agent, frontmatter, body);
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
