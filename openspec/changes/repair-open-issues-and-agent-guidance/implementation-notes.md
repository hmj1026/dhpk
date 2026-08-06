# Implementation notes

## Baseline reconfirmation (2026-08-06)

| Issue | Current evidence | Expected verdict | Baseline verdict |
| --- | --- | --- | --- |
| #143 official Claude frontmatter | staged consumer `claude plugin validate <manifest> --strict` (Claude Code 2.1.223) | Every shipped skill has runtime-readable metadata; the staged official command exits 0 | **FAIL**: 26 skills report `YAML frontmatter failed to parse`; repository gates still pass (`validate-plugin.js`, `validate-skills.js --strict`) |
| #144 jq-optional installer | `scripts/install.sh` lines 84-105 and `tests/install.test.js` | no-jq extraction passes paths/keys as data, fails closed, and leaves no partial destination | **OPEN**: Python fallback interpolates `$PROFILES` and `$USE_PRESET` into `python3 -c` source; existing tests cover only the happy dry-run path |
| #128 Codex receipt/projection | `tests/install-codex-skills.test.js`, `scripts/release/consumer-gate.js` | stale receipts and duplicate native/fallback surfaces are explicit and actionable | **PARTIAL**: installer has ownership/collision safeguards; consumer gate already has a surface matrix, but stale/legacy evidence needs explicit receipt-state coverage (the CLI uses `--repo-root`) |
| #145 health routing | `node skills/dhpk-skill-health-audit/scripts/skill-lint.js --json` | canonical source tree has zero P1 findings while P2 remains visible | **FAIL**: 2 P1 findings for `dhpk-codebase-exploration` and `dhpk-module-design`; 127 P2 advisories remain visible |

The official Claude command also emits one unrelated root `CLAUDE.md` warning. That warning is not treated as a blocker for this change; frontmatter errors are.

## GitNexus pre-edit impact

The current `dhpk` index is fresh at commit `9899ec3`. Upstream impact was run before implementation edits for the relevant symbols:

| Symbol | Direct upstream | Processes/modules | Risk |
| --- | ---: | --- | --- |
| `validateSkillMd` (`scripts/ci/validate-skills.js`) | 1 | 0 / 1 | LOW |
| `runGate` (`scripts/release/consumer-gate.js`) | 1 | 0 / 0 | LOW |
| `discoverCodexSurfaces` (`scripts/release/consumer-gate.js`) | 1 | 2 / 1 | LOW |
| `reconcileDistribution` (`scripts/lib/distribution-inventory.js`) | 2 | 0 / 0 | LOW |
| `lintSkill` (`skills/dhpk-skill-health-audit/scripts/skill-lint.js`) | 1 | 1 / 1 | LOW |
| `checkWhenNotSection` (`skills/dhpk-skill-health-audit/scripts/skill-lint.js`) | 1 | 1 / 1 | LOW |

`scripts/install.sh` is a shell entrypoint and has no indexed symbol match; its blast radius is covered by shell syntax and process-level regression tests. No HIGH or CRITICAL result was returned.

## Source/format evidence matrix

| Topic | Source / version | Query or path | Claims covered | Validators |
| --- | --- | --- | --- | --- |
| Claude plugin/frontmatter | Claude Code 2.1.223 local CLI; Context7 `/anthropics/claude-code` (retrieved 2026-08-06) | Local `claude plugin validate .claude-plugin/plugin.json --strict`; Context7 query `plugin validate command strict option and plugin skill frontmatter YAML validation` | official YAML/frontmatter consumer behavior and required metadata shape | official strict validator plus repository validators |
| Installer profiles/modules | repository SSOT | `manifests/install-profiles.json`, `manifests/module-catalog.json`, `scripts/install.sh` | supported preset/module shape and shell-to-Python boundary | `bash -n`, installer regression tests |
| Codex projections | repository SSOT | `manifests/distribution-inventory.json`, `docs/distribution-surfaces.md`, `scripts/hooks/install-codex-skills.sh` | ownership, receipt, fingerprint, collision, and support-tier claims | Codex install/layout/distribution/consumer tests |
| Health routing | repository implementation | `skills/dhpk-skill-health-audit/scripts/skill-lint.js`, `skills/dhpk-skill-health-audit/SKILL.md` | P1/P2 contract and fix-hint output | health lint normal/JSON/`--fix-hint` modes |
| OpenSpec lifecycle | repository CLI, apply/verify skill, and change artifacts | `openspec status/instructions/validate/archive` plus the verification report | apply/verify/archive completion boundary | OpenSpec validation and archive evidence |

Context7 resolved Claude Code documentation for the frontmatter shape and validator guidance; the exact `plugin validate --strict` behavior was additionally verified against the installed official CLI 2.1.223. Repository-local contracts use their owning implementation and manifests. Claims without a current authoritative source remain marked as implementation evidence, not assumed release evidence.

The official consumer gate validates a consumer-shaped temporary stage containing
the manifest, registered skills, agents, commands, and modules. The repository's
development-only root `CLAUDE.md` is excluded because the official CLI warns that
plugin-root context is not loaded; `agents/INDEX.md` now carries a metadata
pointer. Direct source validation may still report that known root-context
warning, while the staged shipped-surface check is the release evidence.

## Focused implementation evidence (2026-08-06)

- `node tests/frontmatter.test.js`: 16/16; all 26 affected descriptions are
  quoted scalars and the official fixture passes.
- `node tests/install.test.js`: 11/11; no-jq apostrophe, malformed profile,
  invalid selection, and unknown module cases fail closed without side effects.
- `node tests/install-codex-skills.test.js`: 33/33; stale receipts require
  explicit `--migrate --update`, collision ownership is preserved, and receipt
  evidence records paths, fingerprints, counts, and rollback backups.
- `node tests/consumer-gate-cli.test.js`: 9/9; official strict `NOT RUN`, PASS,
  and blocking FAIL states are covered.
- `node tests/skill-health-check-resilience.test.js`: 7/7; missing/empty/stale
  routing sections retain deterministic P1 paths, while canonical P1 is zero.
- `node tests/documentation-platform-parity.test.js`: 8/8; bilingual shape and
  safety/lifecycle decisions remain paired.
- `node scripts/release/consumer-gate.js --version 0.35.0 --repo-root .`:
  PASS; Claude official strict PASS on staged surface, Codex native smoke PASS
  (experimental), supported Codex duplicate surface WARN with project-local
  precedence and durable fingerprints.
- `node tests/run-all.js`: 171/171 test files passed (includes the full
  agent-facing contract suite).
- Internal validators: plugin, catalog, harness, distribution, OpenAI metadata,
  native-package verification, and health lint all passed; health lint reports
  0 P0/P1 and 127 visible P2 advisories. Normal, JSON, and `--fix-hint` modes
  each report `Gate: All Pass`/`overallPass: true`; their expected exit 1 is
  advisory-only because P2 findings remain visible.
- `bash -n` passed for all changed shell entrypoints; ShellCheck reports only
  the existing informational SC1091 source-following notice for `install.sh`.

## Scope extension: writing-for-agents full-surface pass (2026-08-06)

The user approved a contract-first writing-for-agents pass in the same PR. The
scope is all canonical agent-facing source surfaces: 102 skills, 32 registered
agents, 4 rules, 45 commands, and the repository guidance roots
`AGENTS.md`, `CLAUDE.md`, and `codex/AGENTS.md`. The completed pass preserves
invocation, route, roster/model/tool, rule-precedence, command-flag, and
Claude/Codex support-tier semantics. Every inventory entry has an explicit
updated, already-compliant, or intentionally-exempt disposition below.

The selected method is the external `writing-for-agents` contract plus the
repository `agent-md-refactor` guidance: context pointers, progressive
disclosure, co-location, completion criteria, SSOT pruning, and a minimal root
index. No standalone shipped `writing-for-agents` skill will be added.

### Inventory disposition

| Surface | Total | Updated | Already compliant | Exempt | Disposition evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| Canonical skills | 102 | 8 | 94 | 0 | Eight heuristic gaps received source/SSOT boundary pointers; strict skill and health validators cover all 102. |
| Registered agent roles | 32 | 0 | 32 | 0 | All 31 root roles plus the module role pass agent metadata, completion, handoff, and link checks; generated Codex roles remain projection-owned. |
| Agent index | 1 | 1 | 0 | 0 | Roster path now names `.claude-plugin/plugin.json` and points to frontmatter/execution-policy ownership. |
| Rules | 4 | 0 | 4 | 0 | Rule audit found no ownership, precedence, or completion gap; `rules/execution-policy.md` remains the routing SSOT. |
| Commands | 45 | 25 | 19 | 1 | Twenty-five aliases/legacy utilities now carry shared contract pointers; `commands/INDEX.md` is an intentional navigation exemption. |
| Guidance roots | 3 | 3 | 0 | 0 | `AGENTS.md`, `CLAUDE.md`, and `codex/AGENTS.md` retain their support boundaries while using linked progressive disclosure. |

The 25 command updates are the 13 deprecated forwarding aliases plus the 12
thin legacy utilities identified by the semantic audit. No route, invocation
class, flag, model/tool entitlement, or support-tier behavior changed.

## OpenSpec verification report (pre-archive, 2026-08-06)

### Completeness

- `openspec status --change repair-open-issues-and-agent-guidance --json` reports
  a repo-local, complete planning artifact set (`proposal`, `design`, seven
  delta specs, and `tasks`).
- Task evidence is `40/41`: tasks 1.1–8.3 and 9.1–9.8 are checked; 8.4
  remains intentionally open until the PR's CI result is green and the
  archive operation is executed.

### Correctness

- The seven delta specs map to the changed installer, Codex receipt/projection,
  consumer-gate, health-lint, agent-facing guidance, bilingual playbook, and
  generated native-package files listed by the focused tests and validators.
- `openspec validate repair-open-issues-and-agent-guidance --strict` passes.

### Coherence

- Final code review and doc review both returned `APPROVE` with zero remaining
  findings after the root-index link assertion fix; the consumer review also
  returned `APPROVE` with the official Claude strict and Codex surfaces green.
- GitNexus staged detection for the feature worktree reported 136 changed
  symbols across 60 files, 0 affected processes, and LOW risk.
- The remaining lifecycle gate is external: push the feature branch, verify
  the exact PR CI run, repair any CI failure, then check 8.4 and archive.
