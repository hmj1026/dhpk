---
name: codex-bridge
description: 'Outsource a self-contained task to gpt-5.5 via the Codex CLI (codex exec) and relay its raw output verbatim, with the heavy output quarantined in a subagent. Use when: (a) offloading bulk or mechanical, clearly-specified implementation/analysis to a cheaper capable model, or (b) getting a second opinion on a plan, diagnosis, or diff that is independent of Claude. Not for: work that needs our conversation context (Codex sees a fresh session — the prompt must be self-contained), interactive/iterative pairing, or in-session structured review via the MCP codex-* skills (use codex-code-review / codex-cli-review). Output: gpt-5.5''s verbatim response, or an honest failure report — never fabricated.'
allowed-tools: 'Bash(bash:*), Bash(codex exec:*), Read, Write'
---

# Codex Bridge

Hand a **self-contained** task to gpt-5.5 through the Codex CLI (`codex exec`) and bring
back its **verbatim** output. The bundled `scripts/run-codex.sh` owns the mechanism (flags
hardcoded); this skill teaches *when* to outsource and *how* to compose the prompt. Run it
from the dedicated `codex-bridge` subagent so Codex's large output stays isolated from the
main thread.

## When to use

- **Clear-spec bulk work** — a mechanical or well-specified implementation / data-analysis / transformation task that a cheaper capable model can do while Claude stays on higher-value work.
- **Independent second opinion** — a review of a plan, root-cause diagnosis, or diff where you want a view that does **not** inherit Claude's reasoning (blind second perspective).

## When NOT to Use

- The task needs our **conversation context** — Codex gets a fresh session and sees only the prompt. If you can't make the prompt self-contained, don't use this.
- **Interactive / iterative** pairing — this is one-shot; there is no back-and-forth.
- **In-session structured review** with a review-loop — use the MCP `codex-*` skills (`codex-code-review`, `codex-cli-review`) instead (see the three paths below).
- Codex is not installed / not logged in — a codex-free path applies.

## The three Codex paths (pick the right one)

| Path | Transport / session | Use it for |
|------|--------------------|-----------|
| dhpk `codex-*` MCP skills | in-session Codex MCP tools, output in the main context | structured review / implement / architecture with a review-loop |
| external `codex:` plugin | Codex app-server (persistent JSON-RPC broker) | rescue / long-running handoff via a persistent runtime |
| **codex-bridge (this skill)** | one-shot `codex exec` bash wrapper, fresh session, output **quarantined in a subagent**, relayed verbatim | outsource a self-contained bulk task, or a **blind** second opinion |

codex-bridge is the thinnest, most isolated path — no MCP, no persistent broker, no in-context output.

## Compose a self-contained prompt

Codex cannot see our chat. Every prompt must stand alone:

1. **Goal** — one sentence stating exactly what to produce.
2. **Files** — the relevant paths as **absolute** paths (Codex reads them in `<workdir>`).
3. **Spec / acceptance** — constraints, invariants, what "correct" means.
4. **Output format** — exactly how the answer should come back (a diff, a list, a verdict, a patch…).

Keep it tight and unambiguous — a fresh model with no context will do literally what the prompt says.

## Run it

1. `Write` the composed prompt to a temp file (avoids long-arg / escaping issues).
2. Call the wrapper:

   ```
   bash "${CLAUDE_PLUGIN_ROOT}/skills/codex-bridge/scripts/run-codex.sh" <mode> <workdir> <prompt-file>
   ```

   - `mode` = `read-only` for investigation / review, `workspace-write` when Codex must edit files.
   - `workdir` = the working root (absolute); `prompt-file` = the temp file from step 1.
3. The wrapper prints Codex's final message to stdout on success (exit 0), or fails loud on error.

> **Permissions:** this repo's `.claude/settings.json` allows `Bash(codex exec:*)` and the path-scoped `Bash(bash skills/codex-bridge/scripts/run-codex.sh:*)`, which covers a **direct** relative-path call from the plugin root. The **subagent** invokes the wrapper via `${CLAUDE_PLUGIN_ROOT}` (an absolute path) that a path-scoped rule cannot match ([#9354](https://github.com/anthropics/claude-code/issues/9354)); to keep a non-interactive subagent's Bash from being auto-denied, add the broader `Bash(bash:*)` rule (the same workaround `op-session` uses — a deliberate user decision, not applied automatically). Consumers add the equivalent rule in their own settings.

## Relay the result

- On success: return Codex's output **verbatim** — do not polish, summarize away, or soften its conclusions. The point is its independent view. Annotate with the sandbox mode and exit code.
- On failure (non-zero exit / empty output): report the failure honestly (mode + exit code + the wrapper's stderr tail). **Never fabricate** a result. A `401` means Codex isn't logged in (`codex login`).

## Verification

- [ ] Prompt is self-contained (goal · absolute paths · spec · output format).
- [ ] Correct sandbox mode (`read-only` for review, `workspace-write` only when edits are needed).
- [ ] Result relayed verbatim, or failure reported honestly — nothing invented.
