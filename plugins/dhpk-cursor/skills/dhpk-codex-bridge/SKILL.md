---
name: dhpk-codex-bridge
description: "Use when an explicit CLI handoff or blind second opinion should go to the GPT-5.6 family through one-shot codex exec: gpt-5.6-sol/high for read-only or gpt-5.6-luna/xhigh for workspace-write. Not for context-dependent or iterative work, or retired MCP codex-* review loops. Output: the bounded, redacted codex exec result."
---
# Codex Bridge

Use this skill only after routing has selected an explicit CLI handoff or second opinion. The dedicated `dhpk-codex-bridge`
subagent hands a **self-contained** task to the GPT-5.6 family through the Codex CLI
(`codex exec`) and relays its bounded, redacted output. The bundled `scripts/run-codex.sh` owns sandbox selection,
approval policy, and output capture; this skill defines when to outsource, how to compose
the prompt, and how to report the result.

## When to use

- **Explicit opt-in** — the caller selects this bridge or a named second-opinion option. This bridge is not a default
  runtime path.
- **Clear-spec bulk work** — a mechanical or well-specified implementation / data-analysis / transformation task that a cheaper capable model can do while Claude stays on higher-value work.
- **Independent second opinion** — a review of a plan, root-cause diagnosis, or diff where you want a view that does **not** inherit Claude's reasoning (blind second perspective).

## When NOT to Use

- The task needs our **conversation context** — Codex gets a fresh session and sees only the prompt. If you can't make the prompt self-contained, don't use this.
- **Interactive / iterative** pairing — this is one-shot; there is no back-and-forth.
- **In-session structured review** with a review-loop — use `change-verdict` (current-model or `scripts/review.sh --backend cli`) instead (see the retained paths below).
- No explicit Codex opt-in — keep the work on the normal codex-free path.
- Codex is unavailable or not logged in — report the failure and let the caller choose a codex-free fallback.

## The three Codex paths (pick the right one)

| Path | Transport / session | Use it for |
|------|--------------------|-----------|
| Retired dhpk `codex-*` MCP skills | historical in-session Codex MCP tools; no current route | historical context only; use the backend-neutral owners |
| external `codex:` plugin | Codex app-server (persistent JSON-RPC broker) | rescue / long-running handoff via a persistent runtime |
| **codex-bridge (this skill)** | one-shot `codex exec` bash wrapper, fresh session, output **quarantined in a subagent**, relayed with bounded redaction | outsource a self-contained bulk task, or a **blind** second opinion |

codex-bridge is the thinnest, most isolated path — no MCP, no persistent broker, no in-context output.

## Compose a self-contained prompt

Codex cannot see our chat. Apply the Shared + GPT-5.x sections of
`.cursor/dhpk/agent-traps/_common/cli-prompt-composition.md`. Every prompt must
stand alone and must not contain secrets:

1. **Goal** — one sentence stating exactly what to produce.
2. **Files** — the relevant paths as **absolute** paths (Codex reads them in `<workdir>`).
3. **Spec / acceptance** — constraints, invariants, what "correct" means.
4. **Output format** — exactly how the answer should come back (a diff, a list, a verdict, a patch…).

Also state whether Codex may edit files, which checks it must run, and how it should report
unresolved issues. Redact credentials and sensitive log content. A prompt is ready only when
another agent could execute it without seeing this conversation.

## Run it

1. `Write` the composed prompt to a unique temp file (avoids long-arg / escaping issues).
2. Call the wrapper:

   ```
   bash "${CURSOR_PLUGIN_ROOT}/skills/dhpk-codex-bridge/scripts/run-codex.sh" <mode> <workdir> <prompt-file>
   ```

   - `mode` = `read-only` for investigation / review (`codex-reviewer` →
     `gpt-5.6-sol` / `high`), `workspace-write` when Codex must edit files
     (`codex-worker` → `gpt-5.6-luna` / `xhigh`). A pre-GPT-5.6 model is not
     a fallback and cannot satisfy runtime acceptance evidence.
   - `workdir` = the working root (absolute); `prompt-file` = the temp file from step 1.
   - The dispatcher MUST first set `DHPK_CLI_TRANSPORT_CONTEXT` to its private
     `dhpk.cli.context.v1`. It alone supplies the validated maximum role, scope,
     timeout, and receipt paths; the wrapper blocks rather than inventing them.
   - Omit optional model/effort overrides unless the dispatcher attests them.
     The portable runner enforces the attested timeout without `timeout` or
     `gtimeout`, under a restricted runtime PATH.
   - The wrapper uses only Linux/WSL `/usr/bin/python3` as its bootstrap. The
     dispatcher context must attest that same restricted runtime entry; a host
     without it is `BLOCKED`.
3. The wrapper prints Codex's final message to stdout on success (exit 0), or fails loudly on error.

### Contained timeout receipt

On exit `124`, read the dispatcher-selected contained `dhpk.cli.receipt.v1`.
Only terminal `TIMEOUT` is timeout evidence, and its redacted report is never
independent verification. Missing, invalid, or uncontained receipt evidence is
`BLOCKED`; do not fabricate a timeout envelope, retry, edit inline, or choose a
different backend.

For a single-file dispatch, report `TIMEOUT_SALVAGED` only when an independent
path-scoped diff verifies attributable edits; otherwise report `BLOCKED` and
request reconciliation. There is no automatic retry and no backend fallback
from a timeout result.

> **Permissions:** this repo's `.claude/settings.json` allows `Bash(codex exec:*)` and the path-scoped `Bash(bash skills/dhpk-codex-bridge/scripts/run-codex.sh:*)`, which covers a **direct** relative-path call from the plugin root. The **subagent** invokes the wrapper via `.cursor/dhpk` (an absolute path) that a path-scoped rule cannot match ([#9354](https://github.com/anthropics/claude-code/issues/9354), re-checked 2026-08-17); to keep a non-interactive subagent's Bash from being auto-denied, add the broader `Bash(bash:*)` rule (the same workaround `dhpk-onepassword-session` uses — a deliberate user decision, not applied automatically). Consumers add the equivalent rule in their own settings.

## Output

Return one of these envelopes:

Success:

```text
sandbox=<mode> exit=0
<bounded, redacted Codex final message>
```

Failure:

```text
sandbox=<mode> exit=<non-zero code>
<bounded, redacted wrapper stderr tail>
```

Verified timeout (non-success):

```text
sandbox=<mode> exit=124
<contained dhpk.cli.receipt.v1 TIMEOUT evidence>
```

When receipt containment or redaction cannot be verified, callers report
`BLOCKED`.

The first line is bridge metadata. Preserve the following bounded, redacted Codex or wrapper payload without reinterpretation. An
empty final message is a failure, not a successful result. Preserve the wrapper's `401`
login hint when present.

## Relay the result

- On success: add only the `sandbox=<mode> exit=0` metadata line, then return Codex's bounded,
  redacted output without polishing, summarising away, or softening its conclusions.
- On failure (non-zero exit / empty output): return the failure envelope with the mode, exit
  code, and wrapper stderr tail. **Never fabricate** a result. A `401` means Codex is not
  logged in (`codex login`).

The parent thread may interpret the returned result after relay, but the bridge subagent must
not alter the payload before returning it.

## Verification

- [ ] Prompt is self-contained (goal · absolute paths · spec · output format).
- [ ] Correct sandbox mode (`read-only` for review, `workspace-write` only when edits are needed).
- [ ] Wrapper completed with a non-empty final message, or failure was reported with mode, exit code, and stderr tail.
- [ ] Exit `124` has a contained `dhpk.cli.receipt.v1` terminal `TIMEOUT` receipt; any salvage has independent path-scoped diff evidence and a reconciliation action.
- [ ] Result was relayed with bounded redaction, or failure was reported honestly — nothing invented.
