'use strict';

// Physical-tree publication contract (self-contained-skill-directories 7.1).
// A published Skill is its complete canonical directory minus ignored runtime
// caches; no per-Skill descriptor selects, injects, or is required for files.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const closure = require('../scripts/lib/workflow-package-closure');
const { compileClaudeCapabilityBundle } = require('../scripts/lib/claude-capability-bundle');
const { containsSecret } = require('../scripts/lib/agents-skills-package');
const { createSurfaceReceipt, validateSurfaceReceipt } = require('../scripts/lib/platform-provenance');

function errorsOf(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.errors)) return result.errors;
  return result && result.ok === false ? ['invalid'] : [];
}

function physicalTemp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writeFile(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function readManifest(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', name), 'utf8'));
}

function compileProfile(profileId) {
  const result = compileClaudeCapabilityBundle({
    root: ROOT,
    inventory: readManifest('distribution-inventory.json'),
    profiles: readManifest('install-profiles.json'),
    moduleCatalog: readManifest('module-catalog.json'),
    profileId,
  });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  return result.value;
}

function physicalFiles(skillRoot) {
  const files = [];
  const walk = (directory, relative) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), childRelative);
      else if (entry.isFile()) files.push(childRelative);
    }
  };
  walk(skillRoot, '');
  return files.sort();
}

test('physicalSkillTree lists every regular file and skips ignored runtime caches', () => {
  assert.strictEqual(typeof closure.physicalSkillTree, 'function', 'physicalSkillTree(root, entry) must be exported');
  const root = physicalTemp('dhpk physical tree-');
  try {
    const skill = path.join(root, 'skills', 'tree-case');
    writeFile(skill, 'SKILL.md', '---\nname: tree-case\ndescription: fixture\n---\n');
    writeFile(skill, 'references/guide.md', 'guide\n');
    writeFile(skill, 'scripts/run.py', 'print(1)\n');
    writeFile(skill, 'agents/openai.yaml', 'interface: {}\n');
    writeFile(skill, 'evals/evals.json', '[]\n');
    writeFile(skill, 'scripts/__pycache__/run.cpython-312.pyc', 'bytecode');
    writeFile(skill, 'scripts/stray.pyc', 'bytecode');
    const files = closure.physicalSkillTree(root, { id: 'tree-case', path: 'skills/tree-case' });
    assert.deepStrictEqual(files.map((file) => file.relative), [
      'SKILL.md',
      'agents/openai.yaml',
      'evals/evals.json',
      'references/guide.md',
      'scripts/run.py',
    ]);
    for (const file of files) assert.ok(path.isAbsolute(file.absolute) && fs.existsSync(file.absolute));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('physicalSkillTree fails closed on symlinks and a missing SKILL.md', () => {
  const root = physicalTemp('dhpk physical tree unsafe-');
  const outside = physicalTemp('dhpk physical tree outside-');
  try {
    const skill = path.join(root, 'skills', 'linked');
    writeFile(skill, 'SKILL.md', '---\nname: linked\ndescription: fixture\n---\n');
    writeFile(outside, 'helper.js', 'module.exports = 1;\n');
    fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'helper.js'), path.join(skill, 'scripts', 'helper.js'));
    assert.throws(() => closure.physicalSkillTree(root, { id: 'linked', path: 'skills/linked' }), /symlink/i);

    writeFile(root, 'skills/empty/references/guide.md', 'guide\n');
    assert.throws(() => closure.physicalSkillTree(root, { id: 'empty', path: 'skills/empty' }), /SKILL\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('Claude profile bundles publish each selected Skill as its complete physical tree', () => {
  const bundle = compileProfile('minimal');
  const destinations = new Set(bundle.outputs.map((output) => output.destination));
  const inventory = readManifest('distribution-inventory.json');
  for (const id of bundle.selection.selectedStableIds) {
    const entry = inventory.skills.find((row) => row.id === id);
    const skillName = path.posix.basename(entry.path);
    for (const relative of physicalFiles(path.join(ROOT, entry.path))) {
      if (relative === 'skill-package.json') continue;
      assert.ok(destinations.has(`skills/${skillName}/${relative}`), `${id}: missing published ${relative}`);
    }
  }
});

test('published trees never carry descriptors, ignored bytecode, or a closure receipt field', () => {
  const bundle = compileProfile('full');
  for (const output of bundle.outputs) {
    assert.ok(!/(?:^|\/)skill-package\.json$/.test(output.destination), `descriptor published: ${output.destination}`);
    assert.ok(!/(?:^|\/)__pycache__\/|\.pyc$/.test(output.destination), `bytecode published: ${output.destination}`);
    assert.ok(!/^claude-profile:runtime:/.test(output.stableId), `runtime overlay published: ${output.stableId}`);
  }
  assert.strictEqual(bundle.skillPackageClosure, undefined, 'new bundles do not emit skillPackageClosure');
});

test('historical receipts carrying skillPackageClosure entries remain readable', () => {
  const base = {
    surface: 'agent-plugin',
    sourceVersion: '0.62.4',
    sourceCommit: 'a'.repeat(40),
    inventoryDigest: 'b'.repeat(64),
    fingerprints: {},
  };
  const historical = createSurfaceReceipt({
    ...base,
    skillPackageClosure: [{ id: 'flow-drive', version: '1.0.0' }, { id: 'flow-guide', version: '1.0.0' }],
  });
  const current = createSurfaceReceipt(base);
  assert.deepStrictEqual(errorsOf(validateSurfaceReceipt(historical, 'agent-plugin')), [],
    'a historical receipt with closure entries must still validate');
  assert.deepStrictEqual(errorsOf(validateSurfaceReceipt(current, 'agent-plugin')), []);
  assert.ok(!Object.prototype.hasOwnProperty.call(current, 'skillPackageClosure'),
    'a receipt without closure input does not invent the field');
  const malformed = { ...historical, skillPackageClosure: [{ id: '../escape', version: 'x' }] };
  assert.ok(errorsOf(validateSurfaceReceipt(malformed, 'agent-plugin')).length > 0,
    'malformed historical closure entries still fail closed');
});

test('closure module no longer exports descriptor readers or runtime overlays', () => {
  for (const retired of [
    'readSkillPackageManifest',
    'validateSkillPackageManifest',
    'resolveSkillPackageClosure',
    'skillPackageClosureReceipt',
    'runtimeAssetsForSkill',
  ]) {
    assert.strictEqual(closure[retired], undefined, `${retired} must be retired`);
  }
});

test('no canonical Skill directory carries a retired skill-package.json descriptor', () => {
  const found = [];
  const roots = [path.join(ROOT, 'skills'), ...fs.readdirSync(path.join(ROOT, 'modules'))
    .map((name) => path.join(ROOT, 'modules', name, 'skills'))];
  for (const skillsRoot of roots) {
    if (!fs.existsSync(skillsRoot)) continue;
    for (const name of fs.readdirSync(skillsRoot)) {
      const descriptor = path.join(skillsRoot, name, 'skill-package.json');
      if (fs.existsSync(descriptor)) found.push(path.relative(ROOT, descriptor));
    }
  }
  assert.deepStrictEqual(found, []);
});

test('every resource a retired descriptor declared remains physically local to its Skill', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'skill-package-descriptor-snapshot.json'), 'utf8'));
  const missing = [];
  for (const [id, record] of Object.entries(snapshot.skills)) {
    for (const resource of record.resources) {
      if (!resource.required) continue;
      const target = path.join(ROOT, record.path, resource.path);
      let stat = null;
      try { stat = fs.lstatSync(target); } catch (_) { /* reported below */ }
      if (!stat || stat.isSymbolicLink()) missing.push(`${id}: ${resource.path}`);
    }
  }
  assert.deepStrictEqual(missing, []);
});

test('no repository code path reads a per-Skill descriptor', () => {
  const offenders = [];
  const scan = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { scan(absolute); continue; }
      if (!/\.(?:js|sh|py)$/.test(entry.name)) continue;
      const text = fs.readFileSync(absolute, 'utf8');
      if (/skill-package\.json/.test(text)) offenders.push(path.relative(ROOT, absolute));
    }
  };
  scan(path.join(ROOT, 'scripts'));
  assert.deepStrictEqual(offenders, []);
});

test('the shared-copy map stays repository-only and is never a consumer prerequisite', () => {
  const readers = [];
  const scan = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      // Module skill links point back at canonical skills/ content.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (entry.name !== '__pycache__') scan(absolute); continue; }
      const text = fs.readFileSync(absolute, 'utf8');
      if (/skill-resources\.json|skill-resource-copies\.json|sync-skill-resources/.test(text)) {
        readers.push(path.relative(ROOT, absolute));
      }
    }
  };
  scan(path.join(ROOT, 'skills'));
  for (const name of fs.readdirSync(path.join(ROOT, 'modules'))) {
    const skills = path.join(ROOT, 'modules', name, 'skills');
    if (fs.existsSync(skills)) scan(skills);
  }
  assert.deepStrictEqual(readers, [], 'no Skill may load or invoke the authoring copy map');
  for (const output of compileProfile('full').outputs) {
    assert.ok(!/skill-resources\.json|skill-resource-copies\.json|sync-skill-resources/.test(output.destination),
      `copy-map metadata published: ${output.destination}`);
  }
});

test('migrated script paths are removed without forwarding shims', () => {
  const retired = [
    'scripts/precommit-runner.js',
    'scripts/verify-runner.js',
    'scripts/harness-audit.js',
    'scripts/opsx-apply-resume/detect-phase.sh',
    'scripts/opsx-apply-resume/set-handoff-state.sh',
    'scripts/opsx-apply-resume/extract-compact.sh',
    'scripts/opsx-apply-resume/post-obs.sh',
  ];
  assert.deepStrictEqual(retired.filter((relative) => fs.existsSync(path.join(ROOT, relative))), []);
  const destinations = new Set(compileProfile('full').outputs.map((output) => output.destination));
  assert.deepStrictEqual(retired.filter((relative) => destinations.has(relative)), []);
});

// Reviewed placeholders that intentionally look like credentials.
const SECRET_PATTERN_EXCEPTIONS = Object.freeze({
  'php-pro:references/agent-extracts/security-owasp-examples.md':
    'fake sk_live_ placeholder inside a hardcoded-secret anti-pattern example',
});

test('published Skill trees carry no dotfiles and no unreviewed secret-shaped content', () => {
  // Every regular file in a Skill directory is published, so the canonical
  // tree itself is the gate: no VCS/env/editor dotfiles and no credentials.
  const inventory = readManifest('distribution-inventory.json');
  const dotfiles = [];
  const secrets = [];
  for (const entry of inventory.skills) {
    for (const file of closure.physicalSkillTree(ROOT, entry)) {
      const key = `${entry.id}:${file.relative}`;
      if (file.relative.split('/').some((part) => part.startsWith('.'))) dotfiles.push(key);
      if (containsSecret(fs.readFileSync(file.absolute, 'utf8')) && !SECRET_PATTERN_EXCEPTIONS[key]) secrets.push(key);
    }
  }
  assert.deepStrictEqual(dotfiles, []);
  assert.deepStrictEqual(secrets, []);
});

test('no canonical Skill path is a path-prefix of another Skill path', () => {
  // A Skill tree is published recursively, so a nested Skill would leak its
  // files into the enclosing Skill's package.
  const paths = readManifest('distribution-inventory.json').skills.map((entry) => entry.path).sort();
  const nested = [];
  for (const outer of paths) {
    for (const inner of paths) {
      if (outer !== inner && inner.startsWith(`${outer}/`)) nested.push(`${inner} inside ${outer}`);
    }
  }
  assert.deepStrictEqual(nested, []);
});

run('physical-tree-publication');
