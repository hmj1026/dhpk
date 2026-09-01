'use strict';

// Small policy primitives kept separate from the large inventory validator so
// regeneration coverage can exercise the safety boundary directly.

function classifyWritePolicy(outputExists, parsed) {
  if (!outputExists) return { action: 'bootstrap' };
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.schema === 'dhpk.distribution-inventory.v1') return { action: 'legacy-write' };
    if (parsed.schema === 'dhpk.distribution-inventory.v2') {
      return {
        action: 'reject',
        diagnostic: 'inventory is unchanged; use --refresh-supporting-digests',
      };
    }
    return {
      action: 'reject',
      diagnostic: `unsupported schema '${parsed.schema === undefined ? '<missing>' : parsed.schema}'; expected dhpk.distribution-inventory.v1 or dhpk.distribution-inventory.v2`,
    };
  }
  return { action: 'reject', diagnostic: 'unsupported/invalid schema; expected an inventory object' };
}

function assertCanonicalSkillPath(relPath) {
  if (typeof relPath !== 'string') {
    throw new Error(`unclassified canonical entry: ${String(relPath)}`);
  }
  let match = /^skills\/([^/]+)\/SKILL\.md$/.exec(relPath);
  if (match) return { classification: 'root', id: match[1], path: `skills/${match[1]}` };
  match = /^modules\/([^/]+)\/skills\/([^/]+)\/SKILL\.md$/.exec(relPath);
  if (match) return { classification: 'module', module: match[1], id: match[2], path: `modules/${match[1]}/skills/${match[2]}` };
  throw new Error(`unclassified canonical entry: ${relPath}`);
}

module.exports = {
  classifyWritePolicy,
  classifyInventoryWritePolicy: classifyWritePolicy,
  assertCanonicalSkillPath,
  classifyCanonicalSkillPath: assertCanonicalSkillPath,
};
