'use strict';

// Inventory-owned Claude capability bundle selection.  This module is pure
// until the adapter is asked to read canonical skill files; profile selection
// never consults cwd, environment, SessionStart state, or generated folders.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createTraversalBudget, readDirectoryEntries, readFileBounded } = require('./bounded-filesystem');
const {
  compileDistribution,
  materializeDistribution,
  verifyDistribution,
} = require('./distribution-compiler');
const {
  fingerprint,
  projectionError,
} = require('./distribution-projection-contract');
const {
  resolveCapabilitySelection,
  bindSurfaceSelection,
} = require('./capability-bundle-selection');

const BUNDLE_VERSION = 'claude-profile-v1';
const CLAUDE_SURFACE = 'claude-profile';
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(code, message, details = {}) {
  return { ok: false, error: projectionError(code, 'compile', message, details) };
}

function sortedUnique(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim() !== ''))].sort();
}

function stableInput(value) {
  if (Array.isArray(value)) {
    return value.map(stableInput).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableInput(value[key]);
      return out;
    }, {});
  }
  return value;
}

function catalogModules(moduleCatalog) {
  const modules = new Map();
  const add = (id, requires = []) => {
    if (typeof id !== 'string' || id.trim() === '') return;
    const current = modules.get(id) || { id, requires: [] };
    current.requires = sortedUnique([...(current.requires || []), ...requires]);
    modules.set(id, current);
  };
  if (moduleCatalog && Array.isArray(moduleCatalog.modules)) {
    for (const entry of moduleCatalog.modules) add(entry && (entry.id || entry.module), entry && entry.requires);
  }
  for (const stack of moduleCatalog && Array.isArray(moduleCatalog.stacks) ? moduleCatalog.stacks : []) {
    // Stack `requires` values are human-facing stack ids (for example
    // "php"), while profile closure is defined over canonical module ids.
    // Version-level `requires_module` is the canonical dependency edge.
    for (const version of stack && Array.isArray(stack.versions) ? stack.versions : []) {
      add(version && (version.module || version.id), [
        ...(version && version.requires_module ? [version.requires_module] : []),
        ...(version && Array.isArray(version.requires) ? version.requires : []),
      ]);
    }
  }
  return modules;
}

function resolveClosure(selected, modules) {
  const result = [];
  const state = new Map();
  const visit = (id, chain) => {
    if (!modules.has(id)) return { code: 'UNKNOWN_MODULE', message: `profile references unknown module '${id}'` };
    const status = state.get(id);
    if (status === 'done') return null;
    if (status === 'active') {
      return { code: 'MODULE_REQUIREMENT_CYCLE', message: `module requirement cycle detected: ${[...chain, id].join(' -> ')}` };
    }
    state.set(id, 'active');
    for (const dependency of modules.get(id).requires || []) {
      const error = visit(dependency, [...chain, id]);
      if (error) return error;
    }
    state.set(id, 'done');
    result.push(id);
    return null;
  };
  for (const id of selected) {
    const error = visit(id, []);
    if (error) return { error };
  }
  return { modules: result.sort() };
}

function inventoryEntries(inventory) {
  // Module catalog rows and skill rows may intentionally share an id (for
  // example `ios-platform`). Claude materializes skill rows; module rows are
  // closure metadata, not a second physical skill. Reject duplicate skill
  // identities while allowing that declared module/skill relationship.
  const skills = inventory && Array.isArray(inventory.skills) ? inventory.skills : [];
  const modules = inventory && Array.isArray(inventory.modules) ? inventory.modules : [];
  const raw = [...skills, ...modules.filter((entry) => !skills.some((skill) => skill && entry && skill.id === entry.id))];
  const byId = new Map();
  for (const entry of raw) {
    if (!entry || typeof entry.id !== 'string' || entry.id.trim() === '') continue;
    if (byId.has(entry.id)) return { error: { code: 'DUPLICATE_STABLE_ID', message: `duplicate inventory stable id '${entry.id}'` } };
    byId.set(entry.id, entry);
  }
  return { entries: [...byId.values()], byId };
}

function claudeEntry(entry) {
  return entry && Array.isArray(entry.surfaces)
    && (entry.surfaces.includes('claude-core') || entry.surfaces.includes('claude-module'))
    && entry.lifecycle !== 'deprecated';
}

function resolveClaudeProfile({ profileId, profiles, moduleCatalog, inventory, skillIds } = {}) {
  const inventoryResult = inventoryEntries(inventory);
  if (inventoryResult.error) return fail(inventoryResult.error.code, inventoryResult.error.message);
  const profileTable = profiles && profiles.profiles ? profiles.profiles : profiles;
  const requested = profileId === undefined || profileId === null || profileId === '' ? null : profileId;
  if (requested !== null && (typeof requested !== 'string' || !PROFILE_ID_PATTERN.test(requested))) {
    return fail('INVALID_PROFILE_ID', 'profile id must use a finite safe alias');
  }
  if (requested !== null && (!profileTable || typeof profileTable !== 'object'
    || Array.isArray(profileTable) || !Object.prototype.hasOwnProperty.call(profileTable, requested))) {
    return fail('UNKNOWN_PROFILE', `unknown profile '${requested}'`);
  }
  const profile = requested === null ? null : profileTable[requested];
  if (profile && !Array.isArray(profile.modules)) return fail('INVALID_PROFILE', `profile '${requested}' modules must be an array`);

  // Profiles with an inventory-owned stable-ID allowlist use the shared
  // capability selector. Legacy fixture/compatibility profiles without that
  // metadata retain the module-only characterization below until they opt in.
  const canonicalProfile = profile && Array.isArray(profile.skillIds)
    && inventory && inventory.profile_policy;
  if (canonicalProfile) {
    const normalized = resolveCapabilitySelection({
      inventory,
      profiles,
      moduleCatalog,
      profileId: requested,
      surface: CLAUDE_SURFACE,
      skillIds,
      sourceInputs: { profileId: requested, profiles, moduleCatalog },
      policyVersion: inventory.profile_policy.version,
    });
    if (!normalized.ok) return normalized;
    const bound = bindSurfaceSelection({ selection: normalized.value, surface: CLAUDE_SURFACE });
    if (!bound.ok) return bound;
    const canonical = bound.value;
    const selectedSet = new Set(canonical.selectedStableIds);
    const selectedEntries = inventoryResult.entries.filter((entry) => selectedSet.has(entry.id));
    const ownership = selectedEntries.filter((entry) => !claudeEntry(entry));
    if (ownership.length > 0) return fail('UNOWNED_ENTRY', 'profile selected entries outside the Claude projection', { stableIds: ownership.map((entry) => entry.id) });
    const optionalIds = inventoryResult.entries
      .filter((entry) => (entry.lifecycle === 'optional' || entry.tier === 'optional') && entry.lifecycle !== 'deprecated')
      .map((entry) => entry.id);
    const identity = {
      version: BUNDLE_VERSION,
      id: requested,
      profileId: requested,
      modules: canonical.moduleClosure,
      excludes: Object.keys(profile.excludes || {}).sort(),
      mode: canonical.compatibilityMode,
      selectionPolicyVersion: canonical.selectionPolicyVersion,
      sourceFingerprint: canonical.sourceFingerprint,
      inventoryFingerprint: canonical.inventoryFingerprint,
      profileFingerprint: canonical.profileFingerprint,
      selectionFingerprint: canonical.selectionFingerprint,
      surfaceSelectionFingerprint: canonical.surfaceSelectionFingerprint,
    };
    return {
      ok: true,
      value: Object.freeze({
        ...canonical,
        ...identity,
        identity: Object.freeze(identity),
        selectedEntries: selectedEntries.sort((a, b) => a.id.localeCompare(b.id)),
        unavailableOptionalIds: optionalIds.filter((id) => !selectedSet.has(id)).sort(),
        excludedStableIds: optionalIds.filter((id) => !selectedSet.has(id)).sort(),
        inputFingerprint: canonical.sourceFingerprint,
      }),
    };
  }

  const selected = profile ? profile.modules : [];
  if (new Set(selected).size !== selected.length) return fail('DUPLICATE_MODULE', `profile '${requested}' declares duplicate modules`);
  const modules = catalogModules(moduleCatalog);
  const closureResult = resolveClosure(selected, modules);
  if (closureResult.error) return fail(closureResult.error.code, closureResult.error.message);
  const closure = closureResult.modules || [];
  if (profile && profile.excludes !== undefined && (profile.excludes === null
    || typeof profile.excludes !== 'object' || Array.isArray(profile.excludes))) {
    return fail('INVALID_PROFILE', `profile '${requested}' excludes must be an object`);
  }
  const excludes = profile && profile.excludes ? Object.keys(profile.excludes).sort() : [];
  const unknownExclusion = excludes.find((id) => !modules.has(id));
  if (unknownExclusion) return fail('UNKNOWN_MODULE', `profile excludes unknown module '${unknownExclusion}'`);
  const conflict = closure.find((id) => excludes.includes(id));
  if (conflict) return fail('CONFLICTING_EXCLUSION', `profile '${requested}' both selects and excludes module '${conflict}'`);

  const allClaude = inventoryResult.entries.filter((entry) => claudeEntry(entry)
    && !(typeof entry.path === 'string' && entry.path.replace(/\\/g, '/').startsWith('modules/')));
  const core = allClaude.filter((entry) => entry.lifecycle === 'promoted' || entry.tier === 'core');
  const optional = allClaude.filter((entry) => entry.lifecycle === 'optional' || entry.tier === 'optional');
  const selectedModuleSet = new Set(closure);
  const selectedOptional = requested === null
    ? optional
    : optional.filter((entry) => Array.isArray(entry.profiles) && entry.profiles.some((id) => selectedModuleSet.has(id)));
  const selectedEntries = [...core, ...selectedOptional];
  const selectedIds = sortedUnique(selectedEntries.map((entry) => entry.id));
  const ownership = selectedEntries.filter((entry) => !Array.isArray(entry.surfaces)
    || (!entry.surfaces.includes('claude-core') && !entry.surfaces.includes('claude-module')));
  if (ownership.length > 0) return fail('UNOWNED_ENTRY', 'profile selected entries outside the Claude projection', { stableIds: ownership.map((entry) => entry.id) });
  const identity = {
    version: BUNDLE_VERSION,
    id: requested || 'compatibility',
    profileId: requested,
    modules: closure,
    excludes,
    mode: requested === null ? 'compatibility' : 'profile',
  };
  return {
    ok: true,
    value: Object.freeze({
      ...identity,
      identity: Object.freeze(identity),
      selectedStableIds: selectedIds,
      selectedEntries: selectedEntries.sort((a, b) => a.id.localeCompare(b.id)),
      unavailableOptionalIds: inventoryResult.entries
        .filter((entry) => (entry.lifecycle === 'optional' || entry.tier === 'optional')
          && entry.lifecycle !== 'deprecated'
          && !(typeof entry.path === 'string' && entry.path.replace(/\\/g, '/').startsWith('modules/'))
          && !selectedIds.includes(entry.id))
        .map((entry) => entry.id).sort(),
      excludedStableIds: inventoryResult.entries
        .filter((entry) => (entry.lifecycle === 'optional' || entry.tier === 'optional')
          && entry.lifecycle !== 'deprecated'
          && !(typeof entry.path === 'string' && entry.path.replace(/\\/g, '/').startsWith('modules/'))
          && !selectedIds.includes(entry.id))
        .map((entry) => entry.id).sort(),
      moduleClosure: closure,
      profileFingerprint: fingerprint(identity),
      inputFingerprint: fingerprint(stableInput({ profile: requested, profiles, moduleCatalog, inventory })),
    }),
  };
}

function safeSkillName(entry) {
  const value = entry && entry.path ? path.posix.basename(entry.path.replace(/\\/g, '/')) : '';
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

function safeSourcePath(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0
    || relativePath.includes('\0') || relativePath.includes('\\')
    || path.posix.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath === '.' || relativePath === '..' || relativePath.startsWith('../')) {
    return { error: 'inventory skill source path is not a safe relative path' };
  }
  let rootReal;
  try { rootReal = fs.realpathSync(root); } catch (_) { return { error: 'inventory skill source root is unavailable' }; }
  const candidate = path.resolve(rootReal, relativePath, 'SKILL.md');
  const relativeToRoot = path.relative(rootReal, candidate);
  if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    return { error: 'inventory skill source path escapes the source root' };
  }
  let cursor = rootReal;
  const parts = relativePath.split('/');
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) return { error: 'inventory skill source path contains a symlink' };
    } catch (_) { return { error: 'inventory skill source path is missing' }; }
  }
  try {
    if (fs.lstatSync(candidate).isSymbolicLink()) return { error: 'inventory skill source file is a symlink' };
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(rootReal, realCandidate);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      return { error: 'inventory skill source file escapes the source root' };
    }
  } catch (_) { return { error: 'inventory skill source file is missing' }; }
  return { path: candidate };
}

function safeSourceFile(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0
    || relativePath.includes('\0') || relativePath.includes('\\')
    || path.posix.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath === '.' || relativePath === '..' || relativePath.startsWith('../')) {
    return { error: 'source file path is not a safe relative path' };
  }
  let rootReal;
  try { rootReal = fs.realpathSync(root); } catch (_) { return { error: 'source root is unavailable' }; }
  const candidate = path.resolve(rootReal, relativePath);
  const relativeToRoot = path.relative(rootReal, candidate);
  if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    return { error: 'source file path escapes the source root' };
  }
  let cursor = rootReal;
  for (const part of relativePath.split('/')) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) return { error: 'source file path contains a symlink' };
    } catch (_) { return { error: 'source file path is missing' }; }
  }
  try {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) return { error: 'source file must be a regular file' };
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(rootReal, realCandidate);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      return { error: 'source file escapes the source root' };
    }
  } catch (_) { return { error: 'source file is missing' }; }
  return { path: candidate };
}

function commandFileName(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const name = value.endsWith('.md') ? value : `${value}.md`;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name) ? name : null;
}

function enumerateCommandSources(root) {
  const budget = createTraversalBudget({ maxDepth: 8, maxFiles: 512, maxEntries: 2048 });
  const paths = [];
  const walk = (absolute, relative, depth) => {
    const realDirectory = budget.enterDirectory(absolute, depth);
    try {
      for (const entry of readDirectoryEntries(absolute, { budget, sort: true, localeSort: true })) {
        const child = path.join(absolute, entry.name);
        const childRelative = path.posix.join(relative, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`command source contains a symlink: ${childRelative}`);
        if (entry.isDirectory()) walk(child, childRelative, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md') paths.push(childRelative);
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  const roots = [path.join(root, 'commands')];
  let modules;
  try { modules = readDirectoryEntries(path.join(root, 'modules'), { budget, sort: true, localeSort: true }); } catch (_) { modules = []; }
  for (const entry of modules) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const moduleCommands = path.join(root, 'modules', entry.name, 'commands');
    try { if (fs.statSync(moduleCommands).isDirectory()) roots.push(moduleCommands); } catch (_) { /* module has no commands */ }
  }
  for (const directory of roots) {
    try {
      const relative = path.relative(root, directory).split(path.sep).join('/');
      walk(directory, relative, 0);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return paths.sort();
}

function commandSources(selection, root) {
  const profile = selection && selection.profileDefinition;
  const declared = profile && Array.isArray(profile.commandIds)
    ? profile.commandIds.map(commandFileName)
    : null;
  if (declared) {
    if (declared.some((value) => !value)) throw new Error('profile declares an unsafe command id');
    return [...new Set(declared)].sort().map((name) => `commands/${name}`);
  }
  if (selection && (selection.id === 'full' || selection.id === 'compat-v1')) return enumerateCommandSources(root);
  return [];
}

function createBundleEntries(selection, root) {
  const outputs = [{
    stableId: 'claude-profile:manifest',
    source: '.claude-plugin/plugin.json',
    destination: 'plugin.json',
    owner: 'claude-profile',
    transform: { id: 'claude-profile-manifest', version: BUNDLE_VERSION },
  }, {
    stableId: 'claude-profile:receipt',
    source: 'manifests/distribution-inventory.json',
    destination: 'bundle-receipt.json',
    owner: 'claude-profile',
    transform: { id: 'claude-profile-receipt', version: BUNDLE_VERSION },
  }];
  const seenDestinations = new Set(outputs.map((entry) => entry.destination));
  const contentByStableId = new Map();
  for (const entry of selection.selectedEntries) {
    const skillName = safeSkillName(entry);
    if (!skillName) return { error: projectionError('UNSAFE_PATH', 'compile', `inventory skill path is unsafe for '${entry.id}'`) };
    const destination = `skills/${skillName}/SKILL.md`;
    if (seenDestinations.has(destination)) return { error: projectionError('DUPLICATE_OUTPUT_PATH', 'compile', `profile skills collide at '${destination}'`) };
    seenDestinations.add(destination);
    const sourceResult = safeSourcePath(root, entry.path);
    if (sourceResult.error) return { error: projectionError('UNSAFE_PATH', 'compile', `${sourceResult.error}: '${entry.id}'`, { stableIds: [entry.id] }) };
    const source = sourceResult.path;
    let content;
    try { content = readFileBounded(source); } catch (error) {
      return { error: projectionError('UNSAFE_PATH', 'compile', `selected skill source cannot be read safely: '${entry.id}'`, { stableIds: [entry.id], details: { cause: error.message } }) };
    }
    const stableId = `claude-profile:skill:${entry.id}`;
    outputs.push({
      stableId,
      source: entry.path,
      sourceFingerprint: crypto.createHash('sha256').update(content).digest('hex'),
      destination,
      owner: 'claude-profile',
      transform: { id: 'claude-profile-skill', version: BUNDLE_VERSION },
      expectedFingerprint: crypto.createHash('sha256').update(content).digest('hex'),
    });
    contentByStableId.set(stableId, content);
  }
  const commandRoots = new Set();
  let commandPaths;
  try { commandPaths = commandSources(selection, root); } catch (error) {
    return { error: projectionError('UNSAFE_PATH', 'compile', `command source enumeration failed: ${error.message}`) };
  }
  for (const relativePath of commandPaths) {
    const commandName = path.posix.basename(relativePath);
    const sourceResult = safeSourceFile(root, relativePath);
    if (sourceResult.error) {
      return { error: projectionError('UNSAFE_PATH', 'compile', `${sourceResult.error}: '${relativePath}'`) };
    }
    let content;
    try { content = readFileBounded(sourceResult.path); } catch (error) {
      return { error: projectionError('UNSAFE_PATH', 'compile', `selected command source cannot be read safely: '${relativePath}'`, { details: { cause: error.message } }) };
    }
    const destination = relativePath;
    if (seenDestinations.has(destination)) {
      return { error: projectionError('DUPLICATE_OUTPUT_PATH', 'compile', `profile commands collide at '${destination}'`) };
    }
    seenDestinations.add(destination);
    const stableId = `claude-profile:command:${relativePath.slice('commands/'.length).replace(/\.md$/, '')}`;
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    outputs.push({
      stableId,
      source: relativePath,
      sourceFingerprint: digest,
      destination,
      owner: 'claude-profile',
      transform: { id: 'claude-profile-command', version: BUNDLE_VERSION },
      expectedFingerprint: digest,
    });
    contentByStableId.set(stableId, content);
    commandRoots.add(`./${path.posix.dirname(relativePath)}/`.replace('./commands//', './commands/'));
  }
  return { outputs, contentByStableId, commandRoots: [...commandRoots].sort() };
}

function readPlugin(root, commandRoots = []) {
  let rootReal;
  try { rootReal = fs.realpathSync(root); } catch (_) { return null; }
  let cursor = rootReal;
  for (const part of ['.claude-plugin', 'plugin.json']) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (_) { return null; }
    if (stat.isSymbolicLink()) throw new Error('Claude plugin manifest path contains a symlink');
  }
  const relative = path.relative(rootReal, cursor);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Claude plugin manifest path escapes the source root');
  }
  const plugin = JSON.parse(readFileBounded(cursor).toString('utf8'));
  return { ...plugin, skills: ['./skills/'], commands: commandRoots };
}

function compileClaudeCapabilityBundle({ root, inventory, profiles, moduleCatalog, profileId, skillIds, compilerVersion = BUNDLE_VERSION } = {}) {
  if (!inventory || !profiles || !moduleCatalog) return fail('INVALID_INPUT', 'inventory, install profiles, and module catalog are required');
  const selection = resolveClaudeProfile({ profileId, skillIds, profiles, moduleCatalog, inventory });
  if (!selection.ok) return selection;
  const rootPath = root || process.cwd();
  const entryResult = createBundleEntries(selection.value, rootPath);
  if (entryResult.error) return { ok: false, error: entryResult.error };
  const selectionEntries = selection.value.selectedEntries.map((entry) => ({
    id: entry.id,
    source: entry.path,
    destination: entry.path,
    sourceFingerprint: entry.source_fingerprint || entry.sourceFingerprint || null,
    owner: entry.owner || 'claude-profile',
    transform: entry.transform || { id: 'identity', version: '1' },
  }));
  const compiled = compileDistribution({
    compilerVersion,
    surface: CLAUDE_SURFACE,
    entries: entryResult.outputs,
    selectionEntries,
    selectedStableIds: selection.value.selectedStableIds,
    selectionPolicy: { source: 'profile', version: BUNDLE_VERSION, profileId: selection.value.id },
    profileSelection: selection.value.identity,
    compatibilityMode: selection.value.mode,
    inventoryFingerprint: fingerprint(stableInput(inventory)),
    inputFingerprint: selection.value.inputFingerprint,
    ownershipRoot: '.claude-profile',
  });
  if (!compiled.ok) return compiled;
  let plugin;
  try { plugin = readPlugin(rootPath, entryResult.commandRoots); } catch (error) {
    return fail('UNSAFE_PATH', `Claude plugin manifest is unsafe: ${error.message}`);
  }
  return {
    ok: true,
    value: {
      plan: compiled.value,
      selection: selection.value,
      outputs: entryResult.outputs,
      contentByStableId: entryResult.contentByStableId,
      plugin,
    },
  };
}

function createClaudeCapabilityBundleAdapter({ root, compiled } = {}) {
  if (!compiled || !compiled.plan) throw new TypeError('compiled Claude capability bundle is required');
  const contentByStableId = compiled.contentByStableId || new Map();
  const plugin = compiled.plugin || { skills: ['./skills/'] };
  const receipt = {
    schema: 'dhpk.claude-capability-bundle.v1',
    surface: CLAUDE_SURFACE,
    profile: compiled.plan.profile,
    compatibilityMode: compiled.plan.compatibilityMode,
    selectedStableIds: compiled.plan.selectedStableIds,
    consumerPluginId: compiled.plan.profile && compiled.plan.profile.id === 'compatibility'
      ? 'dhpk@dhpk' : `dhpk@dhpk-profile-${compiled.plan.profile.id}`,
    outputs: compiled.outputs.map((entry) => ({ stableId: entry.stableId, destination: entry.destination })),
    unavailableOptionalIds: compiled.selection && compiled.selection.unavailableOptionalIds || [],
    planFingerprint: compiled.plan.planFingerprint,
  };
  const contents = new Map(contentByStableId);
  contents.set('claude-profile:manifest', `${JSON.stringify(plugin, null, 2)}\n`);
  contents.set('claude-profile:receipt', `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    identity: { id: 'claude-capability-bundle', version: BUNDLE_VERSION },
    render: () => ({
      adapter: { id: 'claude-capability-bundle', version: BUNDLE_VERSION },
      outputs: compiled.outputs.map((entry) => ({
        stableId: entry.stableId,
        destination: entry.destination,
        content: contents.get(entry.stableId),
      })),
      metadata: receipt,
    }),
    validate: (rendered) => {
      const actual = new Set((rendered.outputs || []).map((entry) => entry.destination));
      if (!actual.has('plugin.json')) throw new Error('profile bundle manifest is missing');
      if (!actual.has('bundle-receipt.json')) throw new Error('profile bundle receipt is missing');
      return rendered;
    },
    verify: (stage, artifact) => stage === 'structural'
      ? {
        verdict: 'PASS',
        adapter: { id: 'claude-capability-bundle', version: BUNDLE_VERSION },
        claims: [
          'profile bundle structural evidence matches the planned output ledger',
          'consumer runtime is not inferred from structural materialization',
        ],
        observedOutputs: artifact && Array.isArray(artifact.outputs) ? artifact.outputs : [],
        diagnostics: [],
      }
      : {
        verdict: 'NOT_CONFIGURED',
        adapter: { id: 'claude-capability-bundle', version: BUNDLE_VERSION },
        claims: [],
        observedOutputs: [],
        diagnostics: ['Claude consumer runtime requires the configured claude-profile probe'],
      },
    root,
  };
}

function materializeClaudeCapabilityBundle({ compiled, artifactStore, root } = {}) {
  if (!compiled || !compiled.plan) return fail('INVALID_PLAN', 'compiled Claude capability bundle is required');
  const adapter = createClaudeCapabilityBundleAdapter({ root, compiled });
  return materializeDistribution(compiled.plan, adapter, artifactStore);
}

function verifyClaudeCapabilityBundle(stage, artifact, consumerAdapter) {
  return verifyDistribution(stage, artifact, consumerAdapter);
}

module.exports = {
  BUNDLE_VERSION,
  CLAUDE_SURFACE,
  catalogModules,
  resolveClaudeProfile,
  compileClaudeCapabilityBundle,
  createClaudeCapabilityBundleAdapter,
  materializeClaudeCapabilityBundle,
  verifyClaudeCapabilityBundle,
};
