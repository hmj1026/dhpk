'use strict';

// Inventory-driven structural and fixture-contract coverage for canonical
// Skills.  This module deliberately does not execute fixture code: fixture
// definitions are authoring evidence, while execution evidence is supplied by
// the isolation harness and kept separate from Host evidence.

const fs = require('node:fs');
const path = require('node:path');
const { readFileBounded } = require('./bounded-filesystem');

const SCHEMA = 'dhpk.skill-directory-coverage.v1';
const HOST_STATUSES = new Set([
  'PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE',
  'BLOCKED', 'UNAVAILABLE',
]);
const IGNORED_PARTS = new Set([
  '.git', '.cache', 'node_modules', '__pycache__', '.pytest_cache',
  '.mypy_cache', '.ruff_cache', '.tox',
]);
const EXECUTABLE_EXTENSIONS = new Set([
  '.bash', '.cjs', '.js', '.mjs', '.php', '.pl', '.py', '.rb',
  '.sh', '.swift', '.ts',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeRelative(relative, label) {
  if (typeof relative !== 'string' || relative.length === 0
    || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)
    || /[\\\0]/.test(relative)) {
    throw new Error(`${label} is not a safe Skill-relative path: ${String(relative)}`);
  }
  const parts = relative.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error(`${label} escapes the Skill boundary: ${relative}`);
  }
  if (parts.some((part) => IGNORED_PARTS.has(part) || part.endsWith('.pyc'))) {
    throw new Error(`${label} uses an ignored cache/runtime path: ${relative}`);
  }
  return relative;
}

function physicalPath(root, relative, label, kind = 'file') {
  const rel = safeRelative(relative, label);
  let current = root;
  const parts = rel.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error(`${label} is missing: ${rel}`);
      }
      throw new Error(`${label} cannot be inspected: ${rel}: ${error.message}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`${label} is a symlink: ${rel}`);
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} has a non-directory ancestor: ${rel}`);
    }
    if (index === parts.length - 1) {
      if (kind === 'directory' && !stat.isDirectory()) {
        throw new Error(`${label} is not a regular directory: ${rel}`);
      }
      if (kind === 'file' && !stat.isFile()) {
        throw new Error(`${label} is not a regular file: ${rel}`);
      }
    }
  }
  return current;
}

function readPhysical(root, relative, label) {
  const file = physicalPath(root, relative, label, 'file');
  return { file, text: readFileBounded(file).toString('utf8') };
}

function resolveRoot(root) {
  if (typeof root !== 'string' || !root) throw new Error('root is required');
  const absolute = path.resolve(root);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('root must be a physical directory');
  }
  if (fs.realpathSync(absolute) !== absolute) throw new Error('root must not be symlinked');
  return absolute;
}

function hasFrontmatter(content) {
  const normalized = String(content).replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { ok: false, error: 'SKILL.md has no frontmatter block' };
  const block = match[1];
  if (!/^name:\s*\S.*$/m.test(block)) return { ok: false, error: 'SKILL.md frontmatter has no name' };
  if (!/^description:\s*\S[\s\S]*$/m.test(block)) {
    return { ok: false, error: 'SKILL.md frontmatter has no description' };
  }
  return { ok: true };
}

function fixtureTable(fixtures) {
  if (Array.isArray(fixtures)) {
    return Object.fromEntries(fixtures.filter((item) => isObject(item) && item.id).map((item) => [item.id, item]));
  }
  if (!isObject(fixtures)) return {};
  if (isObject(fixtures.fixtures)) return fixtures.fixtures;
  return fixtures;
}

function fixtureContract(id, fixture, root, skillPath, errors, checked) {
  if (checked.has(id)) return;
  checked.add(id);
  if (!isObject(fixture)) {
    errors.push(`fixture '${id}' is not an object`);
    return;
  }
  if (typeof fixture.entry !== 'string' || !fixture.entry) {
    errors.push(`fixture '${id}' requires a Skill-relative entry`);
  } else {
    try { physicalPath(path.join(root, skillPath), fixture.entry, `fixture '${id}' entry`); }
    catch (error) { errors.push(error.message); }
  }
  if (!isObject(fixture.expected) || !Number.isSafeInteger(fixture.expected.status)) {
    errors.push(`fixture '${id}' requires an expected integer status`);
  }
  const expectedOutput = ['stdout', 'stderr', 'output']
    .some((field) => typeof fixture.expected?.[field] === 'string')
    || (Array.isArray(fixture.expected?.output)
      && fixture.expected.output.length > 0
      && fixture.expected.output.every((fragment) => typeof fragment === 'string' && fragment.length > 0));
  if (!expectedOutput) errors.push(`fixture '${id}' requires expected output text`);
  if (typeof fixture.assert !== 'function') errors.push(`fixture '${id}' requires an assert function`);
}

function localMarkdownLinks(content, document) {
  const links = [];
  const errors = [];
  const add = (raw, documentRelative) => {
    if (typeof raw !== 'string') return;
    const value = raw.replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
    if (!value || /^(?:[a-z]+:|\/|#)/i.test(value)) return;
    if (!/\.md$/i.test(value)) return;
    // Markdown links use normal document-relative resolution, including links
    // containing a slash.  Textual `references/...` and `docs/...` mentions
    // are repository conventions and remain root-relative below.
    const base = documentRelative ? path.posix.dirname(document) : '';
    const candidate = path.posix.normalize(path.posix.join(base, value));
    if (candidate.startsWith('../') || candidate === '..') {
      errors.push(`Markdown link escapes the Skill boundary: ${value} from ${document}`);
      return;
    }
    links.push(candidate);
  };
  const markdown = /\]\(\s*<?([^\s)>]+)>?/g;
  const markdownSpans = [];
  let match;
  while ((match = markdown.exec(content)) !== null) {
    add(match[1], true);
    markdownSpans.push([match.index, markdown.lastIndex]);
  }
  // A Markdown destination is already resolved with document-relative
  // semantics. Mask its span before the root-relative textual scan so a
  // destination such as `references/topic.md` is not interpreted twice.
  const maskedContent = String(content).split('');
  for (const [start, end] of markdownSpans) {
    for (let index = start; index < end; index += 1) {
      if (maskedContent[index] !== '\n' && maskedContent[index] !== '\r') maskedContent[index] = ' ';
    }
  }
  const textual = /(?<![A-Za-z0-9_./-])(?:references|docs)\/[A-Za-z0-9._/-]+\.md\b/g;
  while ((match = textual.exec(maskedContent.join(''))) !== null) add(match[0], false);
  return { links: [...new Set(links)], errors };
}

function commandCandidates(content) {
  const candidates = [];
  const lines = String(content).split(/\r?\n/);
  const pattern = /(?<![A-Za-z0-9_./-])(?:\$SKILL_DIR\/|\$SCRIPTS\/|\.\/)?(scripts\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)/g;
  lines.forEach((line, index) => {
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const relative = match[1].replace(/[),.;:`'"}>]+$/, '');
      const extension = path.posix.extname(relative).toLowerCase();
      const commandLike = /\b(?:node|bash|sh|python(?:3)?|swift|ruby|perl)\b/i.test(line)
        || /\b(?:entrypoint|runner|invoke|execute|command|generate|render|cli)\b/i.test(line)
        || (EXECUTABLE_EXTENSIONS.has(extension) && /`[^`]*scripts\//.test(line));
      if (commandLike) candidates.push({ path: relative, line: index + 1, text: line.trim() });
    }
    pattern.lastIndex = 0;
  });
  const unique = new Map();
  for (const candidate of candidates) {
    if (!unique.has(candidate.path)) unique.set(candidate.path, candidate);
  }
  return [...unique.values()];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A required_by edge is evidence only when the caller file visibly names the
// helper: its basename, its caller-relative path (with or without extension),
// or — for Python — its dotted/relative module name.  This keeps the registry
// honest without executing or fully parsing the caller.
function callerReferencesHelper(callerText, callerPath, helperPath) {
  const text = String(callerText);
  const p = path.posix;
  const base = p.basename(helperPath);
  const extension = p.extname(helperPath);
  const relativePath = p.relative(p.dirname(callerPath), helperPath);
  const relativeStem = relativePath.slice(0, relativePath.length - extension.length);
  const stem = base.slice(0, base.length - extension.length);
  const quote = `['"\`]`;
  const before = '(?<![A-Za-z0-9_.-])';
  const after = '(?![A-Za-z0-9_-])';
  // 1. The basename or caller-relative path, extension included, as a token.
  if (new RegExp(`${before}${escapeRegExp(base)}${after}`).test(text)) return true;
  if (relativePath !== base && new RegExp(`${before}${escapeRegExp(relativePath)}${after}`).test(text)) return true;
  // 2. An extensionless relative specifier such as require('./helper').
  const specifier = relativeStem.startsWith('../') ? relativeStem : `./${relativeStem}`;
  if (new RegExp(`${quote}${escapeRegExp(specifier)}${quote}`).test(text)) return true;
  // 3. The exact stem as a quoted call argument, e.g. loadRuntimeModule('x')
  //    or path.join('scripts', 'lib', 'x'); a bare quoted word is not enough.
  if (stem.length > 1 && new RegExp(`[A-Za-z_$][\\w$]*\\s*\\([^()]*${quote}${escapeRegExp(stem)}${quote}`).test(text)) return true;
  // 4. Python modules require import syntax, never a bare identifier.
  if (extension === '.py') {
    const parts = (base === '__init__.py' ? p.dirname(relativePath) : relativeStem).split('/').filter(Boolean);
    if (parts.length > 0 && !parts.includes('..') && !parts.includes('.')) {
      const dotted = escapeRegExp(parts.join('.'));
      const moduleStem = escapeRegExp(parts[parts.length - 1]);
      if (new RegExp(`^\\s*(?:from\\s+${dotted}(?:\\.[\\w.]+)?\\s+import\\b|import\\s+${dotted}(?![\\w]))`, 'm').test(text)) return true;
      if (new RegExp(`^\\s*from\\s+\\.+${dotted}(?:\\.[\\w.]+)?\\s+import\\b`, 'm').test(text)) return true;
      if (new RegExp(`^\\s*from\\s+\\.+\\s+import\\s+[^\\n]*\\b${moduleStem}\\b`, 'm').test(text)) return true;
    }
  }
  return false;
}

function listEntries(record, field, options, root, skillPath, fixtures, structuralErrors, fixtureErrors, checkedFixtures, kinds) {
  const value = record[field] === undefined ? [] : record[field];
  if (!Array.isArray(value)) {
    structuralErrors.push(`${field} must be an array`);
    return [];
  }
  const output = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.path !== 'string') {
      structuralErrors.push(`${field} entries require a path`);
      continue;
    }
    let relative;
    try { relative = safeRelative(item.path, `${field} path`); }
    catch (error) { structuralErrors.push(error.message); continue; }
    if (kinds.has(relative)) structuralErrors.push(`coverage path is declared more than once: ${relative}`);
    kinds.set(relative, field);
    try { physicalPath(path.join(root, skillPath), relative, `${field} '${relative}'`); }
    catch (error) { structuralErrors.push(error.message); }
    const fixtureIds = item.fixture_ids === undefined ? [] : item.fixture_ids;
    if (!Array.isArray(fixtureIds) || fixtureIds.some((id) => typeof id !== 'string')) {
      fixtureErrors.push(`${field} '${relative}' fixture_ids must be an array of strings`);
    } else {
      if (field === 'executable_entries' && fixtureIds.length === 0) {
        fixtureErrors.push(`executable entry '${relative}' has no fixture_ids`);
      }
      for (const id of fixtureIds) {
        if (!Object.prototype.hasOwnProperty.call(fixtures, id)) fixtureErrors.push(`unknown fixture '${id}' for '${relative}'`);
        else {
          if (fixtures[id]?.entry !== relative) {
            fixtureErrors.push(`fixture '${id}' does not execute declared entry '${relative}'`);
          }
          fixtureContract(id, fixtures[id], root, skillPath, fixtureErrors, checkedFixtures);
        }
      }
    }
    output.push({ path: relative, fixture_ids: Array.isArray(fixtureIds) ? [...fixtureIds] : [] });
  }
  return output;
}

function validateSkillDirectoryCoverage({ root, inventory, coverage, fixtures } = {}) {
  const result = { ok: false, errors: [], skills: {}, host_evidence: {} };
  let repositoryRoot;
  try { repositoryRoot = resolveRoot(root); }
  catch (error) { result.errors.push(error.message); return result; }
  if (!isObject(inventory) || !Array.isArray(inventory.skills)) {
    result.errors.push('inventory.skills must be an array');
    return result;
  }
  if (!isObject(coverage) || coverage.schema !== SCHEMA || !isObject(coverage.skills)) {
    result.errors.push(`coverage must use schema ${SCHEMA} and an object skills map`);
    return result;
  }
  const fixtureDefinitions = fixtureTable(fixtures);
  const checkedFixtures = new Set();
  const seenIds = new Set();
  for (const row of inventory.skills) {
    const errors = [];
    const fixtureErrors = [];
    const id = row && row.id;
    const skillPath = row && row.path;
    if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      result.errors.push(`inventory row has an unsafe stable identity: ${String(id)}`);
      continue;
    }
    if (seenIds.has(id)) { result.errors.push(`inventory contains duplicate stable identity: ${id}`); continue; }
    seenIds.add(id);
    const detail = { id, path: skillPath, structural: 'PASS', fixtures: 'NOT_RUN', host: 'NOT_APPLICABLE' };
    result.skills[id] = detail;
    let skillRoot;
    try {
      if (typeof skillPath !== 'string') throw new Error('inventory path is missing');
      physicalPath(repositoryRoot, skillPath, `Skill '${id}'`, 'directory');
      skillRoot = path.join(repositoryRoot, skillPath);
      const skill = readPhysical(skillRoot, 'SKILL.md', `Skill '${id}' SKILL.md`);
      const metadata = hasFrontmatter(skill.text);
      if (!metadata.ok) errors.push(`Skill '${id}': ${metadata.error}`);
    } catch (error) { errors.push(error.message); }
    const record = coverage.skills[id];
    if (!isObject(record)) {
      errors.push(`missing coverage record for stable Skill identity '${id}'`);
      detail.structural = 'FAIL';
      detail.fixtures = 'FAIL';
      detail.status = 'FAIL';
      result.errors.push(...errors);
      continue;
    }
    if (record.entry !== undefined && record.entry !== 'SKILL.md') errors.push(`Skill '${id}' entry must be SKILL.md`);
    const references = record.references === undefined ? [] : record.references;
    const referencePaths = [];
    if (!Array.isArray(references)) errors.push(`Skill '${id}' references must be an array`);
    else for (const reference of references) {
      try {
        const relative = safeRelative(reference, `Skill '${id}' reference`);
        referencePaths.push(relative);
        if (skillRoot) physicalPath(skillRoot, relative, `Skill '${id}' reference '${relative}'`);
      } catch (error) { errors.push(error.message); }
    }
    const kinds = new Map();
    const executable = skillRoot
      ? listEntries(record, 'executable_entries', {}, repositoryRoot, skillPath, fixtureDefinitions, errors, fixtureErrors, checkedFixtures, kinds)
      : [];
    const api = skillRoot
      ? listEntries(record, 'api_entries', {}, repositoryRoot, skillPath, fixtureDefinitions, errors, fixtureErrors, checkedFixtures, kinds)
      : [];
    const helpers = record.internal_helpers === undefined ? [] : record.internal_helpers;
    const helperEdges = new Map();
    if (!Array.isArray(helpers)) errors.push(`internal_helpers must be an array`);
    else for (const helper of helpers) {
      if (!isObject(helper) || typeof helper.path !== 'string' || !Array.isArray(helper.required_by)) {
        errors.push(`internal_helpers entries require path and required_by`); continue;
      }
      try {
        const relative = safeRelative(helper.path, 'internal helper path');
        if (kinds.has(relative)) errors.push(`coverage path is declared more than once: ${relative}`);
        kinds.set(relative, 'internal_helpers');
        const requiredByPaths = [];
        for (const requiredBy of helper.required_by) {
          const requiredPath = safeRelative(requiredBy, `internal helper '${relative}' required_by`);
          if (skillRoot) physicalPath(skillRoot, requiredPath, `internal helper '${relative}' required_by '${requiredPath}'`);
          requiredByPaths.push(requiredPath);
        }
        if (skillRoot) physicalPath(skillRoot, relative, `internal helper '${relative}'`);
        helperEdges.set(relative, requiredByPaths);
      } catch (error) { errors.push(error.message); }
    }
    const inert = record.inert_scripts === undefined ? [] : record.inert_scripts;
    if (!Array.isArray(inert)) errors.push('inert_scripts must be an array');
    else for (const item of inert) {
      if (!isObject(item) || typeof item.path !== 'string') { errors.push('inert_scripts entries require a path'); continue; }
      try {
        const relative = safeRelative(item.path, 'inert script path');
        if (typeof item.reason !== 'string' || item.reason.trim() === '') {
          errors.push(`inert script '${relative}' requires a non-empty reason`);
        }
        if (kinds.has(relative)) errors.push(`coverage path is declared more than once: ${relative}`);
        kinds.set(relative, 'inert_scripts');
        if (skillRoot) physicalPath(skillRoot, relative, `inert script '${relative}'`);
      } catch (error) { errors.push(error.message); }
    }
    for (const [helperPath, requiredByPaths] of helperEdges) {
      for (const callerPath of requiredByPaths) {
        if (!kinds.has(callerPath) || kinds.get(callerPath) === 'inert_scripts') {
          errors.push(`internal helper '${helperPath}' required_by caller '${callerPath}' is not a registered coverage entry`);
          continue;
        }
        if (callerPath === helperPath) {
          errors.push(`internal helper '${helperPath}' lists itself as its caller (self-cycle)`);
          continue;
        }
        let callerText = null;
        try { callerText = readPhysical(skillRoot, callerPath, `internal helper '${helperPath}' caller '${callerPath}'`).text; }
        catch (error) { errors.push(error.message); }
        if (callerText !== null && !callerReferencesHelper(callerText, callerPath, helperPath)) {
          errors.push(`internal helper '${helperPath}' required_by edge is unproven: caller '${callerPath}' contains no local dependency on it`);
        }
      }
    }
    {
      // Helper metadata must describe a DAG; a cycle means no helper in it is
      // grounded by its own caller evidence.
      const color = new Map();
      const reported = new Set();
      const walk = (node, trail) => {
        color.set(node, 'active');
        for (const next of helperEdges.get(node) || []) {
          if (!helperEdges.has(next) || next === node) continue;
          if (color.get(next) === 'active') {
            const cycle = [...trail.slice(trail.indexOf(next)), next].join(' -> ');
            if (!reported.has(cycle)) { reported.add(cycle); errors.push(`internal helper metadata describes a dependency cycle: ${cycle}`); }
          } else if (!color.has(next)) {
            walk(next, [...trail, next]);
          }
        }
        color.set(node, 'done');
      };
      for (const node of helperEdges.keys()) if (!color.has(node)) walk(node, [node]);
    }
    // Reachability: every internal helper's required_by chain must terminate
    // at a declared public entry (executable_entries/api_entries), not just
    // any physically existing file — otherwise a public script could hide
    // behind a bogus required_by (e.g. 'SKILL.md') and dodge fixture coverage.
    const isPublicEntry = (candidate) => {
      const kind = kinds.get(candidate);
      return kind === 'executable_entries' || kind === 'api_entries';
    };
    for (const [helperPath, requiredByPaths] of helperEdges) {
      const visited = new Set([helperPath]);
      const stack = [...requiredByPaths];
      let reached = false;
      while (stack.length > 0) {
        const candidate = stack.pop();
        if (isPublicEntry(candidate)) { reached = true; break; }
        if (visited.has(candidate)) continue;
        visited.add(candidate);
        if (kinds.get(candidate) === 'internal_helpers' && helperEdges.has(candidate)) {
          stack.push(...helperEdges.get(candidate));
        }
      }
      if (!reached) {
        errors.push(`internal helper '${helperPath}' required_by chain never reaches a covered public entry`);
      }
    }
    for (const reference of referencePaths) {
      if (reference.startsWith('scripts/') && EXECUTABLE_EXTENSIONS.has(path.posix.extname(reference))
        && !kinds.has(reference)) {
        errors.push(`script '${reference}' is listed only as a reference; classify it as an executable/API entry or internal helper`);
      }
    }
    const queue = ['SKILL.md', ...referencePaths.filter((value) => /\.md$/i.test(value))];
    const visited = new Set();
    const discovered = new Map();
    while (skillRoot && queue.length > 0) {
      const document = queue.shift();
      if (visited.has(document)) continue;
      visited.add(document);
      let text;
      try { text = readPhysical(skillRoot, document, `Skill '${id}' Markdown resource`).text; }
      catch (error) { errors.push(error.message); continue; }
      for (const candidate of commandCandidates(text)) {
        if (!discovered.has(candidate.path)) discovered.set(candidate.path, { ...candidate, document });
      }
      const linked = localMarkdownLinks(text, document);
      errors.push(...linked.errors);
      for (const link of linked.links) {
        if (!visited.has(link)) {
          try { physicalPath(skillRoot, link, `Skill '${id}' linked Markdown resource`); queue.push(link); }
          catch (error) { errors.push(error.message); }
        }
      }
    }
    for (const candidate of discovered.values()) {
      if (!kinds.has(candidate.path)) {
        errors.push(`documented executable entry '${candidate.path}' is missing from coverage registry (${candidate.document}:${candidate.line})`);
      }
      try {
        if (skillRoot) physicalPath(skillRoot, candidate.path, `documented executable entry '${candidate.path}'`);
      } catch (error) { errors.push(error.message); }
    }
    const capabilities = record.host_capabilities === undefined ? [] : record.host_capabilities;
    const evidence = record.host_evidence === undefined ? {} : record.host_evidence;
    if (!Array.isArray(capabilities) || capabilities.some((capability) => typeof capability !== 'string')) {
      errors.push(`Skill '${id}' host_capabilities must be an array of strings`);
    } else {
      if (!isObject(evidence)) errors.push(`Skill '${id}' host_evidence must be an object`);
      for (const capability of capabilities) {
        const item = isObject(evidence) ? evidence[capability] : null;
        if (!isObject(item) || !HOST_STATUSES.has(item.status)) {
          errors.push(`Skill '${id}' host capability '${capability}' lacks valid evidence`);
        }
      }
      for (const capability of Object.keys(isObject(evidence) ? evidence : {})) {
        if (!capabilities.includes(capability)) errors.push(`Skill '${id}' has host evidence without capability '${capability}'`);
      }
      if (capabilities.length > 0) {
        detail.host = capabilities.some((capability) => evidence[capability]?.status === 'PASS')
          && capabilities.every((capability) => evidence[capability]?.status === 'PASS')
          ? 'PASS'
          : (capabilities.map((capability) => evidence[capability]?.status).find((status) => status && status !== 'PASS') || 'NOT_RUN');
        result.host_evidence[id] = evidence;
      }
    }
    detail.fixtures = fixtureErrors.length > 0
      ? 'FAIL' : (executable.length + api.length === 0 ? 'NOT_APPLICABLE' : 'NOT_RUN');
    if (errors.length > 0) detail.structural = 'FAIL';
    detail.status = errors.length > 0 || fixtureErrors.length > 0 ? 'FAIL' : 'PASS';
    result.errors.push(...errors.map((error) => `${id}: ${error}`));
    result.errors.push(...fixtureErrors.map((error) => `${id}: ${error}`));
  }
  for (const id of Object.keys(coverage.skills)) {
    if (!seenIds.has(id)) result.errors.push(`coverage contains unknown stable Skill identity '${id}'`);
  }
  result.ok = result.errors.length === 0;
  return result;
}

module.exports = { SCHEMA, callerReferencesHelper, validateSkillDirectoryCoverage };
