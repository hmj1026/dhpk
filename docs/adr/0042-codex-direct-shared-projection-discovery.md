# Codex direct Shared Project Projection discovery

Status: accepted

## Context

[ADR-0023](0023-native-installers-delegate-skills-to-the-shared-projection.md)
delegated native installer skills to the Shared Project Projection
(`.agents/skills/`) while gating direct discovery (`DIRECT_SHAPE`, omitting
`.codex/skills/<name>` links) on an explicit passing
`DHPK_CODEX_CONSUMER_EVIDENCE` record.

Codex CLI (minimum supported 0.159.0; observed on 0.172.0) natively discovers
project skills from `.agents/skills/`. Because daily installs do not supply
`DHPK_CODEX_CONSUMER_EVIDENCE`, consumer projects kept receiving per-skill
`.codex/skills/<name>` links; in a source checkout overlapping the project root
(such as dhpk itself), `codex-sync` bypassed the Shared Project Projection and
materialized physical copies under `.codex/skills/` alongside
`.agents/skills/.dhpk-projection.json`. Issue #1558 retired only a single
hardcoded review skill (`change-verdict`), leaving 13 enabled Duplicate Discovery
pairs in Codex 0.172.0.

## Decision

- Amend [ADR-0023](0023-native-installers-delegate-skills-to-the-shared-projection.md)
  for Codex: `codex-sync` defaults to direct Shared Project Projection discovery
  (`.agents/skills/` as Codex's sole project-local skill Discovery Source) without
  requiring `DHPK_CODEX_CONSUMER_EVIDENCE` on every run. No user-facing
  `--native-links` fallback flag is added; per-skill `.codex/skills/<name>` links
  are generated only when an explicit non-PASS Codex Consumer Evidence override
  is supplied (for compatibility tests). Cursor retains ADR-0023's Consumer
  Evidence gate unchanged.
- On `--update`, retire all unchanged receipt-owned `.codex/skills/<name>` links
  or physical copies whose Skill Identity is proven present in `.agents/skills/`
  (whether via the Shared Project Projection or a verified compatibility
  projection in a source checkout), protected by the Projection Journal and
  rollback backups. This generalizes #1558 from `change-verdict` to all
  overlapping skills.
- Preserve non-overlapping Codex skills (skills absent from `.agents/skills/`),
  third-party skills (such as `code-review`), user-modified copies, retargeted
  symlinks, and Native Projection assets (`.codex/agents/*.toml`).
- If a source-checkout compatibility projection in `.agents/skills/` is stale
  and fails fingerprint verification, do not retire the overlapping
  `.codex/skills/<name>` entry; report an explicit
  `COMPATIBILITY_PROJECTION_STALE` diagnostic with refresh guidance in
  `--plan --json` instead of silently skipping retirement.
- This decision governs the supported daily `codex-sync` route while the OpenAI
  Public Plugin remains `NOT_PUBLISHED`;
  [ADR-0024](0024-current-plugin-distribution-and-unique-discovery.md)'s future
  Public Plugin cutover and isolation direction remains accepted and unchanged.

## Considered Options

- **Keep ADR-0023's Consumer Evidence gate for Codex and add a `--native-links` flag.**
  Rejected: daily installs omit the evidence file, perpetuating redundant
  `.codex/skills/<name>` entries, and a user-facing flag would maintain two
  parallel Codex topologies.
- **Relocate shared skills out of `.agents/skills/` early (ahead of ADR-0024 Public Plugin publication).**
  Rejected: breaks multi-Host Shared Project Projection coexistence before the
  Public Plugin is available.
- **Keep #1558 limited to `change-verdict`.**
  Rejected: leaves 12 other overlapping skills duplicated in the dhpk checkout.

## Consequences

- Existing Codex consumer projects converge to direct `.agents/skills/`
  discovery on their next `--update`, retiring unchanged receipt-owned
  `.codex/skills/<name>` links safely.
- Duplicate discovery verification pairs deterministic multi-root
  filesystem/receipt scanning (project and user scopes) with live Host
  skill-list probes when available, keeping static and live verdicts separate.
- Cursor's Consumer Evidence gate and ADR-0024's future Public Plugin
  distribution boundaries remain unaffected.
