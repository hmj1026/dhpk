'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { createCiPlan, validateCiPlan } = require('../scripts/lib/ci-plan');

const SMOKE = 'skill-script-operability.test.js';
const CLI = 'skills/change-verdict/scripts/review-cli.sh';
const CASES = [
  { name: 'an internal module requires the complete suite', paths: ['skills/change-verdict/scripts/lib/command-namespace.js'], mode: 'full' },
  { name: 'a registered runnable entry selects its smoke owner', paths: [CLI], mode: 'selected' },
  { name: 'an unknown script beside a registered entry requires the complete suite', paths: [CLI, 'skills/demo/scripts/new-helper.js'], mode: 'full' },
  { name: 'a missing smoke owner requires every available suite', paths: [CLI], mode: 'full', missingSmoke: true },
];

for (const scenario of CASES) {
  test(scenario.name, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-ci-owner-'));
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    const availableTests = scenario.missingSmoke ? ['unrelated.test.js'] : [SMOKE, 'unrelated.test.js'];
    const write = (file, content) => {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    };
    try {
      git('init', '-q');
      for (const [key, value] of Object.entries({
        'user.email': 'test@example.invalid', 'user.name': 'Test',
        'commit.gpgsign': 'false', 'maintenance.auto': 'false', 'gc.auto': '0',
      })) git('config', key, value);
      availableTests.forEach((file) => write(`tests/${file}`, '// fixture suite\n'));
      scenario.paths.forEach((file) => write(file, 'before\n'));
      git('add', '.');
      git('commit', '--no-verify', '-qm', 'base');
      const baseSha = git('rev-parse', 'HEAD');
      scenario.paths.forEach((file) => write(file, 'after\n'));
      git('add', '.');
      git('commit', '--no-verify', '-qm', 'head');
      const headSha = git('rev-parse', 'HEAD');
      const identity = { root, baseSha, headSha, checkoutSha: headSha, baseRef: 'develop' };
      const plan = createCiPlan(identity);
      assert.strictEqual(plan.mode, scenario.mode, JSON.stringify(plan));
      assert.deepStrictEqual(plan.testFiles, scenario.mode === 'selected' ? [SMOKE] : availableTests.slice().sort());
      assert.strictEqual(validateCiPlan(plan, identity).ok, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

run('ci-plan');
