'use strict';

// Contract coverage for the writing-for-agents pass. This test deliberately
// checks behavior-facing signals rather than forcing one heading template on
// every document class: existing route, role, policy, and command semantics
// remain owned by their current validators and source-of-truth files.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { extract, isEmpty } = require('../scripts/ci/_lib/frontmatter');

const ROOT = path.resolve(__dirname, '..');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function relativeFiles(dir, predicate) {
  return walk(path.join(ROOT, dir))
    .filter(predicate)
    .map((absolute) => path.relative(ROOT, absolute).split(path.sep).join('/'))
    .sort();
}

function bodyOf(text) {
  const start = text.startsWith('---\n') ? text.indexOf('\n---', 4) : -1;
  return start >= 0 ? text.slice(start + 4) : text;
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function localLinks(relative) {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().split('#')[0])
    .filter((target) => target && !target.includes('://') && !target.startsWith('mailto:'))
    .map((target) => path.normalize(path.join(path.dirname(relative), target)));
}

test('all canonical skills expose the writing-for-agents contract without route boilerplate', () => {
  const files = relativeFiles('skills', (file) => file.endsWith('/SKILL.md'));
  assert.strictEqual(files.length, 100, 'skill inventory count drifted');
  const findings = [];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    const fm = extract(text);
    const body = bodyOf(text);
    if (!fm.present || isEmpty(fm.values.name) || isEmpty(fm.values.description)) findings.push(`${relative}: metadata`);
    if (!hasAny(`${fm.values.description || ''}\n${body}`, [/\bUse(?: when| for)?\b/i, /\bNot for\b/i, /When NOT to Use/i])) findings.push(`${relative}: pointer`);
    if (!hasAny(`${fm.values.description || ''}\n${body}`, [/\bOutput\b/i, /\bDeliver(?:able|ables)\b/i, /\bReturn(?:s|ed)?\b/i, /\bReport\b/i])) findings.push(`${relative}: output`);
    if (!hasAny(body, [/\bVerification\b/i, /\bverify\b/i, /\bvalidation\b/i, /\bevidence\b/i, /\bchecklist\b/i, /\bcheck\b/i])) findings.push(`${relative}: verification`);
    if (!hasAny(body, [/references?\//i, /single source of truth/i, /source of truth/i, /SSOT/i, /authoritative/i, /\bReference\b/i, /\bSee\b/i, /\bRead\b/i, /\bLoad\b/i, /\bSource\b/i])) findings.push(`${relative}: disclosure/SSOT`);
    if (!hasAny(body, [/\bcompletion\b/i, /\bhandoff\b/i, /\bnext step/i, /\bverified\b/i, /\bGate\b/i, /\bresult\b/i, /\breport\b/i, /\breturn\b/i, /\boutput\b/i, /\bdeliver/i, /\bguide\b/i, /\bbaseline\b/i, /\breference\b/i, /\banaly[sz]e/i, /\baudit\b/i, /\bworkflow\b/i, /\bsequence\b/i, /\bsupport/i])) findings.push(`${relative}: completion`);
  }
  assert.deepStrictEqual(findings, [], findings.join('\n'));
});

test('all registered agents expose role scope, available contract, completion, and handoff evidence', () => {
  const files = relativeFiles('agents', (file) => file.endsWith('.md') && !file.endsWith('/INDEX.md'));
  assert.strictEqual(files.length, 35, 'root agent inventory count drifted');
  const findings = [];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    const fm = extract(text);
    if (!fm.present || isEmpty(fm.values.name) || isEmpty(fm.values.description) || isEmpty(fm.values.model) || isEmpty(fm.values.tools)) findings.push(`${relative}: metadata`);
    if (!hasAny(text, [/^##?\s+(?:Scope|Mission|Role boundary|What it does)/im, /^#\s+/m, /\bOwns\b/i, /\bspecialist\b/i, /\bworker\b/i, /\bverifier\b/i])) findings.push(`${relative}: role scope`);
    if (!hasAny(text, [/\bcompletion\b/i, /\bverification\b/i, /\bverified\b/i, /\bverdict\b/i, /\boutput\b/i, /\breport\b/i, /\bresult\b/i, /\bpass\b/i, /\bfail\b/i, /\bblocked\b/i, /\bstop\b/i])) findings.push(`${relative}: completion`);
    if (!hasAny(text, [/\bhandoff\b/i, /\bnext step/i, /\bnext workflow/i, /\bescalat/i, /\breturn/i, /\breport/i, /\breview/i, /\boutput/i, /\bdo not edit/i, /\bread-only/i, /\bdoes not modify/i])) findings.push(`${relative}: handoff`);
  }
  assert.deepStrictEqual(findings, [], findings.join('\n'));
});

test('rules and commands point to policy ownership and execution outcomes', () => {
  const ruleFiles = relativeFiles('rules', (file) => file.endsWith('.md'));
  const commandFiles = relativeFiles('commands', (file) => file.endsWith('.md') && !file.endsWith('/INDEX.md'));
  assert.strictEqual(ruleFiles.length, 5, 'rule inventory count drifted');
  assert.strictEqual(commandFiles.length, 39, 'invocable command inventory count drifted');
  const findings = [];
  for (const relative of ruleFiles) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    if (!hasAny(text, [/SSOT/i, /source of truth/i, /authoritative/i, /precedence/i, /canonical/i])) findings.push(`${relative}: ownership`);
    if (!hasAny(text, [/\bWhen\b/i, /\bIf\b/i, /\bGate\b/i, /\bMUST\b/i, /\bSHALL\b/i])) findings.push(`${relative}: decision`);
  }
  for (const relative of commandFiles) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    const fm = extract(text);
    if (!fm.present || isEmpty(fm.values.description)) findings.push(`${relative}: metadata`);
    if (!hasAny(text, [/^##?\s+(?:Usage|Workflow|How|Steps|Mode|Task|Context|Implementation)/im, /\bUsage\b/i, /\bWorkflow\b/i, /\bRun\b/i, /\bTask\b/i, /\bArguments?\b/i, /^#\s+/m])) findings.push(`${relative}: entry`);
    if (!hasAny(text, [/\bcompletion\b/i, /\bverification\b/i, /\bverified\b/i, /\bexit\b/i, /\bPASS\b/i, /\bFAIL\b/i, /\bOutput\b/i, /\breport/i, /\breturn/i, /\bdry-run/i, /\bcreated\b/i, /\bresult/i, /\bstop/i])) findings.push(`${relative}: outcome`);
  }
  assert.deepStrictEqual(findings, [], findings.join('\n'));
});

test('root guidance stays minimal and every local markdown link resolves', () => {
  for (const relative of ['AGENTS.md', 'CLAUDE.md']) {
    const lines = fs.readFileSync(path.join(ROOT, relative), 'utf8').split('\n').length;
    assert.ok(lines <= 50, `${relative} should be a <=50-line universal index; got ${lines}`);
  }
  const requiredTargets = [
    'docs/agent-guidance/README.md',
    'docs/agent-guidance/plugin-development.md',
    'docs/agent-guidance/writing-for-agents.md',
    'codex/AGENTS.md',
  ];
  const guidance = ['AGENTS.md', 'CLAUDE.md', 'codex/AGENTS.md'];
  const missing = [];
  for (const relative of guidance) {
    const links = localLinks(relative);
    for (const target of links) {
      if (!fs.existsSync(path.join(ROOT, target))) missing.push(`${relative} -> ${target}`);
    }
    if (relative !== 'codex/AGENTS.md') {
      for (const target of requiredTargets) {
        if (!links.includes(target)) missing.push(`${relative} missing required link ${target}`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], missing.join('\n'));
});

test('GitHub issue guidance streams shell-sensitive bodies through stdin', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'issue-tracker.md'), 'utf8');
  assert.match(text, /gh issue create[^\n]*--body-file -/);
  assert.match(text, /gh issue comment[^\n]*--body-file -/);
  assert.match(text, /<<'ISSUE_BODY'/);
  assert.doesNotMatch(text, /gh issue (?:create|comment)[^\n]*--body(?!-file)\b/);
  assert.doesNotMatch(text, /gh issue close[^\n]*--comment/);
});

run('agent-facing-contract');
