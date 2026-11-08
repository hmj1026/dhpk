'use strict';

// Host package pipeline (#1242): the part of publishing a generated Host
// package that is the same for every Package Receipt surface. A Host keeps its
// selection compile, plan entries, file projection, and validator; this module
// assembles its adapter and publishes the plan through ProjectionArtifactStore,
// the sole writer of package trees (ADR-0009).

const path = require('node:path');
const { materializeDistribution } = require('./distribution-compiler');
const { ProjectionArtifactStore } = require('./projection-artifact-store');
const { SURFACE_OWNERS } = require('./platform-provenance');

const SKILL_ENTRY_FIELDS = Object.freeze([
  'skillId',
  'publicName',
  'invocationClass',
  'lifecycle',
  'usageSchema',
  'usage',
  'usageFingerprint',
  'provenance',
]);

// Skill identity carried by a planned file into its plan entry, in the order
// every generator has always written it.
function skillEntryFields(file) {
  if (!file || !file.skillId) return {};
  return Object.fromEntries(SKILL_ENTRY_FIELDS.map((field) => [field, file[field]]));
}

// `renderOutputs` returns the planned outputs at render time; `renderDerived`
// (AGY) late-binds outputs such as the receipt from the fingerprints the store
// observed; `validateStage` checks the staged tree and throws to refuse it.
function hostPackageAdapter({ surface, version, renderOutputs, metadata, renderDerived, validateStage }) {
  if (!Object.prototype.hasOwnProperty.call(SURFACE_OWNERS, surface)) throw new Error(`unknown Host package surface: ${surface}`);
  return {
    identity: { id: surface, version },
    render: () => ({
      adapter: { id: surface, version },
      outputs: renderOutputs(),
      links: [],
      ...(metadata === undefined ? {} : { metadata }),
    }),
    ...(renderDerived ? { renderDerived } : {}),
    validate: (rendered, context) => {
      if (!context || !context.session || !context.session.stageRoot) return rendered;
      if (validateStage) validateStage(context.session.stageRoot, rendered, context);
      return rendered;
    },
  };
}

// Publishes `projection` ({ plan, adapter }) under `publishRoot`. The store is
// rooted at the output's parent and owned by the surface; `verify` replaces the
// store's default owner check. Returns the published artifact or throws.
function publishHostPackage(surface, projection, {
  publishRoot,
  sourceRoot,
  root = publishRoot ? path.dirname(path.resolve(publishRoot)) : undefined,
  artifactStore = null,
  verify = null,
  failurePrefix = null,
} = {}) {
  if (!Object.prototype.hasOwnProperty.call(SURFACE_OWNERS, surface)) throw new Error(`unknown Host package surface: ${surface}`);
  const store = artifactStore || new ProjectionArtifactStore({
    root,
    sourceRoot,
    publishRoot,
    ownership: { owner: SURFACE_OWNERS[surface], ...(verify ? { verify } : {}) },
  });
  const artifact = materializeDistribution(projection.plan, projection.adapter, store);
  if (!artifact.ok) throw new Error(failurePrefix ? `${failurePrefix}: ${artifact.error.message}` : artifact.error.message);
  return artifact.value;
}

module.exports = {
  SKILL_ENTRY_FIELDS,
  skillEntryFields,
  hostPackageAdapter,
  publishHostPackage,
};
