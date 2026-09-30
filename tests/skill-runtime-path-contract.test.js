'use strict';

// Static contract for relocated Skill instructions. The suite reads canonical
// documents and disposable fixtures; it makes no Host, provider, or network call.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');

const ROOT = path.join(__dirname, '..');
const mappings = require('../manifests/skill-resources.json').skills;
const coverage = require('../manifests/skill-directory-coverage.json').skills;
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

function normalizedText(source) {
  return source.replace(/\s+/g, ' ').trim();
}

function assertWholeInstruction(source, instruction, message) {
  assert.ok(
    normalizedText(source).includes(normalizedText(instruction)),
    `${message}: missing complete instruction ${instruction}`,
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
  ];
  for (const [name, pattern] of executablePaths) {
    assert.match(docs[name], pattern, `${name} must quote its Skill-local path`);
  }

  for (const [name, scripts] of [
    ['resume', ['extract-compact.sh', 'set-handoff-state.sh']],
    ['save', [
      'detect-phase.sh',
      'extract-compact.sh',
      'post-obs.sh',
      'set-handoff-state.sh',
      'write-handoff.sh',
    ]],
  ]) {
    for (const script of scripts) {
      assert.ok(
        docs[name].includes(`"$SKILL_DIR/scripts/${script}"`),
        `${name} must quote its Skill-local ${script} path`,
      );
    }
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
  assertWholeInstruction(
    docs.resume,
    `Pass \`HANDOFF_PATH\` explicitly as the phase/state helpers' trailing path argument and to any available optional context loader.
    The package-local \`"$SKILL_DIR/scripts/set-handoff-state.sh"\` accepts the explicit path for \`consuming\` and \`saved\` recovery; the loader accepts the same path rather than assuming a Claude directory.
    Missing required helper assets are \`BLOCKED_RESOURCE_MISSING\`; without a context loader, perform the fallback steps below directly.`,
    'Resume path handling',
  );
  assertWholeInstruction(
    docs.resume,
    'The embedded handoff summary (`handoff only`). If it is absent or empty, return `BLOCKED` with `CONTEXT_UNAVAILABLE`; do not fabricate context.',
    'Resume context fallback',
  );
  assertWholeInstruction(
    docs.resume,
    `6. **Invoke external apply.** Use the canonical \`openspec-apply-change\` Skill with \`<change-id>\`; never pass the \`/opsx:apply\` alias to a Skill tool and never edit the external skill.
    Claude may use native Skill dispatch; Codex uses an available projected \`openspec-apply-change\` skill.
    If no such skill is available, record \`UNAVAILABLE\`, keep \`consuming\` recoverable, and stop with one resume command.`,
    'Resume external apply',
  );
  assertWholeInstruction(
    docs.resume,
    `7. **Archive only after success.** After successful completion, set \`consumed\` and move \`latest.md\` to a timestamped \`consumed-*.md\` beside it.
    Never delete the handoff. If apply did not complete, keep \`latest.md\` in \`consuming\` state.`,
    'Resume handoff archive',
  );
  assertWholeInstruction(
    docs.save,
    `4. **Optional memory provider.** If the package-local observation provider is available, build one JSON payload from the compact fields and launch its post non-blocking.
    Collect the result before the handoff write. Record an integer \`claude_mem_obs_id\` or \`null\`; either is valid.
    Codex may use a native provider or the package-local helper, but never requires Claude-mem.`,
    'Save optional provider',
  );
  assertWholeInstruction(
    docs.observe,
    `bash "$SKILL_DIR/scripts/post-obs.sh" "$OBS_PAYLOAD_FILE" > "$OBS_RESULT_FILE" &`,
    'Observation launch',
  );
  assertWholeInstruction(
    docs.observe,
    'Never block the Save Phase on this step — always launch with `&`',
    'Observation non-blocking rule',
  );
  assertWholeInstruction(
    docs.observe,
    '`OBS_PID=null` and `CLAUDE_MEM_OBS_ID=null` are both valid outcomes; the handoff file accepts null without error',
    'Observation null outcome',
  );
});

function skillMarkdownFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Execution bundles are synchronized plugin-policy copies, not entries.
      if (entry.name !== 'execution-bundle') files.push(...skillMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

const FORBIDDEN_PLUGIN_ROOT_SCRIPT_PATH = /(?:\$\{(?:env:)?CLAUDE_PLUGIN_ROOT\}|\$(?:env:)?CLAUDE_PLUGIN_ROOT|%CLAUDE_PLUGIN_ROOT%|process\.env(?:\.CLAUDE_PLUGIN_ROOT|\[['"]CLAUDE_PLUGIN_ROOT['"]\])|os\.environ\[['"]CLAUDE_PLUGIN_ROOT['"]\]|os\.getenv\(['"]CLAUDE_PLUGIN_ROOT['"]\))(?:[\s"'()+,]|\\)*[\\/]?skills[\\/][^\\/\s`'"]+[\\/]scripts(?:[\\/][^\s`'"]*)?/g;

function forbiddenPluginRootScriptPaths(skillsRoot) {
  const offenders = [];
  for (const file of skillMarkdownFiles(skillsRoot)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      FORBIDDEN_PLUGIN_ROOT_SCRIPT_PATH.lastIndex = 0;
      if (FORBIDDEN_PLUGIN_ROOT_SCRIPT_PATH.test(line)) {
        offenders.push(`${path.relative(path.dirname(skillsRoot), file)}:${index + 1}`);
      }
    });
  }
  return offenders;
}

test('skill documents never resolve Skill scripts through CLAUDE_PLUGIN_ROOT', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk plugin root path fixture '));
  const fixtureSkills = path.join(fixtureRoot, 'skills');
  fs.mkdirSync(fixtureSkills);
  const fixture = path.join(fixtureSkills, 'alternate-root-spellings.md');
  const spellings = [
    '${CLAUDE_PLUGIN_ROOT}/skills/demo/scripts/run.sh',
    '$CLAUDE_PLUGIN_ROOT/skills/demo/scripts/run.sh',
    '$env:CLAUDE_PLUGIN_ROOT/skills/demo/scripts/run.sh',
    '${env:CLAUDE_PLUGIN_ROOT}/skills/demo/scripts/run.sh',
    '%CLAUDE_PLUGIN_ROOT%\\skills\\demo\\scripts\\run.bat',
    "process.env.CLAUDE_PLUGIN_ROOT + '/skills/demo/scripts/run.js'",
    "process.env['CLAUDE_PLUGIN_ROOT'] + '/skills/demo/scripts/run.js'",
    "os.environ['CLAUDE_PLUGIN_ROOT'] + '/skills/demo/scripts/run.sh'",
    "os.getenv('CLAUDE_PLUGIN_ROOT') + '/skills/demo/scripts/run.sh'",
  ];
  try {
    fs.writeFileSync(fixture, `${spellings.join('\n')}\n`);
    assert.deepStrictEqual(
      forbiddenPluginRootScriptPaths(fixtureSkills),
      spellings.map((_, index) => `skills/alternate-root-spellings.md:${index + 1}`),
      'the disposable fixture must detect each ambient-root syntax',
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }

  const offenders = forbiddenPluginRootScriptPaths(path.join(ROOT, 'skills'));
  assert.deepStrictEqual(offenders, [], `use "$SKILL_DIR/scripts/..." instead:\n${offenders.join('\n')}`);
});

// ---- Relocated codemap contract (source suite: skill-codemap-contract) ----
test('relocated codemap Skill retains its five literal output files and write boundary', () => {
  withIsolatedSkill({ source: path.join(ROOT, 'skills/update-codemaps') }, ({ skillDir }) => {
    const instructions = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const outputs = [...instructions.matchAll(/^\s*\| `([^`]+\.md)` \|/gm)].map((match) => match[1]);
    assert.deepStrictEqual(outputs, [
      'architecture.md', 'backend.md', 'frontend.md', 'data.md', 'dependencies.md',
    ]);
    assertWholeInstruction(instructions, '2. **Generate the five maps.** Create `$PROJECT_DIR/docs/CODEMAPS/` when absent, then create or update only these files:', 'Codemap output boundary');
    assert.ok(instructions.includes('$PROJECT_DIR/docs/CODEMAPS/'));
    assert.ok(instructions.includes('$PROJECT_DIR/.reports/codemap-diff.txt'));
    assert.match(instructions, /above 30% requires the user[’']s confirmation before overwrite/);
    assert.match(instructions.replace(/\s+/g, ' '), /generation date, scanned-file count, and estimated token count/);
    assert.doesNotMatch(instructions, /scripts\/codemaps\/generate\.ts/);
  });
});

// ---- Relocated dependency-audit contract (source suite: skill-dep-audit-contract) ----
// This checks written instructions; an independent Host review is not run here.
test('relocated dependency audit keeps a local independent review contract without a peer', () => {
  withIsolatedSkill({ source: path.join(ROOT, 'skills/dep-audit') }, ({ skillDir }) => {
    const entry = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const procedure = fs.readFileSync(path.join(skillDir, 'references/workflow.md'), 'utf8');
    assertWholeInstruction(
      entry,
      `Run the audit first. Only after a successful audit may explicit \`--fix\` run the matching fix command; no fix is implicit.
      Finish with the separate, read-only independent security evidence review defined in the local workflow. An available \`$change-verdict --mode security\` is an optional way to obtain that review; its installation is not required.
      The verdict may inspect the audit output, but it never runs a fixer and a successful \`--fix\` does not clear the original audit or prove a secure result.`,
      'Dependency audit execution boundary',
    );
    assertWholeInstruction(
      procedure,
      `2. Let \`$PROJECT_DIR\` denote the explicitly selected consumer project root. Check for \`$PROJECT_DIR/.claude/scripts/dep-audit.sh\`.
      If found, run \`bash "$PROJECT_DIR/.claude/scripts/dep-audit.sh" $ARGUMENTS\` from that project.
      This is consumer input, not a bundled Skill resource. A success owns the audit output; a failure is terminal and must not silently fall back.`,
      'Consumer script failure',
    );
    assertWholeInstruction(
      procedure,
      '4. Do not run a fix unless `--fix` was explicit and the audit completed. Keep the audit exit status and findings even if the fix command succeeds or fails. A fix is an operation result, not a verdict.',
      'Explicit fix permission',
    );
    assertWholeInstruction(
      procedure,
      `5. Obtain a separate read-only review from an independent security reviewer. An available \`$change-verdict --mode security\` may delegate this step; otherwise use the Host's independent reviewer capability with this local contract: inspect the recorded audit command, exit status, dependency findings and explicit fix result; report evidence-backed severity and affected dependencies; do not execute fixes, installs, or upgrades; do not infer clearance from fix success.
      Record \`READY\`, \`BLOCKED\`, or \`INCONCLUSIVE\` independently from the package-manager result.
      If neither route can supply an independent reviewer, return \`BLOCKED\` with \`INDEPENDENT_REVIEW_UNAVAILABLE\`. The auditing agent must not self-approve or substitute its own reread for that missing review.`,
      'Independent review and fail-closed result',
    );
    assertWholeInstruction(
      procedure,
      '6. Render the severity table and vulnerability details, then a Gate section: `PASS` only when the audit and required read-only evidence support it; `FAIL` for found vulnerabilities or command failure; `BLOCKED` for missing required evidence. A successful fix alone never changes this gate.',
      'Dependency audit verdict',
    );
  });
});

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

const policyDocuments = mappings['flow-drive'].filter(item => item.source.endsWith('.md')).map(item => item.source);

test('canonical policy binds the parent of rules without using the active Skill', () => {
  const result = inspectPolicyBundle(path.join(ROOT, 'rules/execution-policy.md'), policyDocuments);
  assert.strictEqual(result.bundleRoot, fs.realpathSync(ROOT));
  assert.ok(result.required.has('scripts/fast-worker-selector.js'));
  assert.ok(result.required.has('docs/subagent-prompt-template.md'));
});

for (const skill of ['flow-guide', 'flow-drive']) {
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

run('skill-runtime-path-contract');
