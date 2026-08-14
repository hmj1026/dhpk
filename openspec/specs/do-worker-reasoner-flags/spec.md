# do-worker-reasoner-flags Specification

## Purpose
TBD - created by archiving change do-flags-and-harness-consolidation. Update Purpose after archive.
## Requirements
### Requirement: `--worker` flag replaces `--fast-worker` with hard removal
`/dhpk:do` and `dhpk:opsx-apply-goal` SHALL accept `--worker=<claude|codex|agy|auto>` as the sole per-invocation fast-worker backend override, parsed and stripped before route matching (the same strip-before-match contract as `--codex`/`--plan`/`--openspec`). The legacy `--fast-worker` token SHALL be removed outright: it is not recognized, not aliased, and receives no special-case handling. Precedence SHALL remain flag > `fast_worker_backend` userConfig > shipped default (`claude`); userConfig key names and the `scripts/fast-worker-selector.js` engine interface SHALL NOT be renamed. The preserved invocation context SHALL be named `WORKER_OVERRIDE`.

#### Scenario: New flag resolves the backend
- **WHEN** the user invokes `/dhpk:do --worker=codex <task>`
- **THEN** the invocation resolves the codex backend (subject to availability rules) and the cleaned query contains no `--worker` token

#### Scenario: Legacy flag is not recognized
- **WHEN** the user invokes `/dhpk:do --fast-worker=codex <task>` after this change ships
- **THEN** `--fast-worker=codex` is not parsed as a backend override (it flows through as ordinary task text) and no alias or deprecation shim intervenes

#### Scenario: No dangling references remain
- **WHEN** the repository is searched for `--fast-worker` after this change
- **THEN** no command, skill, rule, README, or goal-template occurrence remains (CHANGELOG BREAKING entry excepted)

### Requirement: `--reasoner` flag selects the deep-reasoning backend
`/dhpk:do` SHALL accept `--reasoner=<claude|codex>[:<model>[:<effort>]]`, parsed and stripped before route matching. Only `claude` and `codex` are valid backends; `agy` is explicitly unsupported. `claude` SHALL route reasoning-heavy dispatches to `dhpk:deep-reasoner`; `codex` SHALL route them to `dhpk:codex-deep-reasoner`. Model/effort resolution SHALL follow the `--plan` precedence pattern: explicit flag segments > backend-specific userConfig (`deep_reasoner_model`/`deep_reasoner_effort` for claude; `codex_deep_reasoner_model`/`codex_deep_reasoner_effort` for codex) > built-in defaults (claude: frontmatter; codex: `gpt-5.6-sol` @ `high`). An invalid backend value SHALL warn one line and fall back to the userConfig/default resolution without failing the route. The flag SHALL affect only implementation-class routes; any other resolved route SHALL print a literal one-line `--reasoner ignored: ...` message and proceed unaffected.

#### Scenario: Bare codex backend uses defaults
- **WHEN** the user invokes `/dhpk:do --reasoner=codex <task>` with no `codex_deep_reasoner_*` userConfig set
- **THEN** reasoning-heavy dispatches for that invocation go to `dhpk:codex-deep-reasoner` at `gpt-5.6-sol` @ `high`

#### Scenario: Full segment override
- **WHEN** the flag is `--reasoner=codex:gpt-5.6-sol:medium`
- **THEN** the codex deep reasoner is dispatched with model `gpt-5.6-sol` and effort `medium`, overriding userConfig

#### Scenario: Unsupported backend warns and falls back
- **WHEN** the flag is `--reasoner=agy`
- **THEN** a one-line warning is printed and reasoning dispatch resolution falls back to userConfig/default; the route proceeds

#### Scenario: Non-implementation route ignores the flag
- **WHEN** `--reasoner=codex` is passed and the resolved route is not implementation-class
- **THEN** the router prints the literal `--reasoner ignored: ...` line and the route runs unaffected

#### Scenario: Missing codex CLI falls back to claude reasoner
- **WHEN** `--reasoner=codex` is passed but no codex executable is available
- **THEN** a one-line warning is printed and reasoning dispatches fall back to `dhpk:deep-reasoner` (missing-executable fallback only; execution/auth/model failures remain BLOCKED per selector semantics)
