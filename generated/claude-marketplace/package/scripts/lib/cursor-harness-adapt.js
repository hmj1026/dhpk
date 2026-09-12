'use strict';

const CLAUDE_PLUGIN_ROOT_TOKEN = '${' + 'CLAUDE_PLUGIN_ROOT}';
const CURSOR_PLUGIN_ROOT_TOKEN = '${' + 'CURSOR_PLUGIN_ROOT}';
const CODEX_SUPPORT_ROOT = '.codex/dhpk';
const CURSOR_SUPPORT_ROOT = '.cursor/dhpk';
const CURSOR_REVIEW_GATE_MECHANICS_PATH = `${CLAUDE_PLUGIN_ROOT_TOKEN}/skills/flow-guide/references/review-gate-mechanics.md`;
const CURSOR_REVIEW_GATE_MECHANICS_TARGET = '.cursor/skills/flow-guide/references/review-gate-mechanics.md';
const CURSOR_UNSUPPORTED_IMPLEMENTATION_DISPATCH_PATH = `${CLAUDE_PLUGIN_ROOT_TOKEN}/skills/flow-guide/references/implementation-dispatch.md`;
const CURSOR_CLAUDE_PLUGIN_ROOT_WILDCARD = '`' + CLAUDE_PLUGIN_ROOT_TOKEN + '/...`';
const CURSOR_CX_BOILERPLATE = 'Use ' + String.fromCharCode(96) + 'cx';
const CURSOR_DEFAULT_AGENT_MODEL = 'cursor-grok-4.6-high';
const CURSOR_DOC_AGENT_MODEL = 'composer-2.5-fast';
const CURSOR_DOC_AGENTS = new Set(['doc-reviewer', 'docs-lookup', 'doc-updater']);

function agentStem(basename) {
  return String(basename || '').replace(/\.(?:md|mdc|markdown|txt)$/i, '').toLowerCase();
}

function cursorAgentModel(basenameOrName) {
  if (CURSOR_DOC_AGENTS.has(agentStem(basenameOrName))) return CURSOR_DOC_AGENT_MODEL;
  return CURSOR_DEFAULT_AGENT_MODEL;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseToolList(raw) {
  if (Array.isArray(raw)) return raw.map((value) => String(value).trim()).filter(Boolean);
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
}

function isCursorBoilerplateLine(line) {
  return (
    /^>\s*Exploration:/.test(line)
    || /^>\s*Lookup:/.test(line)
    || line.includes(CURSOR_CX_BOILERPLATE)
    || line.includes(CLAUDE_PLUGIN_ROOT_TOKEN + '/scripts/')
    || (line.includes(CLAUDE_PLUGIN_ROOT_TOKEN + '/skills/')
      && !line.includes(CURSOR_REVIEW_GATE_MECHANICS_PATH)
      && !/\/skills\/dhpk-(?:agy-fast-worker|codex-bridge)\/scripts\/run-(?:agy|codex)\.sh\b/.test(line))
  );
}

function rewriteCursorSupportingAssetBody(body) {
  return String(body || '')
    .split(CODEX_SUPPORT_ROOT).join(CURSOR_SUPPORT_ROOT)
    .split('.codex/artifacts').join('.cursor/artifacts')
    .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/').join(CURSOR_SUPPORT_ROOT + '/')
    .split(CLAUDE_PLUGIN_ROOT_TOKEN).join(CURSOR_SUPPORT_ROOT);
}

function stripCursorReviewGateSetup(body) {
  const kept = [];
  let droppingSection = false;
  for (const line of String(body || '').split('\n')) {
    const trimmed = line.trim();
    if (!droppingSection && /^When invoked with [`']?--review-gate\b/i.test(trimmed)) {
      droppingSection = true;
      continue;
    }
    if (droppingSection) {
      if (/^Walk the user through configuring\b/i.test(trimmed)) {
        droppingSection = false;
        kept.push(line);
      }
      continue;
    }
    if (line.includes('--review-gate')
      || /\breview_gate\b/i.test(line)
      || line.includes('review-gate-runtime.js')
      || /\binit --repo-root\b/.test(line)) {
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function removeCursorUnsupportedFlowGuideReference(line) {
  if (!line.includes(CURSOR_REVIEW_GATE_MECHANICS_PATH)) return line;
  const quotedPath = '`' + CURSOR_UNSUPPORTED_IMPLEMENTATION_DISPATCH_PATH + '`';
  return line
    .split(CURSOR_CLAUDE_PLUGIN_ROOT_WILDCARD).join('the plugin-root interpolation token')
    .split(quotedPath + ' and ').join('')
    .split(CURSOR_UNSUPPORTED_IMPLEMENTATION_DISPATCH_PATH + ' and ').join('')
    .split(' and ' + CURSOR_UNSUPPORTED_IMPLEMENTATION_DISPATCH_PATH).join('');
}

function rewriteCursorHarnessBody(body) {
  const rawBody = String(body || '');
  const sourceBody = /(?:^|\n)\s*When invoked with [`']?--review-gate\b/i.test(rawBody)
    ? stripCursorReviewGateSetup(body)
    : rawBody;
  const kept = [];
  let droppingBlockquote = false;
  for (const rawLine of sourceBody.split('\n')) {
    const line = removeCursorUnsupportedFlowGuideReference(rawLine);
    const isQuote = /^>/.test(line);
    if (droppingBlockquote) {
      const keepsAsset = line.includes(CLAUDE_PLUGIN_ROOT_TOKEN + '/agent-traps')
        || line.includes(CLAUDE_PLUGIN_ROOT_TOKEN + '/docs/')
        || line.includes(CLAUDE_PLUGIN_ROOT_TOKEN + '/rules/')
        || line.includes(CLAUDE_PLUGIN_ROOT_TOKEN + '/agents/')
        || line.includes(CLAUDE_PLUGIN_ROOT_TOKEN + '/manifests/');
      if (isQuote && !keepsAsset) continue;
      droppingBlockquote = false;
    }
    if (isCursorBoilerplateLine(line)) {
      if (isQuote) droppingBlockquote = true;
      continue;
    }
    kept.push(line);
  }
  const remainingRulePattern = new RegExp(
    escapeRegExp(CLAUDE_PLUGIN_ROOT_TOKEN) + '/rules/([A-Za-z0-9._-]+)\\.md\\b',
    'g',
  );
  return rewriteCursorSupportingAssetBody(
    kept
      .join('\n')
      .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/agent-traps').join(CURSOR_SUPPORT_ROOT + '/agent-traps')
      .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/docs/contracts').join(CURSOR_SUPPORT_ROOT + '/contracts')
      .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/rules/execution-policy.md').join(CURSOR_SUPPORT_ROOT + '/policies/execution-policy.md')
      .split(CURSOR_REVIEW_GATE_MECHANICS_PATH).join(CURSOR_REVIEW_GATE_MECHANICS_TARGET)
      .replace(remainingRulePattern, '.cursor/rules/$1.mdc')
      .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/agents/').join('.cursor/agents/')
      .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/skills/dhpk-agy-fast-worker/scripts/run-agy.sh')
      .join(CURSOR_PLUGIN_ROOT_TOKEN + '/skills/dhpk-agy-fast-worker/scripts/run-agy.sh')
      .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/skills/dhpk-codex-bridge/scripts/run-codex.sh')
      .join(CURSOR_PLUGIN_ROOT_TOKEN + '/skills/dhpk-codex-bridge/scripts/run-codex.sh'),
  )
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cursorDocumentDestinationName(kind, basename) {
  if (kind !== 'rules') return basename;
  return basename.replace(/\.(?:md|markdown)$/i, '.mdc');
}

function retainsClaudePluginRoot(content) {
  return String(content || '').includes(CLAUDE_PLUGIN_ROOT_TOKEN);
}

function retainsCodexSupportRoot(content) {
  return String(content || '').includes(CODEX_SUPPORT_ROOT);
}

module.exports = {
  CLAUDE_PLUGIN_ROOT_TOKEN,
  CURSOR_PLUGIN_ROOT_TOKEN,
  CODEX_SUPPORT_ROOT,
  CURSOR_SUPPORT_ROOT,
  CURSOR_DEFAULT_AGENT_MODEL,
  CURSOR_DOC_AGENT_MODEL,
  parseToolList,
  stripCursorReviewGateSetup,
  rewriteCursorHarnessBody,
  rewriteCursorSupportingAssetBody,
  cursorAgentModel,
  cursorDocumentDestinationName,
  retainsClaudePluginRoot,
  retainsCodexSupportRoot,
};
