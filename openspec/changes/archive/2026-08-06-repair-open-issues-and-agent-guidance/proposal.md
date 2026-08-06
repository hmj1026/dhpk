## Why

The current open issues identify four gaps at the boundary between source skills, shipped consumers, and project-local projections: the official Claude validator rejects 26 shipped skills (#143), the jq-optional installer is unsafe for apostrophes and does not fail closed (#144), the canonical skills can coexist with a stale project-local Codex receipt and legacy mirrors (#128), and two canonical skills fail the health-check routing contract (#145). The repository also has useful guidance in Matt Pocock's `wayfinder`, `wizard`, and `writing-for-agents` skills, but those ideas are not yet expressed as a consistent dhpk workflow. Recent installation, projection, and OpenSpec sessions also exposed gaps in the basic operations guide: it needs a surface-first verification ladder, safer normal-terminal examples, and an explicit apply/verify/archive lifecycle.

This change groups the fixes into one ordered umbrella plan so each issue gets a regression gate while the shared guidance is adopted once. It keeps the source-of-truth and consumer-validation boundaries explicit, and avoids adding three stand-alone skills that would increase routing and maintenance cost without solving a current issue.

## What Changes

- Make shipped skill frontmatter compatible with the official Claude strict validator and add an official-consumer validation path alongside the existing zero-dependency checks.
- Make the jq-optional installer transport paths and profile names as data (not interpolated Python source), fail closed on discovery/extraction errors, and add apostrophe/no-jq regression coverage.
- Make Codex projection reconciliation detect stale receipts, legacy fallback names, duplicate native/project-local surfaces, and unsafe collisions with actionable evidence before any destructive migration.
- Restore the missing `When NOT to Use` sections in the two canonical skills and make the health gate assert a zero-P1 routing result.
- Fold the selected Matt principles into existing dhpk skills: use a wayfinder-style destination/decision checkpoint when work spans sessions and the route is unclear; make agent-facing documents context-pointer driven, progressively disclosed, completion-checkable, and pruned against the single source of truth; and hand human-only wizard work to an inspectable, confirmation-gated procedure without executing it autonomously.
- Require source-first authoring for every materially changed skill or operational document: resolve current technical content through Context7 when indexed, otherwise the owning official documentation, then record the source/version, retrieval date, query or URL, covered claims, and repository/consumer format-validator evidence before declaring the text correct.
- Re-edit `docs/basic-operations.md` and `docs/basic-operations.zh-TW.md` as a paired, evidence-backed operating playbook. It SHALL explain the recommended install/verify/route/implement/review/handoff sequence, distinguish Claude marketplace, `scripts/install.sh` convenience installation, local development, supported Codex sync, and experimental native Codex, and incorporate the recent session findings without hard-coding snapshot-only values.
- Apply the `writing-for-agents` contract across the complete agent-facing source inventory: all canonical skills, shipped agents, rules, commands, and repository `CLAUDE.md`/`AGENTS.md` guidance. Preserve existing routing, security, lifecycle, and support-tier semantics while making context pointers, information hierarchy, completion evidence, and SSOT ownership explicit and mechanically checkable.
- Treat root guidance as a minimal entry point: keep universal instructions in the root files, move branch-specific mechanics behind linked documents, keep the Claude and Codex guidance boundaries explicit, and verify every new or retained link.
- Keep this change documentation- and test-first. It does not introduce a generic `wayfinder`, `wizard`, or `writing-for-agents` skill, and it does not silently resolve user-owned project files.

## Capabilities

### New Capabilities

- `installer-preset-safety`: jq-optional preset/profile discovery and module extraction must be path-safe, fail closed, and report a stable error contract.
- `agent-facing-document-guidance`: agent-facing skills and procedures must expose their invocation context, information hierarchy, completion evidence, source-of-truth ownership, human-action boundary, and pre-authoring source/format verification evidence.
- `basic-operation-playbook`: the English and Traditional Chinese basic-operation guides must provide an evidence-backed, surface-aware daily dhpk usage path covering marketplace installation, `scripts/install.sh`, supported Codex sync, and current skill/routing/OpenSpec contracts.

### Modified Capabilities

- `consumer-post-install-validation`: release/consumer evidence must include official Claude strict validation when available and must detect stale or duplicate Codex fallback/native surfaces.
- `codex-install-materialization`: update and migration must reconcile legacy receipts and projections deterministically, preserve unowned collisions, and report provenance/fingerprint evidence.
- `skill-health-check-resilience`: the health contract must include the missing routing sections and a regression assertion that the current canonical set has no P1 findings.
- `skill-routing-guidance`: adaptive workflow routing must define the wayfinder threshold, decision-ticket-to-spec handoff, progressive disclosure, and plan-before-implementation boundary.

## Impact

- Affected source and test areas include `scripts/install.sh`, the Claude frontmatter/consumer gates, `scripts/hooks/install-codex-skills.sh`, Codex projection and distribution checks, the skill-health linter, the existing routing/setup/skill-authoring documentation, and the paired basic-operation guides.
- The change adds focused fixtures and consumer checks but does not change the installed receipt schema unless implementation proves that a migration marker is required; any schema change must remain backward-compatible.
- The document pass is contract-first rather than a free-form rewrite: it may add pointers, headings, links, and completion checks, but SHALL NOT silently change a skill's invocation class, command route, agent role boundary, rule precedence, or product support tier.
- The expected delivery is an ordered implementation plan: validator compatibility first, installer safety second, Codex reconciliation third, health fixes fourth, Matt guidance and basic-operation playbook fifth, then integrated verification/lifecycle handoff.
- Existing P2 advisory findings remain out of scope unless a focused fix is required by one of these contracts; the two current P1 findings are the blocking health target.
