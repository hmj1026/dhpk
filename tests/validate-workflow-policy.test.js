'use strict';

// Behavioral contract tests for the repository-owned GitHub Actions policy;
// the filename mirrors the validator for catalog coverage discovery.
// gate. The tests exercise the exported main(root) seam with both the real
// repository and small semantic workflow fixtures; they do not depend on YAML
// formatting or step order.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { main } = require('../scripts/ci/validate-workflow-policy');

const ROOT = path.join(__dirname, '..');
const ACTIONS = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
  setupNode: 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
};

function makeRoot(workflows, dependabot = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-workflow-policy-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, content] of Object.entries(workflows)) {
    fs.writeFileSync(path.join(root, '.github', 'workflows', name), content);
  }
  if (dependabot !== null) {
    fs.writeFileSync(path.join(root, '.github', 'dependabot.yml'), dependabot);
  }
  return root;
}

function runInTemp(workflows, dependabot = null) {
  const root = makeRoot(workflows, dependabot);
  try {
    return main(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function genericWorkflow({ action = ACTIONS.checkout, nodeVersion = '24', timeout = 7 } = {}) {
  return `name: Generic\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${action}\n      - uses: ${ACTIONS.setupNode}\n        with:\n          node-version: ${nodeVersion}\n    timeout-minutes: ${timeout}\n`;
}

function realRepoResult() {
  return main(ROOT);
}

function releasePolicyRoot(mutator = (workflow) => workflow) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-policy-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  for (const file of ['ci.yml', 'release.yml']) {
    const source = fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8');
    fs.writeFileSync(
      path.join(root, '.github', 'workflows', file),
      file === 'release.yml' ? mutator(source) : source,
    );
  }
  return root;
}

function runReleasePolicy(mutator) {
  const root = releasePolicyRoot(mutator);
  try {
    return main(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the real repository satisfies the workflow policy', () => {
  const result = realRepoResult();
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
});

test('release policy requires one repository-global, non-cancelling concurrency group', () => {
  const result = runReleasePolicy((workflow) => workflow
    .replace('  group: release-${{ github.repository }}', '  group: release-${{ github.ref }}')
    .replace('  cancel-in-progress: false', '  cancel-in-progress: true'));
  assert.ok(result.errors.some((error) => /release.*concurrency|concurrency.*release/i.test(error)), result.errors.join('\n'));
});

test('release policy keeps repository write authority out of validation', () => {
  const result = runReleasePolicy((workflow) => workflow.replace(
    '    permissions:\n      contents: read\n      pull-requests: read',
    '    permissions:\n      contents: write\n      pull-requests: read',
  ));
  assert.ok(result.errors.some((error) => /release.*permission|permission.*release/i.test(error)), result.errors.join('\n'));
});

test('release policy enforces the bounded publication timeout', () => {
  const result = runReleasePolicy((workflow) => workflow.replace(
    /(  publish:[\s\S]*?    timeout-minutes:) 5/,
    '$1 4',
  ));
  assert.ok(result.errors.some((error) => /publish.*timeout|timeout.*publish/i.test(error)), result.errors.join('\n'));
});

test('workflow policy accepts equivalent formatting and reordered steps', () => {
  const quotedAction = `"${ACTIONS.checkout.slice(0, ACTIONS.checkout.indexOf(' #'))}" # v7`;
  const result = runInTemp({ 'custom.yml': genericWorkflow({ action: quotedAction }) });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
});

test('a mutable Action reference fails closed', () => {
  const result = runInTemp({ 'custom.yml': genericWorkflow({ action: 'actions/checkout@v7 # v7' }) });
  assert.ok(result.errors.some((error) => /full .*commit SHA/i.test(error)), result.errors.join('\n'));
});

test('an Action without a readable version comment fails closed', () => {
  const result = runInTemp({
    'custom.yml': genericWorkflow({ action: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1' }),
  });
  assert.ok(result.errors.some((error) => /version comment/i.test(error)), result.errors.join('\n'));
});

test('a Node baseline other than 24 fails closed', () => {
  const result = runInTemp({ 'custom.yml': genericWorkflow({ nodeVersion: "'20'" }) });
  assert.ok(result.errors.some((error) => /Node 24/i.test(error)), result.errors.join('\n'));
});

test('every setup-node step must configure the Node 24 baseline', () => {
  const workflow = genericWorkflow().replace(
    '    timeout-minutes: 7',
    `      - uses: ${ACTIONS.setupNode}\n    timeout-minutes: 7`,
  );
  const result = runInTemp({ 'custom.yml': workflow });
  assert.ok(result.errors.some((error) => /setup-node.*node-version/i.test(error)), result.errors.join('\n'));
});

test('a job without an explicit timeout fails closed', () => {
  const result = runInTemp({ 'custom.yml': genericWorkflow({ timeout: null }).replace(/\n    timeout-minutes: null\n/, '\n') });
  assert.ok(result.errors.some((error) => /timeout-minutes/i.test(error)), result.errors.join('\n'));
});

test('the agreed timeout budget is enforced for current CI jobs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-workflow-policy-timeout-'));
  try {
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    for (const file of ['ci.yml', 'release.yml']) {
      const original = fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8');
      fs.writeFileSync(path.join(root, '.github', 'workflows', file), original);
    }
    const ciPath = path.join(root, '.github', 'workflows', 'ci.yml');
    const ci = fs.readFileSync(ciPath, 'utf8');
    fs.writeFileSync(ciPath, ci.replace(/(\n  validate:\n[\s\S]*?\n    timeout-minutes:) 10/, '$1 9'));
    const result = main(root);
    assert.ok(result.errors.some((error) => /validate.*timeout|timeout.*validate/i.test(error)), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CI runs actionlint and the repository-owned policy gate', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /reviewdog\/action-actionlint@[0-9a-f]{40}\s+#\s*v1\.75\.0/);
  assert.match(workflow, /actionlint_flags:\s*-color[\s\S]*fail_level:\s*error/);
  assert.match(workflow, /node scripts\/ci\/validate-workflow-policy\.js/);
});

test('Dependabot groups weekly GitHub Actions updates without auto-merge policy', () => {
  const config = fs.readFileSync(path.join(ROOT, '.github', 'dependabot.yml'), 'utf8');
  assert.match(config, /package-ecosystem:\s*github-actions/);
  assert.match(config, /interval:\s*weekly/);
  assert.match(config, /groups:/);
  assert.match(config, /patterns:\s*\n\s*-\s*["']?\*["']?/);

  const workflowFiles = fs.readdirSync(path.join(ROOT, '.github', 'workflows'));
  const workflows = workflowFiles
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(workflows, /dependabot[\s\S]{0,300}(?:auto-merge|gh pr merge)/i);
});

run('workflow-policy');

// Regression guard for the v0.62.0/v0.62.1 publish failures: the no-checkout
// publication job inherited steps that silently assumed a repository was
// present, and every structural assertion still passed.
test('a checkout-less job calling gh without GH_REPO fails closed', () => {
  const result = runReleasePolicy((workflow) => workflow.replace(
    /^\s*GH_REPO: \$\{\{ github\.repository \}\}\n/m,
    '',
  ));
  assert.ok(
    result.errors.some((error) => /publish.*GH_REPO/.test(error)),
    result.errors.join('\n'),
  );
});

test('a checkout-less job invoking git fails closed', () => {
  const workflow = `name: Generic\non: push\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - name: Resolve\n        run: |\n          git rev-parse HEAD\n`;
  const result = runInTemp({ 'custom.yml': workflow });
  assert.ok(
    result.errors.some((error) => /publish.*must not invoke git/.test(error)),
    result.errors.join('\n'),
  );
});

test('a job that checks out the repository may use git and gh without GH_REPO', () => {
  const workflow = `name: Generic\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: ${ACTIONS.checkout}\n      - name: Resolve\n        run: |\n          git rev-parse HEAD\n          gh pr list\n`;
  const result = runInTemp({ 'custom.yml': workflow });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
});
