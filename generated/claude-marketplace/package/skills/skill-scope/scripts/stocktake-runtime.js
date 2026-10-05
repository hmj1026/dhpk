'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const UTC_SECOND_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonemptyEnvironment(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function homeDirectory() {
  const home = nonemptyEnvironment('HOME');
  return path.resolve(home || os.homedir());
}

function displayPath(target) {
  if (!path.isAbsolute(target)) return target;

  const absolute = path.resolve(target);
  const home = homeDirectory();
  const relative = path.relative(home, absolute);
  if (relative === '') return '~';
  if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
    return '~' + path.sep + relative;
  }
  return target;
}

function pathFromEnvironment(name, fallback) {
  const value = nonemptyEnvironment(name);
  return value === null ? fallback : value;
}

function getRoots(projectArgument) {
  const home = homeDirectory();
  const globalDir = pathFromEnvironment(
    'SKILL_STOCKTAKE_GLOBAL_DIR',
    path.join(home, '.claude', 'skills'),
  );
  const projectOverride = nonemptyEnvironment('SKILL_STOCKTAKE_PROJECT_DIR');
  const projectFallback = projectOverride !== null
    ? projectOverride
    : (typeof projectArgument === 'string' && projectArgument.length > 0
      ? projectArgument
      : path.join(process.cwd(), '.claude', 'skills'));
  return { globalDir, projectDir: projectFallback };
}

function observationsFile() {
  const home = homeDirectory();
  const override = nonemptyEnvironment('SKILL_STOCKTAKE_OBSERVATIONS');
  return path.resolve(override === null
    ? path.join(home, '.claude', 'observations.jsonl')
    : override);
}

function directoryExists(target) {
  try {
    return fs.lstatSync(target).isDirectory();
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw error;
  }
}

function regularSkillFiles(root) {
  const found = [];

  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    entries.sort((left, right) => {
      if (left.name < right.name) return -1;
      if (left.name > right.name) return 1;
      return 0;
    });

    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(target);
        continue;
      }
      if (entry.name !== 'SKILL.md' || !entry.isFile()) continue;

      const metadata = fs.lstatSync(target);
      if (metadata.isFile()) {
        found.push({ path: target, mtimeMs: metadata.mtimeMs });
      }
    }
  }

  if (directoryExists(root)) visit(root);
  return found;
}

function readRegularFile(target) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
  try {
    if (!fs.fstatSync(descriptor).isFile()) return null;
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseFrontmatter(content) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0] !== '---') return { name: '', description: '' };

  const closingLine = lines.indexOf('---', 1);
  if (closingLine === -1) return { name: '', description: '' };

  const fields = { name: '', description: '' };
  for (const line of lines.slice(1, closingLine)) {
    const match = /^(name|description):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }
    if (fields[match[1]] === '') fields[match[1]] = value;
  }
  return fields;
}

function readObservationRecords(file) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const records = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail('Malformed observations JSONL at line ' + (index + 1));
    }
    if (!isRecord(record) || record.tool !== 'Read' || typeof record.path !== 'string' || record.path.length === 0) {
      continue;
    }
    records.push(record);
  }
  return records;
}

function observationUsage(records, nowMs) {
  const usage = new Map();
  const sevenDayCutoff = nowMs - 7 * DAY_MS;
  const thirtyDayCutoff = nowMs - 30 * DAY_MS;

  for (const record of records) {
    const observedAt = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
    if (!Number.isFinite(observedAt) || observedAt > nowMs) continue;

    const counts = usage.get(record.path) || { use_7d: 0, use_30d: 0 };
    if (observedAt >= sevenDayCutoff) counts.use_7d += 1;
    if (observedAt >= thirtyDayCutoff) counts.use_30d += 1;
    usage.set(record.path, counts);
  }
  return usage;
}

function utcSecond(milliseconds) {
  return new Date(Math.floor(milliseconds / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function collectRoots(roots) {
  const globalFound = directoryExists(roots.globalDir);
  const projectFound = directoryExists(roots.projectDir);
  return {
    globalFound,
    projectFound,
    globalFiles: globalFound ? regularSkillFiles(roots.globalDir) : [],
    projectFiles: projectFound ? regularSkillFiles(roots.projectDir) : [],
  };
}

function scanCommand(args) {
  if (args.length > 1) fail('scan accepts at most one project skills directory');
  const roots = getRoots(args[0]);
  const collected = collectRoots(roots);
  const nowMs = Date.now();
  const records = readObservationRecords(observationsFile());
  const usage = observationUsage(records, nowMs);

  const skills = [];
  for (const file of collected.globalFiles.concat(collected.projectFiles)) {
    const text = readRegularFile(file.path);
    if (text === null) continue;
    const frontmatter = parseFrontmatter(text);
    const counts = usage.get(file.path) || { use_7d: 0, use_30d: 0 };
    skills.push({
      path: displayPath(file.path),
      name: frontmatter.name,
      description: frontmatter.description,
      use_7d: counts.use_7d,
      use_30d: counts.use_30d,
      mtime: utcSecond(file.mtimeMs),
    });
  }

  return {
    scan_summary: {
      global: { found: collected.globalFound, count: collected.globalFiles.length },
      project: {
        found: collected.projectFound,
        path: collected.projectFound ? displayPath(roots.projectDir) : '',
        count: collected.projectFiles.length,
      },
    },
    skills,
  };
}

function validUtcSecond(value) {
  if (typeof value !== 'string' || !UTC_SECOND_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && utcSecond(parsed) === value;
}

function skillPathsFromResults(value) {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) && !isRecord(value)) {
    fail('results.skills must be an array or object');
  }

  const values = Array.isArray(value) ? value : Object.values(value);
  const paths = new Set();
  for (const skill of values) {
    if (isRecord(skill) && typeof skill.path === 'string') paths.add(skill.path);
  }
  return paths;
}

function currentSkillFiles(roots) {
  const collected = collectRoots(roots);
  return collected.globalFiles.concat(collected.projectFiles);
}

function quickDiffCommand(args) {
  if (args.length < 1 || args.length > 2) fail('quick-diff requires a results file and accepts one project skills directory');
  const resultsPath = path.resolve(args[0]);
  const resultsText = fs.readFileSync(resultsPath, 'utf8');

  let results;
  try {
    results = JSON.parse(resultsText);
  } catch (error) {
    fail('Invalid results JSON');
  }
  if (!isRecord(results) || !validUtcSecond(results.evaluated_at)) {
    fail('results.evaluated_at must be a valid UTC-second timestamp');
  }
  const knownPaths = skillPathsFromResults(results.skills);
  const roots = getRoots(args[1]);
  const files = currentSkillFiles(roots);
  const changes = [];

  for (const file of files) {
    const outputPath = displayPath(file.path);
    const mtime = utcSecond(file.mtimeMs);
    const isNew = !knownPaths.has(outputPath);
    if (!isNew && mtime <= results.evaluated_at) continue;
    changes.push({
      path: outputPath,
      mtime,
      is_new: isNew,
    });
  }
  return changes;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function readExistingResult(target) {
  let metadata;
  try {
    metadata = fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { value: null, mode: 0o600 };
    throw error;
  }

  if (!metadata.isFile()) fail('results file must be a regular file');
  const content = readRegularFile(target);
  if (content === null) fail('results file must be a regular file');

  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    fail('Existing results file contains invalid JSON');
  }
  if (!isRecord(value)) fail('Existing results file must contain a JSON object');
  if (value.skills !== undefined && !isRecord(value.skills)) {
    fail('Existing results.skills must be an object');
  }
  return { value, mode: metadata.mode & 0o7777 };
}

function atomicReplace(target, content, mode) {
  const directory = path.dirname(target);
  const basename = path.basename(target);
  const temporary = path.join(
    directory,
    '.' + basename + '.tmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex'),
  );
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY;
  let descriptor = null;
  let renamed = false;

  try {
    descriptor = fs.openSync(temporary, flags, 0o600);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.fchmodSync(descriptor, mode);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, target);
    renamed = true;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (error) { /* preserve original failure */ }
    }
    if (!renamed) {
      try { fs.unlinkSync(temporary); } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
    }
  }
}

function saveResultsCommand(args) {
  if (args.length !== 1 || args[0].length === 0) fail('save-results requires one results file path');
  const target = path.resolve(args[0]);
  const inputText = fs.readFileSync(0, 'utf8');

  let incoming;
  try {
    incoming = JSON.parse(inputText);
  } catch (error) {
    fail('Invalid evaluation JSON');
  }
  if (!isRecord(incoming) || !isRecord(incoming.skills)) {
    fail('Evaluation JSON must contain a skills object');
  }

  const current = readExistingResult(target);
  const evaluatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let merged;
  if (current.value === null) {
    merged = { ...incoming, evaluated_at: evaluatedAt };
  } else {
    const priorSkills = current.value.skills || {};
    merged = {
      ...current.value,
      skills: { ...priorSkills, ...incoming.skills },
      evaluated_at: evaluatedAt,
    };
    for (const key of ['mode', 'batch_progress']) {
      if (hasOwn(incoming, key)) merged[key] = incoming[key];
    }
  }

  const serialized = JSON.stringify(merged, null, 2) + '\n';
  atomicReplace(target, serialized, current.mode);
}

function run() {
  const action = process.argv[2];
  const args = process.argv.slice(3);
  let result;

  if (action === 'scan') result = scanCommand(args);
  else if (action === 'diff') result = quickDiffCommand(args);
  else if (action === 'save') {
    saveResultsCommand(args);
    return;
  } else {
    fail('Unknown stocktake action');
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

try {
  run();
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  process.stderr.write('Error: ' + message + '\n');
  process.exitCode = 1;
}
