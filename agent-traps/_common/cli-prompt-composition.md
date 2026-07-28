# CLI Prompt-Composition Baseline

Loaded on demand by agents that compose a **self-contained** prompt for an
external CLI-backed model (codex, agy). Governs **effectiveness**, not safety —
pair with `prompt-defense.md` for untrusted-content handling; neither restates
the other. Always load Shared; name only the **per-model** section your surface
needs (GPT-5.x or Gemini, never both).

## Shared (load for every CLI-backed surface)

- **State each instruction once.** These prompts are self-contained by design —
  the backend sees a fresh session with none of this conversation — which makes
  restating a constraint in multiple sections a known failure mode, not extra
  safety. Say the autonomy boundary once, the report shape once.
- **A flag beats prose.** Where the backend CLI has a flag that enforces the
  autonomy boundary or the report shape, set the flag and omit the equivalent
  prose. Flags are mechanism; prose is persuasion — prefer mechanism whenever
  the CLI actually has it.
- **State the boundary and the shape — unless the flag above already covers it.**
  Read-only dispatch: state the request authorizes inspection and reporting, not
  modification. Write-enabled dispatch: state it authorizes only the in-scope
  changes named by the task spec. Report shape: conclusion first, then supporting
  evidence, then next action. Skip the prose for whichever half a CLI flag already
  enforces (see above) — don't state both.

## GPT-5.x section (codex-fast-worker, codex-deep-reasoner, codex-bridge skill)

- **Source**: GPT-5.6 latest-model guide. `codex-bridge` dispatches gpt-5.5 —
  a one-minor-version gap from this guidance; treat as directionally correct,
  not exact.
- **Autonomy boundary**: `read-only` sandbox → inspect-and-report; `workspace-write`
  → in-scope-changes-only, naming exactly the files the task spec authorizes.
- **Report shape**: conclusion first, then evidence, then next action — GPT-5.x
  models front-load better when the shape is stated explicitly rather than implied.
- **`reasoning.effort` is already handled** — dhpk passes it via `codex exec -c
  model_reasoning_effort=<effort>`; this is not a prompt-text gap.
- **`text.verbosity` and `reasoning.mode` are out of scope** — `codex exec` gives
  no control surface for either, so no prompt text should claim to set them.

## Gemini section (agy-fast-worker)

- **Source**: official Gemini 3 family guidance. The dispatched model is
  Gemini 3.6 Flash — a minor-version gap; the family-level guidance below still
  applies, but treat any Gemini-3.5-specific example as stale.
- **Order matters**: put large context (file contents, task spec) first, the
  specific question last, anchored with "Based on the preceding information...".
  Put the single most important instruction at the very top, not buried mid-prompt.
- **Structural consistency**: keep section headers and formatting uniform across
  the prompt — Gemini models are more sensitive to structural noise than GPT-5.x.
- **Flash-tier grounding**: state the knowledge-cutoff caveat and a strict
  grounding clause (answer from the provided context and the actual working
  tree, not from training-data assumptions about this repo).
- **Do not cite `--cwd`** — Context7 corpus and agy's own auto-generated docs
  both suggest a `--cwd` flag that does not exist in the installed agy binary
  (confirmed by `agy --help`). Treat both sources as lower-confidence than the
  installed `--help` / `agy models` output, and never include a `--cwd` example
  here.
