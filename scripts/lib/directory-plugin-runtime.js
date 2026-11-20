'use strict';

// Runtime-file selection for the Full Plugin (Claude Code package distributed
// through the Repository Marketplace at dist/claude-marketplace/package). The
// instruction-only Directory Plugin (dhpk-lite at dist/claude-directory/package)
// reduces from this selected tree.
//
// The package carries only files that run or that Claude loads.  Documentation,
// the build, CI, release, and maintainer scripts, per-skill build metadata,
// eval fixtures, and the libraries only the build uses are dropped, even when
// a maintainer skill mentions them.  Claude's directory limit is 512 files, so
// every file that does not run costs a file that does.  Pure: takes and returns
// a Map of destination path to { content: Buffer, ... }.

const NEVER_SHIPPED = Object.freeze([
  'docs/',
  'scripts/ci/', 'scripts/release/', 'scripts/maintainer/', 'scripts/validate/', 'scripts/codemaps/',
]);

// scripts/ci/_lib is a shared library that runtime scripts require, minus the
// two modules only the generators use.
const RUNTIME_EXCEPTIONS = Object.freeze(['scripts/ci/_lib/']);

// Files under a skill directory that Claude never reads: the per-skill
// distribution record, the OpenAI listing metadata, and eval fixtures.
const SKILL_BUILD_FILE = /^skills\/(?:.+\/)?(?:distribution\.yaml|agents\/openai\.yaml)$/;
const SKILL_EVAL_FILE = /^skills\/(?:.+\/)?(?:evals\/|scripts\/check-golden\.sh$)/;

// Stack skills compile into flow-drive's reference tree.  They ship in
// dhpk-stacks as top-level skills, so the Full Plugin does not carry them.
const STACK_SKILL_IDS = Object.freeze(['swift', 'php', 'laravel', 'yii1', 'js-static-checks', 'python', 'react', 'nextjs']);
const STACK_SKILL_FILE = new RegExp(`^skills/flow-drive/references/(${STACK_SKILL_IDS.join('|')})/`);

// Maps a compiled core path of a stack skill to its dhpk-stacks path, or null.
function stackSkillDestination(destination) {
  const match = STACK_SKILL_FILE.exec(destination);
  if (!match || isBuildOnly(destination)) return null;
  return `skills/${match[1]}/${destination.slice(match[0].length)}`;
}

// Build-only modules: nothing a hook, command, agent, or skill runs requires
// them.  tests/directory-plugin-runtime.test.js proves the shipped tree never
// requires one of these.
const BUILD_ONLY_FILES = Object.freeze([
  'scripts/agy-adapt-agents.js', 'scripts/check-cross-cli-drift.sh', 'scripts/check-portability.sh',
  'scripts/gen-codex-agents.js', 'scripts/dhpk-distribution.js',
  'scripts/ci/_lib/codex-runtime.js', 'scripts/ci/_lib/skill-distribution-generator.js',
  // Checkout installer chain.  harness-setup ships its own installer modules under the skill directory;
  // the two scripts/hooks/install-*.sh entries stay because they tell a plugin-only user to use a checkout.
  'scripts/dhpk-install.js', 'scripts/dhpk-harness.js', 'scripts/install.sh', 'scripts/setup/install-assets.sh',
  ...['codex', 'codex-cli', 'cursor-plan', 'python-compat'].map((name) => `scripts/lib/install-adapters/${name}.js`),
  ...[
    'agent-frontmatter', 'capability-bundle-selection', 'consumer-runtime-preflight', 'cursor-consumer-evidence',
    'dhpk-install-lifecycle', 'dhpk-install-recover', 'harness', 'harness-receipt', 'harness-result',
    'installer-modules', 'marketplace-skill-content', 'native-shared-skill-install', 'physical-file', 'platform-provenance',
    'portable-skill-metadata', 'profile-projection-sets', 'project-agent-projection-publisher',
    'projection-artifact-store', 'projection-journal', 'receipt-json-primitives', 'receipt-primitives',
    'receipt-store-budget', 'redaction', 'release-artifact-manifest', 'release-evidence', 'secret-patterns',
    'standalone-skill-dependencies',
    'agent-plugin-package', 'agents-skills-package', 'agents-skills-retirement', 'agy-plugin-install',
    'agy-plugin-package', 'assertion-evidence', 'bounded-child-process', 'capability-bundle-activation',
    'changelog-fragments', 'ci-plan', 'claude-capability-bundle', 'claude-directory-reduction', 'claude-plugin-provision',
    'codex-discovery-registry', 'codex-native-activation', 'codex-native-package', 'codex-role-neighbors',
    'command-namespace', 'cross-cli-parity', 'cursor-harness-adapt', 'cursor-plugin-package',
    'cursor-session-home', 'cursor-sync-package', 'dhpk-distribution', 'directory-plugin-runtime',
    'discovery-budget', 'dispatch-projection', 'distribution-preview', 'file-tree', 'gate-runner', 'host-manifests',
    'host-package-pipeline', 'markdown-link-sanitizer', 'marketplace-host-publication',
    'marketplace-runtime-acceptance', 'marketplace-selection', 'native-agent-support',
    'openai-submission-assets', 'openai-submission-command', 'openai-submission-package',
    'openai-submission-zip', 'plugin-user-config-metadata', 'provider-adapter', 'public-plugin-layout',
    'public-plugin-paths', 'public-plugin-tree', 'publication-conformance', 'reference-registry',
    'release-parity', 'release-probe-batch', 'release-publication-bundle', 'rule-activation-map',
    'skill-command-generation', 'skill-directory-coverage', 'skill-distribution-compile',
    'skill-distribution-extract', 'skill-distribution-source', 'skill-next-map', 'skill-resource-sync',
    'standalone-package-assets', 'toolchain-identity', 'workflow-package-closure',
  ].map((name) => `scripts/lib/${name}.js`),
  'scripts/lib/install-prompts.sh',
  ...[
    'claude-user-config-legacy', 'claude-user-config-metadata',
    'command-skill-dispositions', 'discovery-budgets', 'listing-metadata', 'marketplace-runtime-acceptance',
    'marketplace-selection', 'skill-directory-coverage', 'skill-resource-copies', 'skill-resources',
  ].map((name) => `manifests/${name}.json`),
]);

const isBuildOnly = (destination) => BUILD_ONLY_FILES.includes(destination)
  || SKILL_BUILD_FILE.test(destination) || SKILL_EVAL_FILE.test(destination);

const isRuntimeFile = (destination) => {
  if (isBuildOnly(destination) || STACK_SKILL_FILE.test(destination)) return false;
  return RUNTIME_EXCEPTIONS.some((prefix) => destination.startsWith(prefix))
    || !NEVER_SHIPPED.some((prefix) => destination.startsWith(prefix));
};

function selectRuntimeFiles(files) {
  return new Map([...files].filter(([destination]) => isRuntimeFile(destination)));
}

module.exports = { selectRuntimeFiles, isRuntimeFile, stackSkillDestination, NEVER_SHIPPED, BUILD_ONLY_FILES, STACK_SKILL_IDS };
