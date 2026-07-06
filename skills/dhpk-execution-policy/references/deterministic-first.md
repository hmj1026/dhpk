# Deterministic first, judgment second — detail

Detail for `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Deterministic first, judgment second. The SSOT there keeps the one-line rule + pointer; this file carries the full three-step discipline, loaded **for audit / setup / inventory / generation work**.

For audit / setup / inventory / generation work, separate fact-collection from interpretation:

1. **Collect deterministically** — scripts / Grep / Glob only, no AI judgment. Establish a baseline and surface any pre-existing failure before stacking new changes on it.
2. **Gate** — present the collected facts; for destructive or multi-file outcomes, wait for user confirmation before the judgment phase.
3. **Judge** — only then apply AI evaluation, scoring, or proposals.

**Tool output is immutable**: invoke the deterministic tool, forward its stdout verbatim. Never hand-construct or post-process contract output (e.g. `deploy-list` schema=v1); if a tool fails, stop and report — do not simulate its output.

Applies to: harness-revise, skill-stocktake, project-setup, project-audit, risk-assess, deploy-list, skill-scout.
