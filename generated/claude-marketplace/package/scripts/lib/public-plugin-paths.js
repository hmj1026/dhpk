'use strict';

// Path policy for shipped Public Plugin files (#1497). A plugin-only install has
// no dhpk repository harness, so a shipped file must not tell the agent to read
// `.claude/...` or `.codex/...` content that only the dhpk repo has (rules,
// agents, skills, commands, hooks, docs). Paths in the consumer project that the
// skill writes, or settings the consumer owns, are legitimate and are listed in
// ALLOWED_CONSUMER_PATHS, the single place to extend.

// A harness path with at least one segment below the directory. A bare `.claude/`
// (a filter glob or a directory mention) names no content and is not a reference.
const HARNESS_PATH = /(?<![\w.-])\.(claude|codex)\/([^\s`'"<>)\]}|,;*]+)/g;

// Allowed consumer-project paths, matched on the part after `.claude/` or `.codex/`.
// Every entry carries the reason it is not a dhpk-internal read.
const ALLOWED_CONSUMER_PATHS = Object.freeze([
  { pattern: /^artifacts\//, reason: 'output directory the skill writes in the consumer project' },
  { pattern: /^cache\//, reason: 'cache the shipped runner writes in the consumer project or home directory' },
  { pattern: /^(?:settings(?:\.local)?\.json|config\.toml)$/, reason: 'consumer-owned host settings the skill reads or tells the user about' },
  { pattern: /^dhpk\/skills\//, reason: 'optional installed runner, each use is guarded by "when present" and falls back to the shipped script' },
  { pattern: /^scripts\/dep-audit\.sh$/, reason: 'optional consumer-owned audit script, used only when present' },
]);

// Allowed per file: mentions inside shipped scripts, which are not rewritten.
// Matched on the packaged path suffix and the path after `.claude/` or `.codex/`.
const ALLOWED_IN_FILES = Object.freeze([
  { file: /\/prepare_dev_scope\.py$/, pattern: /^rules\/dev-workflow-project\.md/, reason: 'comment naming the consumer project\'s own override file' },
  { file: /\/deploy-list\.sh$/, pattern: /^skills\/deploy-list\//, reason: 'comment about where a consumer may install the script' },
  { file: /\/extended-presets\.example\//, pattern: /.*/, reason: 'example preset for a consumer project: harness dirs are filter patterns' },
  { file: /\/evals\/[^/]+\/fixtures\//, pattern: /.*/, reason: 'eval fixtures build a throwaway consumer repository containing harness files' },
  { file: /\/deploy-list\.sh$/, pattern: /^\.codex\//, reason: 'comment listing the harness directories the script filters out' },
]);

const TEXT_FILE = /\.(md|txt|js|cjs|mjs|py|sh|json|ya?ml|toml)$/i;

const trimTrailing = (value) => value.replace(/[.:]+$/, '');

function allowed(file, rest) {
  return ALLOWED_CONSUMER_PATHS.some((entry) => entry.pattern.test(rest))
    || ALLOWED_IN_FILES.some((entry) => entry.file.test(file) && entry.pattern.test(rest));
}

// Returns [{ file, reference }] for every disallowed harness path in the files
// (a Map of packaged path to Buffer).
function findInternalPathReferences(files) {
  const found = [];
  for (const [file, bytes] of files) {
    if (!file.startsWith('skills/') || !TEXT_FILE.test(file)) continue;
    for (const match of bytes.toString('utf8').matchAll(HARNESS_PATH)) {
      const rest = trimTrailing(match[2]);
      if (rest !== '' && !allowed(file, rest)) found.push({ file, reference: `.${match[1]}/${rest}` });
    }
  }
  return found;
}

module.exports = { ALLOWED_CONSUMER_PATHS, ALLOWED_IN_FILES, findInternalPathReferences };
