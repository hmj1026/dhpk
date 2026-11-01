'use strict';

// Claude Host Adapter for the distribution inventory: derives Claude's plugin
// skills[] directory-root registration, compiles the inventory/publication-root
// projection, and verifies a published plugin.json against it. The inventory
// module (scripts/lib/distribution-inventory.js) remains the lifecycle SSOT and
// owns validation/reconciliation; this module only consumes it.

const { sha256Hex } = require('./content-fingerprint');
const {
  compileDistribution,
  verifyDistribution,
} = require('./distribution-compiler');
const {
  fingerprint,
  createDistributionArtifact,
  projectionError,
  normalizeExternalSkillPackages,
  externalSkillPackagesFingerprint,
} = require('./distribution-projection-contract');
const { normalizeSkillUsage } = require('./skill-usage');
const { V2_SCHEMA, freezeProjectionValue } = require('./distribution-inventory');

// Task 2.2: derive the Claude plugin.json `skills[]` directory-root
// registration and the "generated promoted" skill id set from a distribution
// inventory object (pure — no fs access, so a rollback (task 5.4) can call
// this against a prior inventory revision read from disk by the caller).
//
// Claude's plugin.json format has no per-skill granularity (design.md
// decision 3): it registers whole directories. So a root stays registered as
// long as at least one of its skills is not deprecated — deprecating one
// skill in a module with other live skills does not, and cannot, remove that
// skill from host discovery. generatedSkillIds is the inventory-derived
// "should be promoted" set used for counts/validation (task 4) and is
// documentation truth, not a claim that the host actually hides anything;
// scripts/ci/gen-claude-manifest.js records that host limitation.
function generateClaudeSkillRoots(inventory) {
  const registered = (inventory.skills || []).filter((s) => s.lifecycle !== 'deprecated');
  const invokable = registered.filter((s) => s.invokable !== false);
  if (inventory && inventory.schema === V2_SCHEMA) {
    return {
      roots: registered.length > 0 ? ['./skills/'] : [],
      registeredSkillIds: registered.map((s) => s.id).sort(),
      generatedSkillIds: invokable.map((s) => s.id).sort(),
    };
  }

  const hasRootSkill = registered.some((s) => !s.path.startsWith('modules/'));
  const liveModuleIds = new Set(
    registered
      .filter((s) => s.path.startsWith('modules/'))
      .map((s) => s.path.split('/')[1])
  );

  const roots = [];
  if (hasRootSkill) roots.push('./skills/');
  for (const id of [...liveModuleIds].sort()) roots.push(`./modules/${id}/skills/`);

  return {
    roots,
    registeredSkillIds: registered.map((s) => s.id).sort(),
    generatedSkillIds: invokable.map((s) => s.id).sort(),
  };
}

function normalizedInventoryView(inventory, generated) {
  const normalize = (entries) => (entries || [])
    .map((entry) => {
      const normalized = {
        id: entry.id,
        name: entry.name || null,
        path: entry.path,
        lifecycle: entry.lifecycle,
        invokable: entry.invokable !== false,
        surfaces: [...(entry.surfaces || [])].sort(),
      };
      if (Object.prototype.hasOwnProperty.call(entry, 'name_style')) {
        normalized.nameStyle = entry.name_style;
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'usage')) {
        normalized.usage = normalizeSkillUsage({ skill: entry, usage: entry.usage });
      }
      return normalized;
    })
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const normalizeRetirements = (entries) => (entries || [])
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      canonicalPath: entry.canonicalPath,
      priorSurfaces: [...(entry.priorSurfaces || [])].sort(),
      retiredIn: entry.retiredIn,
      reasonCode: entry.reasonCode,
      replacements: (entry.replacements || [])
        .map((replacement) => ({
          kind: replacement.kind,
          ...(replacement.id === undefined ? {} : { id: replacement.id }),
          ...(replacement.mode === undefined ? {} : { mode: replacement.mode }),
        }))
        .sort((left, right) => `${left.kind}:${left.id || ''}:${left.mode || ''}`.localeCompare(`${right.kind}:${right.id || ''}:${right.mode || ''}`)),
      rollback: entry.rollback && typeof entry.rollback === 'object'
        ? { release: entry.rollback.release }
        : null,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const view = {
    schema: inventory && inventory.schema ? inventory.schema : null,
    roots: [...generated.roots],
    generatedSkillIds: [...generated.generatedSkillIds],
    skills: normalize(inventory && inventory.skills),
    modules: normalize(inventory && inventory.modules),
    retiredSkills: normalizeRetirements(inventory && inventory.retired_skills),
  };
  if (inventory && Object.prototype.hasOwnProperty.call(inventory, 'external_skill_packages')) {
    view.externalSkillPackages = normalizeExternalSkillPackages({ inventory });
    view.externalSkillPackagesFingerprint = externalSkillPackagesFingerprint({ inventory });
  }
  return freezeProjectionValue(view);
}

function projectionOutput(stableId, source, destination, content, transform) {
  const bytes = Buffer.from(content);
  return {
    stableId,
    source,
    destination,
    content: bytes,
    expectedFingerprint: sha256Hex(bytes),
    transform,
    mode: 0o644,
    symlinkPolicy: 'forbid',
  };
}

// Claude's plugin manifest is intentionally a thin consumer surface: its
// skills[] field registers directory roots while the inventory remains the
// lifecycle and selection SSOT. This compiler emits a deterministic inventory
// view and publication-root view so the shared compiler/verifier can bind the
// existing check without making the manifest itself authoritative.
function compileClaudeProjection({ inventory, compilerVersion = 'claude-1' } = {}) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return { ok: false, error: projectionError('INVALID_INPUT', 'compile', 'inventory is required') };
  }
  const generated = generateClaudeSkillRoots(inventory);
  // Keep Claude's generated metadata on the same normalized router view that
  // Codex and parity checks consume. The Claude host still registers roots;
  // this view records the per-alias contract without changing that host shape.
  const { buildSkillRoutingProjection } = require('./skill-routing-projection');
  const { compareRoutingProjections } = require('./distribution-projection-parity');
  const routingProjection = buildSkillRoutingProjection({ inventory, surface: 'claude-module' });
  const inventoryView = freezeProjectionValue({
    ...normalizedInventoryView(inventory, generated),
    skillRoutingProjection: routingProjection,
  });
  const rootsContent = `${JSON.stringify({ roots: generated.roots, generatedSkillIds: generated.generatedSkillIds }, null, 2)}\n`;
  const inventoryContent = `${JSON.stringify(inventoryView, null, 2)}\n`;
  const entries = [
    projectionOutput(
      'claude:inventory-view',
      'manifests/distribution-inventory.json',
      'generated/inventory-view.json',
      inventoryContent,
      { id: 'claude-inventory-view', version: '1' },
    ),
    projectionOutput(
      'claude:publication-roots',
      'manifests/distribution-inventory.json',
      'generated/publication-roots.json',
      rootsContent,
      { id: 'claude-publication-roots', version: '1' },
    ),
  ];
  const compiled = compileDistribution({
    internalCharacterization: true,
    compilerVersion,
    surface: 'claude-core',
    inventoryFingerprint: fingerprint(inventoryView),
    ...(Object.prototype.hasOwnProperty.call(inventory, 'external_skill_packages')
      ? { externalSkillPackages: inventory.external_skill_packages }
      : {}),
    ownershipRoot: '.claude-plugin',
    entries,
  });
  if (!compiled.ok) return compiled;
  const plan = compiled.value;
  const adapter = {
    identity: { id: 'claude-inventory-projection', version: compilerVersion },
    render: () => ({
      adapter: { id: 'claude-inventory-projection', version: compilerVersion },
      outputs: entries.map((entry) => ({
        stableId: entry.stableId,
        destination: entry.destination,
        content: entry.content,
        mode: entry.mode,
      })),
      metadata: { generated, inventoryView, routingProjection },
    }),
    validate: (rendered) => {
      const expected = buildSkillRoutingProjection({ inventory, surface: 'claude-module' });
      const metadataParity = compareRoutingProjections({
        expected,
        actual: rendered.metadata && rendered.metadata.routingProjection,
      });
      if (!metadataParity.ok) {
        throw new Error(`Claude routing projection metadata drift: ${metadataParity.diagnostics.join('; ')}`);
      }
      const inventoryOutput = (rendered.outputs || []).find((entry) => entry.stableId === 'claude:inventory-view');
      let publishedView;
      try {
        publishedView = JSON.parse(Buffer.from(inventoryOutput && inventoryOutput.content || '').toString('utf8'));
      } catch (_) {
        throw new Error('Claude inventory-view output is not valid JSON');
      }
      const artifactParity = compareRoutingProjections({
        expected,
        actual: publishedView && publishedView.skillRoutingProjection,
      });
      if (!artifactParity.ok) {
        throw new Error(`Claude routing projection artifact drift: ${artifactParity.diagnostics.join('; ')}`);
      }
      return rendered;
    },
  };
  return {
    ok: true,
    plan,
    generated,
    inventoryView,
    routingProjection,
    adapter,
  };
}

function verifyClaudeProjection({ inventory, pluginSkills = [], stage = 'structural', observedAt, publishedInventoryView } = {}) {
  const compiled = compileClaudeProjection({ inventory });
  if (!compiled.ok) return compiled;
  const { compareRoutingProjections } = require('./distribution-projection-parity');
  const routingParity = compareRoutingProjections({
    expected: compiled.routingProjection,
    actual: publishedInventoryView === undefined
      ? compiled.inventoryView.skillRoutingProjection
      : publishedInventoryView && publishedInventoryView.skillRoutingProjection,
  });
  const registered = Array.isArray(pluginSkills) ? pluginSkills.filter((value) => typeof value === 'string') : [];
  const generatedSet = new Set(compiled.generated.roots);
  const registeredSet = new Set(registered);
  // Claude Code always scans the plugin's top-level skills/ directory. Keep
  // that implicit root in the effective set when the inventory expects it,
  // even when plugin.json omits the redundant explicit declaration.
  if (generatedSet.has('./skills/')) registeredSet.add('./skills/');
  const missing = [...generatedSet].filter((root) => !registeredSet.has(root)).sort();
  const extra = [...registeredSet].filter((root) => !generatedSet.has(root)).sort();
  const diagnostics = [
    ...routingParity.diagnostics.map((diagnostic) => `DRIFT [skill-routing-projection]: ${diagnostic}`),
    ...missing.map((root) => `DRIFT [gen-claude-manifest]: inventory expects root '${root}' but plugin.json skills[] does not register it`),
    ...extra.map((root) => `DRIFT [gen-claude-manifest]: plugin.json skills[] registers '${root}' with no inventory-eligible skill backing it`),
  ];
  if (!routingParity.ok) diagnostics.push(`FAIL [skill-routing-projection]: ${routingParity.mismatches.length} routing mismatch(es).`);
  if (missing.length > 0 || extra.length > 0) diagnostics.push(`FAIL [gen-claude-manifest]: ${missing.length + extra.length} root mismatch(es).`);
  const artifactResult = createDistributionArtifact({
    planFingerprint: compiled.plan.planFingerprint,
    adapter: compiled.adapter.identity,
    artifactFingerprint: fingerprint({ roots: [...registeredSet].sort() }),
    outputs: [],
    metadata: { registeredRoots: [...registeredSet].sort() },
  });
  if (!artifactResult.ok) return artifactResult;
  const evidenceResult = verifyDistribution(stage, artifactResult.value, {
    identity: { id: 'claude-inventory-validator', version: '1' },
    verify: () => ({
      verdict: missing.length === 0 && extra.length === 0 && routingParity.ok ? 'PASS' : 'FAIL',
      claims: ['inventory-derived Claude publication roots', 'Claude plugin skills[] root registration', 'Claude routing projection parity'],
      observations: [`checked ${registeredSet.size} registered root(s)`, `checked ${compiled.routingProjection.entries.length} routing projection entr${compiled.routingProjection.entries.length === 1 ? 'y' : 'ies'}`],
      diagnostics,
      observedAt,
    }),
  });
  const evidence = evidenceResult.ok ? evidenceResult.value : evidenceResult;
  return {
    ok: missing.length === 0 && extra.length === 0 && routingParity.ok && evidenceResult.ok && evidence.verdict === 'PASS',
    plan: compiled.plan,
    generated: compiled.generated,
    inventoryView: compiled.inventoryView,
    missing,
    extra,
    evidence,
  };
}

module.exports = {
  generateClaudeSkillRoots,
  compileClaudeProjection,
  verifyClaudeProjection,
};
