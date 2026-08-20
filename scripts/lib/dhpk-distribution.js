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
const { validateSurfaceReceipt } = require('./platform-provenance');

const OPERATIONS = Object.freeze(['generate', 'validate', 'verify']);
const SURFACES = Object.freeze({
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
  const options = { json: false, output: null, version: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
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
    else if (arg.startsWith('--')) return { ok: false, status: 64, error: `unknown option '${arg}'` };
    else positional.push(arg);
  }
  const [surface, operation] = positional;
  if (!SURFACES[surface]) return { ok: false, status: 64, error: `unknown surface '${surface || ''}'` };
  if (!OPERATIONS.includes(operation)) return { ok: false, status: 64, error: `unknown operation '${operation || ''}'` };
  if (positional.length !== 2) return { ok: false, status: 64, error: 'usage: dhpk distribution <surface> <generate|validate|verify> [--output <dir>] [--version <version>] [--json]' };
  return { ok: true, surface, operation, options };
}

function runtime(root, request) {
  const inventory = readJson(path.join(root, 'manifests', 'distribution-inventory.json'));
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  return {
    root,
    inventory,
    version: request.options.version || manifest.version,
    sourceCommit: resolveSourceCommit(root),
    output: path.resolve(root, request.options.output || SURFACES[request.surface].output),
    manifest,
  };
}

function receiptErrors(surface, output) {
  const receiptPath = path.join(output, 'provenance.json');
  if (!fs.existsSync(receiptPath)) return ['provenance.json is missing'];
  try {
    const receipt = readJson(receiptPath);
    // AGY has its own package receipt schema, which deliberately embeds the
    // common provenance fields instead of replacing its native contract.
    const commonReceipt = surface === 'agy-plugin'
      ? { ...receipt, schema: receipt.provenanceSchema }
      : receipt;
    return validateSurfaceReceipt(commonReceipt, surface).errors;
  } catch (error) {
    return [`provenance.json is not valid JSON: ${error.message}`];
  }
}

function mergeReceipt(surface, output, result) {
  const receipt = receiptErrors(surface, output);
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
  if (operation === 'generate') {
    const compiledProjection = compileAgentPluginPackage({
      inventory: context.inventory, root: context.root, outDir: context.output, name: 'dhpk', version: context.version,
      sourceCommit: context.sourceCommit, manifestMetadata: context.manifest,
    });
    const result = materializeAgentPluginPackage({
      inventory: context.inventory, root: context.root, outDir: context.output, name: 'dhpk', version: context.version,
      sourceCommit: context.sourceCommit, manifestMetadata: context.manifest, compiledProjection,
    });
    const validation = validateAgentPluginPackage(context.output, { allowlist: context.inventory.portable_frontmatter && context.inventory.portable_frontmatter.allowlist });
    return mergeReceipt('agent-plugin', context.output, { ok: validation.ok, details: { skillCount: result.skillIds.length, warnings: validation.warnings, errors: validation.errors } });
  }
  const validation = validateAgentPluginPackage(context.output, { allowlist: context.inventory.portable_frontmatter && context.inventory.portable_frontmatter.allowlist });
  return mergeReceipt('agent-plugin', context.output, { ok: validation.ok, details: { warnings: validation.warnings, errors: validation.errors } });
}

function runCursor(operation, context) {
  if (operation === 'generate') {
    const compiledProjection = compileCursorPackage({ inventory: context.inventory, root: context.root, outDir: context.output, version: context.version, sourceCommit: context.sourceCommit });
    const result = materializeCursorPackage({ inventory: context.inventory, root: context.root, outDir: context.output, version: context.version, sourceCommit: context.sourceCommit, compiledProjection });
    const validation = verifyCursorPackage({ packageRoot: context.output, stage: 'structural' }).structural;
    return mergeReceipt('cursor-plugin', context.output, { ok: validation.ok, details: { skillCount: result.skillNames.length, warnings: validation.warnings, errors: validation.errors } });
  }
  const validation = verifyCursorPackage({ packageRoot: context.output, stage: 'structural' }).structural;
  return mergeReceipt('cursor-plugin', context.output, { ok: validation.ok, details: { warnings: validation.warnings, errors: validation.errors } });
}

function runCodex(operation, context) {
  if (operation === 'generate') {
    const compiledProjection = compileNativePackage({ inventory: context.inventory, root: context.root, outDir: context.output, name: 'dhpk', version: context.version, sourceCommit: context.sourceCommit });
    const result = materializeNativePackage({ inventory: context.inventory, root: context.root, outDir: context.output, name: 'dhpk', version: context.version, sourceCommit: context.sourceCommit, compiledProjection });
    const validation = verifyNativePackage({ packageRoot: context.output, inventory: context.inventory, stage: 'structural' });
    return mergeReceipt('codex-native', context.output, { ok: validation.ok, details: { skillCount: result.skillIds.length, errors: validation.errors } });
  }
  if (operation === 'verify') {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-native-verify-'));
    try {
      // A receipt records the commit that materialized this projection.  It is
      // provenance, not source content: comparing it to the command's current
      // HEAD would make every later commit look like package drift.
      const sourceCommit = readJson(path.join(context.output, 'provenance.json')).sourceCommit;
      const compiledProjection = compileNativePackage({ inventory: context.inventory, root: context.root, outDir: temporary, name: 'dhpk', version: context.version, sourceCommit });
      materializeNativePackage({ inventory: context.inventory, root: context.root, outDir: temporary, name: 'dhpk', version: context.version, sourceCommit, compiledProjection });
      const validation = verifyNativePackage({ packageRoot: context.output, inventory: context.inventory, stage: 'structural' });
      const deterministic = fingerprintNative(temporary) === fingerprintNative(context.output);
      return mergeReceipt('codex-native', context.output, {
        ok: validation.ok && deterministic,
        details: { deterministic: deterministic ? 'PASS' : 'FAIL', errors: [...validation.errors, ...(deterministic ? [] : ['tracked Codex native package drifted from a fresh generation'])] },
      });
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  const validation = verifyNativePackage({ packageRoot: context.output, inventory: context.inventory, stage: 'structural' });
  return mergeReceipt('codex-native', context.output, { ok: validation.ok, details: { errors: validation.errors } });
}

function runAgy(operation, context) {
  if (operation === 'generate') {
    const result = materializeAgyPluginPackage({
      root: context.root, inventory: context.inventory, outDir: context.output, version: context.version,
      sourceVersion: context.manifest.version, sourceCommit: context.sourceCommit, generatorVersion: AGY_GENERATOR_VERSION,
    });
    const validation = validateAgyPluginPackage(context.output, { inventory: context.inventory, expectedVersion: context.version });
    return mergeReceipt('agy-plugin', context.output, { ok: validation.ok, details: { agentCount: result.selected.agents.length, skillCount: result.selected.skills.length, warnings: validation.warnings, errors: validation.errors } });
  }
  const validation = validateAgyPluginPackage(context.output, { inventory: context.inventory, expectedVersion: context.version });
  return mergeReceipt('agy-plugin', context.output, { ok: validation.ok, details: { warnings: validation.warnings, errors: validation.errors } });
}

function execute(argv, root) {
  const request = parseRequest(argv);
  if (!request.ok) return request;
  try {
    const context = runtime(root, request);
    if (request.operation === 'generate') assertOwnedGenerationTarget(request.surface, context.output);
    const surface = SURFACES[request.surface];
    const result = surface.run(request.operation, context);
    const evidence = {
      stage: 'structural',
      runtime: 'NOT_RUN',
      reason: `This command verifies deterministic package structure; ${surface.runtimeProbe} is a separate evidence-bound probe.`,
    };
    return {
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
  } catch (error) {
    return { ok: false, status: 1, error: error.message };
  }
}

module.exports = { OPERATIONS, SURFACES, parseRequest, execute };
