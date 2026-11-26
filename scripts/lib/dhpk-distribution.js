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
  CODEX_NATIVE_PROFILE_ID,
  resolveCodexNativeProfileSelection,
  recognizesLegacyCodexNativeReceipt,
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
const { lstatOrNull } = require('./bounded-filesystem');
const {
  ON_DEMAND_SURFACES,
  isOnDemandSurface,
  onDemandRelativeDir,
  archiveOnDemandPackage,
  withOnDemandSurfaceLock,
} = require('./on-demand-packages');

const OPERATIONS = Object.freeze(['generate', 'preview', 'validate', 'verify']);
const SURFACES = Object.freeze({
  'openai-submission': Object.freeze({ output: 'dist/openai-submission', adapter: 'openai-submission-package', runtimeProbe: 'OpenAI consumer execution' }),
  'agent-plugin': Object.freeze({ output: onDemandRelativeDir('agent-plugin'), adapter: 'agent-plugin-package', runtimeProbe: 'Agent Plugin client discovery', run: runAgent }),
  'cursor-plugin': Object.freeze({ output: onDemandRelativeDir('cursor-plugin'), adapter: 'cursor-plugin-package', runtimeProbe: 'Cursor client discovery', run: runCursor }),
  'codex-native': Object.freeze({ output: 'plugins/dhpk', adapter: 'codex-native-package', runtimeProbe: 'Codex native client discovery', run: runCodex }),
  'agy-plugin': Object.freeze({ output: onDemandRelativeDir('agy-plugin'), adapter: 'agy-plugin-package', runtimeProbe: 'AGY native client discovery', run: runAgy }),
});

const DISTRIBUTION_OPTIONS_HELP = 'options: --output <dir> --version <version> --manifest <path> --skill <id> --standalone <id> --json --help';

function helpFor({ building = false, surface = null, operation = null } = {}) {
  if (!building && !surface) {
    return [
      'usage: dhpk distribution <surface> <operation> [options]',
      '       dhpk distribution build <surface> [options]',
      `surfaces: ${Object.keys(SURFACES).join(' | ')}`,
      `operations: ${OPERATIONS.join(' | ')}`,
      `build surfaces: ${ON_DEMAND_SURFACES.join(' | ')}`,
      DISTRIBUTION_OPTIONS_HELP,
      '',
    ].join('\n');
  }
  if (building && !surface) {
    return [
      'usage: dhpk distribution build <surface> [options]',
      `build surfaces: ${ON_DEMAND_SURFACES.join(' | ')}`,
      DISTRIBUTION_OPTIONS_HELP,
      '',
    ].join('\n');
  }
  if (building && surface) {
    return [
      `usage: dhpk distribution build ${surface} [options]`,
      DISTRIBUTION_OPTIONS_HELP,
      '',
    ].join('\n');
  }
  if (!operation) {
    return [
      `usage: dhpk distribution ${surface} <operation> [options]`,
      `operations: ${OPERATIONS.join(' | ')}`,
      DISTRIBUTION_OPTIONS_HELP,
      '',
    ].join('\n');
  }
  return [
    `usage: dhpk distribution ${surface} ${operation} [options]`,
    DISTRIBUTION_OPTIONS_HELP,
    '',
  ].join('\n');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveSourceCommit(root) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const commit = result.status === 0 ? result.stdout.trim() : '';
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('unable to resolve a 40-character source commit');
  return commit;
}

const VALUE_OPTION_HANDLERS = {
  '--manifest': (options, value) => { options.manifest = value; },
  '--output': (options, value) => { options.output = value; },
  '--version': (options, value) => { options.version = value; },
  '--skill': (options, value) => { options.skillIds.push(value); },
  '--standalone': (options, value) => { if (!options.standaloneSkillIds.includes(value)) options.standaloneSkillIds.push(value); },
};

function missingValueError(optionName) {
  return optionName === '--manifest' ? 'a manifest option value is required' : 'an option value is required';
}

function validateDistributionOptions({ surface = null, operation = null, options }) {
  if (surface === 'openai-submission') {
    if (operation === 'preview') {
      return { ok: false, status: 64, error: 'preview is supported only for agent-plugin, cursor-plugin, codex-native, and agy-plugin' };
    }
    if (options.skillIds.length || options.standaloneSkillIds.length) {
      return { ok: false, status: 64, error: 'OpenAI submission requires the complete public catalog; partial selectors are forbidden' };
    }
  } else if (options.manifest) {
    return { ok: false, status: 64, error: '--manifest is only supported for openai-submission' };
  }
  if (operation === 'preview' && options.output) {
    return { ok: false, status: 64, error: 'preview uses a disposable temporary output and does not accept --output' };
  }
  if (options.standaloneSkillIds.length > 0 && options.skillIds.length > 0) {
    return { ok: false, status: 64, error: '--standalone cannot be combined with --skill' };
  }
  return null;
}

function parseRequest(argv = []) {
  const positional = [];
  let help = false;
  const options = { json: false, output: null, version: null, manifest: null, skillIds: [], standaloneSkillIds: [] };
  if (argv.length === 0) {
    return {
      ok: true,
      help: true,
      building: false,
      surface: null,
      operation: null,
      options: Object.freeze({
        ...options,
        skillIds: Object.freeze([]),
        standaloneSkillIds: Object.freeze([]),
      }),
    };
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--profile' || arg.startsWith('--profile=')) {
      return { ok: false, status: 64, error: '--profile is no longer supported; the common collection is selected automatically' };
    } else {
      const equalsIndex = arg.indexOf('=');
      const optionName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
      const handler = VALUE_OPTION_HANDLERS[optionName];
      if (handler) {
        const value = equalsIndex === -1 ? argv[++index] : arg.slice(equalsIndex + 1);
        if (!value || value.startsWith('--') || value === '-h') {
          return { ok: false, status: 64, error: missingValueError(optionName) };
        }
        handler(options, value);
      } else if (arg.startsWith('-')) {
        return { ok: false, status: 64, error: `unknown option '${arg}'` };
      } else {
        positional.push(arg);
      }
    }
  }
  const frozenOptions = Object.freeze({
    ...options,
    skillIds: Object.freeze(options.skillIds.slice()),
    standaloneSkillIds: Object.freeze(options.standaloneSkillIds.slice()),
  });
  // `build <surface>` is the on-demand form: generate, validate, archive.
  const building = positional[0] === 'build';
  if (help && positional.length <= 1) {
    if (positional.length === 0) {
      const optionError = validateDistributionOptions({ options: frozenOptions });
      if (optionError) return optionError;
      return { ok: true, help: true, building: false, surface: null, operation: null, options: frozenOptions };
    }
    if (building) {
      const optionError = validateDistributionOptions({ operation: 'build', options: frozenOptions });
      if (optionError) return optionError;
      return { ok: true, help: true, building: true, surface: null, operation: 'build', options: frozenOptions };
    }
    const surface = positional[0];
    if (!SURFACES[surface]) return { ok: false, status: 64, error: `unknown surface '${surface}'` };
    const optionError = validateDistributionOptions({ surface, options: frozenOptions });
    if (optionError) return optionError;
    return { ok: true, help: true, building: false, surface, operation: null, options: frozenOptions };
  }
  const [surface, operation] = building ? [positional[1], 'build'] : positional;
  if (building && !isOnDemandSurface(surface)) {
    return { ok: false, status: 64, error: `build is supported only for ${ON_DEMAND_SURFACES.join(', ')}; other surfaces use generate` };
  }
  if (!SURFACES[surface]) return { ok: false, status: 64, error: `unknown surface '${surface || ''}'` };
  if (!building && !OPERATIONS.includes(operation)) return { ok: false, status: 64, error: `unknown operation '${operation || ''}'` };
  if (positional.length !== 2) return { ok: false, status: 64, error: 'usage: dhpk distribution <surface> <generate|preview|validate|verify> | build <surface> [--output <dir>] [--version <version>] [--json]' };
  const optionError = validateDistributionOptions({ surface, operation, options: frozenOptions });
  if (optionError) return optionError;
  return {
    ok: true,
    ...(help ? { help: true, building } : {}),
    surface,
    operation,
    options: frozenOptions,
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
  let receipt = null;
  let receiptProfileId = null;
  let receiptStandaloneSkillIds = [];
  let receiptSelectionMode = null;
  if (request.operation !== 'generate') {
    try {
      receipt = readJson(path.join(output, 'provenance.json'));
      receiptProfileId = typeof receipt.profileId === 'string'
        ? receipt.profileId
        : (typeof (receipt.installation && receipt.installation.profileId) === 'string' ? receipt.installation.profileId : null);
      receiptSelectionMode = receipt.selectionMode || null;
      receiptStandaloneSkillIds = Array.isArray(receipt.requestedStableIds) ? receipt.requestedStableIds : [];
    } catch (_) { /* validation reports the missing/invalid receipt later */ }
  }
  const legacyCodexReceipt = request.surface === 'codex-native'
    && recognizesLegacyCodexNativeReceipt({ receipt, root, inventory });
  const standaloneSkillIds = request.options.standaloneSkillIds.length > 0
    ? request.options.standaloneSkillIds
    : (receiptSelectionMode === 'standalone' ? receiptStandaloneSkillIds : []);
  const standalone = standaloneSkillIds.length > 0;
  const defaultToCommon = request.operation === 'generate' || request.operation === 'preview' || request.options.skillIds.length > 0;
  const defaultProfileId = request.surface === 'codex-native' ? CODEX_NATIVE_PROFILE_ID : 'common';
  const profileId = standalone ? null : legacyCodexReceipt
    ? CODEX_NATIVE_PROFILE_ID
    : receiptProfileId || ((defaultToCommon || (request.surface === 'codex-native' && request.operation === 'verify')) ? defaultProfileId : null);
  let profileSelection = null;
  if (profileId || request.options.skillIds.length > 0 || standalone) {
    const selectionProfileId = profileId || 'common';
    if (request.surface === 'codex-native'
      && selectionProfileId === CODEX_NATIVE_PROFILE_ID
      && request.options.skillIds.length === 0
      && !standalone) {
      profileSelection = resolveCodexNativeProfileSelection({ root, inventory, profiles, moduleCatalog });
    } else {
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
  const stat = lstatOrNull(output);
  if (!stat) return;
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

// On-demand build: generate the package into its (gitignored) output, require
// it to validate, then archive it for the GitHub Release.
function executeBuild(request, root) {
  try {
    const context = runtime(root, { ...request, operation: 'generate' });
    return withOnDemandSurfaceLock(context.output, () => {
      assertOwnedGenerationTarget(request.surface, context.output);
      const surface = SURFACES[request.surface];
      const result = surface.run('generate', context);
      const archive = result.ok
        ? archiveOnDemandPackage({ surface: request.surface, packageDir: context.output, version: context.version })
        : null;
      return {
        ok: result.ok,
        status: result.ok ? 0 : 1,
        payload: {
          surface: request.surface,
          operation: 'build',
          verdict: result.ok ? 'PASS' : 'FAIL',
          output: context.output,
          ...(archive ? { archive: archive.archivePath, archiveSha256: archive.sha256 } : {}),
          evidence: {
            stage: 'structural',
            runtime: 'NOT_RUN',
            reason: `This command builds and verifies deterministic package structure; ${surface.runtimeProbe} is a separate evidence-bound probe.`,
          },
          ...result.details,
        },
      };
    });
  } catch (error) {
    return { ok: false, status: 1, error: error.message };
  }
}

function execute(argv, root) {
  const request = parseRequest(argv);
  if (!request.ok) return request;
  if (request.help) return { ok: true, status: 0, help: helpFor(request) };
  if (request.operation === 'build') return executeBuild(request, root);
  let snapshot = null;
  let previewOutput = null;
  // The mkdtemp parent of a default preview output; ours to remove on failure.
  let previewParent = null;
  try {
    if (request.surface === 'openai-submission') {
      return require('./openai-submission-command').executeOpenaiSubmission(request, root);
    }
    let effectiveRequest = request;
    if (request.operation === 'preview') {
      snapshot = createPreviewSourceSnapshot(root);
      // Without --output the preview is an intentional deliverable: it is
      // written under a fresh dhpk-preview-output-* directory in TMPDIR and its
      // path is reported as `output` in the result, so the caller can inspect
      // it and removes it themselves. It is cleaned up here only when the
      // preview fails (nothing to inspect). Pass --output to choose the place.
      if (!request.options.output) {
        previewParent = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-preview-output-')));
      }
      const output = request.options.output
        ? path.resolve(request.options.output)
        : path.join(previewParent, request.surface);
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
    const surface = SURFACES[request.surface];
    const targetOutput = path.resolve(
      snapshot ? snapshot.root : root,
      effectiveRequest.options.output || surface.output,
    );
    // Readers take the same per-directory lock as `generate` and `build`, for
    // the default and any custom --output, so they never see a half-published
    // package. A read-only parent falls back to an unlocked read.
    const lockBeforeRuntime = isOnDemandSurface(request.surface)
      && (request.operation === 'validate' || request.operation === 'verify')
      && fs.existsSync(path.dirname(targetOutput));
    const runDistribution = () => {
      const context = runtime(snapshot ? snapshot.root : root, effectiveRequest);
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
      const runOperation = () => {
        if (request.operation === 'generate') assertOwnedGenerationTarget(request.surface, context.output);
        return surface.run(request.operation === 'preview' ? 'preview' : request.operation, context);
      };
      const result = isOnDemandSurface(request.surface) && request.operation === 'generate'
        ? withOnDemandSurfaceLock(context.output, runOperation)
        : runOperation();
      return { context, result };
    };
    const { context, result } = lockBeforeRuntime
      ? withOnDemandSurfaceLock(targetOutput, runDistribution, { readOnlyFallback: true })
      : runDistribution();
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
    if (snapshot && !result.ok && previewOutput) fs.rmSync(previewParent || previewOutput, { recursive: true, force: true });
    return response;
  } catch (error) {
    if (snapshot) snapshot.cleanup();
    if (previewParent) fs.rmSync(previewParent, { recursive: true, force: true });
    else if (previewOutput) fs.rmSync(previewOutput, { recursive: true, force: true });
    return { ok: false, status: 1, error: error.message };
  }
}

module.exports = { OPERATIONS, SURFACES, parseRequest, helpFor, execute };
