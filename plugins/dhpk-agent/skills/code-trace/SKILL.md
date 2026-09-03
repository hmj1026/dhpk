---
name: code-trace
description: "Trace unfamiliar code, diagnose a reproducible failure, investigate history, or select one code-navigation tool. Use when evidence must follow symbols, callers, data flow, regressions, or tool choice. Not for implementing a confirmed fix, reviewing a proposed diff, or plain-text/document search. Output: an evidence-backed trace, root-cause state, history report, or executable tool route."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Code Trace

Use the smallest mode that answers the question. The default stance is
evidence-first and read-only: inspect the repository, trace the relevant
boundary, and report what remains unknown. A diagnosis may recommend a repair
or a regression test, but it does not implement the repair.

## Modes

| Mode | Use when | Completion criterion |
|---|---|---|
| `explore` | You need to understand an unfamiliar symbol, file, module, or flow. | Entry point, caller/callee path, evidence, assumptions, and gaps are recorded. |
| `diagnose` | A failure, regression, performance problem, data inconsistency, or timing issue needs a confirmed cause. | One falsifiable root cause is supported by evidence, or the current blocker and next check are explicit. |
| `history` | You need to know when, why, or by whom behavior changed. | Blame, timeline, original/problematic comparison, and actionable conclusion are reported. |
| `select-tool` | You need one code-navigation tool and a fallback chosen. | One intent row, executable primary call, and concrete fallback or `none` are returned. |

If `--mode` is omitted, infer one mode only when intent is unambiguous. A
request to edit a symbol first requires the repository's impact-analysis rule
before any implementation lane touches it; this skill only reports the impact.

## When NOT to Use

- Implement a confirmed change → use `flow-drive`.
- Review a proposed change → use `change-verdict`.
- Author or audit a skill → use `skill-forge` or `skill-scope`.

## `explore`

1. Identify the repository root, question, entry point, and target symbol.
2. Follow the repository's CX priority: use `cx overview`, then `cx
   definition`, then `cx references` for symbol-level questions. Use the
   selected semantic fallback only when CX cannot answer.
3. Trace callers, callees, data/control transitions, and observable output
   until the relevant boundary is accounted for.
4. For `--dual`, dispatch an isolated read-only perspective with only the
   original question, repository path, and depth. Reconcile evidence after
   the primary trace; never seed the second perspective with a conclusion.
5. For `--explain --depth brief|normal|deep`, keep the response within the
   requested depth. Load `references/explore/` only for the selected branch.

## `diagnose`

Use the five-phase loop:

`Clarify → Gather evidence → Trace and confirm → Design the fix → Preserve knowledge`

Turn the symptom into a minimal red-capable reproduction or probe before broad
theorizing. Maintain ranked, falsifiable hypotheses with a discriminating
check and rejection evidence. Redact secrets from commands, logs, traces, and
handoffs. Do not promote a plausible explanation to root cause without the
smallest confirming check; verify the cause with that check.

Load the phase-specific material from `references/diagnose/` only when that
phase requires it. The bundled scripts are deterministic read/query helpers;
run them with bounded output and preserve their actual exit status. If the
repository's policy calls for an investigation document, ask for or receive
explicit authorization before creating it; otherwise return the phase report
in the response and name the single next handoff.

## `history`

Use the narrowest history query that answers the question: `git blame` for
ownership, `git log --follow` for timeline, `git log -S`/`-G` for introduction,
and `git show`/`git diff` for original-versus-problematic comparison. Pin the
relevant commit range, distinguish author from committer where material, and
avoid changing refs, the index, or the worktree. Load
`references/history/commands.md` for command/report details and
`references/history/wsl-traps.md` only when the environment matches.

## `select-tool`

1. Read `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` sections “Decision tree”
   and “Tie-breakers”; that policy card owns row order and tie-breaks.
2. Map the request to exactly one intent row and select its primary tool.
3. Use the named fallback only when the primary is unavailable or returns no
   useful result. Prefer CX when both CX and GitNexus are valid, except for
   GitNexus-only operations; leave GitNexus-specific semantics to its external
   package skill.
4. For a planned edit, rename, or refactor, read the policy card's impact
   timing before touching an existing symbol.

Return:

```text
Intent: <matched decision-tree row>
Primary: <exact command or MCP call>
Fallback: <exact command or MCP call, or none>
```

## Output

```markdown
## Code trace: <mode>
- Target/question: <target>
- Mode/depth: <mode and depth>
- Entry point or fixed commit: <evidence anchor>
- Flow or timeline: <ordered path>

### Evidence
- <file:line, commit, command, or tool result>

### Findings and gaps
- <conclusion, hypothesis state, or unresolved link>

### Next action
- <one handoff, or none>
```

For `diagnose`, include expected/actual behavior, reproduction status, ranked
hypotheses, one confirmed cause or blocker, options/risks/verification intent,
and stop-loss state. For `explore --dual`, keep primary and independent
findings separate before the agreement/difference table.

## References

- `references/explore/` — search patterns, explanation depth, and independent perspective.
- `references/diagnose/` — phase templates, tracing, waiting, defense-in-depth, checklists, and scripts.
- `references/history/` — git command/report reference and environment traps.
- `references/select-tool/decision-tree.md` — edge cases and routing rationale.

## Verification

- [ ] Exactly one mode and requested depth are stated.
- [ ] Definitions/references were inspected at symbol or commit granularity before broad search.
- [ ] Every material conclusion has evidence; hypotheses and gaps remain labeled.
- [ ] Dual perspectives, if used, were independent and separately reported.
- [ ] No implementation, fix, refactor, commit, or destructive cleanup was performed.
