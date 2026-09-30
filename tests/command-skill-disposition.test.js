'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  commandSourceRevision,
  validateCommandSkillDispositions,
} = require('../scripts/lib/command-skill-disposition');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/command-skill-dispositions.json'), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));

const REMOVED_COMMAND_IDS = Object.freeze([
  'check-skill', 'create-dev', 'do', 'codex-review', 'codex-review-fast',
  'codex-review-branch', 'codex-review-doc', 'codex-security',
  'codex-test-review', 'review-spec',
]);

function copyManifest() {
  return JSON.parse(JSON.stringify(manifest));
}

function legacyManifest() {
  const candidate = copyManifest();
  candidate.schema = 'dhpk.command-skill-disposition.v2';
  candidate.commands = candidate.commands
    .filter((row) => /^commands\//.test(row.path))
    .map((row) => {
      const copy = { ...row };
      delete copy.resource;
      delete copy.forwarding;
      return copy;
    });
  candidate.source_revision = commandSourceRevision(ROOT, candidate.commands.map((row) => row.path));
  return candidate;
}

function validate(candidate) {
  return validateCommandSkillDispositions({
    manifest: candidate,
    root: ROOT,
    skillIds: inventory.skills.map((skill) => skill.id),
    skills: inventory.skills,
  });
}

test('all canonical commands have exactly one validated disposition', () => {
  const result = validate(manifest);
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(result.canonicalPaths.length, manifest.schema === 'dhpk.command-skill-disposition.v3' ? 32 : 31);
});

test('disposition validation rejects a missing canonical command', () => {
  const candidate = copyManifest();
  candidate.commands.pop();
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /missing command disposition/i.test(error)));
});

test('disposition validation rejects duplicate public names and conflicting owners', () => {
  const candidate = legacyManifest();
  candidate.commands[1].public_name = candidate.commands[0].public_name;
  candidate.commands[1].skill_owner = 'git-smart-commit';
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /public_name/i.test(error)) || result.errors.some((error) => /public name/i.test(error)));
  assert.ok(result.errors.some((error) => /conflicts/i.test(error)));
});

test('disposition validation rejects fabricated Consumer Evidence', () => {
  const candidate = copyManifest();
  candidate.commands[0].evidence.consumer = 'PASS';
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /consumer PASS|fabricated/i.test(error)));
});

test('disposition validation rejects a front door authority above its Skill owner', () => {
  const candidate = copyManifest();
  const row = candidate.commands.find((entry) => entry.skill_owner === 'git-smart-commit');
  row.authority = 'external-write';
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /authority exceeds Skill owner git-smart-commit maximum git-write/i.test(error)));
});

test('thin front doors preserve owner, authority, and argument contract parity', () => {
  const candidate = copyManifest();
  const guide = candidate.commands.find((entry) => entry.id === 'flow-guide');
  guide.argument_contract = '<route>';
  guide.authority = 'workspace-write';
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /argument_contract must match/i.test(error)));
  assert.ok(result.errors.some((error) => /authority must match Skill owner flow-guide/i.test(error)));
});

test('thin front doors identify one real Skill owner and Host-only rows explain themselves', () => {
  for (const row of manifest.commands.filter((entry) => entry.disposition === 'thin-front-door')) {
    assert.ok(row.skill_owner);
  }
  for (const row of manifest.commands.filter((entry) => entry.disposition === 'host-only' || entry.disposition === 'retired')) {
    assert.ok(row.reason);
  }
});

// RED contract for issue #534 P2.  The physical command inventory and the
// removed-name ledger are separate sets: historical command records remain
// useful for diagnostics but can never become executable discovery entries.
test('v2 command disposition keeps 31 active commands disjoint from the exact removed wave', () => {
  const legacy = legacyManifest();
  assert.strictEqual(legacy.schema, 'dhpk.command-skill-disposition.v2');
  assert.ok(Array.isArray(legacy.commands));
  assert.strictEqual(legacy.commands.length, 31);
  assert.ok(legacy.commands.every((row) => row.disposition !== 'retired' && row.outcome !== 'remove'));

  assert.ok(Array.isArray(legacy.removed_commands));
  assert.deepStrictEqual(legacy.removed_commands.map((row) => row.id).sort(), [...REMOVED_COMMAND_IDS].sort());
  assert.ok(legacy.removed_commands.every((row) => row.outcome === 'remove' || row.disposition === 'removed'));
  assert.ok(legacy.removed_commands.every((row) => Array.isArray(row.callers) && row.callers.length > 0));
  assert.ok(legacy.removed_commands.every((row) => row.evidence && typeof row.evidence === 'object'));
  assert.ok(typeof legacy.source_revision === 'string' && legacy.source_revision.startsWith('sha256:'));
  assert.ok(typeof legacy.removed_source_revision === 'string' && legacy.removed_source_revision.startsWith('sha256:'));

  const activeIds = new Set(legacy.commands.map((row) => row.id));
  assert.ok(legacy.removed_commands.every((row) => !activeIds.has(row.id)));
});

test('v2 command validation rejects an omitted removal and a present removed path', () => {
  const missing = legacyManifest();
  missing.removed_commands = (Array.isArray(missing.removed_commands)
    ? missing.removed_commands
    : REMOVED_COMMAND_IDS.map((id) => ({ id }))).slice(1);
  const missingResult = validate(missing);
  assert.ok(missingResult.errors.some((error) => /missing.*removed.*check-skill|check-skill.*missing/i.test(error)),
    `expected missing removed-command diagnostic, got:\n${missingResult.errors.join('\n')}`);

  const present = legacyManifest();
  present.commands.push({
    id: 'check-skill',
    path: 'commands/check-skill.md',
    host_surface: 'claude-command',
    public_name: '/dhpk:check-skill',
    argument_contract: '',
    authority: 'read-only',
    skill_owner: null,
    disposition: 'host-only',
    reason: 'test-only removed command resurrection',
    evidence: { structural: 'PASS', host_smoke: 'NOT_RUN', consumer: 'NOT_RUN' },
  });
  const presentResult = validate(present);
  assert.ok(presentResult.errors.some((error) => /check-skill.*removed|removed.*check-skill|retired.*path/i.test(error)),
    `expected removed-command resurrection diagnostic, got:\n${presentResult.errors.join('\n')}`);
});

{
  // F53 source block: command-skill-portability.test.js
  'use strict';

  // RED contract for the command disposition v3 cutover.  This suite stays at
  // the public disposition validator: it does not inspect private compiler data
  // or derive expected rows from the manifest under test.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const {
    removedCommandSourceRevision,
    validateCommandSkillDispositions,
  } = require('../scripts/lib/command-skill-disposition');

  const ROOT = path.join(__dirname, '..');
  const CURRENT_MANIFEST = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'command-skill-dispositions.json'),
    'utf8',
  ));

  const ROOT_COMMAND_IDS = Object.freeze([
    'check-coverage',
    'codex-test-gen',
    'create-pr',
    'create-release',
    'deep-analyze',
    'dep-audit',
    'doc-refactor',
    'flow-drive',
    'flow-guide',
    'git-worktree',
    'harness-audit',
    'harness-govern',
    'install-hooks',
    'install-rules',
    'install-scripts',
    'matrix-cell-onboard',
    'merge-prep',
    'opsx-apply-resume',
    'pr-summary',
    'precommit-fast',
    'precommit',
    'project-brief',
    'review-pending',
    'setup',
    'simplify',
    'smart-commit',
    'spec-mine',
    'ui-ux-verify',
    'update-codemaps',
    'update-docs',
    'verify',
  ]);

  const REMOVED_COMMAND_IDS = Object.freeze([
    'check-skill',
    'create-dev',
    'do',
    'codex-review',
    'codex-review-fast',
    'codex-review-branch',
    'codex-review-doc',
    'codex-security',
    'codex-test-review',
    'review-spec',
  ]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function evidence() {
    return { structural: 'PASS', host_smoke: 'NOT_RUN', consumer: 'NOT_RUN' };
  }

  function removedRows() {
    return REMOVED_COMMAND_IDS.map((id) => ({
      id,
      path: `commands/${id}.md`,
      public_name: `/dhpk:${id}`,
      outcome: 'remove',
      disposition: 'removed',
      successor: { kind: 'command', id: 'migration-note' },
      reason: 'retained only as migration evidence',
      callers: ['commands/create-pr.md'],
      evidence: evidence(),
    }));
  }

  function commandRow(id, overrides = {}) {
    return {
      id,
      path: `commands/${id}.md`,
      host_surface: 'claude-command',
      public_name: `/dhpk:${id}`,
      argument_contract: '',
      authority: 'read-only',
      skill_owner: null,
      outcome: 'retain',
      disposition: 'host-only',
      reason: 'Host-specific command boundary',
      callers: [`commands/${id}.md`],
      evidence: evidence(),
      ...overrides,
    };
  }

  function ownerSkill() {
    return {
      id: 'shared-owner',
      name: 'shared-owner',
      path: 'skills/shared-owner',
      usage: {
        display_name: 'Shared command owner',
        summary: 'Expose one owner contract to several Host commands',
        syntax: '$shared-owner <task>',
        input_kind: 'free-text',
        invocation_class: 'explicit-only',
        effect_authority: 'external-write',
        inputs: [{ id: 'task', syntax: '<task>', value_kind: 'string', required: true, summary: 'Task to execute' }],
        actions: [
          {
            id: 'inspect',
            summary: 'Inspect the requested task without changing it',
            syntax: '$shared-owner inspect',
            input_kind: 'none',
            effect_authority: 'read-only',
          },
          {
            id: 'publish',
            summary: 'Publish the requested task through the owner',
            syntax: '$shared-owner publish',
            input_kind: 'none',
            effect_authority: 'external-write',
          },
        ],
        options: [],
        examples: [{ prompt: '$shared-owner inspect', summary: 'Inspect a task' }],
      },
    };
  }

  function v3Manifest() {
    const commands = ROOT_COMMAND_IDS.map((id) => commandRow(id));
    commands[2] = commandRow('create-pr', {
      authority: 'external-write',
      skill_owner: 'shared-owner',
      disposition: 'thin-front-door',
      resource: 'skills/shared-owner/SKILL.md',
      forwarding: { action: 'publish', prepend_args: ['--draft'] },
    });
    commands[3] = commandRow('create-release', {
      authority: 'external-write',
      skill_owner: 'shared-owner',
      disposition: 'existing-skill-owner',
      resource: 'skills/shared-owner/SKILL.md',
    });
    commands[18] = commandRow('pr-summary', {
      authority: 'read-only',
      skill_owner: 'shared-owner',
      disposition: 'thin-front-door',
      resource: 'skills/shared-owner/SKILL.md',
      forwarding: { action: 'inspect', prepend_args: ['--summary'] },
    });
    commands.push(commandRow('ts-check-status', {
      path: 'modules/js/commands/ts-check-status.md',
      public_name: '/dhpk:ts-check-status',
      authority: 'read-only',
      skill_owner: 'shared-owner',
      disposition: 'thin-front-door',
      resource: 'skills/shared-owner/SKILL.md',
      forwarding: { action: 'inspect', prepend_args: ['--path', 'js/'] },
      callers: ['modules/js/commands/ts-check-status.md'],
    }));
    const removed = removedRows();
    return {
      schema: 'dhpk.command-skill-disposition.v3',
      commands,
      removed_commands: removed,
      removed_source_revision: removedCommandSourceRevision(removed),
    };
  }

  function validate(manifest) {
    return validateCommandSkillDispositions({
      manifest,
      root: ROOT,
      skillIds: ['shared-owner'],
      skills: [ownerSkill()],
    });
  }

  function physicalCommandInventory(root) {
    const rootCommands = path.join(root, 'commands');
    const rootIds = fs.readdirSync(rootCommands, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md')
      .map((entry) => entry.name.slice(0, -3))
      .sort();
    const modulePaths = [];
    const modulesRoot = path.join(root, 'modules');
    if (fs.existsSync(modulesRoot)) {
      for (const moduleEntry of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
        if (!moduleEntry.isDirectory()) continue;
        const commandDirectory = path.join(modulesRoot, moduleEntry.name, 'commands');
        if (!fs.existsSync(commandDirectory)) continue;
        for (const commandEntry of fs.readdirSync(commandDirectory, { withFileTypes: true })) {
          if (commandEntry.isFile() && commandEntry.name.endsWith('.md') && commandEntry.name !== 'INDEX.md') {
            modulePaths.push(path.posix.join('modules', moduleEntry.name, 'commands', commandEntry.name));
          }
        }
      }
    }
    return { rootIds, modulePaths: modulePaths.sort() };
  }

  test('v3 enumerates all 31 root commands plus the module ts-check-status command', () => {
    // The default path is the real repository. DHPK_COMMAND_SCAN_ROOT is used
    // only by a disposable command-addition mutation; the production validator
    // below continues to use ROOT.
    const scanRoot = process.env.DHPK_COMMAND_SCAN_ROOT || ROOT;
    const physical = physicalCommandInventory(scanRoot);
    assert.strictEqual(physical.rootIds.length, 31);
    assert.deepStrictEqual(physical.rootIds, [...ROOT_COMMAND_IDS].sort(),
      'the physical root command files must match the independent literal ID set');
    assert.deepStrictEqual(physical.modulePaths, ['modules/js/commands/ts-check-status.md'],
      'the physical module command inventory must retain ts-check-status');

    const manifest = v3Manifest();
    assert.strictEqual(manifest.commands.length, 32);
    const result = validate(manifest);
    assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
    assert.strictEqual(result.canonicalPaths.length, 32);
  });

  test('v3 allows several command rows to share one Skill owner', () => {
    const expectedSharedOwners = [
      { owner: 'harness-setup', commandIds: ['install-hooks', 'install-rules', 'install-scripts', 'setup'] },
      { owner: 'precommit', commandIds: ['precommit', 'precommit-fast'] },
    ];
    for (const group of expectedSharedOwners) {
      const commandIds = CURRENT_MANIFEST.commands
        .filter((row) => row.skill_owner === group.owner)
        .map((row) => row.id)
        .sort();
      assert.deepStrictEqual(commandIds, [...group.commandIds].sort(),
        `the checked-in manifest must retain the real shared owner ${group.owner}`);
    }

    const result = validateCommandSkillDispositions({
      manifest: CURRENT_MANIFEST,
      root: ROOT,
      skillIds: INVENTORY_SKILL_IDS,
      skills: INVENTORY_SKILLS,
    });
    assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  });

  test('forwarding action authority cannot be broader than the selected owner action', () => {
    const manifest = v3Manifest();
    const row = manifest.commands.find((candidate) => candidate.id === 'pr-summary');
    row.forwarding.action = 'publish';
    const result = validate(manifest);
    assert.ok(result.errors.some((error) => /selected action|action.*authority|authority.*action/i.test(error)), result.errors.join('\n'));
  });

  test('forwarding rows require an owner and a readable Skill resource', () => {
    const manifest = v3Manifest();
    const row = manifest.commands.find((candidate) => candidate.id === 'create-pr');
    row.skill_owner = null;
    row.resource = '';
    const result = validate(manifest);
    assert.ok(result.errors.some((error) => /skill_owner|owner/i.test(error)), result.errors.join('\n'));
    assert.ok(result.errors.some((error) => /resource.*(required|non-empty|path|readable|missing)/i.test(error)), result.errors.join('\n'));
  });

  test('legacy v2 command dispositions remain readable during the v3 migration', () => {
    const legacy = clone(CURRENT_MANIFEST);
    legacy.schema = 'dhpk.command-skill-disposition.v2';
    delete legacy.source_revision;
    legacy.commands = legacy.commands
      .filter((row) => /^commands\//.test(row.path))
      .map((row) => {
        const copy = { ...row };
        delete copy.resource;
        delete copy.forwarding;
        return copy;
      });
    const result = validateCommandSkillDispositions({
      manifest: legacy,
      root: ROOT,
      skillIds: INVENTORY_SKILL_IDS,
      skills: INVENTORY_SKILLS,
    });
    assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  });

  const INVENTORY = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    'utf8',
  ));
  const INVENTORY_SKILLS = INVENTORY.skills;
  const INVENTORY_SKILL_IDS = INVENTORY_SKILLS.map((skill) => skill.id);
}

{
  // F53 source block: command-front-door-parity.test.js
  'use strict';

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const { extract } = require('../scripts/ci/_lib/frontmatter');

  const ROOT = path.join(__dirname, '..');

  function read(name) {
    return fs.readFileSync(path.join(ROOT, 'commands', name + '.md'), 'utf8');
  }

  test('approved short flow front doors preserve canonical identity and invocation class', () => {
    const guide = read('flow-guide');
    const drive = read('flow-drive');
    assert.match(guide, /canonical `\$flow-guide` Skill/);
    assert.match(drive, /canonical `\$flow-drive` Skill/);
    assert.match(drive, /--worker-target=<provider>\/\<model>\[:<effort>\]/);
    assert.doesNotMatch(guide, /^(?:procedure|workflow steps|target authority)\s*$/im);
    assert.match(drive, /does not add a mode, route selection, proposal authoring/);
    assert.strictEqual(extract(guide).values['metadata.dhpk-invocation-class'] || 'implicit-eligible', 'implicit-eligible');
    assert.match(drive, /dhpk-invocation-class: explicit-only/);
    assert.match(drive, /disable-model-invocation: true/);
  });

  test('short front doors have no competing Usage Grammar', () => {
    for (const name of ['flow-guide', 'flow-drive']) {
      const text = read(name);
      assert.strictEqual((text.match(/argument-hint:/g) || []).length, 1);
      assert.match(text, /Forward[\s\S]*(?:arguments|options) unchanged/i);
      assert.match(text, /second\s+(?:usage\s+)?grammar/i);
    }
  });

  test('precommit and precommit-fast preserve forwarding authority and mode arguments', () => {
    const precommit = read('precommit');
    const fast = read('precommit-fast');
    assert.match(precommit, /argument-hint:\s*'\[--fast\]'/);
    assert.match(precommit, /Forward `\[--fast\]` unchanged to the\s+canonical `\$precommit` Skill/);
    assert.match(precommit, /metadata:\s*\n\s+dhpk-invocation-class: implicit-eligible/);
    assert.doesNotMatch(precommit, /scripts\/precommit-runner\.js|scripts\/verify-runner\.js/);

    assert.match(fast, /deprecated forwarding alias/i);
    assert.match(fast, /\$precommit --fast \$ARGUMENTS/);
    assert.match(fast, /metadata:\s*\n\s+dhpk-invocation-class: explicit-only/);
    assert.doesNotMatch(fast, /scripts\/precommit-runner\.js|scripts\/verify-runner\.js/);
  });

  test('verify preserves public authority and forwards optional integration/e2e arguments unchanged', () => {
    const verify = read('verify');
    assert.match(verify, /argument-hint:\s*'\[fast\|full\] \[--integration <path>\] \[--e2e <path>\]'/);
    assert.match(verify, /Forward `\[fast\|full\] \[--integration <path>\] \[--e2e <path>\]` unchanged to the\s+canonical `\$repo-verify` Skill/);
    assert.match(verify, /metadata:\s*\n\s+dhpk-invocation-class: implicit-eligible/);
    assert.match(verify, /public command remains `\/dhpk:verify`/);
    assert.doesNotMatch(verify, /scripts\/precommit-runner\.js|scripts\/verify-runner\.js/);
  });

  test('pilot Skill procedures retain package-local runner ownership and the new repo-verify install path', () => {
    const precommitSkill = fs.readFileSync(path.join(ROOT, 'skills', 'precommit', 'SKILL.md'), 'utf8');
    const precommitReference = fs.readFileSync(path.join(ROOT, 'skills', 'precommit', 'references', 'workflow.md'), 'utf8');
    const repoVerifySkill = fs.readFileSync(path.join(ROOT, 'skills', 'repo-verify', 'SKILL.md'), 'utf8');
    const repoVerifyReference = fs.readFileSync(path.join(ROOT, 'skills', 'repo-verify', 'references', 'workflow.md'), 'utf8');

    for (const text of [precommitSkill, precommitReference]) {
      assert.match(text, /\$SKILL_DIR\/scripts\/precommit-runner\.js/);
    }
    for (const text of [repoVerifySkill, repoVerifyReference]) {
      assert.match(text, /\.claude\/dhpk\/skills\/repo-verify\/scripts\/verify-runner\.js/);
      assert.doesNotMatch(text, /\.claude\/scripts\/verify-runner\.js/);
    }
  });

  function commandFiles() {
    const roots = [path.join(ROOT, 'commands')];
    for (const moduleName of fs.readdirSync(path.join(ROOT, 'modules'))) {
      const dir = path.join(ROOT, 'modules', moduleName, 'commands');
      if (fs.existsSync(dir)) roots.push(dir);
    }
    return roots.flatMap(dir => fs.readdirSync(dir)
      .filter(name => name.endsWith('.md') && name !== 'INDEX.md')
      .map(name => path.join(dir, name)));
  }

  test('every command front door states its non-use boundary before completion', () => {
    // docs/agent-guidance/command-contract.md: "State the trigger and nearest
    // non-use boundary before detailed mechanics."
    const offenders = [];
    for (const file of commandFiles()) {
      const body = fs.readFileSync(file, 'utf8');
      const boundary = body.search(/^Not for: \S/m);
      const completion = body.search(/^Completion:/m);
      if (boundary < 0 || (completion >= 0 && boundary > completion)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    assert.deepStrictEqual(offenders, [], `missing "Not for:" boundary:\n${offenders.join('\n')}`);
  });
}

{
  // F53 source block: simplify-command-contract.test.js
  'use strict';

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const COMMAND = path.join(ROOT, 'commands', 'simplify.md');
  const REFACTOR_CLEANER = path.join(ROOT, 'agents', 'refactor-cleaner.md');
  const SKILL = path.join(ROOT, 'skills', 'code-simplify', 'SKILL.md');

  function commandText() {
    return fs.readFileSync(COMMAND, 'utf8');
  }

  // The command is a thin front door; the cleanup procedure lives in the
  // canonical `$code-simplify` Skill, so behavior contracts are asserted there.
  function skillText() {
    return fs.readFileSync(SKILL, 'utf8');
  }

  function withoutFrontmatter(text) {
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
  }

  test('simplify command forwards unchanged to the canonical Skill without duplicating the procedure', () => {
    const body = commandText();

    assert.match(body, /\$code-simplify/);
    assert.match(body, /\$ARGUMENTS` unchanged/);
    assert.match(body, /allowed-tools:.*\bBash\b/);
    assert.doesNotMatch(body, /git merge-base|### Reuse|\| Reuse \|/);
  });

  test('simplify defaults to the current diff and preserves explicit target overrides', () => {
    const body = skillText();

    assert.match(body, /explicit target always wins/i);
    assert.match(body, /gh pr diff "\$ARGUMENTS"/);
    assert.match(body, /git merge-base <target> <base>/);
    assert.match(body, /git diff HEAD -- "\$ARGUMENTS"/);
    assert.match(body, /file\/directory: review its full contents/i);
    assert.match(body, /never fall back to the current branch for an\s+invalid explicit target/i);
    assert.match(body, /git diff @\{upstream\}\.\.\.HEAD/);
    assert.match(body, /git diff main\.\.\.HEAD/);
    assert.match(body, /git diff HEAD~1/);
    assert.match(body, /git diff HEAD/);
    assert.match(body, /range is empty/i);
  });

  test('simplify dispatches four independent cleanup angles concurrently', () => {
    const body = skillText();

    assert.match(body, /four independent workers concurrently/i);
    assert.match(body, /exactly one angle each/i);
    for (const angle of ['Reuse', 'Simplification', 'Efficiency', 'Altitude']) {
      assert.match(body, new RegExp(`^\\s*\\| ${angle} \\|`, 'm'));
    }
    assert.match(body, /`file`.*`line`.*summary.*concrete cost/is);
  });

  test('simplify degrades honestly and applies only behavior-preserving findings', () => {
    const body = skillText();

    assert.match(body, /fan-out is unavailable/i);
    assert.match(body, /If fan-out is unavailable, the current worker is\s+nested, or one reviewer fails, perform only the missing angles inline and\s+mark the result degraded\./i);
    assert.match(body, /degraded:/);
    assert.match(body, /single-pass review, not\s+the four-worker fan-out/is);
    assert.match(body, /Deduplicate findings at the same line or mechanism/i);
    assert.match(body, /change intended behavior/i);
    assert.match(body, /out-of-scope files/i);
    assert.match(body, /false\s+positives/i);
  });

  test('simplify preserves test gates, heavy-cleanup escalation, and deletion safety', () => {
    const body = skillText();
    const cleaner = fs.readFileSync(REFACTOR_CLEANER, 'utf8');

    assert.match(body, /allowed-tools:.*\bBash\b/);
    assert.doesNotMatch(body, /Bash\(TEST_ENV=unit npx jest/);
    assert.match(body, /exact baseline test command/i);
    assert.match(body, /A file over 800 lines, cross-file\s+deduplication, or a multi-module dead-code sweep needs a documented scoped\s+process\./i);
    assert.match(body, /registered `worker` or `architect` roles/);
    assert.match(body, /Never\s+substitute an unregistered role/i);
    assert.match(cleaner, /Delete only with proof/i);
    assert.match(cleaner, /dynamic-dispatch.*reflection.*DI/i);
    assert.match(cleaner, /deprecation path/i);
    assert.match(cleaner, /small batches/i);
  });

  test('simplify reports execution mode, applied and skipped findings, and both test results', () => {
    const body = skillText();

    assert.match(body, /Execution Mode/);
    assert.match(body, /### Applied/);
    assert.match(body, /### Skipped/);
    assert.match(body, /Baseline:/);
    assert.match(body, /Final:/);
  });

  test('simplify command is synchronized across Cursor and generated Claude surfaces', () => {
    const canonical = commandText();
    const canonicalBody = withoutFrontmatter(canonical);
    const cursorCopies = [
      'cursor/commands/simplify.md',
      'plugins/dhpk-cursor/commands/simplify.md',
    ];
    const claudeCopies = [
      'generated/claude-marketplace/package/commands/simplify.md',
      'generated/claude-profiles/full/package/commands/simplify.md',
      'generated/claude-profiles/compat-v1/package/commands/simplify.md',
    ];

    for (const relative of cursorCopies) {
      // Cursor projections rewrite repository-relative links to canonical URLs.
      const projected = fs.readFileSync(path.join(ROOT, relative), 'utf8')
        .replaceAll('](https://github.com/hmj1026/dhpk/blob/main/', '](../');
      assert.strictEqual(withoutFrontmatter(projected), canonicalBody, `${relative} body drifted`);
    }
    for (const relative of claudeCopies) {
      const projected = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      assert.strictEqual(projected, canonical, `${relative} drifted`);
    }
  });
}

{
  // F53 source block: command-namespace.test.js
  'use strict';

  // Unit contract for the Skill-local command namespace helper. Keep loading
  // inside the test boundary so a missing authoring module is reported as RED
  // assertions rather than aborting the whole test process during require().

  const { test, assert } = require('./_lib/tinytest');

  let namespace;
  let loadError;
  try {
    namespace = require('../scripts/lib/command-namespace');
  } catch (error) {
    loadError = error;
  }

  function moduleUnderTest() {
    assert.ifError(loadError);
    return namespace;
  }

  test('command namespace exports the approved dhpk constant and qualifier', () => {
    const helper = moduleUnderTest();
    assert.strictEqual(helper.COMMAND_NAMESPACE, 'dhpk');
    assert.strictEqual(typeof helper.qualifyCommand, 'function');
  });

  test('qualifyCommand prefixes an unqualified slash command exactly once', () => {
    assert.strictEqual(moduleUnderTest().qualifyCommand('/update-docs'), '/dhpk:update-docs');
  });

  test('qualifyCommand leaves an already dhpk-qualified command unchanged', () => {
    const command = '/dhpk:update-docs';
    assert.strictEqual(moduleUnderTest().qualifyCommand(command), command);
  });

  test('qualifyCommand leaves dollar, non-command, and empty values unchanged', () => {
    const qualify = moduleUnderTest().qualifyCommand;
    assert.strictEqual(qualify('$change-verdict --mode code'), '$change-verdict --mode code');
    assert.strictEqual(qualify('update-docs'), 'update-docs');
    assert.strictEqual(qualify(''), '');
  });

  test('other slash namespaces retain the current utils prefix behavior', () => {
    const command = '/other:update-docs';
    const expected = '/dhpk:other:update-docs';
    assert.strictEqual(moduleUnderTest().qualifyCommand(command), expected);
  });
}

run('command-skill-disposition');
