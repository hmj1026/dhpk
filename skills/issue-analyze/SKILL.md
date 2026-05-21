---
name: issue-analyze
description: 'GitHub Issue and PR review thread deep analysis with Codex blind verdict. Use when: analyzing issue root cause, classifying problems, investigation planning, triaging PR review comments for actionability. Not for: fixing bugs (use bug-fix), code exploration (use code-explore). Output: classified analysis + verdict assessment + investigation strategy.'
allowed-tools: 'Read, Grep, Glob, Bash(git:*), Bash(gh:*), mcp__codex__codex'
---

# Issue Analyze Skill

## Trigger

- Keywords: analyze issue, investigate problem, problem analysis, root cause, root cause analysis, triage review, review thread analysis

## Input Types

| Type | Source | Example |
|------|--------|---------|
| GitHub Issue | Issue number, URL, or description | `/issue-analyze 123` |
| Review Thread | file:line + reviewer comment | `/issue-analyze --triage "src/foo.ts:42 — Use early return"` |

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

- Known root cause, fix directly (use `/bug-fix`)
- Pure feature development (use `/feature-dev`)
- Only need code review (use `/codex-review`)

## Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Read Issue / Review Thread                             │
├─────────────────────────────────────────────────────────────────┤
│ GitHub Issue: gh issue view <number> --json ...                  │
│ Review Thread: use provided { path, line, reviewer, comment }   │
│ Extract: symptoms, reproduction steps, error messages, files    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Problem Classification                                 │
├─────────────────────────────────────────────────────────────────┤
│ GitHub Issue: Determine problem type → investigation strategy   │
│ Review Thread: Determine category → actionability               │
│                                                                 │
│ ┌────────────────┬──────────────────────────────────┐           │
│ │ Type           │ Investigation Strategy            │           │
│ ├────────────────┼──────────────────────────────────┤           │
│ │ Unfamiliar     │ /code-explore                    │           │
│ │ Regression     │ /git-investigate                 │           │
│ │ Complex root   │ /code-investigate (dual view)    │           │
│ │ Multiple cause │ /codex-brainstorm (exhaustive)   │           │
│ │ Composite      │ Combine multiple strategies      │           │
│ └────────────────┴──────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2.5: Verdict Assessment (NEW)                             │
├─────────────────────────────────────────────────────────────────┤
│ Codex blind verification: ACTIONABLE / NON_ACTIONABLE / UNCERTAIN│
│ Fresh mcp__codex__codex thread, read-only, anti-anchoring       │
│ Pattern: @skills/seek-verdict/references/verdict-prompt.md      │
│ Thresholds: @skills/seek-verdict/references/policy-mapping.md   │
│                                                                 │
│ ⚠️ Never send Claude's classification to Codex                  │
│ --triage mode: stop here, output verdict + classification       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: Execute Investigation                                  │
├─────────────────────────────────────────────────────────────────┤
│ Skip if verdict = DISMISS_VERIFIED (per policy-mapping thresholds)    │
│ Otherwise: invoke corresponding investigation command           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 4: Consolidated Report                                    │
├─────────────────────────────────────────────────────────────────┤
│ Synthesize investigation results + verdict, produce report      │
└─────────────────────────────────────────────────────────────────┘
```

## Problem Classification Decision Tree

```
Issue Symptoms
    │
    ├─ "It used to work, now it doesn't" ───→ /git-investigate
    │                                          (find introduction point)
    │
    ├─ "Don't know how this feature works" ─→ /code-explore
    │                                          (quick understanding)
    │
    ├─ "Has error message / stack trace"
    │       │
    │       ├─ Clear error ────────────────→ /code-explore
    │       │                                (trace path)
    │       │
    │       └─ Vague / intermittent ───────→ /code-investigate
    │                                        (dual-view confirmation)
    │
    ├─ "Many possible causes" ────────────→ /codex-brainstorm
    │                                        (exhaustive analysis)
    │
    └─ Composite / uncertain ─────────────→ Start with /code-explore
                                             then choose based on results
```

## Investigation Tool Comparison

| Tool                | Purpose                | Speed   | Depth      |
| ------------------- | ---------------------- | ------- | ---------- |
| `/code-explore`     | Quick code exploration | Fast    | Single     |
| `/git-investigate`  | Track change history   | Medium  | Single     |
| `/code-investigate` | Dual confirmation      | Slow    | Dual-view  |
| `/codex-brainstorm` | Exhaust possibilities  | Slowest | Adversarial|

## Phase 2.5: Verdict Assessment

After classification, run Codex blind verification to independently assess actionability.

**Codex call requirements** (same as `/seek-verdict` pattern):

| Requirement | Detail |
|-------------|--------|
| Thread | **Fresh** `mcp__codex__codex` (never reuse existing thread) |
| Sandbox | `read-only` |
| Approval policy | `never` |
| Anti-anchoring | Never send Claude's Phase 2 classification to Codex |

**Prompt construction**: follow `@skills/seek-verdict/references/verdict-prompt.md` pattern, adapting input:

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

**Policy mapping**: follow `@skills/seek-verdict/references/policy-mapping.md` thresholds (normal state; heightened thresholds apply after `[DISMISS_PATTERN_WARN]` — see policy-mapping.md Anti-Abuse Guard):

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
- `@skills/seek-verdict/references/verdict-prompt.md` — Codex blind verification prompt pattern (source of truth)
- `@skills/seek-verdict/references/policy-mapping.md` — Verdict thresholds + audit format (source of truth)

## Examples

### Regression Issue

```
Input: /issue-analyze 123
Phase 1: gh issue view 123 -> "API returns 500 after update"
Phase 2: Classification = Regression
Phase 3: /git-investigate -> find introducing commit
Phase 4: Report + fix recommendation
```

### Intermittent Error

```
Input: /issue-analyze 456
Phase 1: gh issue view 456 -> "Random timeout occurrences"
Phase 2: Classification = Complex root cause (intermittent)
Phase 3: /code-investigate -> Claude + Codex dual-view
Phase 4: Consolidated report -> ranked possible causes
```

### Unknown Feature

```
Input: /issue-analyze 789
Phase 1: gh issue view 789 -> "Why does it behave this way?"
Phase 2: Classification = Unfamiliar feature
Phase 2.5: Verdict = ACTIONABLE (confidence 0.75) -> proceed
Phase 3: /code-explore -> trace execution path
Phase 4: Report + flow diagram + verdict
```

### Review Thread Triage

```
Input: /issue-analyze --triage "src/service.ts:42 — Use early return instead of nested if"
Phase 2: Classification = nit
Phase 2.5: Verdict = NON_ACTIONABLE (confidence 0.85)
  Codex found: current nested pattern follows project convention in 12 other files
Output: Triage report — skip suggested
```
