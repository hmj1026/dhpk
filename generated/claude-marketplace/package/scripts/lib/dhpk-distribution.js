'use strict';

// Single command boundary for deterministic distribution operations.  Package
// libraries own client-specific selection and rendering; this facade owns
// argument validation, the common result envelope, and structural evidence.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  compileAgentPluginPackage,
  materializeAgentPluginPackage,
  validateAgentPluginPackage,
} = require('./agent-plugin-package');
const {
  compileCursorPackage,
  materializeCursorPackage,
  verifyCursorPackage,
} = require('./cursor-plugin-package');
const {
  compileNativePackage,
  materializeNativePackage,
  verifyNativePackage,
  fingerprintDir: fingerprintNative,
} = require('./codex-native-package');
const {
  GENERATOR_VERSION: AGY_GENERATOR_VERSION,
  materializeAgyPluginPackage,
  validateAgyPluginPackage,
} = require('./agy-plugin-package');
const { validateSurfaceReceipt, resolveGeneratedFromTree, assertCleanSourceCheckout } = require('./platform-provenance');
const { resolveCapabilitySelection, bindSurfaceSelection } = require('./capability-bundle-selection');
const { createPreviewSourceSnapshot } = require('./distribution-preview');

const OPERATIONS = Object.freeze(['generate', 'preview', 'validate', 'verify']);
const SURFACES = Object.freeze({
  'openai-submission': Object.freeze({ output: 'generated/openai-submission', adapter: 'openai-submission-package', runtimeProbe: 'OpenAI consumer execution' }),
  'agent-plugin': Object.freeze({ output: 'plugins/dhpk-agent', adapter: 'agent-plugin-package', runtimeProbe: 'Agent Plugin client discovery', run: runAgent }),
  'cursor-plugin': Object.freeze({ output: 'plugins/dhpk-cursor', adapter: 'cursor-plugin-package', runtimeProbe: 'Cursor client discovery', run: runCursor }),
  'codex-native': Object.freeze({ output: 'plugins/dhpk', adapter: 'codex-native-package', runtimeProbe: 'Codex native client discovery', run: runCodex }),
  'agy-plugin': Object.freeze({ output: 'plugins/dhpk-agy', adapter: 'agy-plugin-package', runtimeProbe: 'AGY native client discovery', run: runAgy }),
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveSourceCommit(root) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const commit = result.status === 0 ? result.stdout.trim() : '';
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('unable to resolve a 40-character source commit');
  return commit;
}

function parseRequest(argv) {
  const positional = [];
  const options = { json: false, output: null, version: null, manifest: null, profileId: null, skillIds: [], standaloneSkillIds: [], profileExplicit: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--manifest') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'a manifest option value is required' };
      options.manifest = value;
    }
    else if (arg.startsWith('--manifest=')) {
      const value = arg.slice('--manifest='.length);
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'a manifest option value is required' };
      options.manifest = value;
    }
    else if (arg === '--output') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      options.output = value;
    }
    else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length);
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      options.output = value;
    }
    else if (arg === '--version') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      options.version = value;
    }
    else if (arg.startsWith('--version=')) {
      const value = arg.slice('--version='.length);
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      options.version = value;
    }
    else if (arg === '--profile') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      options.profileId = value;
      options.profileExplicit = true;
    }
    else if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length);
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      options.profileId = value;
      options.profileExplicit = true;
    }
    else if (arg === '--skill') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      options.skillIds.push(value);
    }
    else if (arg.startsWith('--skill=')) {
      const value = arg.slice('--skill='.length);
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      options.skillIds.push(value);
    }
    else if (arg === '--standalone') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      if (!options.standaloneSkillIds.includes(value)) options.standaloneSkillIds.push(value);
    }
    else if (arg.startsWith('--standalone=')) {
      const value = arg.slice('--standalone='.length);
      if (!value || value.startsWith('--')) return { ok: false, status: 64, error: 'an option value is required' };
      if (!options.standaloneSkillIds.includes(value)) options.standaloneSkillIds.push(value);
    }
    else if (arg.startsWith('--')) return { ok: false, status: 64, error: `unknown option '${arg}'` };
    else positional.push(arg);
  }
  const [surface, operation] = positional;
  if (!SURFACES[surface]) return { ok: false, status: 64, error: `unknown surface '${surface || ''}'` };
  if (!OPERATIONS.includes(operation)) return { ok: false, status: 64, error: `unknown operation '${operation || ''}'` };
  if (positional.length !== 2) return { ok: false, status: 64, error: 'usage: dhpk distribution <surface> <generate|preview|validate|verify> [--output <dir>] [--version <version>] [--json]' };
  if (surface === 'openai-submission') {
    if (operation === 'preview') {
      return { ok: false, status: 64, error: 'preview is supported only for agent-plugin, cursor-plugin, codex-native, and agy-plugin' };
    }
    if (options.profileId || options.skillIds.length || options.standaloneSkillIds.length) {
      return { ok: false, status: 64, error: 'OpenAI submission requires the complete public catalog; partial selectors are forbidden' };
    }
    if (operation === 'generate' && !options.manifest) {
      return { ok: false, status: 64, error: 'OpenAI submission generation requires --manifest <portable-plugin.json>' };
    }
  } else if (options.manifest) {
    return { ok: false, status: 64, error: '--manifest is only supported for openai-submission' };
  }
  if (operation === 'preview' && options.output) {
    return { ok: false, status: 64, error: 'preview uses a disposable temporary output and does not accept --output' };
  }
  if (options.standaloneSkillIds.length > 0 && (options.profileId || options.skillIds.length > 0)) {
    return { ok: false, status: 64, error: '--standalone cannot be combined with --profile or --skill' };
  }
  return {
    ok: true,
    surface,
    operation,
    options: Object.freeze({
      ...options,
      skillIds: Object.freeze(options.skillIds.slice()),
      standaloneSkillIds: Object.freeze(options.standaloneSkillIds.slice()),
    }),
  };
}

function runtime(root, request) {
  // Provenance-bound generation must freeze a clean source tree. validate/verify
  // only read an already-materialized package, so a dirty checkout (including
  // parallel CI workers writing fixtures) must not fail them.
  if (request.operation === 'generate') assertCleanSourceCheckout(root);
  const inventory = readJson(path.join(root, 'manifests', 'distribution-inventory.json'));
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  const profiles = readJson(path.join(root, 'manifests', 'install-profiles.json'));
  const moduleCatalog = readJson(path.join(root, 'manifests', 'module-catalog.json'));
  const output = path.resolve(root, request.options.output || SURFACES[request.surface].output);
  let receiptProfileId = null;
  let receiptStandaloneSkillIds = [];
  let receiptSelectionMode = null;
  if (request.operation !== 'generate') {
    try {
      const receipt = readJson(path.join(output, 'provenance.json'));
      receiptProfileId = typeof receipt.profileId === 'string' ? receipt.profileId : null;
      receiptSelectionMode = receipt.selectionMode || null;
      receiptStandaloneSkillIds = Array.isArray(receipt.requestedStableIds) ? receipt.requestedStableIds : [];
    } catch (_) { /* validation reports the missing/invalid receipt later */ }
  }
  const standaloneSkillIds = request.options.standaloneSkillIds.length > 0
    ? request.options.standaloneSkillIds
    : (receiptSelectionMode === 'standalone' ? receiptStandaloneSkillIds : []);
  const standalone = standaloneSkillIds.length > 0;
  const profileId = standalone ? null : request.options.profileId || receiptProfileId;
  let profileSelection = null;
  if (profileId || request.options.skillIds.length > 0 || standalone) {
    const selectionProfileId = profileId || 'minimal';
    const resolved = resolveCapabilitySelection({
      inventory,
      profiles,
      moduleCatalog,
      profileId: standalone ? null : selectionProfileId,
      skillIds: request.options.skillIds,
      standaloneSkillIds: standaloneSkillIds.length > 0 ? standaloneSkillIds : undefined,
      surface: request.surface,
      sourceInputs: { profileId: standalone ? null : selectionProfileId, skillIds: request.options.skillIds, standaloneSkillIds },
      policyVersion: inventory.profile_policy && inventory.profile_policy.version,
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    const supportedStableIds = request.surface === 'codex-native'
      ? inventory.skills.filter((entry) => Array.isArray(entry.surfaces) && entry.surfaces.includes('codex-native')).map((entry) => entry.id)
      : null;
    const bound = bindSurfaceSelection({ selection: resolved.value, surface: request.surface, supportedStableIds });
    if (!bound.ok) throw new Error(bound.error.message);
    profileSelection = bound.value;
  }
  const sourceCommit = resolveSourceCommit(root);
  const targetTree = resolveGeneratedFromTree(root, sourceCommit);
  if (!targetTree) throw new Error('unable to resolve the target source tree');
  return {
    root,
    inventory,
    version: request.options.version || manifest.version,
    sourceCommit,
    targetTree,
    output,
    manifest,
    profiles,
    moduleCatalog,
    profileSelection,
  };
}

function receiptErrors(surface, output, context = null) {
  const receiptPath = path.join(output, 'provenance.json');
  if (!fs.existsSync(receiptPath)) return ['provenance.json is missing'];
  try {
    const receipt = readJson(receiptPath);
    // AGY has its own package receipt schema, which deliberately embeds the
    // common provenance fields instead of replacing its native contract.
    const commonReceipt = surface === 'agy-plugin'
      ? { ...receipt, schema: receipt.provenanceSchema }
      : receipt;
    const validationContext = context
      ? {
        root: context.root,
        targetCommit: context.sourceCommit,
        targetTree: context.targetTree,
        allowPreview: context.allowPreview === true,
      }
      : undefined;
    return validateSurfaceReceipt(commonReceipt, surface, validationContext).errors;
  } catch (error) {
    return [`provenance.json is not valid JSON: ${error.message}`];
  }
}

function mergeReceipt(surface, output, result, context) {
  const receipt = receiptErrors(surface, output, context);
  const errors = [...(result.details.errors || []), ...receipt];
  return { ok: result.ok && errors.length === 0, details: { ...result.details, errors } };
}

function assertOwnedGenerationTarget(surface, output) {
  let stat;
  try {
    stat = fs.lstatSync(output);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`refusing foreign output: ${output} must be a physical package directory`);
  }
  const errors = receiptErrors(surface, output);
  if (errors.length > 0) {
    throw new Error(`refusing to replace output without a valid ${surface} owner receipt: ${errors.join('; ')}`);
  }
}

function runAgent(operation, context) {
  if (operation === 'generate' || operation === 'preview') {
    const compiledProjection = compileAgentPluginPackage({
      inventory: context.inventory, root: context.root, outDir: context.output, name: 'dhpk', version: context.version,
      sourceCommit: context.sourceCommit, manifestMetadata: context.manifest,
      profileSelection: context.profileSelection,
      publication: context.publication,
    });
    const result = materializeAgentPluginPackage({
      inventory: context.inventory, root: context.root, outDir: context.output, name: 'dhpk', version: context.version,
      sourceCommit: context.sourceCommit, manifestMetadata: context.manifest, compiledProjection,
      profileSelection: context.profileSelection,
      publication: context.publication,
    });
    const validation = validateAgentPluginPackage(context.output, { allowlist: context.inventory.portable_frontmatter && context.inventory.portable_frontmatter.allowlist, inventory: context.inventory, profileSelection: context.profileSelection });
    return mergeReceipt('agent-plugin', context.output, { ok: validation.ok, details: { skillCount: result.skillIds.length, warnings: validation.warnings, errors: validation.errors } }, context);
  }
  const validation = validateAgentPluginPackage(context.output, { allowlist: context.inventory.portable_frontmatter && context.inventory.portable_frontmatter.allowlist, inventory: context.inventory, profileSelection: context.profileSelection });
  return mergeReceipt('agent-plugin', context.output, { ok: validation.ok, details: { warnings: validation.warnings, errors: validation.errors } }, context);
}

function runCursor(operation, context) {
  if (operation === 'generate' || operation === 'preview') {
    const compiledProjection = compileCursorPackage({ inventory: context.inventory, root: context.root, outDir: context.output, version: context.version, sourceCommit: context.sourceCommit, profileSelection: context.profileSelection, publication: context.publication });
    const result = materializeCursorPackage({ inventory: context.inventory, root: context.root, outDir: context.output, version: context.version, sourceCommit: context.sourceCommit, compiledProjection, profileSelection: context.profileSelection, publication: context.publication });
    const validation = verifyCursorPackage({ packageRoot: context.output, stage: 'structural', inventory: context.inventory }).structural;
    return mergeReceipt('cursor-plugin', context.output, { ok: validation.ok, details: { skillCount: result.skillNames.length, warnings: validation.warnings, errors: validation.errors } }, context);
  }
  const validation = verifyCursorPackage({ packageRoot: context.output, stage: 'structural', inventory: context.inventory }).structural;
  return mergeReceipt('cursor-plugin', context.output, { ok: validation.ok, details: { warnings: validation.warnings, errors: validation.errors } }, context);
}

function runCodex(operation, context) {
  if (operation === 'generate' || operation === 'preview') {
    const compiledProjection = compileNativePackage({ inventory: context.inventory, root: context.root, outDir: context.output, name: 'dhpk', version: context.version, sourceCommit: context.sourceCommit, profileSelection: context.profileSelection, publication: context.publication });
    const result = materializeNativePackage({ inventory: context.inventory, root: context.root, outDir: context.output, name: 'dhpk', version: context.version, sourceCommit: context.sourceCommit, compiledProjection, profileSelection: context.profileSelection, publication: context.publication });
    const validation = verifyNativePackage({ packageRoot: context.output, inventory: context.inventory, sourceRoot: context.root, stage: 'structural', profileSelection: context.profileSelection });
    return mergeReceipt('codex-native', context.output, { ok: validation.ok, details: { skillCount: result.skillIds.length, errors: validation.errors } }, context);
  }
  if (operation === 'verify') {
    const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-codex-native-verify-'));
    try {
      // A receipt records the commit that materialized this projection.  It is
      // provenance, not source content: comparing it to the command's current
      // HEAD would make every later commit look like package drift.
      const sourceCommit = readJson(path.join(context.output, 'provenance.json')).sourceCommit;
      const compiledProjection = compileNativePackage({ inventory: context.inventory, root: context.root, outDir: temporary, name: 'dhpk', version: context.version, sourceCommit, profileSelection: context.profileSelection });
      materializeNativePackage({ inventory: context.inventory, root: context.root, outDir: temporary, name: 'dhpk', version: context.version, sourceCommit, compiledProjection, profileSelection: context.profileSelection });
      const validation = verifyNativePackage({ packageRoot: context.output, inventory: context.inventory, sourceRoot: context.root, stage: 'structural', profileSelection: context.profileSelection });
      const deterministic = fingerprintNative(temporary) === fingerprintNative(context.output);
      return mergeReceipt('codex-native', context.output, {
        ok: validation.ok && deterministic,
        details: { deterministic: deterministic ? 'PASS' : 'FAIL', errors: [...validation.errors, ...(deterministic ? [] : ['tracked Codex native package drifted from a fresh generation'])] },
      }, context);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  const validation = verifyNativePackage({ packageRoot: context.output, inventory: context.inventory, sourceRoot: context.root, stage: 'structural', profileSelection: context.profileSelection });
  return mergeReceipt('codex-native', context.output, { ok: validation.ok, details: { errors: validation.errors } }, context);
}

function runAgy(operation, context) {
  if (operation === 'generate' || operation === 'preview') {
    const result = materializeAgyPluginPackage({
      root: context.root, inventory: context.inventory, outDir: context.output, version: context.version,
      sourceVersion: context.manifest.version, sourceCommit: context.sourceCommit, generatorVersion: AGY_GENERATOR_VERSION,
      profileSelection: context.profileSelection,
      publication: context.publication,
    });
    const validation = validateAgyPluginPackage(context.output, { inventory: context.inventory, sourceRoot: context.root, expectedVersion: context.version, profileSelection: context.profileSelection, allowPreview: context.allowPreview });
    return mergeReceipt('agy-plugin', context.output, { ok: validation.ok, details: { agentCount: result.selected.agents.length, skillCount: result.selected.skills.length, warnings: validation.warnings, errors: validation.errors } }, context);
  }
  const validation = validateAgyPluginPackage(context.output, { inventory: context.inventory, sourceRoot: context.root, expectedVersion: context.version, profileSelection: context.profileSelection });
  return mergeReceipt('agy-plugin', context.output, { ok: validation.ok, details: { warnings: validation.warnings, errors: validation.errors } }, context);
}

function execute(argv, root) {
  const request = parseRequest(argv);
  if (!request.ok) return request;
  let snapshot = null;
  let previewOutput = null;
  try {
    if (request.surface === 'openai-submission') {
      return require('./openai-submission-command').executeOpenaiSubmission(request, root);
    }
    let effectiveRequest = request;
    if (request.operation === 'preview') {
      snapshot = createPreviewSourceSnapshot(root);
      const output = request.options.output
        ? path.resolve(request.options.output)
        : path.join(fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-preview-output-'))), request.surface);
      const sourceReal = fs.realpathSync(root);
      let outputParent = path.dirname(output);
      while (!fs.existsSync(outputParent)) outputParent = path.dirname(outputParent);
      const outputParentReal = fs.realpathSync(outputParent);
      const outputRealCandidate = path.join(outputParentReal, path.basename(output));
      const outputRelative = path.relative(sourceReal, outputRealCandidate);
      if (outputRelative === '' || (!outputRelative.startsWith(`..${path.sep}`) && outputRelative !== '..' && !path.isAbsolute(outputRelative))) {
        throw new Error('preview output must be outside the source checkout');
      }
      if (fs.existsSync(output)) throw new Error(`preview output must not already exist: ${output}`);
      previewOutput = output;
      effectiveRequest = {
        ...request,
        options: Object.freeze({ ...request.options, output }),
      };
    }
    const context = runtime(snapshot ? snapshot.root : root, effectiveRequest);
    if (request.operation === 'generate') assertOwnedGenerationTarget(request.surface, context.output);
    if (snapshot) {
      context.allowPreview = true;
      context.publication = {
        publicationMode: 'preview',
        releaseEligible: false,
        origin: {
          baseCommit: snapshot.baseCommit,
          baseTree: snapshot.baseTree,
          snapshotCommit: snapshot.snapshotCommit,
          snapshotTree: snapshot.snapshotTree,
          changeCounts: snapshot.changeCounts,
        },
      };
    }
    const surface = SURFACES[request.surface];
    const result = surface.run(request.operation === 'preview' ? 'preview' : request.operation, context);
    const evidence = {
      stage: 'structural',
      runtime: 'NOT_RUN',
      reason: `This command verifies deterministic package structure; ${surface.runtimeProbe} is a separate evidence-bound probe.`,
      ...(context.publication ? {
        publicationMode: context.publication.publicationMode,
        releaseEligible: context.publication.releaseEligible,
        origin: context.publication.origin,
      } : {}),
    };
    const response = {
      ok: result.ok,
      status: result.ok ? 0 : 1,
      payload: {
        surface: request.surface,
        operation: request.operation,
        verdict: result.ok ? 'PASS' : 'FAIL',
        output: context.output,
        evidence,
        ...result.details,
      },
    };
    if (snapshot) snapshot.cleanup();
    if (snapshot && !result.ok && previewOutput) fs.rmSync(previewOutput, { recursive: true, force: true });
    return response;
  } catch (error) {
    if (snapshot) snapshot.cleanup();
    if (previewOutput) fs.rmSync(previewOutput, { recursive: true, force: true });
    return { ok: false, status: 1, error: error.message };
  }
}

module.exports = { OPERATIONS, SURFACES, parseRequest, execute };
