'use strict';

// Single source of truth for rule activation across AGY and Cursor projections.
// Keyed by canonical rule path. Descriptions are fixed literals: do not derive
// them from rule prose. alwaysOn maps to AGY `always_on` / Cursor `alwaysApply: true`;
// otherwise AGY `model_decision` / Cursor `alwaysApply: false`.
const RULE_ACTIVATION_MAP = Object.freeze({
  'rules/execution-policy-kernel.md': Object.freeze({
    alwaysOn: true,
    description: 'Always-visible execution policy kernel',
  }),
  'rules/execution-policy.md': Object.freeze({
    alwaysOn: false,
    description: 'Execution policy single source of truth',
  }),
  'rules/anti-rationalization.md': Object.freeze({
    alwaysOn: false,
    description: 'Anti-rationalization patterns stop-loss reference',
  }),
  'rules/model-economics.md': Object.freeze({
    alwaysOn: false,
    description: 'Opt-in model tier and cost rules',
  }),
  'rules/tool-routing.md': Object.freeze({
    alwaysOn: false,
    description: 'Tool routing reference card',
  }),
  // Cursor-only: not projected to AGY.
  'rules/dhpk-project-conventions.md': Object.freeze({
    alwaysOn: false,
    description: 'dhpk repository branch, changelog, and delivery conventions',
    cursorOnly: true,
  }),
});

function canonicalRulePath(basename) {
  return `rules/${String(basename).replace(/\.(?:md|mdc|markdown|txt)$/i, '')}.md`;
}

module.exports = { RULE_ACTIVATION_MAP, canonicalRulePath };
