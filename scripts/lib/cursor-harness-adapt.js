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
    || line.includes(CLAUDE_PLUGIN_ROOT_TOKEN + '/skills/')
  );
}

function rewriteCursorSupportingAssetBody(body) {
  return String(body || '')
    .split(CODEX_SUPPORT_ROOT).join(CURSOR_SUPPORT_ROOT)
    .split('.codex/artifacts').join('.cursor/artifacts')
    .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/').join(CURSOR_SUPPORT_ROOT + '/')
    .split(CLAUDE_PLUGIN_ROOT_TOKEN).join(CURSOR_SUPPORT_ROOT);
}

function rewriteCursorHarnessBody(body) {
  const sourceBody = String(body || '');
  const kept = [];
  let droppingBlockquote = false;
  for (const line of sourceBody.split('\n')) {
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
      .split('.claude/docs/doc-review-local.md').join('.cursor/docs/doc-review-local.md')
      .replace(remainingRulePattern, '.cursor/rules/$1.mdc')
      .split(CLAUDE_PLUGIN_ROOT_TOKEN + '/agents/').join('.cursor/agents/'),
  )
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CURSOR_PORTABLE_SKILL_OWNER = 'dhpk-agent';

// Native Cursor agents are loaded from the installed plugin, not from a
// project-local `.cursor/dhpk` sync. Support files live in that package.
// Worker adapters stay in the co-installed portable owner. The installation
// guide places the two packages side by side as `dhpk-cursor` and `dhpk-agent`.
function rewriteCursorNativeAgentBody(body) {
  const canonicalSharedScriptPrefix = `${CLAUDE_PLUGIN_ROOT_TOKEN}/scripts/cli-dispatch/`;
  const packagedSharedScriptPrefix = `${CURSOR_PLUGIN_ROOT_TOKEN}/../${CURSOR_PORTABLE_SKILL_OWNER}/scripts/cli-dispatch/`;
  return rewriteCursorHarnessBody(String(body || '').split(canonicalSharedScriptPrefix).join(packagedSharedScriptPrefix))
    .split('.cursor/dhpk/agent-traps/').join(`${CURSOR_PLUGIN_ROOT_TOKEN}/agent-traps/`)
    .split('.cursor/dhpk/policies/execution-policy.md').join(`${CURSOR_PLUGIN_ROOT_TOKEN}/rules/execution-policy.mdc`)
    .split('.cursor/rules/').join(`${CURSOR_PLUGIN_ROOT_TOKEN}/rules/`);
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
  rewriteCursorNativeAgentBody,
  rewriteCursorSupportingAssetBody,
  cursorAgentModel,
  cursorDocumentDestinationName,
  retainsClaudePluginRoot,
  retainsCodexSupportRoot,
};
