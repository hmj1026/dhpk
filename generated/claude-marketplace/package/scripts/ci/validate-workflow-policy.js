#!/usr/bin/env node
'use strict';

// Validate the repository-owned GitHub Actions policy that actionlint cannot
// express: immutable Action revisions, the shared Node baseline, one pinned
// Linux runner image, and explicit timeout budgets. This intentionally uses a
// small indentation-aware scanner so the repository remains dependency-free
// and policy tests stay semantic.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const NODE_BASELINE = '24';
const NODE_VERSION_FILE = '.nvmrc';
// Every Linux job pins one explicit image so CI and Release never diverge and
// a GitHub label migration (ubuntu-latest) is a reviewed change, not a surprise.
const LINUX_RUNNER_BASELINE = 'ubuntu-26.04';
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const VERSION_COMMENT = /(?:^|\s)v?\d+(?:\.\d+){0,3}(?:[-+][\w.-]+)?(?:\s|$)/i;

const WORKFLOW_TIMEOUTS = Object.freeze({
  'ci.yml': Object.freeze({
    validate: 10,
    'macos-installer': 10,
    'release-rehearsal': 10,
    lint: 5,
  }),
  'release.yml': Object.freeze({
    release: 10,
    publish: 5,
    'consumer-verify': 10,
    'sync-develop': 5,
  }),
});

const RELEASE_JOB_PERMISSIONS = Object.freeze({
  release: Object.freeze({ contents: 'read', 'pull-requests': 'read' }),
  publish: Object.freeze({ contents: 'write' }),
  'consumer-verify': Object.freeze({ contents: 'read' }),
  'sync-develop': Object.freeze({ contents: 'write' }),
});

function unquote(value) {
  const trimmed = String(value).trim().replace(/\s+#.*$/, '');
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function workflowFiles(root) {
  const directory = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort()
    .map((file) => path.join(directory, file));
}

// Composite actions carry their own `uses:` steps (for example setup-node), so
// they must satisfy the same pin and runtime-baseline rules as workflows or
// they become an unchecked side door. They have no jobs, so job rules skip them.
function compositeActionFiles(root) {
  const directory = path.join(root, '.github', 'actions');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ['action.yml', 'action.yaml'].map((name) => path.join(directory, entry.name, name)))
    .flat()
    .filter((file) => fs.existsSync(file))
    .sort();
}

function jobBlocks(content) {
  const lines = content.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex === -1) return [];

  const jobs = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^  ([A-Za-z0-9][A-Za-z0-9_-]*):\s*$/);
    if (!match) continue;
    const end = lines.findIndex((line, offset) => offset > index && /^  [A-Za-z0-9][A-Za-z0-9_-]*:\s*$/.test(line));
    jobs.push({ name: match[1], line: index + 1, lines: lines.slice(index, end === -1 ? lines.length : end) });
    if (end !== -1) index = end - 1;
  }
  return jobs;
}

function addError(errors, root, file, line, message) {
  errors.push(`${path.relative(root, file) || file}:${line}: ${message}`);
}

function validateLocalNodeBaseline(root, errors) {
  const file = path.join(root, NODE_VERSION_FILE);
  if (!fs.existsSync(file)) {
    addError(errors, root, file, 1, `CI Runtime Baseline must be declared in ${NODE_VERSION_FILE}`);
    return;
  }

  const value = fs.readFileSync(file, 'utf8').trim();
  if (value !== NODE_BASELINE) {
    addError(errors, root, file, 1, `CI Runtime Baseline in ${NODE_VERSION_FILE} must be Node ${NODE_BASELINE}; found '${value}'`);
  }
}

function validateActions(root, file, content, errors) {
  content.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#(.*))?\s*$/);
    if (!match) return;
    const reference = unquote(match[1]);
    // A repository-local action or reusable workflow is pinned by the commit
    // that contains it; only remote references need an immutable SHA.
    if (reference.startsWith('./')) return;
    const at = reference.lastIndexOf('@');
    const revision = at === -1 ? '' : reference.slice(at + 1);
    if (at === -1 || !COMMIT_SHA.test(revision)) {
      addError(errors, root, file, index + 1, `Action '${reference}' must use a full immutable commit SHA`);
    }
    if (!match[2] || !VERSION_COMMENT.test(match[2])) {
      addError(errors, root, file, index + 1, `Action '${reference}' must include a readable version comment`);
    }
  });
}

function stepBlocks(content) {
  const lines = content.split(/\r?\n/);
  const starts = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(\s*)-\s+/);
    if (match) starts.push({ index, indent: match[1].length });
  });
  return starts.map((start, position) => {
    const next = starts.slice(position + 1).find((candidate) => candidate.indent <= start.indent);
    return {
      line: start.index + 1,
      lines: lines.slice(start.index, next ? next.index : lines.length),
    };
  });
}

function validateNodeBaseline(root, file, content, errors) {
  const setupSteps = stepBlocks(content).filter((step) => step.lines.some((line) => /(?:-\s*)?uses:\s*actions\/setup-node@/.test(line)));
  for (const step of setupSteps) {
    const versions = step.lines
      .map((line, offset) => {
        const match = line.match(/^\s*node-version:\s*(.+?)\s*$/);
        return match ? { value: unquote(match[1]), line: step.line + offset } : null;
      })
      .filter(Boolean);
    if (versions.length === 0) {
      addError(errors, root, file, step.line, `actions/setup-node must declare Node ${NODE_BASELINE} via node-version`);
      continue;
    }
    for (const version of versions) {
      if (version.value !== NODE_BASELINE) {
        addError(errors, root, file, version.line, `CI Runtime Baseline must be Node ${NODE_BASELINE}; found '${version.value}'`);
      }
    }
  }
}

// A job without actions/checkout has no working tree and no git remote, so
// anything that resolves the repository from local git state fails at runtime
// with "not a git repository". Structural step assertions cannot see this:
// the step is well-formed, it just has no repository underneath it.
function stepSections(step) {
  const dashIndent = step.lines[0].match(/^(\s*)-\s/)[1].length;
  const keyPattern = new RegExp(`^\\s{${dashIndent + 2}}([A-Za-z0-9_-]+):\\s*(?:.*)$`);
  const sections = [];
  step.lines.forEach((line, offset) => {
    const match = offset === 0
      ? line.slice(dashIndent + 2).match(/^([A-Za-z0-9_-]+):/)
      : line.match(keyPattern);
    if (match) sections.push({ key: match[1], offset });
  });
  return (key) => {
    const index = sections.findIndex((section) => section.key === key);
    if (index === -1) return '';
    const start = sections[index].offset;
    const end = index + 1 < sections.length ? sections[index + 1].offset : step.lines.length;
    return step.lines.slice(start, end).join('\n');
  };
}

function shellCommands(runBody) {
  return runBody
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function validateCheckoutlessRepoContext(root, file, content, errors) {
  for (const job of jobBlocks(content)) {
    if (job.lines.some((line) => /uses:\s*actions\/checkout@/.test(line))) continue;
    for (const step of stepBlocks(job.lines.join('\n'))) {
      const section = stepSections(step);
      const commands = shellCommands(section('run'));
      if (!commands) continue;
      const line = job.line + job.lines.findIndex((entry) => entry === step.lines[0]);
      if (/(?:^|\s)gh\s+[a-z]/m.test(commands) && !/^\s*GH_REPO:\s*\S/m.test(section('env'))) {
        addError(errors, root, file, line, `job '${job.name}' has no actions/checkout, so a step calling gh must set GH_REPO`);
      }
      if (/(?:^|\s)git\s+[a-z]/m.test(commands)) {
        addError(errors, root, file, line, `job '${job.name}' has no actions/checkout, so a step must not invoke git`);
      }
    }
  }
}

function validateLinuxRunner(root, file, content, errors) {
  for (const job of jobBlocks(content)) {
    job.lines.forEach((line, offset) => {
      const match = line.match(/^    runs-on:\s*(.+?)\s*$/);
      if (!match) return;
      const runner = unquote(match[1]);
      if (/^ubuntu-/i.test(runner) && runner !== LINUX_RUNNER_BASELINE) {
        addError(
          errors,
          root,
          file,
          job.line + offset,
          `job '${job.name}' runs on '${runner}'; Linux jobs must use the pinned runner ${LINUX_RUNNER_BASELINE}`,
        );
      }
    });
  }
}

function timeoutValue(job) {
  const line = job.lines.find((entry) => /^    timeout-minutes:\s*/.test(entry));
  if (!line) return null;
  const match = line.match(/^    timeout-minutes:\s*([^\s#]+)/);
  if (!match || !/^\d+$/.test(unquote(match[1]))) return NaN;
  return Number(unquote(match[1]));
}

function validateTimeouts(root, file, content, errors) {
  const jobs = jobBlocks(content);
  if (jobs.length === 0) {
    addError(errors, root, file, 1, 'workflow must define at least one job');
    return;
  }
  const expected = WORKFLOW_TIMEOUTS[path.basename(file)] || {};
  for (const job of jobs) {
    const actual = timeoutValue(job);
    if (actual === null) {
      addError(errors, root, file, 1, `job '${job.name}' must declare an explicit timeout-minutes`);
      continue;
    }
    if (!Number.isSafeInteger(actual) || actual <= 0) {
      addError(errors, root, file, 1, `job '${job.name}' timeout-minutes must be a positive integer`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(expected, job.name) && actual !== expected[job.name]) {
      addError(errors, root, file, 1, `job '${job.name}' timeout-minutes must be ${expected[job.name]}, found ${actual}`);
    }
  }
  for (const [name, budget] of Object.entries(expected)) {
    if (!jobs.some((job) => job.name === name)) {
      addError(errors, root, file, 1, `expected job '${name}' is missing; its timeout budget is ${budget} minutes`);
    }
  }
}

function permissionMap(job) {
  const permissionsIndex = job.lines.findIndex((line) => /^    permissions:\s*$/.test(line));
  if (permissionsIndex === -1) return null;
  const permissions = {};
  for (let index = permissionsIndex + 1; index < job.lines.length; index += 1) {
    if (/^    [A-Za-z0-9_-]+:\s*/.test(job.lines[index])) break;
    const match = job.lines[index].match(/^      ([A-Za-z0-9_-]+):\s*(\S+)/);
    if (match) permissions[match[1]] = unquote(match[2]);
  }
  return permissions;
}

function validateReleasePolicy(root, file, content, errors) {
  if (path.basename(file) !== 'release.yml') return;

  const lines = content.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const concurrencyIndex = lines.findIndex((line) => /^concurrency:\s*$/.test(line));
  const concurrencyEnd = jobsIndex === -1 ? lines.length : jobsIndex;
  const concurrencyLines = concurrencyIndex === -1
    ? []
    : lines.slice(concurrencyIndex + 1, concurrencyEnd);
  const groupLine = concurrencyLines.find((line) => /^  group:\s*/.test(line));
  const cancelLine = concurrencyLines.find((line) => /^  cancel-in-progress:\s*/.test(line));
  if (concurrencyIndex === -1 || concurrencyIndex > concurrencyEnd
    || !groupLine || unquote(groupLine.replace(/^  group:\s*/, '')) !== 'release-${{ github.repository }}'
    || !cancelLine || unquote(cancelLine.replace(/^  cancel-in-progress:\s*/, '')) !== 'false') {
    addError(
      errors,
      root,
      file,
      concurrencyIndex === -1 ? 1 : concurrencyIndex + 1,
      'release workflow must define concurrency group release-${{ github.repository }} with cancel-in-progress: false',
    );
  }

  const jobs = Object.fromEntries(jobBlocks(content).map((job) => [job.name, job]));
  for (const [jobName, expected] of Object.entries(RELEASE_JOB_PERMISSIONS)) {
    const job = jobs[jobName];
    if (!job) continue;
    const actual = permissionMap(job);
    if (actual === null) {
      addError(errors, root, file, 1, `release job '${jobName}' must declare its permission boundary`);
      continue;
    }
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);
    const matches = expectedKeys.every((key) => actual[key] === expected[key])
      && actualKeys.length === expectedKeys.length;
    if (!matches) {
      addError(
        errors,
        root,
        file,
        1,
        `release job '${jobName}' permission boundary must be ${JSON.stringify(expected)}`,
      );
    }
  }
}

function main(root = ROOT) {
  const files = workflowFiles(root);
  const errors = [];
  validateLocalNodeBaseline(root, errors);
  if (files.length === 0) {
    errors.push('.github/workflows: no workflow files found');
  }
  const actionFiles = compositeActionFiles(root);
  for (const file of actionFiles) {
    const content = fs.readFileSync(file, 'utf8');
    validateActions(root, file, content, errors);
    validateNodeBaseline(root, file, content, errors);
  }
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    validateActions(root, file, content, errors);
    validateNodeBaseline(root, file, content, errors);
    validateTimeouts(root, file, content, errors);
    validateLinuxRunner(root, file, content, errors);
    validateCheckoutlessRepoContext(root, file, content, errors);
    validateReleasePolicy(root, file, content, errors);
  }
  return { errors, warnings: [], files: [...files, ...actionFiles].map((file) => path.relative(root, file)) };
}

if (require.main === module) {
  const result = main();
  for (const error of result.errors) console.error(`workflow-policy: ${error}`);
  if (result.errors.length > 0) process.exitCode = 1;
  else console.log(`workflow-policy: checked ${result.files.length} workflow/action file(s)`);
}

module.exports = { main, NODE_BASELINE, LINUX_RUNNER_BASELINE, WORKFLOW_TIMEOUTS };
