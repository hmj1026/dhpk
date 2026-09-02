---
name: dhpk-issue-analyze
description: "GitHub Issue and PR review thread deep analysis with Codex blind verdict. Purpose: analyze issue root causes, classify problems, plan investigations, or triage PR review comments for actionability. Not for: fixing bugs (use dhpk-adaptive-dev-workflow in bug mode), code exploration (use dhpk-codebase-exploration). Output: classified analysis + verdict assessment + investigation strategy."
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

- Known root cause, fix directly (use `/dhpk:dhpk-adaptive-dev-workflow` and select the Bug branch)
- Pure feature development (use `/dhpk:dhpk-adaptive-dev-workflow` and select the Feature branch)
- Only need code review (use `/codex-review`)

## Workflow

1. **Read** the issue with `gh issue view --json ...`, or use the supplied review-thread fields. Extract symptoms, reproduction, errors, and file clues.
2. **Classify** with [classification.md](references/classification.md): unfamiliar → `/dhpk:dhpk-codebase-exploration`; regression → `/dhpk:dhpk-git-history-investigation`; complex root → `/dhpk:dhpk-codebase-exploration --dual`; multiple causes → `/dhpk:dhpk-codex-architect --mode adversarial`.
3. **Blind verdict** in a fresh read-only Codex thread without Claude's classification. Triage mode stops after this phase.
4. **Investigate** unless policy maps the verdict to `DISMISS_VERIFIED`.
5. **Report** the combined evidence, verdict, root-cause hypothesis, and recommendation.

## Investigation Tool Comparison

| Tool                | Purpose                | Speed   | Depth      |
| ------------------- | ---------------------- | ------- | ---------- |
| `/dhpk:dhpk-codebase-exploration`     | Quick code exploration | Fast    | Single     |
| `/dhpk:dhpk-git-history-investigation`  | Track change history   | Medium  | Single     |
| `/dhpk:dhpk-codebase-exploration --dual` | Dual confirmation      | Slow    | Dual-view  |
| `/dhpk:dhpk-codex-architect --mode adversarial` | Exhaust possibilities  | Slowest | Adversarial|

## Phase 2.5: Verdict Assessment

After classification, run Codex blind verification to independently assess actionability.

**Codex call requirements**:

| Requirement | Detail |
|-------------|--------|
| Thread | **Fresh** `mcp__codex__codex` (never reuse existing thread) |
| Sandbox | `read-only` |
| Approval policy | `never` |
| Anti-anchoring | Never send Claude's Phase 2 classification to Codex |

**Prompt construction** (blind verdict — never reveal Claude's Phase 2 classification to Codex):

- **GitHub Issue input**: provide issue title, body, labels as finding context
- **Review Thread input**: provide file path, line, reviewer comment as finding context
- Always include Standard Research Block (git status, git diff, grep, cat)

**Codex output** (all fields required):

```
- codex_verdict: ACTIONABLE | NON_ACTIONABLE | UNCERTAIN
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

**Graceful degradation**: if Codex call fails, log warning and proceed to Phase 3 without verdict.

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
- [ ] Verdict assessment executed (Codex blind verification)
- [ ] Codex prompt contains no Claude conclusions (anti-anchoring)
- [ ] Fresh Codex thread used (not reusing existing thread)
- [ ] Investigation strategy reasonably selected (or skipped if NON_ACTIONABLE)
- [ ] Report includes root cause analysis + verdict
- [ ] Contains specific fix recommendations
- [ ] `--triage` mode: outputs classification + verdict only

## References

- `references/classification.md` — Detailed problem classification guide (includes Review Thread dimensions)
- `references/report-template.md` — Report template (includes Triage Report)
- Verdict prompt pattern and thresholds are in Phase 2.5 above.

## Examples

### Regression Issue

```
Input: /dhpk:dhpk-issue-analyze 123
Phase 1: gh issue view 123 -> "API returns 500 after update"
Phase 2: Classification = Regression
Phase 3: /dhpk:dhpk-git-history-investigation -> find introducing commit
Phase 4: Report + fix recommendation
```

### Intermittent Error

```
Input: /dhpk:dhpk-issue-analyze 456
Phase 1: gh issue view 456 -> "Random timeout occurrences"
Phase 2: Classification = Complex root cause (intermittent)
Phase 3: /dhpk:dhpk-codebase-exploration --dual -> Claude + Codex dual-view
Phase 4: Consolidated report -> ranked possible causes
```

### Unknown Feature

```
Input: /dhpk:dhpk-issue-analyze 789
Phase 1: gh issue view 789 -> "Why does it behave this way?"
Phase 2: Classification = Unfamiliar feature
Phase 2.5: Verdict = ACTIONABLE (confidence 0.75) -> proceed
Phase 3: /dhpk:dhpk-codebase-exploration -> trace execution path
Phase 4: Report + flow diagram + verdict
```

### Review Thread Triage

```
Input: /dhpk:dhpk-issue-analyze --triage "src/service.ts:42 — Use early return instead of nested if"
Phase 2: Classification = nit
Phase 2.5: Verdict = NON_ACTIONABLE (confidence 0.85)
  Codex found: current nested pattern follows project convention in 12 other files
Output: Triage report — skip suggested
```
