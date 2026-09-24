'use strict';

// Regression guards for the Release workflow's immutable-tag contract:
//   - an existing GitHub Release is preserved on rerun instead of being edited;
//   - empty CHANGELOG notes fail before publication;
//   - notes are streamed via stdin so shell syntax in prose stays inert.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
// Pre-publish verification lives in one script shared with the release-PR
// rehearsal; behavioral coverage is tests/release-verify-cli.test.js.
const verifyScript = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'release-verify.sh'), 'utf8');
const releaseJob = raw.slice(raw.indexOf('\n  release:\n'), raw.indexOf('\n  publish:\n'));
const verifyStepIdx = releaseJob.indexOf('- name: Verify release candidate');

test('release workflows share one repository-global queue without cancelling active releases', () => {
  assert.match(
    raw,
    /^concurrency:\n  group: release-\$\{\{\s*github\.repository\s*\}\}\n  cancel-in-progress: false$/m,
    'release workflow must queue every tag in one repository-global, non-cancelling group',
  );
});

test('release step preserves an existing release instead of editing it', () => {
  const viewIdx = raw.indexOf('gh release view');
  const createIdx = raw.indexOf('gh release create');
  assert.ok(viewIdx !== -1, 'missing "gh release view" existence check');
  assert.ok(createIdx !== -1, 'missing "gh release create"');
  assert.ok(viewIdx < createIdx, '"gh release view" must be checked before "gh release create"');
  assert.ok(!raw.includes('gh release edit'), 'immutable release reruns must not edit existing notes');
});

test('release notes are streamed via stdin, not interpolated inline', () => {
  assert.ok(raw.includes('--notes-file -'), 'missing "--notes-file -" (stdin) usage');
  assert.ok(
    !/--notes\s+"\$\{?NOTES/.test(raw),
    'notes must not be passed inline via --notes "$NOTES" (backticks/$(...) would be shell-expanded)'
  );
});

test('release verification delegates note extraction to the unit-tested extract-notes.sh (see tests/extract-release-notes.test.js for empty/malformed-section coverage)', () => {
  assert.match(verifyScript, /bash scripts\/release\/extract-notes\.sh CHANGELOG\.md "\$version" > "\$notes_file"/);
});

test('the release job runs the shared verification in tag mode and exposes its outputs to publication', () => {
  assert.ok(verifyStepIdx !== -1, 'release job must run the shared release verification step');
  const step = releaseJob.slice(verifyStepIdx, releaseJob.indexOf('- name:', verifyStepIdx + 1));
  assert.match(step, /id:\s*release-verify/);
  assert.match(step, /bash scripts\/release\/release-verify\.sh --mode tag --tag "\$GITHUB_REF_NAME" --out-dir "\$RUNNER_TEMP"/);
  assert.ok(verifyStepIdx < releaseJob.indexOf('Verify bounded repository tests'), 'tag provenance and packages must fail fast before the suite');
  for (const [output, key] of [
    ['release_target_commit', 'target_commit'],
    ['release_target_tree', 'target_tree'],
    ['release_verifier_sha256', 'verifier_sha256'],
    ['release_notes_sha256', 'notes_sha256'],
  ]) {
    assert.match(releaseJob, new RegExp(`${output}:\\s*\\$\\{\\{\\s*steps\\.release-verify\\.outputs\\.${key}\\s*\\}\\}`), output);
  }
});

test('release validation emits one run-bound publication bundle from the exact notes file', () => {
  const uploadManifestIdx = raw.indexOf('Upload trusted release artifact manifest');
  const uploadIdx = raw.indexOf('Upload trusted publication bundle');
  const digestUploadIdx = raw.indexOf('Upload trusted publication notes digest');
  const verifierUploadIdx = raw.indexOf('Upload trusted publication bundle verifier');
  const createIdx = raw.indexOf('gh release create');
  assert.ok(uploadManifestIdx > raw.indexOf('- name: Verify release candidate'), 'uploads follow the verification that writes them');
  assert.ok(uploadIdx > uploadManifestIdx, 'publication bundle must be uploaded after the manifest');
  assert.ok(digestUploadIdx > uploadIdx, 'notes digest must be uploaded after the publication bundle');
  assert.ok(verifierUploadIdx > digestUploadIdx, 'portable verifier must be uploaded after the notes digest');
  assert.ok(createIdx > verifierUploadIdx, 'publication bundle must be produced before publication');
  // The script writes exactly the files the upload steps publish.
  for (const name of ['dhpk-release-artifact-manifest.json', 'dhpk-release-publication-bundle.json', 'dhpk-release-publication-notes-digest.json']) {
    assert.ok(verifyScript.includes(`$out_dir/${name}`), `release-verify.sh must write ${name}`);
    assert.ok(releaseJob.includes(`\${{ runner.temp }}/${name}`), `release job must upload ${name}`);
  }
  const bundleIdx = verifyScript.indexOf('node scripts/release/release-publication-bundle.js');
  assert.ok(bundleIdx !== -1, 'missing trusted publication bundle generation');
  const bundleBlock = verifyScript.slice(bundleIdx, verifyScript.indexOf('stage verifier-digest'));
  assert.match(bundleBlock, /--notes-file\s+"\$notes_file"/);
  assert.match(bundleBlock, /--run-id\s+"\$run_id"/);
  assert.match(bundleBlock, /--tag\s+"\$tag"/);
  assert.match(bundleBlock, /--expected-notes-sha256\s+"\$notes_sha256"/);
  assert.match(bundleBlock, /--digest-output\s+"\$digest_file"/);
  assert.match(bundleBlock, /--target-commit\s+"\$target_commit"/);
  assert.match(bundleBlock, /--target-tree\s+"\$target_tree"/);
  assert.match(verifyScript, /verifier="scripts\/release\/verify-publication-bundle\.js"[\s\S]*emit_output verifier_sha256 "\$verifier_sha256"/);
  const uploadBlock = raw.slice(uploadIdx, createIdx);
  assert.match(uploadBlock, /actions\/upload-artifact@[0-9a-f]{40}\s+#\s*v\d+(?:\.\d+)*/);
  assert.match(uploadBlock, /dhpk-release-publication-bundle-\$\{\{\s*github\.run_id\s*\}\}/);
  const digestUploadBlock = raw.slice(digestUploadIdx, verifierUploadIdx);
  assert.match(digestUploadBlock, /dhpk-release-publication-notes-digest-\$\{\{\s*github\.run_id\s*\}\}/);
  const verifierUploadBlock = raw.slice(verifierUploadIdx, createIdx);
  assert.match(verifierUploadBlock, /scripts\/release\/verify-publication-bundle\.js/);
  assert.match(verifierUploadBlock, /dhpk-release-publication-bundle-verifier-\$\{\{\s*github\.run_id\s*\}\}/);
  assert.doesNotMatch(raw, /notes<<EOF/, 'release notes are never passed through multi-line step outputs');
});

test('release publication validates the bundle and streams only its validated note bytes', () => {
  const publishIdx = raw.indexOf('  publish:');
  const nextJobIdx = raw.indexOf('  consumer-verify:', publishIdx);
  const publishBlock = raw.slice(publishIdx, nextJobIdx);
  const validateIdx = publishBlock.indexOf('Validate trusted publication bundle');
  const ghCreateIdx = publishBlock.indexOf('gh release create');
  assert.ok(publishIdx !== -1, 'missing no-checkout publication job');
  assert.ok(validateIdx !== -1, 'publication must validate the trusted bundle');
  assert.ok(ghCreateIdx > validateIdx, 'bundle validation must precede release creation');
  assert.match(publishBlock, /needs:\s+release/);
  assert.doesNotMatch(publishBlock, /actions\/checkout@/, 'publication consumer must not checkout the repository');
  assert.match(publishBlock, /actions\/download-artifact@[0-9a-f]{40}\s+#\s*v\d+(?:\.\d+)*/);
  assert.match(publishBlock, /dhpk-release-publication-bundle-\$\{\{\s*github\.run_id\s*\}\}/);
  assert.match(publishBlock, /dhpk-release-publication-notes-digest-\$\{\{\s*github\.run_id\s*\}\}/);
  assert.match(publishBlock, /dhpk-release-publication-bundle-verifier-\$\{\{\s*github\.run_id\s*\}\}/);
  assert.match(publishBlock, /VERIFIER_SHA256:\s*\$\{\{\s*needs\.release\.outputs\.release_verifier_sha256\s*\}\}/);
  assert.match(publishBlock, /EXPECTED_NOTES_SHA256:\s*\$\{\{\s*needs\.release\.outputs\.release_notes_sha256\s*\}\}/);
  assert.match(publishBlock, /actual_verifier_sha256="sha256:\$\(sha256sum\s+"\$verifier"/);
  assert.match(publishBlock, /downloaded verifier digest does not match/);
  assert.match(publishBlock, /node\s+"\$verifier"/);
  assert.match(publishBlock, /--bundle\s+"\$bundle"/);
  assert.match(publishBlock, /--expected-run-id\s+"\$GITHUB_RUN_ID"/);
  assert.match(publishBlock, /--expected-tag\s+"\$GITHUB_REF_NAME"/);
  assert.match(publishBlock, /--expected-notes-sha256\s+"\$EXPECTED_NOTES_SHA256"/);
  assert.match(publishBlock, /--expected-notes-digest-file\s+"\$digest"/);
  assert.match(publishBlock, /--expected-target-commit\s+"\$TARGET_COMMIT"/);
  assert.match(publishBlock, /--expected-target-tree\s+"\$TARGET_TREE"/);
  assert.match(publishBlock, /--notes-output\s+"\$validated_notes_file"/);
  assert.match(publishBlock, /--notes-file -\s+<\s+"\$RUNNER_TEMP\/dhpk-release-notes-validated\.txt"/);
  assert.doesNotMatch(publishBlock, /steps\.notes\.outputs\.notes/);
});

test('publication steps that call gh bind GH_REPO because the no-checkout job has no git remote to infer from', () => {
  const publishIdx = raw.indexOf('  publish:');
  const nextJobIdx = raw.indexOf('  consumer-verify:', publishIdx);
  const publishBlock = raw.slice(publishIdx, nextJobIdx);
  const steps = publishBlock.split(/\n      - name: /).slice(1);
  const ghSteps = steps.filter((step) => /^\s*gh\s/m.test(step));
  assert.ok(ghSteps.length > 0, 'publication job must invoke the gh CLI');
  for (const step of ghSteps) {
    const stepName = step.split('\n', 1)[0];
    assert.match(
      step,
      /GH_REPO:\s*\$\{\{\s*github\.repository\s*\}\}/,
      `publication step "${stepName}" calls gh without GH_REPO; the job does not checkout, so gh cannot resolve the repository from git`,
    );
  }
});

test('release verification proves the tag commit is contained in main', () => {
  assert.ok(verifyScript.includes('git merge-base --is-ancestor "$target_commit" origin/main'), 'missing tag-to-main provenance check');
});

test('release verification checks manifest/changelog parity for the tag version before creating a release', () => {
  assert.match(verifyScript, /node scripts\/ci\/verify-release-parity\.js --version "\$version"/);
  assert.ok(verifyStepIdx !== -1 && raw.indexOf('- name: Verify release candidate') < raw.indexOf('gh release create'));
});

test('release workflow reruns repository tests under the required Linux bounded runner', () => {
  const boundedIdx = raw.indexOf('Verify bounded repository tests');
  const resolveIdx = raw.indexOf('Resolve merged release PR head');
  assert.ok(boundedIdx !== -1, 'missing bounded repository test step');
  const boundedBlock = raw.slice(boundedIdx, resolveIdx);
  assert.match(boundedBlock, /DHPK_BOUNDED_REQUIRE_CGROUP:\s*[\'\"]?1/);
  assert.match(boundedBlock, /run-bounded-node-test\.sh\s+node\s+tests\/run-all\.js/);
});

// Ubuntu runners do not ship ripgrep, and the isolated skill fixtures delegate
// to the host rg binary. v0.63.0 failed at tag time because only CI installed
// it; both test-running jobs must now share one environment definition.
test('CI validate and the release rerun share one test environment action and no inline ripgrep install', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const action = fs.readFileSync(path.join(ROOT, '.github', 'actions', 'setup-dhpk-test-env', 'action.yml'), 'utf8');
  const releaseJob = raw.slice(raw.indexOf('\n  release:\n'), raw.indexOf('\n  publish:\n'));
  const validateJob = ci.slice(ci.indexOf('\n  validate:\n'), ci.indexOf('\n  macos-installer:\n'));
  for (const [name, job] of [['release', releaseJob], ['validate', validateJob]]) {
    const actionIdx = job.indexOf('uses: ./.github/actions/setup-dhpk-test-env');
    assert.ok(actionIdx !== -1, `${name} job must use the shared test environment action`);
    assert.ok(job.indexOf('actions/checkout@') < actionIdx, `${name} job must check out before using the local action`);
    assert.ok(actionIdx < job.indexOf('run-bounded-node-test.sh'), `${name} job must set up the environment before tests`);
    assert.doesNotMatch(job, /apt-get install -y ripgrep/, `${name} job must not install ripgrep inline`);
  }
  assert.match(action, /using:\s*['"]?composite/);
  assert.match(action, /apt-get install -y ripgrep/);
  assert.match(action, /actions\/setup-node@[0-9a-f]{40}/);
  for (const block of action.split(/\n\s*- /).filter((step) => /^\s*(name:[^\n]*\n\s*)?run:/.test(step))) {
    assert.match(block, /shell:\s*bash/, 'composite run steps must declare shell: bash');
  }
});

// The release PR rehearses the tag-only path (release-verify.sh dry-run plus
// the consumer gate) before merge, so publication-shaped failures surface
// while no immutable tag exists yet. It must never gain publish authority.
test('release PRs run a read-only release rehearsal of the tag-only path', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const start = ci.indexOf('\n  release-rehearsal:\n');
  assert.ok(start !== -1, 'ci.yml must define a release-rehearsal job');
  const next = ci.slice(start + 1).search(/\n  [A-Za-z0-9][A-Za-z0-9_-]*:\n/);
  const job = next === -1 ? ci.slice(start) : ci.slice(start, start + 1 + next);
  assert.match(job, /\n    if:\s*github\.base_ref == 'main'\n/);
  assert.match(job, /\n    permissions:\n      contents: read\n(?!      )/);
  assert.match(job, /\n    timeout-minutes: 10\n/);
  assert.match(job, /fetch-depth: 0/);
  assert.ok(job.indexOf('actions/checkout@') < job.indexOf('uses: ./.github/actions/setup-dhpk-test-env'));
  assert.match(job, /bash scripts\/release\/release-verify\.sh --mode dry-run --out-dir "\$RUNNER_TEMP"/);
  assert.doesNotMatch(job, /run-all\.js/, 'the rehearsal relies on the validate job for the full suite');
  assert.doesNotMatch(job, /gh release|git tag|git push|contents: write/);
  const gateIdx = job.indexOf('bin/dhpk harness release --json');
  assert.ok(gateIdx > job.indexOf('release-verify.sh --mode dry-run'), 'consumer rehearsal follows the dry-run that writes the manifest');
  assert.match(job, /DHPK_RELEASE_ARTIFACT_MANIFEST:\s*\$\{\{\s*runner\.temp\s*\}\}\/dhpk-release-artifact-manifest\.json/);
  assert.ok(/PUBLISHED_PENDING[\s\S]{0,240}exit 0/.test(job), 'pending consumer evidence stays green');
  assert.ok(/PUBLISHED_UNHEALTHY\|BLOCKED[\s\S]{0,240}exit 1/.test(job), 'unhealthy or blocked evidence fails the rehearsal');
  assert.ok(/Unexpected consumer rehearsal outcome[\s\S]{0,120}exit 1/.test(job), 'unknown evidence fails closed');
});

test('a post-publish consumer-verify job runs the full harness release probe and reports via the job summary, never editing the release', () => {
  assert.ok(raw.includes('consumer-verify:'), 'missing consumer-verify job');
  assert.ok(raw.includes('bin/dhpk harness release'), 'consumer-verify must run the public release facade');
  assert.ok(raw.includes('surfaceResults'), 'consumer-verify must report all consumer surface rows');
  assert.ok(raw.includes('GITHUB_STEP_SUMMARY'), 'consumer-verify must report via the job summary');
  assert.ok(!raw.includes('gh release edit'), 'consumer-verify must never edit the immutable release');
});

test('sync-develop delegates reconciliation to the tested sync-develop.sh writer', () => {
  const syncIdx = raw.indexOf('sync-develop:');
  assert.ok(syncIdx !== -1, 'missing sync-develop job');
  const syncBlock = raw.slice(syncIdx);
  assert.ok(syncBlock.includes('scripts/release/sync-develop.sh'), 'sync-develop must call scripts/release/sync-develop.sh');
  assert.ok(!syncBlock.includes('reset --hard'), 'sync-develop must never reset');
  assert.ok(!/\bgit\s+push\s+-f\b/.test(syncBlock), 'workflow must not use git push -f');
  assert.ok(
    !/\bgit\s+push\s+--force(?!-with-lease)\b/.test(syncBlock),
    'workflow must not use bare git push --force; idle align belongs in sync-develop.sh as --force-with-lease',
  );
});

test('sync-develop receives the merged release PR head SHA before idle alignment', () => {
  const releaseJob = raw.slice(raw.indexOf('  release:'), raw.indexOf('  consumer-verify:'));
  const syncJob = raw.slice(raw.indexOf('  sync-develop:'));
  assert.match(releaseJob, /outputs:/, 'release job must expose a sync baseline');
  assert.match(releaseJob, /pull-requests:\s*read/, 'release job needs pull-request read permission for head lookup');
  assert.match(releaseJob, /headRefOid/, 'release job must resolve the merged PR head SHA');
  assert.match(releaseJob, /--base main --head develop/, 'release job must resolve the direct develop-to-main release PR');
  assert.match(releaseJob, /release_pr_head_sha/, 'release job output must be named');
  assert.match(syncJob, /DHPK_RELEASE_EXPECTED_DEVELOP_SHA:\s*\$\{\{\s*needs\.release\.outputs\.release_pr_head_sha\s*\}\}/, 'sync job must pass the release PR head SHA');
});

test('release PR head lookup dereferences the pushed tag before matching mergeCommit', () => {
  const resolveIdx = raw.indexOf('Resolve merged release PR head');
  const parityIdx = raw.indexOf('Verify release parity');
  const resolveBlock = raw.slice(resolveIdx, parityIdx);
  assert.match(resolveBlock, /git rev-list -n 1 "\$GITHUB_REF_NAME"/, 'annotated tags must be dereferenced to a commit');
  assert.match(resolveBlock, /MERGE_SHA="\$merge_sha" node -e/, 'tag commit must bind the PR lookup input');
});

test('RELEASE.md documents the manual back-merge recovery procedure (recovery branch, resolve, test, PR to develop)', () => {
  const releaseMd = fs.readFileSync(path.join(ROOT, 'RELEASE.md'), 'utf8');
  assert.match(releaseMd, /recovery branch/i);
  assert.match(releaseMd, /merge `?main`? into/i);
  assert.match(releaseMd, /PR .* to `?develop`?|pull request .* to `?develop`?/i);
});

test('consumer-verify never deletes, moves, or force-updates the tag or release on a CONSUMER failure', () => {
  const verifyIdx = raw.indexOf('consumer-verify:');
  const nextJobIdx = raw.indexOf('sync-develop:');
  const consumerBlock = raw.slice(verifyIdx, nextJobIdx);
  assert.ok(!consumerBlock.includes('tag -d'), 'must never delete a local tag');
  assert.ok(!consumerBlock.includes('push --delete'), 'must never delete the remote tag');
  assert.ok(!consumerBlock.includes('gh release delete'), 'must never delete the GitHub release');
  assert.ok(!consumerBlock.includes('gh release edit'), 'must never edit the immutable release');
});

test('RELEASE.md documents that a CONSUMER verification failure keeps the tag immutable and recovery is a new patch/hotfix release', () => {
  const releaseMd = fs.readFileSync(path.join(ROOT, 'RELEASE.md'), 'utf8');
  assert.match(releaseMd, /consumer verification fail|consumer.*fail/i);
  assert.match(releaseMd, /patch|hotfix/i);
  assert.match(releaseMd, /immutable/i);
});

test('consumer-verify installs the real claude CLI so the supported Claude check runs for real, not perpetually UNAVAILABLE', () => {
  const verifyIdx = raw.indexOf('consumer-verify:');
  const nextJobIdx = raw.indexOf('sync-develop:');
  const consumerBlock = raw.slice(verifyIdx, nextJobIdx);
  assert.match(consumerBlock, /actions\/checkout@[0-9a-f]{40}[\s\S]{0,160}fetch-depth: 0/, 'consumer verification needs full git history for ancestry checks');
  const installIdx = consumerBlock.indexOf('@anthropic-ai/claude-code');
  const gateInvocationIdx = consumerBlock.indexOf('bin/dhpk harness release');
  assert.ok(installIdx !== -1, 'missing claude CLI install step');
  assert.ok(gateInvocationIdx !== -1, 'missing harness release invocation');
  assert.ok(installIdx < gateInvocationIdx, 'claude CLI must be installed before the harness release probe runs');
});

test('consumer-verify keeps pending evidence green but fails unhealthy or blocked outcomes', () => {
  const verifyIdx = raw.indexOf('consumer-verify:');
  const nextJobIdx = raw.indexOf('sync-develop:');
  const consumerBlock = raw.slice(verifyIdx, nextJobIdx);
  const pendingIdx = consumerBlock.indexOf('PUBLISHED_PENDING');
  const unhealthyIdx = consumerBlock.indexOf('PUBLISHED_UNHEALTHY');
  const blockedIdx = consumerBlock.indexOf('BLOCKED');
  assert.ok(pendingIdx !== -1, 'pending consumer evidence must be classified explicitly');
  assert.ok(unhealthyIdx !== -1, 'unhealthy consumer evidence must remain a failing outcome');
  assert.ok(blockedIdx !== -1, 'blocked consumer evidence must remain a failing outcome');
  assert.ok(/PUBLISHED_PENDING[\s\S]{0,240}exit 0/.test(consumerBlock), 'pending evidence must not fail the workflow job');
  assert.ok(/PUBLISHED_UNHEALTHY[\s\S]{0,240}exit 1/.test(consumerBlock), 'unhealthy evidence must fail the workflow job');
  assert.ok(/BLOCKED[\s\S]{0,240}exit 1/.test(consumerBlock), 'blocked evidence must fail the workflow job');
  assert.ok(/Unexpected consumer verification outcome[\s\S]{0,120}exit 1/.test(consumerBlock), 'unknown evidence must fail closed');
});

test('release preflight classifies UNAVAILABLE outcome as non-blocking on standard runner', () => {
  const preflightIdx = verifyScript.indexOf('stage preflight');
  assert.ok(preflightIdx !== -1, 'missing harness facade preflight stage');
  const preflightBlock = verifyScript.slice(preflightIdx, verifyScript.indexOf('stage packages'));
  assert.ok(preflightBlock.includes('bin/dhpk harness preflight --json'));
  assert.ok(preflightBlock.includes('UNAVAILABLE'), 'preflight stage must explicitly handle UNAVAILABLE outcome');
  assert.ok(preflightBlock.includes('BLOCKED'), 'preflight stage must explicitly handle BLOCKED outcome');
  assert.ok(preflightBlock.includes('preflight_exit'), 'preflight stage must capture exit code');
});

test('RELEASE.md documents that a failed publish job leaves an unreleased tag recovered by the next patch, not a hand-made release', () => {
  const releaseDoc = fs.readFileSync(path.join(ROOT, 'RELEASE.md'), 'utf8');
  assert.match(releaseDoc, /publish[\s\S]{0,200}fails[\s\S]{0,200}no GitHub Release/i);
  assert.match(releaseDoc, /Do not create that release by hand/i);
  assert.match(releaseDoc, /workflow definition stored at the\s+tag/i);
  assert.match(releaseDoc, /ship the next patch\s+release/i);
});

run('release-workflow');
