---
name: dhpk-codex-bridge
description: 'Use when CODEX=on and a self-contained bulk task or blind second opinion should go to gpt-5.5 through one-shot codex exec. Not for context-dependent or iterative work, or structured MCP codex-* review loops. Output: the relayed codex exec result, verbatim.'
allowed-tools: 'Bash(bash:*), Bash(codex exec:*), Read, Write'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Codex Bridge

Use this skill only after routing has selected `CODEX=on`. The dedicated `dhpk-codex-bridge`
subagent hands a **self-contained** task to gpt-5.5 through the Codex CLI (`codex exec`) and
relays its **verbatim** output. The bundled `scripts/run-codex.sh` owns sandbox selection,
approval policy, and output capture; this skill defines when to outsource, how to compose
the prompt, and how to report the result.

## When to use

- **Explicit opt-in** — `CODEX=on` is selected by the caller. This bridge is not a default
  runtime path.
- **Clear-spec bulk work** — a mechanical or well-specified implementation / data-analysis / transformation task that a cheaper capable model can do while Claude stays on higher-value work.
- **Independent second opinion** — a review of a plan, root-cause diagnosis, or diff where you want a view that does **not** inherit Claude's reasoning (blind second perspective).

## When NOT to Use

- The task needs our **conversation context** — Codex gets a fresh session and sees only the prompt. If you can't make the prompt self-contained, don't use this.
- **Interactive / iterative** pairing — this is one-shot; there is no back-and-forth.
- **In-session structured review** with a review-loop — use `dhpk-change-review` (MCP backend or `scripts/review.sh --backend cli`) instead (see the three paths below).
- `CODEX=off` or no explicit Codex opt-in — keep the work on the normal codex-free path.
- Codex is unavailable or not logged in — report the failure and let the caller choose a codex-free fallback.

## The three Codex paths (pick the right one)

| Path | Transport / session | Use it for |
|------|--------------------|-----------|
| dhpk `codex-*` MCP skills | in-session Codex MCP tools, output in the main context | structured review / implement / architecture with a review-loop |
| external `codex:` plugin | Codex app-server (persistent JSON-RPC broker) | rescue / long-running handoff via a persistent runtime |
| **codex-bridge (this skill)** | one-shot `codex exec` bash wrapper, fresh session, output **quarantined in a subagent**, relayed verbatim | outsource a self-contained bulk task, or a **blind** second opinion |

codex-bridge is the thinnest, most isolated path — no MCP, no persistent broker, no in-context output.

## Compose a self-contained prompt

Codex cannot see our chat. Apply the Shared + GPT-5.x sections of
`${CLAUDE_PLUGIN_ROOT}/agent-traps/_common/cli-prompt-composition.md`. Every prompt must
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
   bash "${CLAUDE_PLUGIN_ROOT}/skills/dhpk-codex-bridge/scripts/run-codex.sh" <mode> <workdir> <prompt-file>
   ```

   - `mode` = `read-only` for investigation / review, `workspace-write` when Codex must edit files.
   - `workdir` = the working root (absolute); `prompt-file` = the temp file from step 1.
   - Omit optional model/effort overrides unless the caller explicitly supplies them; the wrapper otherwise uses the configured defaults.
   - The wrapper resolves `DHPK_CODEX_ROLE` through the normal project-over-global seam. Use
     `dhpk-codex-bridge` for this skill and configure `codex_bridge_timeout_secs` (or shared
     `codex_timeout_secs`) as an integer number of seconds; `0` intentionally disables the
     wrapper backstop. Do not add a sixth positional timeout argument—the three-argument
     bridge shape is part of the compatibility contract. Invalid values fail closed.
3. The wrapper prints Codex's final message to stdout on success (exit 0), or fails loudly on error.

### Verified timeout envelope

On a verified wrapper timeout, parse the timeout envelope as `dhpk.codex.timeout.v1` with
`skills/dhpk-codex-bridge/scripts/codex-timeout-envelope.js` before classifying exit `124`; its stable fields are
`schema`, `status`, `verified_wrapper_timeout`, `exit_code`, `budget_secs`, `elapsed_secs`, `report_present`,
`report_encoding`, `report_b64`, `stderr_tail_encoding`, `stderr_tail_b64`, `stdout_tail_encoding`,
`stdout_tail_b64`, and `redaction` (`applied` or `unavailable`).
For operational validation, pipe the unchanged object to `node skills/dhpk-codex-bridge/scripts/codex-timeout-envelope.js --parse`;
exit `0` means valid and exit `1` means `BLOCKED`. Keep the original object for forwarding.
Multiline reports and diagnostics use RFC 4648 base64; credentials are redacted before encoding. Raw reports over 256 KiB use
`[TRUNCATED_REPORT_OMITTED]`; the redacted report remains capped at 256 KiB, with `[TRUNCATED]` only for post-redaction
expansion. Oversized diagnostics use `[TRUNCATED_DIAGNOSTIC_OMITTED]`. A report is evidence, never success: single-file
salvage is `TIMEOUT_SALVAGED` only with an independently verified path-scoped diff, otherwise `BLOCKED`; no retry,
no inline edit, and no backend fallback are allowed, and reconciliation is required.
If the Node helper is unavailable or invalid, the wrapper emits a no-payload `redaction=unavailable` envelope; classify
`BLOCKED` and do not infer edits. For multi-file work, the parent owns the `confirmed` / `unconfirmed` / `remaining`
ledger and applies `PARTIAL` or `BLOCKED`; the bridge only forwards the envelope and never retries.

> **Permissions:** this repo's `.claude/settings.json` allows `Bash(codex exec:*)` and the path-scoped `Bash(bash skills/dhpk-codex-bridge/scripts/run-codex.sh:*)`, which covers a **direct** relative-path call from the plugin root. The **subagent** invokes the wrapper via `${CLAUDE_PLUGIN_ROOT}` (an absolute path) that a path-scoped rule cannot match ([#9354](https://github.com/anthropics/claude-code/issues/9354)); to keep a non-interactive subagent's Bash from being auto-denied, add the broader `Bash(bash:*)` rule (the same workaround `dhpk-onepassword-session` uses — a deliberate user decision, not applied automatically). Consumers add the equivalent rule in their own settings.

## Output

Return one of these envelopes:

Success:

```text
sandbox=<mode> exit=0
<Codex final message, unchanged>
```

Failure:

```text
sandbox=<mode> exit=<non-zero code>
<wrapper stderr tail, unchanged>
```

Verified timeout (non-success):

```text
sandbox=<mode> exit=124
<one dhpk.codex.timeout.v1 JSON object, unchanged>
```

When the sanitizer is unavailable, the unchanged JSON object has
`redaction=unavailable` and empty base64 payloads; callers still report
`BLOCKED`.

The first line is bridge metadata. Keep the following Codex or wrapper payload verbatim. An
empty final message is a failure, not a successful result. Preserve the wrapper's `401`
login hint when present.

## Relay the result

- On success: add only the `sandbox=<mode> exit=0` metadata line, then return Codex's output
  **verbatim**. Do not polish, summarize away, or soften its conclusions.
- On failure (non-zero exit / empty output): return the failure envelope with the mode, exit
  code, and wrapper stderr tail. **Never fabricate** a result. A `401` means Codex is not
  logged in (`codex login`).

The parent thread may interpret the returned result after relay, but the bridge subagent must
not alter the payload before returning it.

## Verification

- [ ] Prompt is self-contained (goal · absolute paths · spec · output format).
- [ ] Correct sandbox mode (`read-only` for review, `workspace-write` only when edits are needed).
- [ ] Wrapper completed with a non-empty final message, or failure was reported with mode, exit code, and stderr tail.
- [ ] A verified exit `124` was parsed as `dhpk.codex.timeout.v1` before classification; any salvage has independent path-scoped diff evidence and a reconciliation action.
- [ ] Result was relayed verbatim, or failure was reported honestly — nothing invented.
