'use strict';

// Static contract for relocated runtime instructions. The test reads the
// canonical documents only; it makes no Host, provider, or network call.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const DOCS = Object.freeze({
  load: 'skills/dhpk-opsx-load-context/SKILL.md',
  extractor: 'skills/dhpk-opsx-load-context/references/extractor-resolution.md',
  observe: 'skills/dhpk-opsx-post-observation/SKILL.md',
  audit: 'skills/dhpk-project-audit/SKILL.md',
  intake: 'skills/dhpk-repo-intake/SKILL.md',
  resumeSkill: 'skills/opsx-apply-resume/SKILL.md',
  resume: 'skills/opsx-apply-resume/references/resume.md',
  save: 'skills/opsx-apply-resume/references/save.md',
});

function readDocs() {
  return Object.fromEntries(
    Object.entries(DOCS).map(([name, relative]) => [
      name,
      fs.readFileSync(path.join(ROOT, relative), 'utf8'),
    ]),
  );
}

function assertSkillDirDefinition(source, name) {
  assert.match(
    source,
    /`\$SKILL_DIR` denotes the physical directory containing the selected `SKILL\.md`/,
    `${name} must define the physical selected Skill directory`,
  );
  assert.match(
    source,
    /not an ambient environment variable or repository-root\s+lookup/,
    `${name} must reject ambient path resolution`,
  );
}

test('runtime documents define a physical selected Skill directory', () => {
  const docs = readDocs();
  for (const [name, source] of Object.entries(docs)) {
    assertSkillDirDefinition(source, name);
  }
});

test('runtime examples quote Skill-local executable paths', () => {
  const docs = readDocs();
  const executablePaths = [
    ['load', /"\$SKILL_DIR\/scripts\/extract-compact\.sh"/],
    ['extractor', /extractor="\$SKILL_DIR\/scripts\/extract-compact\.sh"/],
    ['observe', /bash "\$SKILL_DIR\/scripts\/post-obs\.sh"/],
    ['audit', /node "\$SKILL_DIR\/scripts\/audit\.js"/],
    ['intake', /node "\$SKILL_DIR\/scripts\/intake_cached\.js"/],
    ['resumeSkill', /"\$SKILL_DIR\/scripts\/"/],
    ['resume', /"\$SKILL_DIR\/scripts\/(?:extract-compact|set-handoff-state)\.sh"/],
    ['save', /"\$SKILL_DIR\/scripts\/(?:detect-phase|extract-compact|post-obs|set-handoff-state|write-handoff)\.sh"/],
  ];
  for (const [name, pattern] of executablePaths) {
    assert.match(docs[name], pattern, `${name} must quote its Skill-local path`);
  }

  assert.doesNotMatch(
    docs.resume,
    /dhpk-opsx-load-context\/scripts\/extract-compact\.sh/,
    'Resume must use its synchronized local extractor copy',
  );
  assert.match(docs.save, /extract-compact\.sh.*synchronized local copy/s);
  assert.match(docs.save, /post-obs\.sh.*synchronized local copy/s);
});

test('runtime path repair preserves handoff and optional-provider contracts', () => {
  const docs = readDocs();
  assert.match(docs.resume, /HANDOFF_PATH.*explicit/s);
  assert.match(docs.resume, /CONTEXT_UNAVAILABLE/);
  assert.match(docs.resume, /consumed/);
  assert.match(docs.resume, /openspec-apply-change/);
  assert.match(docs.save, /post non-blocking/);
  assert.match(docs.save, /claude_mem_obs_id.*null/s);
  assert.match(docs.save, /BLOCKED_RESOURCE_MISSING/);
  assert.match(docs.observe, /post-obs\.sh.*&/s);
  assert.match(docs.observe, /outcomes accepted/);
});

run('skill-runtime-path-contract');
