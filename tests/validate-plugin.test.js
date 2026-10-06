'use strict';

// Behavioral guards for the plugin, command, and module validators: declared
// plugin paths must resolve, command aliases must match their live invocation
// policy, and module metadata must satisfy structural boundaries.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-plugin-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

function writePluginJson(tmp, plugin) {
  const dir = path.join(tmp, '.claude-plugin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(plugin, null, 2));
}

function runValidator(tmp) {
  const res = spawnSync('node', [path.join(tmp, 'scripts', 'ci', 'validate-plugin.js')], {
    encoding: 'utf8',
  });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('real repo plugin.json passes validation', () => {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-plugin.js')], {
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, `expected real repo to pass, got:\n${res.stdout}${res.stderr}`);
});

test('missing plugin.json fails', () => {
  const tmp = makeTempRepo();
  try {
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /plugin\.json not found/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('invalid JSON fails', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), '{ not valid json');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /invalid JSON/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing agents[] file fails', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', agents: ['agents/ghost.md'] });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /agents\[\] — missing file: agents\/ghost\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing skills[] directory fails', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', skills: ['skills/ghost'] });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /skills\[\] — missing directory: skills\/ghost/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing commands[] path fails', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', commands: ['commands/ghost.md'] });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /commands\[\] — missing path: commands\/ghost\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('non-semver version warns but does not fail (non-strict)', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: 'not-a-version' });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /is not semver/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an unregistered on-disk agent file fails (reverse check)', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', agents: [] });
    fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'agents', 'stray.md'), '# stray agent\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /unregistered agent file on disk: agents\/stray\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a fully self-consistent minimal plugin passes', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'agents', 'a.md'), '# a\n');
    fs.mkdirSync(path.join(tmp, 'skills', 's'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'skills', 's', 'SKILL.md'), '# s\n');
    fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'commands', 'c.md'), '# c\n');
    writePluginJson(tmp, {
      version: '1.0.0',
      agents: ['agents/a.md'],
      skills: ['skills/s'],
      commands: ['commands/c.md'],
    });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0, out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Consolidated from tests/validate-commands.test.js; test registrations remain isolated in this lexical block.
{
  // Behavioral guard for scripts/ci/validate-commands.js: every commands/*.md
  // needs frontmatter with a non-empty 'description'; INDEX.md is exempt.
  // Runs the real script (ROOT is __dirname-relative, so we spawn a copy of
  // scripts/ + commands/ inside a temp dir rather than pass a path argument).

  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  function makeTempRepo() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-commands-'));
    fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
    return tmp;
  }

  function writeCommand(tmp, name, content) {
    const dir = path.join(tmp, 'commands');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }

  function runValidator(tmp) {
    const res = spawnSync('node', [path.join(tmp, 'scripts', 'ci', 'validate-commands.js')], {
      encoding: 'utf8',
    });
    return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
  }

  test('real repo commands/ pass validation', () => {
    const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-commands.js')], {
      encoding: 'utf8',
    });
    assert.strictEqual(res.status, 0, `expected real repo to pass, got:\n${res.stdout}${res.stderr}`);
  });

  test('no commands/ directory — exits 0 (skip)', () => {
    const tmp = makeTempRepo();
    try {
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 0);
      assert.match(out, /skipping/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a command file with no frontmatter fails', () => {
    const tmp = makeTempRepo();
    try {
      writeCommand(tmp, 'broken.md', '# no frontmatter here\n');
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 1);
      assert.match(out, /missing frontmatter/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a command file with empty description fails', () => {
    const tmp = makeTempRepo();
    try {
      writeCommand(tmp, 'empty-desc.md', "---\ndescription: ''\n---\nbody\n");
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 1);
      assert.match(out, /missing\/empty 'description'/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('duplicate frontmatter keys fail', () => {
    const tmp = makeTempRepo();
    try {
      writeCommand(tmp, 'dupe.md', '---\ndescription: a\ndescription: b\n---\nbody\n');
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 1);
      assert.match(out, /duplicate frontmatter keys/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('INDEX.md is skipped even when malformed', () => {
    const tmp = makeTempRepo();
    try {
      writeCommand(tmp, 'INDEX.md', '# no frontmatter, should be ignored\n');
      writeCommand(tmp, 'valid.md', "---\ndescription: does a thing\n---\nbody\n");
      const { status } = runValidator(tmp);
      assert.strictEqual(status, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a well-formed command file passes', () => {
    const tmp = makeTempRepo();
    try {
      writeCommand(tmp, 'valid.md', "---\ndescription: does a thing\n---\nbody\n");
      const { status } = runValidator(tmp);
      assert.strictEqual(status, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('canonical commands retire the approved aliases and retain supported adapters', () => {
    const read = (name) => fs.readFileSync(path.join(ROOT, 'commands', name), 'utf8');
    assert.match(read('precommit.md'), /--fast/);
    assert.match(read('setup.md'), /--install hooks\|rules\|scripts\|all/);

    for (const name of [
      'check-skill.md', 'create-dev.md', 'do.md', 'codex-review.md',
      'codex-review-fast.md', 'codex-review-branch.md', 'codex-review-doc.md',
      'codex-security.md', 'codex-test-review.md', 'review-spec.md',
    ]) assert.ok(!fs.existsSync(path.join(ROOT, 'commands', name)), `${name} must be retired without an alias`);

    for (const name of [
      'precommit-fast.md', 'install-hooks.md', 'install-rules.md',
      'install-scripts.md', 'check-coverage.md', 'codex-test-gen.md',
    ]) {
      assert.ok(!fs.existsSync(path.join(ROOT, 'commands', name)), `${name} must be retired`);
    }
    assert.ok(!fs.existsSync(path.join(ROOT, 'commands', 'zh-tw.md')), 'zh-tw must be retired');
  });

  test('flow-guide routing, flow-drive implementation, and setup installation have deterministic executable contracts', () => {
    const guide = fs.readFileSync(path.join(ROOT, 'skills', 'flow-guide', 'SKILL.md'), 'utf8');
    const drive = fs.readFileSync(path.join(ROOT, 'skills', 'flow-drive', 'SKILL.md'), 'utf8');
    const setup = fs.readFileSync(path.join(ROOT, 'commands', 'setup.md'), 'utf8');
    const setupProcedure = fs.readFileSync(path.join(ROOT, 'skills', 'harness-setup', 'references', 'claude-setup.md'), 'utf8');
    assert.match(guide, /route --go/);
    assert.match(guide, /advisory|does not execute|without `--go`/i);
    assert.match(drive, /confirmed specification|confirmed work/i);
    assert.doesNotMatch(drive, /--route-only|flow-drive:author/);
    assert.match(setup, /canonical `\$harness-setup` Skill/);
    assert.match(setupProcedure, /scripts\/setup\/install-assets\.sh/);
    assert.match(setupProcedure, /--source.*--target.*--dry-run.*--force/is);
    assert.match(setup, /Bash\(bash:\*\).*Bash\(mkdir:\*\).*Bash\(cp:\*\).*Bash\(chmod:\*\)/);
  });


    const RETIRED_COMMANDS = ['do', 'zh-tw'];
    const FORWARDING_COMMANDS = [
      'precommit-fast', 'install-hooks', 'install-rules', 'install-scripts',
      'check-coverage', 'codex-test-gen',
    ];

    function assertCurrentCommandSurface(commandsDir, inventory) {
      const currentNames = new Set(fs.readdirSync(commandsDir)
        .filter((name) => name.endsWith('.md') && name !== 'INDEX.md')
        .map((name) => name.slice(0, -3)));
      const historicalNames = new Set(inventory.commands.map((entry) => entry.name));

      assert.ok(historicalNames.has('do'), 'historical inventory should identify the retired do alias');
      for (const name of FORWARDING_COMMANDS) {
        assert.ok(historicalNames.has(name), `historical inventory should retain ${name}`);
      }
      for (const name of RETIRED_COMMANDS) {
        assert.ok(!currentNames.has(name), `commands/${name}.md must remain retired`);
      }
      for (const name of FORWARDING_COMMANDS) {
        assert.ok(!currentNames.has(name), `commands/${name}.md must remain retired`);
      }
    }

    test('invocation inventory preserves history while current aliases remain retired', () => {
      const inventory = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'tests', 'fixtures', 'invocation-inventory-baseline.json'), 'utf8'
      ));
      const commandsDir = process.env.DHPK_789_COMMANDS_DIR || path.join(ROOT, 'commands');
      assertCurrentCommandSurface(commandsDir, inventory);

      const tmp = makeTempRepo();
      try {
        const mutatedCommands = path.join(tmp, 'commands');
        fs.cpSync(commandsDir, mutatedCommands, { recursive: true });
        fs.writeFileSync(path.join(mutatedCommands, 'do.md'), '---\ndescription: retired alias mutation\n---\nbody\n');
        const structurallyValid = runValidator(tmp);
        assert.strictEqual(structurallyValid.status, 0, structurallyValid.out);
      assert.throws(
        () => assertCurrentCommandSurface(mutatedCommands, inventory),
        /commands\/do\.md must remain retired/
      );
      fs.rmSync(path.join(mutatedCommands, 'do.md'));

      fs.writeFileSync(path.join(mutatedCommands, 'install-hooks.md'), '---\ndescription: retired installation alias\n---\nbody\n');
      assert.throws(
        () => assertCurrentCommandSurface(mutatedCommands, inventory),
        /install-hooks\.md must remain retired/
      );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });


}


// Consolidated from tests/validate-modules.test.js; test registrations remain isolated in this lexical block.
{
  // Behavioral guard for scripts/ci/validate-modules.js: module.yaml structural
  // checks (name matches directory, requires[] resolves) and the softer
  // warnings (version/description/triggers, provides.skills resolution).

  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  function makeTempRepo() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-modules-'));
    fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
    return tmp;
  }

  function writeModule(tmp, id, yaml) {
    const dir = path.join(tmp, 'modules', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'module.yaml'), yaml);
  }

  function runValidator(tmp, extraArgs = []) {
    const res = spawnSync(
      'node',
      [path.join(tmp, 'scripts', 'ci', 'validate-modules.js'), ...extraArgs],
      { encoding: 'utf8' }
    );
    return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
  }

  test('real repo modules/ pass validation', () => {
    const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-modules.js')], {
      encoding: 'utf8',
    });
    assert.strictEqual(res.status, 0, `expected real repo to pass, got:\n${res.stdout}${res.stderr}`);
  });

  test('no modules/ directory — exits 0 (skip)', () => {
    const tmp = makeTempRepo();
    try {
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 0);
      assert.match(out, /skipping/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('module directory missing module.yaml fails', () => {
    const tmp = makeTempRepo();
    try {
      fs.mkdirSync(path.join(tmp, 'modules', 'ghost'), { recursive: true });
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 1);
      assert.match(out, /missing module\.yaml/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('name mismatched with directory fails', () => {
    const tmp = makeTempRepo();
    try {
      writeModule(tmp, 'foo', 'name: bar\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\n');
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 1);
      assert.match(out, /name 'bar' != directory 'foo'/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('requires[] pointing at a non-existent module fails', () => {
    const tmp = makeTempRepo();
    try {
      writeModule(
        tmp,
        'foo',
        "name: foo\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\nrequires: [nonexistent-module]\n"
      );
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 1);
      assert.match(out, /requires non-existent module 'nonexistent-module'/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('requires[] pointing at an existing module passes', () => {
    const tmp = makeTempRepo();
    try {
      writeModule(tmp, 'base', 'name: base\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\n');
      writeModule(
        tmp,
        'foo',
        'name: foo\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\nrequires: [base]\n'
      );
      const { status } = runValidator(tmp);
      assert.strictEqual(status, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('missing version/description warn but do not fail (non-strict)', () => {
    const tmp = makeTempRepo();
    try {
      writeModule(tmp, 'foo', 'name: foo\ntriggers:\n  - x\n');
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 0);
      assert.match(out, /missing 'version'/);
      assert.match(out, /missing 'description'/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('missing version/description fail under --strict', () => {
    const tmp = makeTempRepo();
    try {
      writeModule(tmp, 'foo', 'name: foo\ntriggers:\n  - x\n');
      const { status } = runValidator(tmp, ['--strict']);
      assert.strictEqual(status, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('provides.skills entry with no resolvable SKILL.md warns', () => {
    const tmp = makeTempRepo();
    try {
      writeModule(
        tmp,
        'foo',
        'name: foo\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\nprovides:\n  skills: [nonexistent-skill]\n'
      );
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 0);
      assert.match(out, /provides skill 'nonexistent-skill' but no SKILL\.md found/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('module with no triggers and no provided skills warns (no-op module)', () => {
    const tmp = makeTempRepo();
    try {
      writeModule(tmp, 'foo', 'name: foo\nversion: 1.0.0\ndescription: x\n');
      const { status, out } = runValidator(tmp);
      assert.strictEqual(status, 0);
      assert.match(out, /no 'triggers' and no provided skills/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

run('validate-plugin');
