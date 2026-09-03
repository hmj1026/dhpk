---
name: dhpk-issue-analyze
description: "GitHub Issue and PR review thread deep analysis with an optional blind verdict. Purpose: analyze issue root causes, classify problems, plan investigations, or triage PR review comments for actionability. Not for: fixing bugs (use flow-guide in bug mode), code exploration (use code-trace). Output: classified analysis + verdict assessment + investigation strategy."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Issue Analyze Skill

## Input Types

| Type | Source | Example |
|------|--------|---------|
| GitHub Issue | Issue number, URL, or description | `/dhpk:dhpk-issue-analyze 123` |
| Review Thread | file:line + reviewer comment | `/dhpk:dhpk-issue-analyze --triage "src/foo.ts:42 — Use early return"` |

When input is a **Review Thread**:
- Phase 1 skips `gh issue view`, uses provided thread data directly
- Phase 2 classification uses Review Thread dimensions (see `references/classification.md`)

## Modes

| Mode | Input Type | Phases Executed | Use Case |
|------|-----------|----------------|----------|
| Full (default) | Issue or Thread | 1 → 2 → 2.5 → 3 → 4 | Deep analysis with investigation |
| Triage (`--triage`) | Review Thread | 2 → 2.5 only | Lightweight classification + verdict (thread data provided inline) |
| Triage (`--triage`) | GitHub Issue | 1 → 2 → 2.5 | Fetch issue first, then classify + verdict |

## When NOT to Use

- Known root cause, fix directly (use `flow-guide` and select the Bug branch)
- Pure feature development (use `flow-guide` and select the Feature branch)
- Only need code review (use `change-verdict`)

## Workflow

1. **Read** the issue with `gh issue view --json ...`, or use the supplied review-thread fields. Extract symptoms, reproduction, errors, and file clues.
2. **Classify** with [classification.md](references/classification.md): unfamiliar → `/dhpk:code-trace`; regression → `/dhpk:code-trace`; complex root → `/dhpk:code-trace --dual`; multiple causes → `/dhpk:dhpk-module-design --mode adversarial`.
3. **Blind verdict** in a fresh read-only isolated reviewer context without the primary classification. Triage mode stops after this phase.
4. **Investigate** unless policy maps the verdict to `DISMISS_VERIFIED`.
5. **Report** the combined evidence, verdict, root-cause hypothesis, and recommendation.

## Investigation Tool Comparison

| Tool                | Purpose                | Speed   | Depth      |
| ------------------- | ---------------------- | ------- | ---------- |
| `/dhpk:code-trace`     | Quick code exploration | Fast    | Single     |
| `/dhpk:code-trace`  | Track change history   | Medium  | Single     |
| `/dhpk:code-trace --dual` | Dual confirmation      | Slow    | Dual-view  |
| `/dhpk:dhpk-module-design --mode adversarial` | Exhaust possibilities  | Slowest | Adversarial|

## Phase 2.5: Verdict Assessment

After classification, the primary model may request an independent actionability
assessment. The normal second perspective is a fresh, isolated, read-only
general-purpose subagent; it receives the issue or review-thread context but not
the primary classification or conclusion. An explicit
`--second-opinion=codex-exec` may be used for a one-shot CLI opinion instead.

**Independent reviewer requirements**:

| Requirement | Detail |
|-------------|--------|
| Thread | **Fresh** isolated subagent (never reuse the primary context) |
| Sandbox | `read-only` |
| Approval policy | `never` |
| Anti-anchoring | Never send the primary Phase 2 classification to the reviewer |

**Prompt construction** (blind verdict — never reveal the primary Phase 2 classification to the reviewer):

- **GitHub Issue input**: provide issue title, body, labels as finding context
- **Review Thread input**: provide file path, line, reviewer comment as finding context
- Always include Standard Research Block (git status, git diff, grep, cat)
- If no independent reviewer is requested or available, mark the result
  **degraded: primary model only** and state plainly: "Only the primary
  model's verdict is present; no independent review ran."

**Independent reviewer output** (all fields required):

```
- reviewer_verdict: ACTIONABLE | NON_ACTIONABLE | UNCERTAIN
- confidence: [0.0 - 1.0]
- evidence_refs: [files/lines/commands used]
- reasoning: [why this verdict]
```

**Policy mapping** (apply these thresholds; the heightened column applies after a repeated-dismiss warning `[DISMISS_PATTERN_WARN]`):

| Verdict | Confidence | Evidence Refs | Result |
|---------|------------|---------------|--------|
| NON_ACTIONABLE | >= 0.80 (normal) / >= 0.85 (heightened) | >= 2 (normal) / >= 3 (heightened) | Skip Phase 3 investigation (DISMISS_VERIFIED) |
| ACTIONABLE | >= 0.70 | any | Proceed to Phase 3 (FIX_REQUIRED) |
| UNCERTAIN / low | any | any | Proceed to Phase 3 (NEED_HUMAN) |

**`--triage` mode**: stop after Phase 2.5, output classification + verdict only.

**Graceful degradation**: if the isolated reviewer or explicitly requested CLI
opinion fails, log a warning, preserve the degraded primary-only state, and
proceed to Phase 3 without claiming an independent verdict.

## Output

### Full Report (default)

```markdown
## Issue Analysis: <title>
- **Classification**: <problem type>
- **Verdict**: ACTIONABLE / NON_ACTIONABLE / UNCERTAIN (confidence: 0.XX)
- **Root cause hypothesis**: <analysis>
- **Investigation strategy**: <tools + plan>
- **Priority**: P0 / P1 / P2
```

### Triage Report (`--triage` mode)

```markdown
## Triage: <file>:<line> (or issue title)
- **Category**: <classification>
- **Verdict**: ACTIONABLE / NON_ACTIONABLE / UNCERTAIN
- **Confidence**: 0.XX
- **Reasoning**: <brief justification>
- **Evidence**: <file:line references>
```

## Verification

- [ ] Issue / review thread content fully extracted
- [ ] Problem type correctly classified
- [ ] Verdict assessment executed by an isolated reviewer when requested, or the
  degraded primary-only state is recorded
- [ ] Reviewer prompt contains no primary conclusions (anti-anchoring)
- [ ] Fresh isolated reviewer context used (not the primary context)
- [ ] Investigation strategy reasonably selected (or skipped if NON_ACTIONABLE)
- [ ] Report includes root cause analysis + verdict
- [ ] Contains specific fix recommendations
- [ ] `--triage` mode: outputs classification + verdict only

## References

- `references/classification.md` — Detailed problem classification guide (includes Review Thread dimensions)
- `references/report-template.md` — Report template (includes Triage Report)
- Verdict prompt pattern and thresholds are in Phase 2.5 above.
