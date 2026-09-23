'use strict';

// Static procedure/resource evidence in both authoring and relocated contexts.
// This does not execute a Host orchestrator or claim reviewer availability.
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const ROOT = path.join(__dirname, '..');
const mappings = require('../manifests/skill-resources.json').skills;
const coverage = require('../manifests/skill-directory-coverage.json').skills;

function inspectPolicyBundle(selectedPolicy, documents) {
  const policy = fs.realpathSync(selectedPolicy);
  assert.strictEqual(path.basename(path.dirname(policy)), 'rules');
  const bundleRoot = path.dirname(path.dirname(policy));
  const required = new Set();
  for (const document of documents) {
    const content = fs.readFileSync(path.join(bundleRoot, document), 'utf8');
    for (const match of content.matchAll(/\$\{POLICY_BUNDLE_ROOT\}\/([A-Za-z0-9_./-]+\.(?:md|js|json))\b/g)) {
      const relative = match[1];
      assert.ok(!relative.split('/').includes('..'), `escaping policy resource: ${relative}`);
      const target = path.join(bundleRoot, relative);
      assert.ok(fs.existsSync(target), `missing selected policy resource: ${relative}`);
      assert.ok(fs.lstatSync(target).isFile(), `nonphysical policy resource: ${relative}`);
      required.add(relative);
    }
  }
  return { bundleRoot, required };
}

const documents = mappings['flow-drive'].filter(item => item.source.endsWith('.md')).map(item => item.source);

test('canonical policy binds the parent of rules without using the active Skill', () => {
  const result = inspectPolicyBundle(path.join(ROOT, 'rules/execution-policy.md'), documents);
  assert.strictEqual(result.bundleRoot, fs.realpathSync(ROOT));
  assert.ok(result.required.has('scripts/fast-worker-selector.js'));
  assert.ok(result.required.has('docs/subagent-prompt-template.md'));
});

for (const skill of ['flow-guide', 'flow-drive']) {
  test(`${skill} policy uses only declared physical resources in its relocated bundle`, () => {
    withIsolatedSkill({ source: path.join(ROOT, 'skills', skill) }, context => {
      const prefix = 'references/execution-bundle/';
      const result = inspectPolicyBundle(path.join(context.skillDir, prefix, 'rules/execution-policy.md'), documents);
      assert.strictEqual(result.bundleRoot, path.join(context.skillDir, 'references/execution-bundle'));
      const row = coverage[skill];
      const declared = new Set([...row.references, ...row.executable_entries.map(item => item.path),
        ...(row.api_entries || []).map(item => item.path), ...(row.internal_helpers || []).map(item => item.path)]);
      for (const resource of result.required) assert.ok(declared.has(prefix + resource), `uncovered policy resource: ${resource}`);
      const required = path.join(result.bundleRoot, 'rules/execution-policy-kernel.md');
      fs.unlinkSync(required);
      assert.throws(() => inspectPolicyBundle(path.join(result.bundleRoot, 'rules/execution-policy.md'), documents), /missing selected policy resource/);
    });
  });
}

run('skill-policy-bundle-contract');
