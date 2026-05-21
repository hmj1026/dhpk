# Review Common Definitions

## Severity Levels

- **P0**: System crash, data loss, security vulnerability
- **P1**: Functional anomaly, severe performance degradation
- **P2**: Code quality, maintainability concerns
- **Nit**: Style suggestions, minor improvements

## Review Dimensions

| Dimension       | Checklist |
|-----------------|-----------|
| Correctness     | Logic errors, boundary conditions, null handling, off-by-one, type safety, error handling |
| Security        | Injection attacks (SQL/NoSQL/Command), auth bypass, sensitive data leaks, OWASP Top 10 |
| Performance     | N+1 queries, memory leaks, unnecessary loops/computations, blocking operations |
| Maintainability | Naming clarity, function length, single responsibility, duplicate code, testability |

## Merge Gate

- **Ready**: No P0/P1; P2/Nit sweep policy applies before precommit
- **Blocked**: Has P0/P1, needs fix

## Codex Independent Research (Required)

Codex **must** perform its own research, not rely only on provided diff/context:

### Git Exploration (Priority)

1. Check change status: `git status`
2. Check changed files: `git diff --name-only HEAD`
3. Check full changes for specific file: `git diff HEAD -- <file-path>`
4. Check full content of changed files: `cat <changed file> | head -200`

### Project Research

- Search called functions: `grep -r "functionName" . -l --include="*.ts" --include="*.js" --include="*.md" | head -10`
- Read related files: `cat <file-path> | head -100`
- Understand class definitions: `grep -rA 20 "class ClassName" . --include="*.ts" --include="*.js"`

## Review Loop

**⚠️ Follow @CLAUDE.md review loop rules ⚠️**

When review result is Blocked:

1. Remember the `threadId`
2. Fix P0/P1 issues
3. Re-review using `--continue <threadId>`
4. Repeat until Ready

## P2/Nit Post-Ready Sweep

When review returns Ready with P2/Nit findings, auto-loop triggers a quality sweep:

1. **Batch-fix** all P2/Nit items (1 attempt)
2. **Re-review** using `--continue <threadId>` with P2/Nit verification
3. **Evaluate**: unresolved P2 → ⚠️ Need Human; unresolved Nit → exempt with `[NIT_DEFERRED]` log; all resolved → `/precommit`

### P2/Nit Judgment

| Step | Description |
|------|-------------|
| Parse | Extract P2/Nit findings from Codex output (tag-based `[P2]`/`[Nit]` or section-based `#### P2`/`#### Nit`) |
| Identity | Key = `file + canonicalized issue text` (line number approximate, may shift after fix) |
| Dedupe | Same key across reviews counts as 1 item |
| False-positive | Same key persists after fix → mark `possible-false-positive` |

### Re-review Prompt Template

Used with `mcp__codex__codex-reply`:

```typescript
mcp__codex__codex-reply({
  threadId: '<from --continue parameter>',
  prompt: `I have fixed the previously identified issues. Please re-review:

## ${LOCAL_CHECKS ? 'Local Check Results\n' + LOCAL_CHECKS + '\n\n##' : ''} New Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

Please verify:
1. Have previous P0/P1 issues been correctly fixed?
2. Did fixes introduce new issues?
3. Update Merge Gate status
4. For P2/Nit items from previous review: are they resolved? List any remaining P2/Nit with status.`,
});
```

## Dismiss Verdict Format

When a finding is verified via `/seek-verdict`, output:

**Dismiss intent**:

```
[DISMISS_VERDICT] key=<file|canonical_issue> | severity=<P0-Nit> | verdict=<DISMISS_VERIFIED|DISMISS_CANDIDATE|FIX_REQUIRED|NEED_HUMAN> | confidence=<0..1> | codex_thread=<id> | evidence=<brief> | timestamp=<ISO8601> | intent=dismiss | authorization=<automated|human-required|human-confirmed>
```

**Confirm/Clarify intent**:

```
[SEEK_VERDICT] key=<file|canonical_issue> | severity=<P0-Nit> | intent=<confirm|clarify> | verdict=<CONFIRMED|DISPUTED|HIGH_IMPACT|LOW_IMPACT|UNCERTAIN> | confidence=<0..1> | codex_thread=<id> | evidence=<brief> | timestamp=<ISO8601>
```

| Field | Redaction |
|-------|-----------|
| `key` | File path + issue summary (<= 120 chars); no code snippets |
| `evidence` | File:line references only; no source code |
| All fields | No secrets/tokens/passwords/API keys |

## Output Findings Format

```
- [P0/P1/P2/Nit] <file:line> <issue description> -> <fix recommendation> [source: codex|toolkit|both]
```

> Note: `[source: ...]` tag is required in dual review mode. In single-reviewer mode it may be omitted.

## AC Coverage Format (Spec-Driven Review)

When `SPEC_CHECKLIST` is injected (feature has request doc with ACs), review output includes:

| AC | Status | Evidence |
|----|--------|----------|
| AC text | Status | file:line reference |

**Status values**: ✅ Implemented, ⚠️ Partial, ❌ Missing, N/A (not applicable to this change)

**Omitted when**: No feature detected, no request doc, or no AC section.

## Gate Sentinels

Hook gate is emitted via `bash scripts/emit-review-gate.sh READY|BLOCKED` (outputs `REVIEW_GATE=<value>`, consumed by `post-tool-review-state.sh`).

Text sentinels below are for **behavior-layer** (auto-loop) and **stop-guard** visual confirmation:

- `✅ Ready` — Passed (code review)
- `⛔ Blocked` — Failed (code review)

> Note: Always emit both: (1) `emit-review-gate.sh` for hook state, (2) text sentinel for behavior layer.

## Dual Reviewer Aggregation

When `review_mode=dual`, two reviewers run in parallel. This section defines how to merge their results.

### Severity Mapping (toolkit → standard)

`pr-review-toolkit:code-reviewer` uses confidence scoring. Map to P0-Nit:

| toolkit Output | Default Mapping | Upgrade Condition |
|----------------|-----------------|-------------------|
| Critical (confidence 90-100) | P1 | Contains P0 keywords → P0 |
| Important (confidence 80-89) | P2 | — |
| < 80 confidence | Not reported | toolkit filters internally |

**P0 keywords**: crash, data loss, security vulnerability, injection, auth bypass, RCE, SSRF, XSS

`strict-reviewer` already uses P0/P1/P2/Nit format — no mapping needed.

### Deduplication Algorithm

| Step | Rule |
|------|------|
| Key | `canonical_file_path + canonical_issue_text` |
| Line tolerance | ±5 lines (ignore line number differences within range) |
| Conflict resolution | Same key → keep highest severity (P0 > P1 > P2 > Nit) |
| Source merge | Same key from both reviewers → `source = "both"` |

### Degradation Matrix

| Scenario | Behavior | Gate Source | Output |
|----------|----------|------------|--------|
| Codex ✅ + Secondary ✅ | Union aggregation | `codex+toolkit` | Full dual findings |
| Codex ✅ + Secondary ❌ | Codex-only + degradation warning | `codex-only` | `⚠️ Secondary reviewer unavailable` |
| Codex ❌ + Secondary ✅ | Secondary-only + degradation warning | `toolkit-only` | `⚠️ Codex MCP unavailable` |
| Both ❌ | `⛔ Blocked` + `⚠️ Need Human` | `none` | Both reviewers failed |

### Source Attribution

Every finding includes a source tag:

| Source | Meaning |
|--------|---------|
| `codex` | Found by Codex MCP only |
| `toolkit` | Found by secondary reviewer only |
| `both` | Found by both reviewers (deduplicated) |

Output format: `- [P0] file:line issue → fix [source: both]`

### Review Loop (Dual Mode)

| Reviewer | Loop Behavior |
|----------|---------------|
| Codex MCP | Stateful → `mcp__codex__codex-reply(threadId)` continues context |
| Secondary | Re-dispatched every iteration (fresh context). Always dispatched in v1 (no skip exception). |

Codex gate is authoritative for timing. Secondary runs non-blocking in background. Aggregation reconciled at pre-precommit checkpoint. Any code edit resets the review cycle — both reviewers must re-run.
