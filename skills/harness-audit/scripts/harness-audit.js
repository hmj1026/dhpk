'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CATEGORY_NAMES = [
  'Tool Coverage',
  'Context Efficiency',
  'Quality Gates',
  'Memory Persistence',
  'Eval Coverage',
  'Security Guardrails',
  'Cost Efficiency',
];
const VALID_SCOPES = new Set(['repo', 'hooks', 'skills', 'commands', 'agents']);
const VALID_FORMATS = new Set(['text', 'json']);
const RUBRIC_VERSION = '2026-03-30';

const HELP_TEXT = [
  'Usage: node "$SKILL_DIR/scripts/harness-audit.js" [scope] [options]',
  '',
  'Inspect harness coverage at a repository or consumer root. The audit only reads files.',
  '',
  'Scopes: repo, hooks, skills, commands, agents (default: repo)',
  'Options:',
  '  --scope VALUE, --scope=VALUE    Select a report scope',
  '  --format VALUE, --format=VALUE  Print text or JSON (default: text)',
  '  --root VALUE, --root=VALUE      Inspect this path (default: AUDIT_ROOT or cwd)',
  '  -h, --help                      Show this help',
  '',
].join('\n');

function readText(rootDir, relativePath) {
  try {
    return fs.readFileSync(path.resolve(rootDir, relativePath), 'utf8');
  } catch {
    return '';
  }
}

function exists(rootDir, relativePath) {
  return fs.existsSync(path.resolve(rootDir, relativePath));
}

function countEntries(rootDir, relativeDir, suffixes) {
  const scanRoot = path.resolve(rootDir, relativeDir);

  function visit(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return 0;
      throw error;
    }

    return entries.reduce((total, entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return total + visit(entryPath);
      const matches = suffixes === null || suffixes.some((suffix) => entry.name.endsWith(suffix));
      return total + (matches ? 1 : 0);
    }, 0);
  }

  return visit(scanRoot);
}

function hasSuffix(rootDir, relativeDir, suffixes) {
  return countEntries(rootDir, relativeDir, suffixes) > 0;
}

function containsAny(rootDir, relativePath, fragments) {
  const contents = readText(rootDir, relativePath);
  return fragments.some((fragment) => contents.includes(fragment));
}

function readJson(rootDir, relativePath) {
  const contents = readText(rootDir, relativePath);
  try {
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

function detectMode(rootDir) {
  const packageJson = readJson(rootDir, 'package.json');
  if (packageJson && packageJson.name === 'dhpk') return 'repo';

  const sourceIndicators = [
    'skills/harness-audit/scripts/harness-audit.js',
    '.claude-plugin/plugin.json',
    'agents',
    'skills',
  ];
  return sourceIndicators.every((relativePath) => exists(rootDir, relativePath)) ? 'repo' : 'consumer';
}

function assignScope(value) {
  const displayValue = value === undefined || value === '' ? 'repo' : String(value);
  const scope = displayValue.toLowerCase();
  if (!VALID_SCOPES.has(scope)) throw new Error('Invalid scope: ' + displayValue);
  return scope;
}

function parseArgs(argv) {
  const tokens = Array.isArray(argv) ? argv.slice(2) : [];
  let scope = 'repo';
  let format = 'text';
  let formatDisplayValue = 'text';
  let rootValue;
  let hasRootValue = false;
  let help = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const argument = String(tokens[index]);

    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--scope') {
      scope = assignScope(tokens[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith('--scope=')) {
      scope = assignScope(argument.split('=')[1]);
      continue;
    }
    if (argument === '--format') {
      const value = tokens[index + 1];
      formatDisplayValue = value === undefined ? '' : String(value);
      format = formatDisplayValue.toLowerCase();
      index += 1;
      continue;
    }
    if (argument.startsWith('--format=')) {
      formatDisplayValue = argument.split('=')[1] || '';
      format = formatDisplayValue.toLowerCase();
      continue;
    }
    if (argument === '--root') {
      rootValue = tokens[index + 1];
      hasRootValue = true;
      index += 1;
      continue;
    }
    if (argument.startsWith('--root=')) {
      rootValue = argument.slice('--root='.length);
      hasRootValue = true;
      continue;
    }
    if (argument.startsWith('-')) throw new Error('Unknown argument: ' + argument);

    scope = assignScope(argument);
  }

  if (!VALID_FORMATS.has(format)) {
    throw new Error('Invalid format: ' + formatDisplayValue + '. Use text or json.');
  }

  const configuredRoot = hasRootValue
    ? (rootValue || process.cwd())
    : (process.env.AUDIT_ROOT && process.env.AUDIT_ROOT.length > 0
      ? process.env.AUDIT_ROOT
      : process.cwd());

  return {
    scope,
    format,
    help,
    root: path.resolve(process.cwd(), configuredRoot),
  };
}

function definition(id, category, points, scopes, reportPath, description, action, passes) {
  return { id, category, points, scopes, path: reportPath, description, action, passes };
}

function repoChecks(rootDir) {
  return [
    definition(
      'tool-hooks-config', 'Tool Coverage', 2, ['repo', 'hooks'], 'hooks/hooks.json',
      'A hooks configuration file is available in the repository.',
      'Add the hooks configuration file at hooks/hooks.json.',
      () => exists(rootDir, 'hooks/hooks.json'),
    ),
    definition(
      'tool-hooks-impl-count', 'Tool Coverage', 2, ['repo', 'hooks'], 'scripts/hooks/',
      'The hook scripts directory contains at least eight JavaScript files.',
      'Add or restore the missing JavaScript hook implementations under scripts/hooks/.',
      () => countEntries(rootDir, 'scripts/hooks', ['.js']) >= 8,
    ),
    definition(
      'tool-agent-count', 'Tool Coverage', 2, ['repo', 'agents'], 'agents/',
      'The agents directory contains at least ten Markdown agent files.',
      'Provide at least ten agent documents under agents/.',
      () => countEntries(rootDir, 'agents', ['.md']) >= 10,
    ),
    definition(
      'tool-skill-count', 'Tool Coverage', 2, ['repo', 'skills'], 'skills/',
      'The skills tree contains at least twenty SKILL.md resources.',
      'Add the missing skill resources so skills/ contains at least twenty SKILL.md files.',
      () => countEntries(rootDir, 'skills', ['SKILL.md']) >= 20,
    ),
    definition(
      'tool-command-parity', 'Tool Coverage', 2, ['repo', 'commands'],
      '.opencode/commands/harness-audit.md',
      'The OpenCode command copy matches the canonical harness-audit command.',
      'Refresh .opencode/commands/harness-audit.md from commands/harness-audit.md.',
      () => {
        const canonical = readText(rootDir, 'commands/harness-audit.md').trim();
        const projection = readText(rootDir, '.opencode/commands/harness-audit.md').trim();
        return canonical.length > 0 && canonical === projection;
      },
    ),
    definition(
      'context-strategic-compact', 'Context Efficiency', 3, ['repo', 'skills'],
      'skills/strategic-compact/SKILL.md',
      'The strategic compacting skill is present.',
      'Restore skills/strategic-compact/SKILL.md.',
      () => exists(rootDir, 'skills/strategic-compact/SKILL.md'),
    ),
    definition(
      'context-suggest-compact-hook', 'Context Efficiency', 3, ['repo', 'hooks'],
      'scripts/hooks/suggest-compact.js',
      'A hook can suggest compaction when the context is getting large.',
      'Add scripts/hooks/suggest-compact.js to the hook set.',
      () => exists(rootDir, 'scripts/hooks/suggest-compact.js'),
    ),
    definition(
      'context-model-route', 'Context Efficiency', 2, ['repo', 'commands'], 'commands/model-route.md',
      'The model-routing command is documented.',
      'Restore the model-routing command at commands/model-route.md.',
      () => exists(rootDir, 'commands/model-route.md'),
    ),
    definition(
      'context-token-doc', 'Context Efficiency', 2, ['repo'], 'docs/token-optimization.md',
      'Token-use guidance is available in the documentation.',
      'Add docs/token-optimization.md with the repository token-use guidance.',
      () => exists(rootDir, 'docs/token-optimization.md'),
    ),
    definition(
      'quality-test-runner', 'Quality Gates', 3, ['repo'], 'tests/run-all.js',
      'The aggregate JavaScript test runner is present.',
      'Restore tests/run-all.js so the repository test suites can be launched.',
      () => exists(rootDir, 'tests/run-all.js'),
    ),
    definition(
      'quality-ci-validations', 'Quality Gates', 3, ['repo'], '.github/workflows/ci.yml',
      'The CI workflow names both command validation and the aggregate test runner.',
      'Include validate-commands.js and tests/run-all.js in .github/workflows/ci.yml.',
      () => containsAny(rootDir, '.github/workflows/ci.yml', ['validate-commands.js'])
        && containsAny(rootDir, '.github/workflows/ci.yml', ['tests/run-all.js']),
    ),
    definition(
      'quality-hook-tests', 'Quality Gates', 2, ['repo', 'hooks'], 'tests/hooks/hooks.test.js',
      'Automated hook behavior tests are present.',
      'Add the hook behavior suite at tests/hooks/hooks.test.js.',
      () => exists(rootDir, 'tests/hooks/hooks.test.js'),
    ),
    definition(
      'quality-doctor-script', 'Quality Gates', 2, ['repo'], 'scripts/doctor.js',
      'The repository doctor script is available.',
      'Restore scripts/doctor.js for the repository health check.',
      () => exists(rootDir, 'scripts/doctor.js'),
    ),
    definition(
      'memory-hooks-dir', 'Memory Persistence', 4, ['repo', 'hooks'], 'hooks/memory-persistence/',
      'Memory persistence hook assets have a repository location.',
      'Add the memory-persistence hook assets under hooks/memory-persistence/.',
      () => exists(rootDir, 'hooks/memory-persistence'),
    ),
    definition(
      'memory-session-hooks', 'Memory Persistence', 4, ['repo', 'hooks'],
      'scripts/hooks/session-start.js',
      'Both session lifecycle hooks are present.',
      'Provide scripts/hooks/session-start.js and scripts/hooks/session-end.js.',
      () => exists(rootDir, 'scripts/hooks/session-start.js')
        && exists(rootDir, 'scripts/hooks/session-end.js'),
    ),
    definition(
      'eval-skill', 'Eval Coverage', 4, ['repo', 'skills'], 'skills/eval-harness/SKILL.md',
      'The evaluation harness skill is available.',
      'Restore skills/eval-harness/SKILL.md.',
      () => exists(rootDir, 'skills/eval-harness/SKILL.md'),
    ),
    definition(
      'eval-commands', 'Eval Coverage', 4, ['repo', 'commands'], 'commands/eval.md',
      'Evaluation, verification, and checkpoint commands are all available.',
      'Provide commands/eval.md, commands/verify.md, and commands/checkpoint.md.',
      () => exists(rootDir, 'commands/eval.md')
        && exists(rootDir, 'commands/verify.md')
        && exists(rootDir, 'commands/checkpoint.md'),
    ),
    definition(
      'eval-tests-presence', 'Eval Coverage', 2, ['repo'], 'tests/',
      'The tests tree contains at least ten JavaScript test files.',
      'Add JavaScript test coverage until tests/ contains at least ten .test.js files.',
      () => countEntries(rootDir, 'tests', ['.test.js']) >= 10,
    ),
    definition(
      'security-review-skill', 'Security Guardrails', 3, ['repo', 'skills'],
      'skills/change-verdict/SKILL.md',
      'The change review skill is available.',
      'Restore skills/change-verdict/SKILL.md.',
      () => exists(rootDir, 'skills/change-verdict/SKILL.md'),
    ),
    definition(
      'security-agent', 'Security Guardrails', 3, ['repo', 'agents'], 'agents/security-reviewer.md',
      'A dedicated security reviewer agent is present.',
      'Add agents/security-reviewer.md to the agent set.',
      () => exists(rootDir, 'agents/security-reviewer.md'),
    ),
    definition(
      'security-prompt-hook', 'Security Guardrails', 2, ['repo', 'hooks'], 'hooks/hooks.json',
      'The hook configuration declares a prompt interception event.',
      'Configure beforeSubmitPrompt or PreToolUse in hooks/hooks.json.',
      () => containsAny(rootDir, 'hooks/hooks.json', ['beforeSubmitPrompt', 'PreToolUse']),
    ),
    definition(
      'security-scan-command', 'Security Guardrails', 2, ['repo', 'commands'],
      'commands/security-scan.md',
      'A security scanning command is documented.',
      'Add commands/security-scan.md with the security scan invocation.',
      () => exists(rootDir, 'commands/security-scan.md'),
    ),
    definition(
      'cost-skill', 'Cost Efficiency', 4, ['repo', 'skills'],
      'skills/cost-aware-llm-pipeline/SKILL.md',
      'Cost-aware model selection guidance is available as a skill.',
      'Restore skills/cost-aware-llm-pipeline/SKILL.md.',
      () => exists(rootDir, 'skills/cost-aware-llm-pipeline/SKILL.md'),
    ),
    definition(
      'cost-doc', 'Cost Efficiency', 3, ['repo'], 'docs/token-optimization.md',
      'The token optimization document is present.',
      'Add docs/token-optimization.md with token and cost guidance.',
      () => exists(rootDir, 'docs/token-optimization.md'),
    ),
    definition(
      'cost-model-route-command', 'Cost Efficiency', 3, ['repo', 'commands'],
      'commands/model-route.md',
      'The model-routing command is available.',
      'Restore commands/model-route.md with the model routing guidance.',
      () => exists(rootDir, 'commands/model-route.md'),
    ),
  ];
}

function consumerPluginInstalled(rootDir) {
  const localPaths = [
    path.join(rootDir, '.claude/plugins/dhpk/.claude-plugin/plugin.json'),
    path.join(rootDir, '.claude/plugins/dhpk/plugin.json'),
  ];
  const home = process.env.HOME;
  const candidates = home
    ? localPaths.concat([
      path.join(home, '.claude/plugins/dhpk/.claude-plugin/plugin.json'),
      path.join(home, '.claude/plugins/dhpk/plugin.json'),
    ])
    : localPaths;
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function hasTestCommand(rootDir) {
  const packageJson = readJson(rootDir, 'package.json');
  return Boolean(
    packageJson
    && packageJson.scripts
    && typeof packageJson.scripts.test === 'string',
  );
}

function consumerChecks(rootDir) {
  return [
    definition(
      'consumer-plugin-install', 'Tool Coverage', 4, ['repo'], '~/.claude/plugins/dhpk/',
      'A supported plugin installation record exists in the project or home directory.',
      'Install the plugin so a plugin.json file is present in a supported location.',
      () => consumerPluginInstalled(rootDir),
    ),
    definition(
      'consumer-project-overrides', 'Tool Coverage', 3,
      ['repo', 'hooks', 'skills', 'commands', 'agents'], '.claude/',
      'The project contains at least one host-specific agent, skill, command, or settings file.',
      'Add the project-level Claude settings or an agent, skill, or command under .claude/.',
      () => countEntries(rootDir, '.claude/agents', ['.md']) > 0
        || countEntries(rootDir, '.claude/skills', ['SKILL.md']) > 0
        || countEntries(rootDir, '.claude/commands', ['.md']) > 0
        || exists(rootDir, '.claude/settings.json')
        || exists(rootDir, '.claude/hooks.json'),
    ),
    definition(
      'consumer-instructions', 'Context Efficiency', 3, ['repo'], 'AGENTS.md',
      'The project provides an agent instruction file at a recognized location.',
      'Add AGENTS.md, CLAUDE.md, or .claude/CLAUDE.md to describe project instructions.',
      () => exists(rootDir, 'AGENTS.md')
        || exists(rootDir, 'CLAUDE.md')
        || exists(rootDir, '.claude/CLAUDE.md'),
    ),
    definition(
      'consumer-project-config', 'Context Efficiency', 2, ['repo', 'hooks'], '.mcp.json',
      'A project MCP or Claude settings file is present.',
      'Add .mcp.json or a Claude settings file for the project.',
      () => exists(rootDir, '.mcp.json')
        || exists(rootDir, '.claude/settings.json')
        || exists(rootDir, '.claude/settings.local.json'),
    ),
    definition(
      'consumer-test-suite', 'Quality Gates', 4, ['repo'], 'tests/',
      'The project declares a test command or contains recognized test files.',
      'Add a package test script or JavaScript/TypeScript test files.',
      () => hasTestCommand(rootDir)
        || countEntries(rootDir, 'tests', ['.test.js']) > 0
        || hasSuffix(rootDir, '.', ['.spec.js', '.spec.ts', '.test.ts']),
    ),
    definition(
      'consumer-ci-workflow', 'Quality Gates', 3, ['repo'], '.github/workflows/',
      'At least one YAML workflow is present for continuous integration.',
      'Add a .yml or .yaml workflow under .github/workflows/.',
      () => hasSuffix(rootDir, '.github/workflows', ['.yml', '.yaml']),
    ),
    definition(
      'consumer-memory-notes', 'Memory Persistence', 2, ['repo'], '.claude/memory.md',
      'The project has a memory note or an architecture decision record.',
      'Add .claude/memory.md or a Markdown record under docs/adr/.',
      () => exists(rootDir, '.claude/memory.md')
        || countEntries(rootDir, 'docs/adr', ['.md']) > 0,
    ),
    definition(
      'consumer-eval-coverage', 'Eval Coverage', 2, ['repo'], 'evals/',
      'The project has evaluation assets or at least three JavaScript test files.',
      'Add files under evals/ or expand tests/ to include at least three .test.js files.',
      () => countEntries(rootDir, 'evals', null) > 0
        || countEntries(rootDir, 'tests', ['.test.js']) >= 3,
    ),
    definition(
      'consumer-security-policy', 'Security Guardrails', 2, ['repo'], 'SECURITY.md',
      'The project publishes a security policy or a recognized automated scan configuration.',
      'Add SECURITY.md, Dependabot configuration, or CodeQL configuration.',
      () => exists(rootDir, 'SECURITY.md')
        || exists(rootDir, '.github/dependabot.yml')
        || exists(rootDir, '.github/codeql.yml'),
    ),
    definition(
      'consumer-secret-hygiene', 'Security Guardrails', 2, ['repo'], '.gitignore',
      'The ignore rules mention environment files.',
      'Add .env to .gitignore so environment files are excluded from version control.',
      () => readText(rootDir, '.gitignore').includes('.env'),
    ),
    definition(
      'consumer-hook-guardrails', 'Security Guardrails', 2, ['repo', 'hooks'],
      '.claude/settings.json',
      'Claude settings declare a pre-tool or prompt hook, or a separate hooks file exists.',
      'Add a PreToolUse or beforeSubmitPrompt hook to Claude settings, or provide .claude/hooks.json.',
      () => containsAny(rootDir, '.claude/settings.json', ['PreToolUse', 'beforeSubmitPrompt'])
        || exists(rootDir, '.claude/hooks.json'),
    ),
  ];
}

function categorySummary(category, checks) {
  const matchingChecks = checks.filter((check) => check.category === category);
  const earned = matchingChecks.reduce(
    (total, check) => total + (check.pass ? check.points : 0),
    0,
  );
  const max = matchingChecks.reduce((total, check) => total + check.points, 0);
  return {
    score: max === 0 ? 0 : Math.round((10 * earned) / max),
    earned,
    max,
  };
}

function buildReport(scope, options) {
  const settings = options || {};
  const rootDir = path.resolve(settings.rootDir || process.cwd());
  const detectedMode = detectMode(rootDir);
  const targetMode = settings.targetMode || detectedMode;
  const definitions = targetMode === 'repo' ? repoChecks(rootDir) : consumerChecks(rootDir);
  const checks = definitions
    .filter((candidate) => candidate.scopes.includes(scope))
    .map((candidate) => ({
      id: candidate.id,
      category: candidate.category,
      points: candidate.points,
      path: candidate.path,
      description: candidate.description,
      pass: Boolean(candidate.passes()),
      actionText: candidate.action,
    }));

  const reportChecks = checks.map(({ actionText, ...check }) => check);
  const overallScore = reportChecks.reduce(
    (total, check) => total + (check.pass ? check.points : 0),
    0,
  );
  const maxScore = reportChecks.reduce((total, check) => total + check.points, 0);
  const categories = Object.fromEntries(
    CATEGORY_NAMES.map((category) => [category, categorySummary(category, reportChecks)]),
  );
  const topActions = checks
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => !check.pass)
    .sort((left, right) => right.check.points - left.check.points || left.index - right.index)
    .slice(0, 3)
    .map(({ check }) => ({
      action: check.actionText,
      path: check.path,
      category: check.category,
      points: check.points,
    }));

  return {
    scope,
    root_dir: rootDir,
    target_mode: targetMode,
    deterministic: true,
    rubric_version: RUBRIC_VERSION,
    overall_score: overallScore,
    max_score: maxScore,
    categories,
    checks: reportChecks,
    top_actions: topActions,
  };
}

function renderText(report) {
  const failedCount = report.checks.filter((check) => !check.pass).length;
  const categoryLines = CATEGORY_NAMES
    .filter((category) => report.categories[category].max > 0)
    .map((category) => {
      const result = report.categories[category];
      return '  ' + category + ': ' + result.earned + '/' + result.max + ' (' + result.score + '/10)';
    });
  const lines = [
    'Harness audit for ' + report.scope + ' scope (' + report.target_mode + ' mode)',
    'Score: ' + report.overall_score + '/' + report.max_score,
    'Root: ' + report.root_dir,
    'Category scores:',
  ].concat(categoryLines, [
    'Checks: ' + report.checks.length + ' total, ' + failedCount + ' failed',
  ]);

  if (report.top_actions.length > 0) {
    lines.push('Recommended actions:');
    report.top_actions.forEach((action, index) => {
      lines.push(
        '  ' + (index + 1) + '. ' + action.action + ' [' + action.path + ']',
      );
    });
  }

  return lines.join('\n') + '\n';
}

function runCli() {
  const options = parseArgs(process.argv);
  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const report = buildReport(options.scope, { rootDir: options.root });
  const output = options.format === 'json'
    ? JSON.stringify(report, null, 2) + '\n'
    : renderText(report);
  process.stdout.write(output);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    process.stderr.write('Error: ' + message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, buildReport };
