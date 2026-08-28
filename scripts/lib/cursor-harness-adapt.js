'use strict';

const CLAUDE_PLUGIN_ROOT_TOKEN = '${' + 'CLAUDE_PLUGIN_ROOT}';
const CURSOR_PLUGIN_ROOT_TOKEN = '${' + 'CURSOR_PLUGIN_ROOT}';
const CODEX_SUPPORT_ROOT = '.codex/dhpk';
const CURSOR_SUPPORT_ROOT = '.cursor/dhpk';
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
      && !/\/skills\/dhpk-(?:agy-fast-worker|codex-bridge)\/scripts\/run-(?:agy|codex)\.sh\b/.test(line))
  );
}

function rewriteCursorSupportingAssetBody(body) {
  return String(body || '')
    .split(CODEX_SUPPORT_ROOT).join(CURSOR_SUPPORT_ROOT)
    .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/').join(CURSOR_SUPPORT_ROOT + '/')
    .split(CLAUDE_PLUGIN_ROOT_TOKEN).join(CURSOR_SUPPORT_ROOT);
}

function rewriteCursorHarnessBody(body) {
  const kept = [];
  let droppingBlockquote = false;
  for (const line of String(body || '').split('\n')) {
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
  rewriteCursorHarnessBody,
  rewriteCursorSupportingAssetBody,
  cursorAgentModel,
  cursorDocumentDestinationName,
  retainsClaudePluginRoot,
  retainsCodexSupportRoot,
};
