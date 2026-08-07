## Context

`codex/agents/` is a generated/runtime projection, while `agents/` is the
canonical Claude roster. The current generator has a seven-role allowlist and
the hand-maintained projection contains four generic roles. The projection
must gain useful Codex-native coverage without promising Claude-only lifecycle
hooks or browser capabilities that a consumer does not have.

The current Codex custom-agent contract accepts explicit `model`,
`model_reasoning_effort`, and `sandbox_mode` values. It does not provide a
project-owned token-budget field, so this change uses model/effort policy and
accepted-outcome cost reasoning rather than inventing an unsupported runtime
setting.

## Decisions

### 1. Expand the generated role set by capability, not by blind mirroring

Add `planner`, `spec-miner`, `frontend-reviewer`, `migration-reviewer`, and
`e2e-runner` to the generator allowlist. The remaining canonical roster is
covered by an explicit matrix:

- `performance-analyzer` → database/performance review lane.
- `silent-failure-hunter` and `type-design-analyzer` → code-reviewer,
  deep-reasoner, or architect fallback.
- `doc-updater`, `docs-lookup`, build resolvers,
  `agent-evaluator`, and `harness-reviser` → skill/manual fallback.
- `e2e-runner`, `ui-ux-verifier`, and `smoke-tester` require runtime browser
  capability; only `e2e-runner` is added now and it reports `BLOCKED` when its
  required capability is absent.
- `polyfill-reviewer` remains module-gated; `codex-bridge` remains intentionally
  unavailable inside Codex.

The generator continues to adapt unavailable handoffs and receipt-managed
asset paths rather than copying Claude-only promises.

### 2. Keep generated and hand-maintained boundaries explicit

The 12 canonical roles in the generator allowlist are generated. The existing
`bug-investigator`, `explorer`, `monitor`, and `worker` files remain
hand-maintained so their Codex-specific contracts and requested model settings
are not overwritten by Claude frontmatter.

### 3. Use role-specific model metadata with a medium global default

The generator runtime map becomes the single machine-level source for generated
role model/effort values. The hand-maintained TOML files carry the same explicit
metadata. The approved values are:

| Roles | Model | Effort | Sandbox |
|---|---|---|---|
| `architect`, `bug-investigator`, `deep-reasoner`, `security-reviewer`, `migration-reviewer`, `planner`, `spec-miner` | `gpt-5.6-sol` | `high` | role-derived |
| `code-reviewer` | `gpt-5.6-terra` | `medium` | read-only |
| `database-reviewer`, `frontend-reviewer`, `e2e-runner` | `gpt-5.6-terra` | `high` | role-derived |
| `explorer` | `gpt-5.6-terra` | `medium` | read-only |
| `worker`, `tdd-guide` | `gpt-5.6-luna` | `max` | role-derived |
| `doc-reviewer` | `gpt-5.6-luna` | `medium` | role-derived |
| `monitor` | `gpt-5.6-luna` | `low` | role-derived |

`worker` and `tdd-guide` use `max` intentionally because implementation and
test-first failures can cost more in retries than a single quality-first pass.
The global config default is `gpt-5.6-luna` with `medium` effort. Explicit role
metadata wins over that default.

### 4. Adapt e2e-runner to Codex's execution boundary

The generated e2e role keeps only Codex-readable paths and uses the
`playwright-cli` skill when available. It may write test specs, helpers,
fixtures, and test artifacts, but it must not modify application code to fix a
failed journey. It returns a fix-spec to the parent and reports a first-line
`Verdict: BLOCKED` when Playwright/browser prerequisites are unavailable.

## Implementation Shape

1. Extend `RUNTIME_METADATA` and the generator allowlist, then regenerate the
   12 generated TOML files.
2. Update adaptation rules so generated bodies contain no unavailable Codex
   role handoffs and no Claude-only sentinel/loader promises.
3. Update the four hand-maintained TOML files and `codex/config.toml.example`
   defaults.
4. Add coverage and model contract assertions to generator/runtime tests.
5. Update Codex role documentation and `rules/model-economics.md`.

## Risks and Mitigations

- Browser capability may be absent in a consumer: fail closed with `BLOCKED`
  and preserve the manual Playwright fallback.
- Generated source wording may include a new unavailable handoff: runtime
  reference validation and generated-body assertions reject it.
- Maximum effort may increase cost: keep it limited to `worker` and `tdd-guide`
  and retain medium as the global default.

## Rollout

Regenerate and validate the repository projection, run the clean consumer copy
installer test, then run the full OpenSpec strict validator. No production
runtime or data migration is required.
