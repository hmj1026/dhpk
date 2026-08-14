# cli-backed-fast-workers Specification

## Purpose
TBD - created by archiving change dhpk-usage-audit-and-cli-fast-workers. Update Purpose after archive.
## Requirements
### Requirement: CLI-backed fast-worker agents exist and preserve the fast-worker contract
The plugin SHALL ship two root agents, `agents/codex-fast-worker.md` and `agents/agy-fast-worker.md`, each a write-capable mechanical implementer that executes its work by shelling out to an external CLI backend. Both SHALL preserve the four fast-worker contract pillars: (1) a required task spec of target file list + exact change intent per file + verification command, escalating on ambiguity instead of guessing; (2) surgical edits only — no opportunistic refactors or out-of-scope changes; (3) stop after 3 failed verification attempts and escalate with an attempt log and ≥2 alternatives; (4) a mandatory complete edited-file list in every report. Frontmatter SHALL declare `model: sonnet` (validator constraint); the CLI backend is invoked from the agent body.

#### Scenario: Task spec applied via CLI backend
- **WHEN** `codex-fast-worker` is dispatched with target files, change intent, and a verification command
- **THEN** it composes a self-contained prompt, executes it through the codex CLI in workspace-write mode, runs the verification command itself, and reports pass/fail plus the complete edited-file list

#### Scenario: Ambiguous spec escalates
- **WHEN** the dispatched task spec omits the verification command or leaves change intent underspecified
- **THEN** the agent returns the blocking question without invoking the CLI backend

### Requirement: Codex invocation contract
The `codex-fast-worker` agent SHALL invoke the codex CLI via the shared wrapper (`skills/codex-bridge/scripts/run-codex.sh`) extended with optional model/effort arguments, producing an invocation equivalent to `codex exec --skip-git-repo-check --sandbox workspace-write -c approval_policy="never" --cd <workdir> -m <model> -c model_reasoning_effort="<effort>" --output-last-message <out-file>` with the prompt fed via stdin from a temp file. When the model/effort arguments are empty the wrapper SHALL omit the `-m`/`-c model_reasoning_effort` flags entirely, preserving the existing inherit-from-config behavior for `codex-bridge`. On a verified wrapper timeout, the agent SHALL consume the `dhpk.codex.timeout.v1` envelope and SHALL not treat a non-empty salvaged report as independent verification.

#### Scenario: Model and effort flags applied
- **WHEN** the wrapper is called with model `gpt-5.6-luna` and effort `xhigh`
- **THEN** the codex invocation includes `-m gpt-5.6-luna` and `-c model_reasoning_effort="xhigh"`

#### Scenario: Backwards-compatible without model args
- **WHEN** the wrapper is called with the original three arguments only
- **THEN** no `-m` or `model_reasoning_effort` override is passed and behavior is byte-identical to the pre-change wrapper

#### Scenario: Codex timeout report is salvaged
- **WHEN** the shared wrapper exits `124` with `verified_wrapper_timeout=true`
- **THEN** the agent forwards the envelope to its caller and records the report as timeout evidence
- **AND** it independently checks the assigned diff before classifying any edits

### Requirement: Agy invocation contract
The `agy-fast-worker` agent SHALL invoke the agy CLI via a dedicated wrapper script (`skills/agy-fast-worker/scripts/run-agy.sh <workdir> <prompt-file> <model>`) implementing the non-interactive combination verified against the installed agy 1.1.8 binary (`agy --help`): plan-confirmation `Y` piped on stdin unconditionally, `--dangerously-skip-permissions` (auto-approves tool permission requests only), `--add-dir <workdir>` (repeatable; required — print mode ignores the shell cwd), `--model "<model>"`, and `-p`/`--print` (alias `--prompt`) with the prompt content, bounding the wait with `--print-timeout` (CLI default 5m0s). Live re-verification against the installed 1.1.8 binary (accept-edits mode, stdin from `/dev/null`) found stdin `Y` is **not** required by this version when `--dangerously-skip-permissions` is set — the "separate gate `--dangerously-skip-permissions` does not clear" characterization was itself stale 1.1.2-era text carried forward without re-verification across the 1.1.2 → 1.1.8 gap. The wrapper keeps piping `Y` regardless: harmless when unread, and possibly still required by a pre-1.1.8 binary on the degrade path.

The wrapper SHALL additionally set `--mode` to express the autonomy boundary (`plan` for inspect-and-report work, `accept-edits` for write-enabled work) and SHALL request structured output via `--output-format json` together with `--json-schema` bound to the worker's report contract. Where such a flag enforces a property, the composed prompt SHALL NOT restate it in prose.

The wrapper SHALL NOT pass `--effort`: the agy model string already encodes the reasoning tier (`Gemini 3.6 Flash (High)` / `gemini-3.6-flash-high`), so a separate effort flag is redundant and a source of semantic conflict.

The wrapper SHALL NOT use `--cwd`: the official Antigravity CLI docs (antigravity.google/docs/cli/best-practices, retrieved 2026-07-14) recommend `-p ... --cwd $(pwd)`, but no such flag exists in the installed binary. Installed `--help` / `agy models` / the CLI's own persisted `settings.json` are the ground truth over published or auto-generated documentation, **re-verified whenever the agy version changes**. The wrapper SHALL fail loudly (non-zero exit with the CLI's stderr) rather than hang past the print timeout.

The wrapper SHALL record the exact agy version its flag combination was verified against. That recorded baseline SHALL be re-verified — not merely renumbered — whenever the installed agy version differs from it, because a version gap silently accumulates unadopted flags: the 1.1.2 → 1.1.8 gap hid `--output-format`, `--json-schema`, and `--mode` for six patch releases.

Because the previous version of this clause failed for want of an observer rather than for want of wording, the wrapper SHALL compare the installed agy version against that recorded baseline at runtime and SHALL emit a one-line notice on mismatch. This reuses the version detection the structured-output gate already requires and introduces no separate synchronization tooling.

Structured output requires agy ≥ 1.1.8. On an older binary the wrapper SHALL degrade to the unstructured path and SHALL say so explicitly; it SHALL NOT silently drop the schema.

The feature floor and the verified baseline are **separate constants** that happen to coincide today. The floor is the lowest version providing the structured-output flags; the baseline is the version the flag combination was last verified against. They SHALL NOT share one variable: refreshing the baseline after a future release would otherwise raise the floor with it and silently stop requesting structured output on versions that support it.

#### Scenario: Non-interactive agy run
- **WHEN** the wrapper runs with a workdir, prompt file, and model `Gemini 3.6 Flash (High)`
- **THEN** agy executes the prompt against that workdir with the selected model and the wrapper returns agy's output and exit code

#### Scenario: Wrapper does not silently hang
- **WHEN** agy blocks awaiting input the wrapper did not anticipate
- **THEN** the invocation terminates at the `--print-timeout` bound (or a tighter wrapper-level timeout) with a non-zero exit and diagnostic output, not an indefinite hang

#### Scenario: Docs-vs-binary drift does not corrupt the wrapper
- **WHEN** published or auto-generated CLI docs suggest a flag or argument form absent from — or contradicted by — the installed binary's `--help`, `agy models`, or persisted settings
- **THEN** the wrapper follows the installed binary and the divergence is recorded, not the documented example

#### Scenario: Autonomy boundary is set by flag
- **WHEN** the wrapper dispatches write-enabled mechanical work
- **THEN** it passes `--mode accept-edits`, and the composed prompt omits equivalent prose about what the request authorizes

#### Scenario: Report contract is enforced by schema
- **WHEN** the wrapper dispatches a task on agy ≥ 1.1.8
- **THEN** it passes `--output-format json` and `--json-schema` bound to the report contract, and the returned payload parses against that schema

#### Scenario: Older binary degrades audibly
- **WHEN** the installed agy predates `--json-schema`
- **THEN** the wrapper runs the unstructured path and states that structured reporting is unavailable, rather than omitting the flag silently

#### Scenario: Effort is not passed separately
- **WHEN** the wrapper builds the agy invocation
- **THEN** no `--effort` flag is passed, because the model string carries the tier

#### Scenario: Refreshing the baseline does not raise the feature floor
- **WHEN** a future agy release prompts a refresh of the recorded verified baseline
- **THEN** the structured-output floor stays at the lowest version providing those flags, and the wrapper still requests structured output on any binary at or above that floor

#### Scenario: Version drift is observable at runtime
- **WHEN** the installed agy version differs from the version recorded in the wrapper's verification note
- **THEN** the wrapper emits a one-line drift notice naming both versions, so the gap surfaces on use rather than waiting for someone to read the comment

#### Scenario: Version gap triggers re-verification, not renumbering
- **WHEN** the installed agy version differs from the version recorded in the wrapper's verification note
- **THEN** the flag combination is re-verified against the installed binary's `--help` and the newly available flags are assessed for adoption, rather than the recorded version number being updated on its own

### Requirement: Backend availability fallback
Both CLI-backed agents SHALL check backend availability before composing work and SHALL return `RESULT: BLOCKED` with the exact failure for missing CLI, authentication, authorization, rejected model, or execution errors. They SHALL not simulate or perform the edits themselves. A fallback to `fast-worker` is permitted only when explicitly configured and only for a missing backend executable; the report SHALL identify the requested and selected backends.

#### Scenario: CLI absent without fallback
- **WHEN** `agy-fast-worker` is selected on a machine without the agy binary and no fallback is configured
- **THEN** it returns `RESULT: BLOCKED`, names the missing CLI, and makes no file edits

#### Scenario: CLI absent with configured fallback
- **WHEN** a CLI-backed worker is selected, its executable is absent, and fallback is configured as `claude`
- **THEN** the dispatcher may run `fast-worker` and the result records the fallback

#### Scenario: Model or authorization failure
- **WHEN** the CLI rejects the configured model or authorization
- **THEN** the selected worker returns `RESULT: BLOCKED` and does not fall back or guess another model

### Requirement: Independent verification and edited-file accounting
Both agents SHALL run the task spec's verification command themselves (via Bash) after the CLI backend completes, and SHALL derive the edited-file list independently of the backend's self-report (e.g. `git status --porcelain` capture before and after the CLI run). The backend's own claims about what it changed SHALL NOT be the sole source of the edited-file list.

A schema-enforced backend report SHALL NOT weaken this boundary. `--json-schema` guarantees the **shape** of the backend's self-report, not the **truth** of its contents; a well-formed report SHALL NOT be treated as evidence that the work was done or verified. Where the backend is instructed to run the verification command and iterate on its output, those backend-internal iterations SHALL NOT count against the 3-attempt bound, which counts the agent's own dispatch-and-independently-verify cycles.

#### Scenario: Backend under-reports its edits
- **WHEN** the CLI backend modifies a file it does not mention in its output
- **THEN** the agent's edited-file list still includes that file, because the list is derived from working-tree state, not the backend's narrative

#### Scenario: Verification failure loop bound
- **WHEN** the verification command still fails after 3 backend fix attempts
- **THEN** the agent stops, reports `RESULT: PARTIAL` or `BLOCKED` with the attempt log, and escalates rather than looping

#### Scenario: Schema conformance is not evidence of correctness
- **WHEN** the backend returns a report that validates against the schema and claims verification passed
- **THEN** the agent still runs the verification command itself and still derives the edited-file list from the working tree

#### Scenario: Backend-internal iteration does not consume the attempt budget
- **WHEN** the backend is told to run the verification command and iterate on failures, and does so several times within one dispatch
- **THEN** that dispatch counts as one attempt against the 3-attempt bound
