'use strict';

// Drift and contract verification between stage IDs declared in the six
// script-dependent skills' scripts and their Manual Procedures in
// references/manual-procedure.md (ADR-0041, task 7.1).

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

const MANUAL_PROCEDURE_SKILLS = Object.freeze([
  {
    skill: 'flow-guide',
    scripts: [
      'skills/flow-guide/scripts/action-runner.js',
      'skills/flow-guide/scripts/pre-route.sh',
      'skills/flow-guide/scripts/usage-card.js',
    ],
  },
  {
    skill: 'opsx-apply-resume',
    scripts: [
      'skills/opsx-apply-resume/scripts/detect-phase.sh',
      'skills/opsx-apply-resume/scripts/extract-compact.sh',
      'skills/opsx-apply-resume/scripts/write-handoff.sh',
      'skills/opsx-apply-resume/scripts/set-handoff-state.sh',
      'skills/opsx-apply-resume/scripts/post-obs.sh',
    ],
  },
  {
    skill: 'git-smart-commit',
    scripts: ['skills/git-smart-commit/scripts/collect-changes.js'],
  },
  {
    skill: 'harness-setup',
    scripts: [
      'skills/harness-setup/scripts/install-assets.sh',
      'skills/harness-setup/scripts/install-codex-project.sh',
    ],
  },
  {
    skill: 'precommit',
    scripts: ['skills/precommit/scripts/precommit-runner.js'],
  },
  {
    skill: 'release-creator',
    scripts: ['skills/release-creator/scripts/release-runner.sh'],
  },
]);

function extractDeclaredStageIds(scriptText) {
  const found = [];
  const add = (id) => {
    const clean = id.trim();
    if (clean && !found.includes(clean)) found.push(clean);
  };

  for (const match of String(scriptText).matchAll(/^\s*(?:#|\/\/)\s*dhpk-stage-ids:\s*(.+)$/gm)) {
    for (const token of match[1].split(',')) add(token);
  }
  for (const match of String(scriptText).matchAll(/\bconst\s+(?:STAGE_ORDER|STAGE_IDS)\s*=\s*(?:Object\.freeze\(\s*)?\[([^\]]+)\]/g)) {
    for (const item of match[1].matchAll(/['"]([a-z0-9_-]+)['"]/g)) add(item[1]);
  }
  return found;
}

function extractProcedureStages(markdown) {
  const stages = [];
  const duplicates = [];
  for (const match of String(markdown).matchAll(/^##\s+Stage:\s*([a-z0-9_-]+)\b/gm)) {
    const id = match[1];
    if (stages.includes(id)) duplicates.push(id);
    else stages.push(id);
  }
  return { stages, duplicates };
}

function verifyStageParity(skill, scriptIds, procedureMarkdown) {
  const errors = [];
  if (!scriptIds || scriptIds.length === 0) {
    errors.push(`${skill}: no stage IDs declared in skill scripts`);
  }
  if (typeof procedureMarkdown !== 'string' || procedureMarkdown.trim().length === 0) {
    errors.push(`${skill}: references/manual-procedure.md is missing`);
    return { ok: false, errors };
  }

  const { stages: procIds, duplicates } = extractProcedureStages(procedureMarkdown);
  for (const dup of duplicates) {
    errors.push(`${skill}: duplicate procedure heading for stage '${dup}'`);
  }

  const scriptSet = new Set(scriptIds);
  const procSet = new Set(procIds);
  for (const id of scriptIds) {
    if (!procSet.has(id)) {
      errors.push(`${skill}: script declares stage '${id}' which is missing from references/manual-procedure.md`);
    }
  }
  for (const id of procIds) {
    if (!scriptSet.has(id)) {
      errors.push(`${skill}: references/manual-procedure.md declares stage '${id}' which scripts do not declare`);
    }
  }

  const safetyMatch = /^##\s+Safety Rules\b/m.exec(procedureMarkdown);
  const firstStageMatch = /^##\s+Stage:\s*[a-z0-9_-]+\b/m.exec(procedureMarkdown);
  if (!safetyMatch) {
    errors.push(`${skill}: references/manual-procedure.md must include a '## Safety Rules' section`);
  } else if (firstStageMatch && safetyMatch.index > firstStageMatch.index) {
    errors.push(`${skill}: '## Safety Rules' must appear before the first '## Stage:' section`);
  }

  if (!/`?mode:\s*manual`?/.test(procedureMarkdown)) {
    errors.push(`${skill}: references/manual-procedure.md must require reporting 'mode: manual'`);
  }
  if (!/\bNOT_RUN\b/.test(procedureMarkdown)) {
    errors.push(`${skill}: references/manual-procedure.md must keep unexecuted stages as NOT_RUN without an overall pass`);
  }
  if (/(?:^|[\s`])npx\s+[a-z0-9@/_-]+/i.test(procedureMarkdown)) {
    errors.push(`${skill}: references/manual-procedure.md must not invoke npx`);
  }

  return { ok: errors.length === 0, errors };
}

test('synthetic missing or extra stage IDs fail parity and name skill and stage ID', () => {
  const missingProc = '## Safety Rules\nKeep clean.\n\n## Stage: alpha\nReport mode: manual, NOT_RUN otherwise.\n';
  const missingRes = verifyStageParity('sample-skill', ['alpha', 'beta'], missingProc);
  assert.strictEqual(missingRes.ok, false);
  assert.ok(missingRes.errors.some((e) => e.includes('sample-skill') && e.includes('beta')), missingRes.errors.join('\n'));

  const extraRes = verifyStageParity('sample-skill', ['alpha'], `${missingProc}\n## Stage: gamma\n`);
  assert.strictEqual(extraRes.ok, false);
  assert.ok(extraRes.errors.some((e) => e.includes('sample-skill') && e.includes('gamma')), extraRes.errors.join('\n'));
});

for (const spec of MANUAL_PROCEDURE_SKILLS) {
  test(`${spec.skill}: script stage IDs match references/manual-procedure.md headings and safety contract`, () => {
    const declaredIds = [];
    for (const rel of spec.scripts) {
      const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const id of extractDeclaredStageIds(content)) {
        if (!declaredIds.includes(id)) declaredIds.push(id);
      }
    }

    const procPath = path.join(ROOT, 'skills', spec.skill, 'references', 'manual-procedure.md');
    const procText = fs.existsSync(procPath) ? fs.readFileSync(procPath, 'utf8') : null;
    const verdict = verifyStageParity(spec.skill, declaredIds, procText);
    assert.strictEqual(verdict.ok, true, verdict.errors.join('\n'));

    const skillMd = fs.readFileSync(path.join(ROOT, 'skills', spec.skill, 'SKILL.md'), 'utf8');
    assert.match(skillMd, /references\/manual-procedure\.md/, `${spec.skill}/SKILL.md must reference references/manual-procedure.md fallback`);
  });
}

run('manual-procedure-drift');
