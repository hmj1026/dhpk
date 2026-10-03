'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 4999;
const MAX_DIRECTORY_ENTRIES = 40000;
const MAX_DEPTH = 64;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RETAINED_HOST_ROOTS = new Set(['docs', 'rules']);

function resolveSourceFileAllowlist(physicalRoot, supplied, errors) {
  if (supplied !== undefined) {
    if (!(supplied instanceof Set) || [...supplied].some((item) => typeof item !== 'string')) {
      errors.push('sourceFileAllowlist must be a Set of source-relative paths');
      return null;
    }
    return supplied;
  }

  const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: physicalRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 15000,
  });
  if (rootResult.error) {
    if (rootResult.error.code === 'ENOENT') return null;
    errors.push(`could not identify the source Git checkout: ${rootResult.error.message}`);
    return null;
  }
  if (rootResult.status !== 0) {
    if (!fs.existsSync(path.join(physicalRoot, '.git'))) return null;
    errors.push(`could not identify the source Git checkout: ${(rootResult.stderr || '').trim() || `git exited ${rootResult.status}`}`);
    return null;
  }

  let gitRoot;
  try {
    gitRoot = fs.realpathSync(rootResult.stdout.trim());
  } catch (error) {
    errors.push(`source Git checkout root cannot be resolved: ${error.message}`);
    return null;
  }
  if (gitRoot !== physicalRoot) {
    errors.push('source root must be the Git checkout root or provide an explicit sourceFileAllowlist');
    return null;
  }

  const trackedResult = spawnSync('git', ['ls-tree', '-rz', '--name-only', 'HEAD'], {
    cwd: physicalRoot,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15000,
  });
  if (trackedResult.error || trackedResult.status !== 0) {
    const detail = trackedResult.error ? trackedResult.error.message : (trackedResult.stderr || '').toString('utf8').trim();
    errors.push(`could not enumerate HEAD source paths: ${detail || `git exited ${trackedResult.status}`}`);
    return null;
  }
  let trackedText;
  try {
    trackedText = new TextDecoder('utf-8', { fatal: true }).decode(trackedResult.stdout);
  } catch (_) {
    errors.push('HEAD contains source paths that are not readable UTF-8');
    return null;
  }
  return new Set(trackedText.split('\0').filter((item) => item.length > 0));
}

function originalGitBlobDigest(bytes) {
  return crypto.createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeRelative(value, label, errors) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) {
    errors.push(`${label} must be a contained relative path`);
    return null;
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized !== value) {
    errors.push(`${label} must be a normalized relative path`);
    return null;
  }
  return normalized;
}

function safePath(root, relative, label, errors) {
  const normalized = normalizeRelative(relative, label, errors);
  if (!normalized) return null;
  const candidate = path.resolve(root, ...normalized.split('/'));
  if (!inside(root, candidate)) {
    errors.push(`${label} escapes the source root`);
    return null;
  }
  let current = root;
  for (const segment of normalized.split('/')) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        errors.push(`${label} is missing: ${normalized}`);
        return null;
      }
      errors.push(`${label} cannot be inspected: ${normalized}: ${error.message}`);
      return null;
    }
    if (stat.isSymbolicLink()) {
      errors.push(`${label} contains a symlink: ${normalized}`);
      return null;
    }
  }
  return candidate;
}

function decodeUtf8(bytes, label, errors) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch (_) {
    errors.push(`${label} is not readable UTF-8`);
    return false;
  }
}

function scalarValue(raw) {
  const value = String(raw).trim();
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    try { return JSON.parse(value); } catch (_) { return value.slice(1, -1); }
  }
  if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function validateSkillFrontmatter(bytes, expectedName, label, errors) {
  const content = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push(`${label} is missing valid YAML frontmatter`);
    return;
  }
  const values = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;
    const [, key, raw] = keyMatch;
    if (values.has(key)) errors.push(`${label} has duplicate frontmatter key '${key}'`);
    values.set(key, scalarValue(raw));
  }
  const name = values.get('name');
  const description = values.get('description');
  if (typeof name !== 'string' || !SKILL_NAME.test(name) || name.includes('--')) {
    errors.push(`${label} has an invalid or missing frontmatter name`);
  } else if (name !== expectedName) {
    errors.push(`${label} frontmatter name '${name}' does not match catalog name '${expectedName}'`);
  }
  if (typeof description !== 'string' || description.length < 1 || description.length > 1024) {
    errors.push(`${label} frontmatter description must be a non-empty string of at most 1024 characters`);
  }
}

function mappingKey(ownerId, sourcePath) {
  return `${ownerId}\0${sourcePath}`;
}

function retainedHostResourceEntries(supplied, root, errors) {
  if (supplied === undefined) return [];
  let entries;
  if (supplied instanceof Set) entries = [...supplied].map((source) => [source, source]);
  else if (supplied instanceof Map) entries = [...supplied.entries()];
  else {
    errors.push('retainedHostResourcePaths must be a Set or Map of packaged docs/rules paths');
    return [];
  }
  const normalized = [];
  for (const [sourceValue, destinationValue] of entries) {
    const source = normalizeRelative(sourceValue, 'retained host resource source', errors);
    const destination = normalizeRelative(destinationValue, 'retained host resource destination', errors);
    if (!source || !destination) continue;
    if (!RETAINED_HOST_ROOTS.has(source.split('/')[0]) || !RETAINED_HOST_ROOTS.has(destination.split('/')[0])) {
      errors.push('retained host resource paths must be under docs or rules');
      continue;
    }
    const resolved = safePath(root, source, 'retained host resource', errors);
    if (!resolved) continue;
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch (error) {
      errors.push(`retained host resource cannot be inspected: ${source}: ${error.message}`);
      continue;
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      errors.push(`retained host resource is not a regular file or directory: ${source}`);
      continue;
    }
    normalized.push({ source, destination, isDirectory: stat.isDirectory() });
  }
  return normalized.sort((left, right) => right.source.length - left.source.length
    || (left.source < right.source ? -1 : (left.source > right.source ? 1 : 0)));
}

function resolveRetainedHostResource(sourceRelative, entries, root, allowedSourcePaths, errors, label) {
  const normalized = normalizeRelative(sourceRelative, label, errors);
  if (!normalized) return undefined;
  const ellipsis = normalized.endsWith('/...');
  const directoryReference = ellipsis || normalized.endsWith('/');
  const concrete = ellipsis ? normalized.slice(0, -4) : normalized.replace(/\/$/, '');
  const entry = entries.find((candidate) => concrete === candidate.source
    || (candidate.isDirectory && concrete.startsWith(`${candidate.source}/`)));
  if (!entry || (directoryReference && !entry.isDirectory)) return undefined;
  const tracked = !allowedSourcePaths || (directoryReference
    ? [...allowedSourcePaths].some((file) => file.startsWith(`${concrete}/`))
    : allowedSourcePaths.has(concrete));
  if (!tracked) return undefined;
  const relativeSuffix = concrete === entry.source ? '' : concrete.slice(entry.source.length + 1);
  const resolved = safePath(root, concrete, label, errors);
  if (!resolved) return undefined;
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    errors.push(`${label} cannot be inspected: ${sourceRelative}: ${error.message}`);
    return undefined;
  }
  if (directoryReference ? !stat.isDirectory() : !stat.isFile()) return undefined;
  const destination = relativeSuffix ? path.posix.join(entry.destination, relativeSuffix) : entry.destination;
  return {
    destination: `${destination}${ellipsis ? '/...' : (directoryReference ? '/' : '')}`,
    retained: true,
  };
}

function packageRelative(file, destination) {
  const relative = path.posix.relative(path.posix.dirname(file.path), destination) || path.posix.basename(destination);
  return destination.endsWith('/') && !relative.endsWith('/') ? `${relative}/` : relative;
}

function resolveBundledPath(ownerId, sourceRelative, sourceDestinations, hostOnlyOwnerIds, retainedHostResources, context) {
  if (!normalizeRelative(sourceRelative, context.label, context.errors)) return undefined;
  if (hostOnlyOwnerIds.has(ownerId) && context.preferRetained) {
    const retained = resolveRetainedHostResource(sourceRelative, retainedHostResources,
      context.root, context.allowedSourcePaths, context.errors, context.label);
    if (retained) return retained;
  }
  const bundled = sourceDestinations.get(mappingKey(ownerId, sourceRelative));
  if (bundled) return { destination: bundled, retained: false };
  if (!hostOnlyOwnerIds.has(ownerId)) return undefined;
  if (sourceRelative.endsWith('/') || sourceRelative.endsWith('/...')) {
    const directory = sourceRelative.replace(/\/(?:\.\.\.)?$/, '');
    if (RETAINED_HOST_ROOTS.has(directory.split('/')[0])) {
      const prefix = mappingKey(ownerId, `${directory}/`);
      const inferred = [...sourceDestinations.entries()].find(([source, destination]) =>
        source.startsWith(prefix) && destination.endsWith(source.slice(prefix.length)));
      if (inferred) {
        const destination = inferred[1].slice(0, -inferred[0].slice(prefix.length).length).replace(/\/$/, '');
        return { destination: `${destination}${sourceRelative.endsWith('/...') ? '/...' : '/'}`, retained: false };
      }
    }
  }
  return resolveRetainedHostResource(
    sourceRelative,
    retainedHostResources,
    context.root,
    context.allowedSourcePaths,
    context.errors,
    context.label,
  );
}

function rewriteMarkdownLinks(content, file, sourceDestinations, hostOnlyOwnerIds, retainedHostResources, context) {
  const { errors } = context;
  return String(content).replace(/\]\(([^)]*)\)/g, (whole, rawBody) => {
    const leading = rawBody.match(/^\s*/)[0];
    const trimmed = rawBody.slice(leading.length);
    const angle = trimmed.startsWith('<');
    let targetToken;
    let trailing;
    if (angle) {
      const close = trimmed.indexOf('>');
      if (close < 0) {
        errors.push(`${file.path} contains a malformed Markdown link`);
        return whole;
      }
      targetToken = trimmed.slice(1, close);
      trailing = trimmed.slice(close + 1);
    } else {
      const match = trimmed.match(/^(\S+)([\s\S]*)$/);
      if (!match) return whole;
      [, targetToken, trailing] = match;
    }
    if (!targetToken || targetToken.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(targetToken)) return whole;
    const suffixIndex = targetToken.search(/[?#]/);
    const targetPath = suffixIndex < 0 ? targetToken : targetToken.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? '' : targetToken.slice(suffixIndex);
    if (!targetPath) return whole;

    let sourceRelative;
    if (targetPath.startsWith('${CLAUDE_PLUGIN_ROOT}/')) {
      const rootRelative = targetPath.slice('${CLAUDE_PLUGIN_ROOT}/'.length);
      if (rootRelative === '..' || rootRelative.startsWith('../') || path.posix.isAbsolute(rootRelative)) {
        errors.push(`${file.path} contains a Markdown link escaping the source root '${targetToken}'`);
        return whole;
      }
      sourceRelative = normalizeRelative(rootRelative, file.path, errors);
      if (!sourceRelative) return whole;
    } else {
      if (targetPath.startsWith('/') || targetPath.includes('\\')) {
        errors.push(`${file.path} contains a non-contained local Markdown link '${targetToken}'`);
        return whole;
      }
      sourceRelative = path.posix.normalize(path.posix.join(path.posix.dirname(file.sourcePath), targetPath));
    }
    if (sourceRelative === '..' || sourceRelative.startsWith('../') || path.posix.isAbsolute(sourceRelative)) {
      errors.push(`${file.path} contains a Markdown link escaping the source root '${targetToken}'`);
      return whole;
    }
    const bundled = resolveBundledPath(
      file.ownerId, sourceRelative, sourceDestinations, hostOnlyOwnerIds, retainedHostResources,
      { ...context, label: file.path, preferRetained: targetPath.startsWith('${CLAUDE_PLUGIN_ROOT}/') },
    );
    if (!bundled) {
      errors.push(`${file.path} links to missing or undeclared local resource '${targetToken}'`);
      return whole;
    }
    const bundledTarget = bundled.destination;
    if (bundled.retained && targetPath.startsWith('${CLAUDE_PLUGIN_ROOT}/')) {
      const rootTarget = `\${CLAUDE_PLUGIN_ROOT}/${bundledTarget}${suffix}`;
      const renderedRootTarget = angle ? `<${rootTarget}>` : rootTarget;
      return `](${leading}${renderedRootTarget}${trailing})`;
    }
    if (!targetPath.startsWith('${CLAUDE_PLUGIN_ROOT}/')
      && path.posix.normalize(path.posix.join(path.posix.dirname(file.path), targetPath)) === bundledTarget) return whole;
    const renderedTarget = `${packageRelative(file, bundledTarget)}${suffix}`;
    const rendered = angle ? `<${renderedTarget}>` : renderedTarget;
    return `](${leading}${rendered}${trailing})`;
  });
}

function rewriteRootReferences(content, file, sourceDestinations, hostOnlyOwnerIds, retainedHostResources, context) {
  const { errors } = context;
  return String(content).replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s)`"'<>]+)/g, (whole, rawSource) => {
    const cleaned = rawSource.endsWith('/...') ? rawSource : rawSource.replace(/[.,;:]+$/, '');
    const sourceRelative = normalizeRelative(cleaned, file.path, errors);
    if (!sourceRelative) return whole;
    const trailingPunctuation = rawSource.slice(sourceRelative.length);
    if (sourceRelative === '..' || sourceRelative.startsWith('../') || path.posix.isAbsolute(sourceRelative)) {
      errors.push(`${file.path} contains a plugin-root reference escaping the source root '${rawSource}'`);
      return whole;
    }
    const bundled = resolveBundledPath(
      file.ownerId, sourceRelative, sourceDestinations, hostOnlyOwnerIds, retainedHostResources,
      { ...context, label: file.path, preferRetained: true },
    );
    if (!bundled) {
      errors.push(`${file.path} references missing or undeclared local resource '${rawSource}'`);
      return whole;
    }
    if (bundled.retained) return `\${CLAUDE_PLUGIN_ROOT}/${bundled.destination}${trailingPunctuation}`;
    return `${packageRelative(file, bundled.destination)}${trailingPunctuation}`;
  });
}

function compileMarketplaceSkillContent({ root, inventory, publicationView, sourceFileAllowlist, retainedHostResourcePaths } = {}) {
  const errors = [];
  const files = [];
  let physicalRoot;
  try {
    if (typeof root !== 'string' || root.length === 0) throw new Error('root must be a directory path');
    physicalRoot = fs.realpathSync(root);
    if (!fs.statSync(physicalRoot).isDirectory()) throw new Error('root must be a directory path');
  } catch (error) {
    return { ok: false, errors: [`source root is unavailable: ${error.message}`], files: [], bundleProvenance: null };
  }
  const allowedSourcePaths = resolveSourceFileAllowlist(physicalRoot, sourceFileAllowlist, errors);
  if (errors.length > 0) return { ok: false, errors, files: [], bundleProvenance: null };
  const retainedHostResources = retainedHostResourceEntries(retainedHostResourcePaths, physicalRoot, errors);
  if (errors.length > 0) return { ok: false, errors, files: [], bundleProvenance: null };
  if (!inventory || !Array.isArray(inventory.skills)) errors.push('inventory.skills must be an array');
  if (!publicationView || !Array.isArray(publicationView.publicEntries)
    || !publicationView.bundledChildren || typeof publicationView.bundledChildren !== 'object'
    || Array.isArray(publicationView.bundledChildren)
    || (publicationView.hostOnly !== undefined && !Array.isArray(publicationView.hostOnly))) {
    errors.push('publicationView must contain publicEntries and bundledChildren');
  }
  if (publicationView && publicationView.errors && publicationView.errors.length > 0) {
    errors.push(...publicationView.errors.map((error) => `publication selection: ${error}`));
  }
  if (publicationView && (typeof publicationView.selectionDigest !== 'string' || !/^[a-f0-9]{64}$/.test(publicationView.selectionDigest))) {
    errors.push('publicationView.selectionDigest must be a SHA-256 digest');
  }
  if (errors.length > 0) return { ok: false, errors, files: [], bundleProvenance: null };

  const inventoryById = new Map(inventory.skills.map((skill) => [skill.id, skill]));
  const hostOnlyEntries = publicationView.hostOnly || [];
  const hostOnlyOwnerIds = new Set(hostOnlyEntries.map((entry) => entry && entry.id).filter((id) => typeof id === 'string'));
  const publicEntries = [...publicationView.publicEntries, ...hostOnlyEntries];
  const filesByPath = new Map();
  const sourceToDestination = [];
  const sourceDestinationByOwnerAndPath = new Map();
  const entryIds = [];
  const childIds = [];
  let fileCount = 0;
  let totalBytes = 0;
  let directoryEntryCount = 0;
  let directoryBudgetExceeded = false;

  const addFile = ({ sourceRelative, destination, owner, skill, kind, sourcePath }) => {
    if (allowedSourcePaths && !allowedSourcePaths.has(sourceRelative)) {
      errors.push(`${sourceRelative} is not included in the source file allowlist`);
      return;
    }
    const safeSource = safePath(physicalRoot, sourceRelative, `${skill.id} source`, errors);
    if (!safeSource) return;
    let stat;
    try {
      stat = fs.lstatSync(safeSource);
    } catch (error) {
      errors.push(`${skill.id} source cannot be inspected: ${sourceRelative}: ${error.message}`);
      return;
    }
    if (!stat.isFile()) {
      errors.push(`${skill.id} source is not a regular file: ${sourceRelative}`);
      return;
    }
    if (stat.size > MAX_FILE_BYTES) {
      errors.push(`${sourceRelative} exceeds the ${MAX_FILE_BYTES}-byte source limit`);
      return;
    }
    if (fileCount >= MAX_FILES) {
      errors.push(`submission contains more than ${MAX_FILES} source files`);
      return;
    }
    if (stat.size > MAX_TOTAL_BYTES - totalBytes) {
      errors.push(`submission source files exceed the ${MAX_TOTAL_BYTES}-byte extracted-content limit`);
      return;
    }
    let bytes;
    try {
      bytes = fs.readFileSync(safeSource);
    } catch (error) {
      errors.push(`${skill.id} source is unreadable: ${sourceRelative}: ${error.message}`);
      return;
    }
    if (!decodeUtf8(bytes, sourceRelative, errors)) return;
    const safeDestination = normalizeRelative(destination, `${skill.id} destination`, errors);
    if (!safeDestination) return;
    const existingFile = filesByPath.get(safeDestination);
    if (existingFile) {
      if (existingFile.ownerId === owner.id && existingFile.sourcePath === (sourcePath || sourceRelative)) return existingFile;
      errors.push(`package path collision at ${safeDestination}`);
      return null;
    }
    const sourceKey = mappingKey(owner.id, sourcePath || sourceRelative);
    const priorDestination = sourceDestinationByOwnerAndPath.get(sourceKey);
    if (priorDestination && priorDestination !== safeDestination) {
      errors.push(`${skill.id} source ${sourcePath || sourceRelative} maps to more than one package path for owner ${owner.id}`);
      return null;
    }
    const record = {
      path: safeDestination,
      bytes,
      sourcePath: sourcePath || sourceRelative,
      ownerId: owner.id,
      skillId: skill.id,
      kind,
      mode: stat.mode & 0o777,
    };
    filesByPath.set(safeDestination, record);
    sourceDestinationByOwnerAndPath.set(sourceKey, safeDestination);
    sourceToDestination.push({
      ownerId: owner.id,
      source: record.sourcePath,
      destination: safeDestination,
      originalGitBlobDigest: originalGitBlobDigest(bytes),
    });
    fileCount += 1;
    totalBytes += bytes.length;
    return record;
  };

  const collectTree = (entry, skill, owner, kind) => {
    if (!skill || typeof skill.id !== 'string') {
      errors.push('publication view contains a skill without a stable id');
      return;
    }
    if (typeof skill.name !== 'string' || !SKILL_NAME.test(skill.name) || skill.name.includes('--')) {
      errors.push(`${skill.id}: invalid public skill name '${skill.name || '(missing)'}'`);
      return;
    }
    const sourceRelative = normalizeRelative(skill.path, `${skill.id} inventory path`, errors);
    if (!sourceRelative) return;
    const sourceDirectory = safePath(physicalRoot, sourceRelative, `${skill.id} skill directory`, errors);
    if (!sourceDirectory) return;
    let directoryStat;
    try {
      directoryStat = fs.lstatSync(sourceDirectory);
    } catch (error) {
      errors.push(`${skill.id} skill directory is missing: ${sourceRelative}`);
      return;
    }
    if (!directoryStat.isDirectory()) {
      errors.push(`${skill.id} skill path is not a directory: ${sourceRelative}`);
      return;
    }
    const destinationRoot = kind === 'entry'
      ? path.posix.join('skills', owner.name)
      : path.posix.join('skills', owner.name, 'references', skill.name);
    let foundEntrypoint = false;

    const visit = (currentAbsolute, currentRelative, depth = 0) => {
      if (depth > MAX_DEPTH) {
        errors.push(`${skill.id} exceeds the ${MAX_DEPTH}-level source directory limit`);
        return;
      }
      let directory;
      const entries = [];
      try {
        directory = fs.opendirSync(currentAbsolute, { bufferSize: 32 });
        let item;
        while ((item = directory.readSync()) !== null) {
          directoryEntryCount += 1;
          if (directoryEntryCount > MAX_DIRECTORY_ENTRIES) {
            directoryBudgetExceeded = true;
            errors.push(`submission source exceeds the ${MAX_DIRECTORY_ENTRIES}-entry filesystem limit`);
            break;
          }
          entries.push(item);
        }
      } catch (error) {
        errors.push(`${skill.id} directory is unreadable: ${currentRelative}: ${error.message}`);
        return;
      } finally {
        if (directory) {
          try { directory.closeSync(); } catch (_) { /* closed by the runtime */ }
        }
      }
      if (directoryBudgetExceeded) return;
      entries.sort((left, right) => left.name < right.name ? -1 : (left.name > right.name ? 1 : 0));
      for (const entryItem of entries) {
        if (directoryBudgetExceeded) return;
        if (entryItem.name === '__pycache__' || entryItem.name.endsWith('.pyc') || entryItem.name.endsWith('.pyo')) continue;
        const childSourceRelative = path.posix.join(currentRelative, entryItem.name);
        const childAbsolute = path.join(currentAbsolute, entryItem.name);
        let stat;
        try {
          stat = fs.lstatSync(childAbsolute);
        } catch (error) {
          errors.push(`${skill.id} source cannot be inspected: ${childSourceRelative}: ${error.message}`);
          continue;
        }
        if (stat.isSymbolicLink()) {
          errors.push(`${skill.id} skill tree contains a symlink: ${childSourceRelative}`);
          continue;
        }
        if (stat.isDirectory()) {
          visit(childAbsolute, childSourceRelative, depth + 1);
          continue;
        }
        if (!stat.isFile()) {
          errors.push(`${skill.id} skill tree contains an unsupported filesystem entry: ${childSourceRelative}`);
          continue;
        }
        const relativeInsideSkill = path.posix.relative(sourceRelative, childSourceRelative);
        if (relativeInsideSkill === 'SKILL.md') foundEntrypoint = true;
        const destination = path.posix.join(destinationRoot, relativeInsideSkill);
        const record = addFile({
          sourceRelative: childSourceRelative,
          destination,
          owner,
          skill,
          kind,
        });
        if (relativeInsideSkill === 'SKILL.md' && record) {
          validateSkillFrontmatter(record.bytes, skill.name, `${skill.id} SKILL.md`, errors);
        }
      }
    };

    visit(sourceDirectory, sourceRelative);
    if (!foundEntrypoint) errors.push(`${skill.id} is missing SKILL.md`);
  };

  const collectDependencies = (dependencySkill, owner) => {
    const declared = inventory.standalone_dependencies && inventory.standalone_dependencies[dependencySkill.name];
    const dependencies = declared && Array.isArray(declared.files) ? declared.files : [];
    for (const dependency of dependencies) {
      if (!dependency || typeof dependency.source !== 'string' || typeof dependency.destination !== 'string') {
        errors.push(`${dependencySkill.id} has an invalid standalone dependency declaration`);
        continue;
      }
      const dependencyDestination = normalizeRelative(
        dependency.destination,
        `${dependencySkill.id} standalone dependency destination`,
        errors,
      );
      if (!dependencyDestination) continue;
      addFile({
        sourceRelative: dependency.source,
        destination: path.posix.join('skills', owner.name, 'references', '_dependencies', dependencyDestination),
        owner,
        skill: dependencySkill,
        kind: 'dependency',
      });
    }
  };

  for (const entry of publicEntries) {
    const skill = inventoryById.get(entry.id);
    if (!skill) {
      errors.push(`public entry ${entry.id || '(missing)'} is not in inventory`);
      continue;
    }
    entryIds.push(entry.id);
    collectTree(entry, skill, skill, 'entry');
    const children = publicationView.bundledChildren[entry.id] || [];
    if (!Array.isArray(children)) {
      errors.push(`${entry.id} bundled children must be an array`);
      continue;
    }
    for (const child of children) {
      const childSkill = inventoryById.get(child.id);
      if (!childSkill) {
        errors.push(`${entry.id} child ${child.id || '(missing)'} is not in inventory`);
        continue;
      }
      childIds.push(child.id);
      collectTree(child, childSkill, skill, child.kind || 'reference');
      collectDependencies(childSkill, skill);
    }
    collectDependencies(skill, skill);
  }

  if (errors.length > 0) return { ok: false, errors, files: [], bundleProvenance: null };
  const sourceDestinations = sourceDestinationByOwnerAndPath;
  if (errors.length > 0) return { ok: false, errors, files: [], bundleProvenance: null };
  const orderedFiles = [...filesByPath.values()].sort((left, right) => left.path < right.path ? -1 : (left.path > right.path ? 1 : 0));
  const relocatedFiles = orderedFiles.map((file) => {
    if (path.posix.extname(file.path).toLowerCase() !== '.md') return file;
    let content = file.bytes.toString('utf8');
    const context = { root: physicalRoot, allowedSourcePaths, errors };
    content = rewriteMarkdownLinks(content, file, sourceDestinations, hostOnlyOwnerIds, retainedHostResources, context);
    content = rewriteRootReferences(content, file, sourceDestinations, hostOnlyOwnerIds, retainedHostResources, context);
    return { ...file, bytes: Buffer.from(content, 'utf8') };
  });
  sourceToDestination.sort((left, right) => left.ownerId < right.ownerId
    ? -1
    : (left.ownerId > right.ownerId
      ? 1
      : (left.destination < right.destination ? -1 : (left.destination > right.destination ? 1 : 0))));
  if (errors.length > 0) return { ok: false, errors, files: [], bundleProvenance: null };
  return {
    ok: true,
    errors: [],
    files: relocatedFiles,
    bundleProvenance: {
      selectionDigest: publicationView.selectionDigest,
      entryIds: [...new Set(entryIds)].sort(),
      childIds: [...new Set(childIds)].sort(),
      sourceToDestination,
    },
  };
}

module.exports = { compileMarketplaceSkillContent };
