'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'skills', 'skill-scope', 'scripts');
const SCAN = path.join(SCRIPTS, 'scan.sh');
const QUICK_DIFF = path.join(SCRIPTS, 'quick-diff.sh');
const SAVE_RESULTS = path.join(SCRIPTS, 'save-results.sh');

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scope-stocktake-')));
}

function writeSkill(root, directory, name, description, mtime) {
  const file = path.join(root, directory, 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    '---',
    'name: ' + name,
    'description: ' + description,
    '---',
    '# ' + name,
    '',
  ].join('\n'));
  fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
}

function runShell(script, args, env, input, timeoutMs = 15000) {
  return spawnSync('bash', [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, ...env },
    input,
  });
}

function stocktakeEnv(globalDir, projectDir, observations) {
  return {
    HOME: path.dirname(path.dirname(globalDir)),
    SKILL_STOCKTAKE_GLOBAL_DIR: globalDir,
    SKILL_STOCKTAKE_PROJECT_DIR: projectDir,
    SKILL_STOCKTAKE_OBSERVATIONS: observations,
  };
}

function runSave(root, results, payload, timeoutMs = 15000) {
  return runShell(SAVE_RESULTS, [results], stocktakeEnv(
    path.join(root, 'home', '.claude', 'skills'),
    path.join(root, 'project', '.claude', 'skills'),
    path.join(root, 'observations.jsonl'),
  ), JSON.stringify(payload), timeoutMs);
}

test('scan applies directory overrides and reports only SKILL.md metadata', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const globalDir = path.join(home, '.claude', 'skills');
  const projectDir = path.join(root, 'project', '.claude', 'skills');
  const observations = path.join(root, 'observations.jsonl');
  const fixedMtime = '2024-01-02T03:04:05Z';
  try {
    const alpha = writeSkill(globalDir, 'alpha', 'alpha', 'Alpha skill', fixedMtime);
    const beta = writeSkill(projectDir, 'beta', 'beta', 'Beta skill', fixedMtime);
    fs.writeFileSync(path.join(globalDir, 'alpha', 'README.md'), '# supporting file\n');
    fs.mkdirSync(path.join(globalDir, 'alpha', 'references'), { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'alpha', 'references', 'notes.md'), '# ignored reference\n');

    const now = Date.now();
    fs.writeFileSync(observations, [
      JSON.stringify({ tool: 'Read', path: alpha, timestamp: new Date(now - 60 * 60 * 1000).toISOString() }),
      JSON.stringify({ tool: 'Read', path: alpha, timestamp: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString() }),
    ].join('\n') + '\n');

    const result = runShell(SCAN, [], stocktakeEnv(globalDir, projectDir, observations));
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepStrictEqual(output.scan_summary, {
      global: { found: true, count: 1 },
      project: { found: true, path: projectDir, count: 1 },
    });
    assert.deepStrictEqual(output.skills.map((skill) => skill.name).sort(), ['alpha', 'beta']);

    const alphaSkill = output.skills.find((skill) => skill.name === 'alpha');
    assert.ok(alphaSkill.path.endsWith('/alpha/SKILL.md'), alphaSkill.path);
    assert.strictEqual(alphaSkill.description, 'Alpha skill');
    assert.strictEqual(alphaSkill.use_7d, 1);
    assert.strictEqual(alphaSkill.use_30d, 2);
    assert.strictEqual(alphaSkill.mtime, fixedMtime);

    const betaSkill = output.skills.find((skill) => skill.name === 'beta');
    assert.ok(betaSkill.path.endsWith('/beta/SKILL.md'), betaSkill.path);
    assert.strictEqual(betaSkill.description, 'Beta skill');
    assert.strictEqual(betaSkill.use_7d, 0);
    assert.strictEqual(betaSkill.use_30d, 0);
    assert.strictEqual(betaSkill.mtime, fixedMtime);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scan preserves a relative project root in its summary and skill paths', () => {
  const root = tempDir();
  const globalDir = path.join(root, 'global', '.claude', 'skills');
  const projectDir = path.join(root, 'project', '.claude', 'skills');
  const relativeProjectDir = path.relative(ROOT, projectDir);
  try {
    fs.mkdirSync(globalDir, { recursive: true });
    writeSkill(projectDir, 'relative-skill', 'relative-skill', 'Relative skill', '2024-01-02T03:04:05Z');
    const result = runShell(SCAN, [], {
      HOME: path.join(root, 'home'),
      SKILL_STOCKTAKE_GLOBAL_DIR: globalDir,
      SKILL_STOCKTAKE_PROJECT_DIR: relativeProjectDir,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.scan_summary.project.path, relativeProjectDir);

    const skill = output.skills.find((entry) => entry.name === 'relative-skill');
    assert.ok(skill);
    assert.strictEqual(skill.path, relativeProjectDir + '/relative-skill/SKILL.md');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quick diff reports changed and unknown skills with stable result fields', () => {
  const root = tempDir();
  const globalDir = path.join(root, 'home', '.claude', 'skills');
  const projectDir = path.join(root, 'project', '.claude', 'skills');
  const observations = path.join(root, 'observations.jsonl');
  const evaluatedAt = '2024-01-02T03:04:05Z';
  try {
    const unchanged = writeSkill(globalDir, 'unchanged', 'unchanged', 'Unchanged skill', '2024-01-02T03:04:04Z');
    const changed = writeSkill(globalDir, 'changed', 'changed', 'Changed skill', '2024-01-02T03:04:06Z');
    const unknown = writeSkill(globalDir, 'unknown', 'unknown', 'Unknown skill', '2020-01-02T03:04:06Z');
    fs.mkdirSync(projectDir, { recursive: true });
    const results = path.join(root, 'results.json');
    fs.writeFileSync(results, JSON.stringify({
      evaluated_at: evaluatedAt,
      skills: [
        { path: unchanged, mtime: '2024-01-02T03:04:04Z' },
        { path: changed, mtime: evaluatedAt },
      ],
    }));

    const env = stocktakeEnv(globalDir, projectDir, observations);
    env.HOME = path.join(root, 'unrelated-home');
    const result = runShell(QUICK_DIFF, [results], env);
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.ok(Array.isArray(output));
    assert.strictEqual(output.length, 2, JSON.stringify(output));
    assert.ok(!output.some((entry) => entry.path.endsWith('/unchanged/SKILL.md')));

    const changedResult = output.find((entry) => entry.path.endsWith('/changed/SKILL.md'));
    assert.ok(changedResult);
    assert.strictEqual(changedResult.mtime, '2024-01-02T03:04:06Z');
    assert.strictEqual(changedResult.is_new, false);
    assert.deepStrictEqual(Object.keys(changedResult).sort(), ['is_new', 'mtime', 'path']);

    const unknownResult = output.find((entry) => entry.path.endsWith('/unknown/SKILL.md'));
    assert.ok(unknownResult);
    assert.strictEqual(unknownResult.mtime, '2020-01-02T03:04:06Z');
    assert.strictEqual(unknownResult.is_new, true);
    assert.deepStrictEqual(Object.keys(unknownResult).sort(), ['is_new', 'mtime', 'path']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quick diff accepts object-map history with scan paths and fixed timestamps', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const globalDir = path.join(home, '.claude', 'skills');
  const projectDir = path.join(root, 'project', '.claude', 'skills');
  const observations = path.join(root, 'observations.jsonl');
  const evaluatedAt = '2024-01-02T03:04:05Z';
  try {
    writeSkill(globalDir, 'changed', 'changed', 'Changed skill', '2024-01-02T03:04:06Z');
    writeSkill(globalDir, 'unchanged', 'unchanged', 'Unchanged skill', '2024-01-02T03:04:04Z');
    writeSkill(projectDir, 'new-skill', 'new-skill', 'New skill', '2020-01-02T03:04:06Z');
    fs.writeFileSync(observations, '');

    const scan = runShell(SCAN, [], stocktakeEnv(globalDir, projectDir, observations));
    assert.strictEqual(scan.status, 0, scan.stderr);
    const scannedSkills = JSON.parse(scan.stdout).skills;
    const changed = scannedSkills.find((skill) => skill.name === 'changed');
    const unchanged = scannedSkills.find((skill) => skill.name === 'unchanged');
    const newSkill = scannedSkills.find((skill) => skill.name === 'new-skill');
    assert.ok(changed.path.startsWith('~/.claude/skills/'), changed.path);

    const results = path.join(root, 'results.json');
    fs.writeFileSync(results, JSON.stringify({
      evaluated_at: evaluatedAt,
      skills: {
        previouslyChanged: { path: changed.path },
        previouslyUnchanged: { path: unchanged.path },
      },
    }));
    const diff = runShell(QUICK_DIFF, [results], stocktakeEnv(globalDir, projectDir, observations));
    assert.strictEqual(diff.status, 0, diff.stderr);
    const changes = JSON.parse(diff.stdout);
    assert.strictEqual(changes.length, 2);

    const changedResult = changes.find((entry) => entry.path === changed.path);
    assert.ok(changedResult);
    assert.strictEqual(changedResult.mtime, '2024-01-02T03:04:06Z');
    assert.strictEqual(changedResult.is_new, false);

    assert.ok(!changes.some((entry) => entry.path === unchanged.path));
    const newResult = changes.find((entry) => entry.path === newSkill.path);
    assert.ok(newResult);
    assert.strictEqual(newResult.mtime, '2020-01-02T03:04:06Z');
    assert.strictEqual(newResult.is_new, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results merges skill evaluations with incoming values winning', () => {
  const root = tempDir();
  const results = path.join(root, 'results.json');
  const previous = {
    skills: { keep: { rating: 'old' }, same: { rating: 'before' } },
    mode: 'full',
    batch_progress: { completed: 1 },
    evaluated_at: '2000-01-01T00:00:00Z',
  };
  try {
    fs.writeFileSync(results, JSON.stringify(previous));
    const input = {
      skills: { same: { rating: 'after' }, added: { rating: 'new' } },
      mode: 'quick',
      batch_progress: { completed: 2 },
    };
    const result = runShell(SAVE_RESULTS, [results], stocktakeEnv(
      path.join(root, 'home', '.claude', 'skills'),
      path.join(root, 'project', '.claude', 'skills'),
      path.join(root, 'observations.jsonl'),
    ), JSON.stringify(input));

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
    const saved = JSON.parse(fs.readFileSync(results, 'utf8'));
    assert.deepStrictEqual(saved.skills, {
      keep: { rating: 'old' },
      same: { rating: 'after' },
      added: { rating: 'new' },
    });
    assert.strictEqual(saved.mode, 'quick');
    assert.deepStrictEqual(saved.batch_progress, { completed: 2 });
    assert.ok(Date.parse(saved.evaluated_at) > Date.parse(previous.evaluated_at));
    assert.ok(saved.evaluated_at.endsWith('Z'), saved.evaluated_at);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results preserves optional mode and batch progress when omitted', () => {
  const root = tempDir();
  const results = path.join(root, 'results.json');
  const previous = {
    skills: { keep: { rating: 'old' } },
    mode: 'deep',
    batch_progress: { completed: 7 },
    evaluated_at: '2000-01-01T00:00:00Z',
  };
  try {
    fs.writeFileSync(results, JSON.stringify(previous));
    const result = runShell(SAVE_RESULTS, [results], stocktakeEnv(
      path.join(root, 'home', '.claude', 'skills'),
      path.join(root, 'project', '.claude', 'skills'),
      path.join(root, 'observations.jsonl'),
    ), JSON.stringify({ skills: { added: { rating: 'new' } } }));

    assert.strictEqual(result.status, 0, result.stderr);
    const saved = JSON.parse(fs.readFileSync(results, 'utf8'));
    assert.strictEqual(saved.mode, 'deep');
    assert.deepStrictEqual(saved.batch_progress, { completed: 7 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results rejects malformed JSON without changing the prior file', () => {
  const root = tempDir();
  const results = path.join(root, 'results.json');
  const previous = JSON.stringify({ skills: { keep: { rating: 'old' } }, mode: 'full' });
  try {
    fs.writeFileSync(results, previous);
    const result = runShell(SAVE_RESULTS, [results], stocktakeEnv(
      path.join(root, 'home', '.claude', 'skills'),
      path.join(root, 'project', '.claude', 'skills'),
      path.join(root, 'observations.jsonl'),
    ), '{ malformed');

    assert.notStrictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(fs.readFileSync(results, 'utf8'), previous);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results rejects JSON without a skills object before changing the prior file', () => {
  const root = tempDir();
  const results = path.join(root, 'results.json');
  const previous = JSON.stringify({ skills: { keep: { rating: 'old' } }, mode: 'full' });
  try {
    fs.writeFileSync(results, previous);
    const result = runShell(SAVE_RESULTS, [results], stocktakeEnv(
      path.join(root, 'home', '.claude', 'skills'),
      path.join(root, 'project', '.claude', 'skills'),
      path.join(root, 'observations.jsonl'),
    ), JSON.stringify({}));

    assert.notStrictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(fs.readFileSync(results, 'utf8'), previous);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results creates a new results file with mode 0600', () => {
  const root = tempDir();
  const results = path.join(root, 'results.json');
  try {
    const result = runSave(root, results, { skills: { alpha: { rating: 'new' } } });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(fs.statSync(results).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results preserves mode 0640 on an existing results file', () => {
  const root = tempDir();
  const results = path.join(root, 'results.json');
  try {
    fs.writeFileSync(results, JSON.stringify({ skills: { keep: { rating: 'old' } } }), { mode: 0o640 });
    fs.chmodSync(results, 0o640);
    const result = runSave(root, results, { skills: { added: { rating: 'new' } } });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.statSync(results).mode & 0o777, 0o640);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results rejects a symlink target without changing its referent', () => {
  const root = tempDir();
  const referent = path.join(root, 'referent.json');
  const results = path.join(root, 'results.json');
  const previous = JSON.stringify({ skills: { keep: { rating: 'old' } } });
  try {
    fs.writeFileSync(referent, previous);
    fs.symlinkSync(referent, results);
    const result = runSave(root, results, { skills: { added: { rating: 'new' } } });

    assert.notStrictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(fs.lstatSync(results).isSymbolicLink(), true);
    assert.strictEqual(fs.readlinkSync(results), referent);
    assert.strictEqual(fs.readFileSync(referent, 'utf8'), previous);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results rejects an existing FIFO promptly without changing the target', () => {
  const root = tempDir();
  const fifo = path.join(root, 'results.fifo');
  try {
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    assert.strictEqual(created.status, 0, created.stderr);
    const result = runSave(root, fifo, { skills: { added: { rating: 'new' } } }, 1500);

    assert.strictEqual(result.error, undefined, result.error && result.error.message);
    assert.notStrictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(fs.lstatSync(fifo).isFIFO(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results leaves no temporary files after an invalid prior result blocks writing', () => {
  const root = tempDir();
  const outputDir = path.join(root, 'output');
  const results = path.join(outputDir, 'results.json');
  const previous = '{"skills":';
  try {
    fs.mkdirSync(outputDir);
    fs.writeFileSync(results, previous);
    const result = runSave(root, results, { skills: { added: { rating: 'new' } } });

    assert.notStrictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(fs.readFileSync(results, 'utf8'), previous);
    assert.deepStrictEqual(fs.readdirSync(outputDir), ['results.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save results merges an own __proto__ skill key without prototype pollution', () => {
  const root = tempDir();
  const results = path.join(root, 'results.json');
  const previous = JSON.parse('{"skills":{"__proto__":{"rating":"old","polluted":"old"},"same":{"rating":"old"},"keep":"old"}}');
  const incoming = JSON.parse('{"skills":{"__proto__":{"rating":"new","polluted":"new"},"same":{"rating":"new"},"added":"new"}}');
  try {
    fs.writeFileSync(results, JSON.stringify(previous));
    const result = runSave(root, results, incoming);

    assert.strictEqual(result.status, 0, result.stderr);
    const saved = JSON.parse(fs.readFileSync(results, 'utf8'));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(saved.skills, '__proto__'), true);
    assert.deepStrictEqual(saved.skills.__proto__, incoming.skills.__proto__);
    assert.deepStrictEqual(saved.skills.same, { rating: 'new' });
    assert.strictEqual(saved.skills.keep, 'old');
    assert.strictEqual(Object.getPrototypeOf(saved.skills), Object.prototype);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
    assert.strictEqual(({}).polluted, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('skill-scope-stocktake-contract');
