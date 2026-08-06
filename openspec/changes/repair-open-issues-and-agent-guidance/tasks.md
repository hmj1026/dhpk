## 1. Baseline and regression fixtures

- [x] 1.1 Reconfirm issues #143, #144, #128, and #145 against the current checkout; capture the affected paths, commands, and expected verdicts in the implementation notes.
- [x] 1.2 Run GitNexus impact analysis for the installer, frontmatter/consumer gate, Codex reconciliation, and health-lint symbols before editing any implementation symbol; record any HIGH or CRITICAL blast radius.
- [x] 1.3 Add failing or fixture-level regression cases for official frontmatter validation, no-jq apostrophe handling, stale Codex receipts/duplicate surfaces, and the missing health sections before changing production behavior.

## 2. Issue #143 — official Claude frontmatter compatibility

- [x] 2.1 Convert the 26 affected skill descriptions to a strict-validator-compatible YAML scalar form while preserving their routing meaning and line-length constraints.
- [x] 2.2 Extend frontmatter tests with colon-containing descriptions, the affected skill set, and a fixture that proves the internal parser and official validator receive equivalent metadata.
- [x] 2.3 Add the official `claude plugin validate ... --strict` command to the release/consumer evidence path, including an explicit `NOT RUN` result when the CLI is unavailable and a blocking failure when validation is non-zero.
- [x] 2.4 Run the focused frontmatter, plugin, and consumer-gate tests and verify all shipped skills pass the official strict validator in an environment that provides the CLI.

## 3. Issue #144 — jq-optional installer safety

- [x] 3.1 Add no-jq tests for a valid plugin path containing an apostrophe, an invalid profile, an absent preset/module, dry-run output, exit status, and absence of partial destinations.
- [x] 3.2 Refactor `scripts/install.sh` Python fallbacks to receive paths, preset names, and module names as arguments or environment data rather than interpolated source.
- [x] 3.3 Add explicit status/shape checks so profile and module extraction errors fail closed before prompts or installation side effects, with stable redacted diagnostics.
- [x] 3.4 Run the installer smoke and focused regression tests with both jq present and jq absent; retain unrelated installer behavior unchanged.

## 4. Issue #128 — Codex receipt and projection reconciliation

- [x] 4.1 Build an isolated temporary-project fixture from a pre-consolidation receipt containing legacy fallback names, current canonical names, and a native package with matching and differing fingerprints.
- [x] 4.2 Implement evidence-first receipt/projection classification for schema/version, source fingerprint, canonical names, ownership, collisions, and retired managed entries; do not mutate unowned paths.
- [x] 4.3 Make update/migration emit an explicit stale-receipt state and actionable command, and record updated, skipped, collided, retired, and backed-up counts without falsely marking a failed run current.
- [x] 4.4 Extend the consumer surface matrix to detect duplicate or differing native/fallback content and include both paths and fingerprints in the durable evidence summary.
- [x] 4.5 Run Codex installer, layout, distribution, parity, and consumer-gate tests against clean, stale, collision, and rollback fixtures.

## 5. Issue #145 — health routing P1 closure

- [x] 5.1 Add health-lint regression assertions for missing/empty `When NOT to Use` sections, stale or unresolvable neighboring-route tokens, and zero P1 findings in the current source tree while keeping P2 advisory counts visible.
- [x] 5.2 Add explicit neighboring-route exclusions to `dhpk-codebase-exploration` and `dhpk-module-design` without duplicating their primary workflows.
- [x] 5.3 Run the health audit in normal, JSON, and `--fix-hint` modes and verify the two current P1 findings are gone and no new P1 is masked.

## 6. Matt guidance integration without new standalone skills

- [x] 6.1 Update the existing adaptive workflow/routing guidance with the wayfinder threshold (unclear destination plus multi-session effort), destination/frontier/next-decision framing, one-decision tickets, and the handoff to `/opsx:new` or the verified Codex OpenSpec entry.
- [x] 6.2 Update skill-authoring and quality/health guidance with writing-for-agents rules: short context pointers, positive trigger and non-use boundaries, progressive disclosure, co-located references, completion evidence, single-source ownership, no-op pruning, and plan-versus-apply wording.
- [x] 6.3 Update project-setup guidance with the wizard boundary: inspect first, enumerate destinations and secret classification, require human confirmation, statically validate generated procedures, and never execute interactive credential/migration/cutover steps autonomously.
- [x] 6.4 Run routing/reference/skill-health checks and review the resulting always-loaded descriptions for context cost, duplicate policy, and clear neighboring routes; do not add generic `wayfinder`, `wizard`, or `writing-for-agents` skills in this wave.
- [x] 6.5 Before editing any skill or agent-facing document, build a source matrix using Context7 for indexed technical topics or the owning official documentation as fallback; record source/version/query or URL, map affected claims, and define the repository/official format validators that must pass.

## 7. 基礎操作文件重編 — session evidence 與雙語同步

- [x] 7.1 Resolve and record the source matrix before inventorying `docs/basic-operations.md` and `docs/basic-operations.zh-TW.md`; then compare them with `scripts/install.sh`, the supported Codex installer, current routing/install/migration/OpenSpec skills, and the recent issue-audit, Codex projection, and OpenSpec session logs. Record stale claims, missing guardrails, and duplicated SSOT content.
- [x] 7.2 Rewrite both guides as one evidence-backed playbook: install → verify → choose surface → route work → implement with TDD/impact/review gates → hand off with one next command, including the wayfinder threshold and the apply/verify/archive lifecycle.
- [x] 7.3 Correct operational hazards and recent-session lessons: use an explicit persistent plugin root in normal-terminal Codex commands, distinguish official Claude validation from repository validation, keep native Codex experimental, preserve unowned/stale Codex entries, and explain when `--migrate --update` is required.
- [x] 7.4 Remove or date snapshot-only versions/counts, link detailed behavior to the authoritative skills/rules/manifests/specs, and keep the basic pages focused on reader decisions rather than implementation internals.
- [x] 7.5 Run bilingual heading/command/link parity checks plus a fresh-reader review that can answer install, daily-use, troubleshooting, Codex sync, and OpenSpec completion questions without relying on prior session context.

## 8. Integrated verification and lifecycle handoff

- [x] 8.1 Regenerate and validate the native Codex package and canonical projections only after source changes settle; verify source fingerprints and the no-physical-mirror layout.
- [x] 8.2 Run internal plugin/catalog/harness validators, focused issue and document suites, the full test suite, health lint, bilingual basic-operation checks, source/format verification, and the official Claude strict consumer check; retain sources, versions, queries/URLs, commands, exit codes, and redacted evidence.
- [x] 8.3 Run `gitnexus_detect_changes()` before any commit or handoff that intends to commit, and confirm the affected symbols/flows match this change's scope; stop on unexpected HIGH/CRITICAL changes.
- [ ] 8.4 Use OpenSpec verify/apply evidence to close every checkbox, then archive the change only after implementation, consumer validation, and documentation review are complete; keep issue closure and release publication as separate explicit steps.

## 9. Writing-for-agents full-surface normalization

- [x] 9.1 Inventory all canonical skills, registered agents, rules, commands, `AGENTS.md`, `CLAUDE.md`, and `codex/AGENTS.md`; record each file's category, current invocation/route/roster semantics, applicable contract fields, and disposition in the implementation notes.
- [x] 9.2 Define and test the category contract: skills (pointer/non-use/output/verification/reference), agents (scope/tools/model/completion/handoff), rules (SSOT/precedence), commands (route/invocation/failure/completion), and root guidance (universal constraints/linked topics/platform boundary).
- [x] 9.3 Refactor the root guidance into a minimal linked index, preserve the GitNexus/plugin gates, split branch-specific mechanics into linked topic files, and verify every link without duplicating Claude-only and Codex-only contracts.
- [x] 9.4 Apply contract-first normalization to all skills without changing frontmatter invocation classes or route meaning; use progressive disclosure and co-located references, and record already-compliant files without padding them.
- [x] 9.5 Apply contract-first normalization to all agents, rules, and commands without changing roster/model/tool boundaries, rule precedence, command flags, or route-table targets; add completion and failure evidence where missing.
- [x] 9.6 Add deterministic contract/parity tests that report category coverage, relative paths, broken links, and semantic drift; require zero P0/P1 findings while retaining advisory P2 visibility.
- [x] 9.7 Run Markdown/frontmatter/route/invocation/distribution/native/parity validators and both English/Traditional Chinese document checks after the full inventory pass; record exact counts and exceptions.
- [x] 9.8 Obtain final code/doc reviewer approval for the expanded document surface, run GitNexus change detection, update PR evidence, and keep 8.4 open until CI and archive are complete.
