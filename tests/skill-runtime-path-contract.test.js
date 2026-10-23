'use strict';

// Resource closure checks for canonical and relocated policy bundles.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');

const ROOT = path.join(__dirname, '..');
const mappings = require('../manifests/skill-resources.json').skills;
const coverage = require('../manifests/skill-directory-coverage.json').skills;
// ---- Policy-bundle contract (source suite: skill-policy-bundle-contract) ----
// Static evidence only; this does not execute a Host orchestrator or claim reviewer availability.
function inspectPolicyBundle(selectedPolicy, policyDocuments) {
  const policy = fs.realpathSync(selectedPolicy);
  assert.strictEqual(path.basename(path.dirname(policy)), 'rules');
  const bundleRoot = path.dirname(path.dirname(policy));
  const required = new Set();
  for (const document of policyDocuments) {
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

const policyDocuments = mappings['flow-guide'].filter(item => item.source.endsWith('.md')).map(item => item.source);

test('canonical policy binds the parent of rules without using the active Skill', () => {
  const { bundleRoot } = inspectPolicyBundle(path.join(ROOT, 'rules/execution-policy.md'), policyDocuments);
  assert.strictEqual(bundleRoot, fs.realpathSync(ROOT));
});

for (const skill of ['flow-guide']) {
  test(`${skill} policy uses only declared physical resources in its relocated bundle`, () => {
    withIsolatedSkill({ source: path.join(ROOT, 'skills', skill) }, context => {
      const prefix = 'references/execution-bundle/';
      const result = inspectPolicyBundle(path.join(context.skillDir, prefix, 'rules/execution-policy.md'), policyDocuments);
      assert.strictEqual(result.bundleRoot, path.join(context.skillDir, 'references/execution-bundle'));
      const row = coverage[skill];
      const declared = new Set([...row.references, ...row.executable_entries.map(item => item.path),
        ...(row.api_entries || []).map(item => item.path), ...(row.internal_helpers || []).map(item => item.path)]);
      for (const resource of result.required) assert.ok(declared.has(prefix + resource), `uncovered policy resource: ${resource}`);
      const required = path.join(result.bundleRoot, 'rules/execution-policy-kernel.md');
      fs.unlinkSync(required);
      assert.throws(() => inspectPolicyBundle(path.join(result.bundleRoot, 'rules/execution-policy.md'), policyDocuments), /missing selected policy resource/);
    });
  });
}

test('relocated Laravel public task ignores distribution authoring data without manifests', () => {
  withIsolatedSkill({ source: path.join(ROOT, 'skills/laravel'), files: ['SKILL.md', 'distribution.yaml', 'scripts/resolve-version.js', 'scripts/version-resolver.js', 'references/11.md'] }, context => {
    fs.writeFileSync(path.join(context.skillDir, 'distribution.yaml'), 'schema: invalid\nusage: [unparseable authoring metadata\n');
    fs.writeFileSync(path.join(context.projectDir, 'composer.lock'), JSON.stringify({ packages: [{ name: 'laravel/framework', version: 'v11.0.7' }], 'packages-dev': [] }));
    fs.writeFileSync(path.join(context.projectDir, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^10.0' } }));
    fs.writeFileSync(path.join(context.skillDir, 'probe.js'), [
      "const fs = require('node:fs');",
      "const reads = [];",
      "for (const method of ['readFileSync', 'openSync']) { const original = fs[method]; fs[method] = function (file, ...args) { const name = String(file); reads.push(name); if (/distribution\\.yaml|[/\\\\]manifests[/\\\\]|[/\\\\]scripts[/\\\\]ci[/\\\\]/.test(name)) throw new Error('forbidden authoring read: ' + name); return original.call(fs, file, ...args); }; }",
      "require('./scripts/resolve-version.js');",
      "process.stderr.write(JSON.stringify(reads));",
    ].join('\n'));
    const copiedRuntime = path.join(context.skillDir, 'scripts/resolve-version.js');
    const acceptedRuntime = fs.readFileSync(copiedRuntime);
    const runtimeText = acceptedRuntime.toString('utf8');
    assert.ok(runtimeText.startsWith('#!/usr/bin/env node\n\'use strict\';\n'));
    try {
      fs.writeFileSync(copiedRuntime, runtimeText.replace("'use strict';", "'use strict';\nrequire('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'distribution.yaml'), 'utf8');"));
      const negativeControl = context.run('probe.js', ['--json']);
      assert.notStrictEqual(negativeControl.status, 0, 'authoring-read mutation must fail');
      assert.match(negativeControl.stderr, /Error: forbidden authoring read: [^\n]+[/\\]distribution\.yaml/);
    } finally {
      fs.writeFileSync(copiedRuntime, acceptedRuntime);
    }
    assert.deepStrictEqual(fs.readFileSync(copiedRuntime), acceptedRuntime);
    const result = context.run('probe.js', ['--json']);
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepStrictEqual([report.status, report.family, report.selector, report.source, report.reference, report.loadedReferences], ['resolved', 'laravel', '11', 'composer.lock', 'references/11.md', ['references/11.md']]);
    assert.strictEqual(report.guidance, fs.readFileSync(path.join(context.skillDir, 'references/11.md'), 'utf8'));
    const reads = JSON.parse(result.stderr);
    assert.ok(reads.some(file => file.endsWith('references/11.md')));
    assert.ok(!reads.some(file => file.endsWith('distribution.yaml')));
    assert.ok(!fs.existsSync(path.join(context.skillDir, 'manifests')));
    assert.strictEqual(result.hostStatus, 'NOT_RUN');
  });
});

run('skill-runtime-path-contract');
