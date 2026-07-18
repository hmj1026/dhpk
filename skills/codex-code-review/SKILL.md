---
name: codex-code-review
description: 'Code review using Codex MCP. Use when: PR review, code audit, second opinion on changes. Not for: doc review (use doc-review), security audit (use security-review). Output: severity-grouped findings + merge gate.'
allowed-tools: 'mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Bash(yarn:*), Bash(npm:*), Bash(bash:*), Read, Grep, Glob, Task'
---

# Codex Code Review

<!-- Security note: Bash(bash:*) is broader than ideal; cannot scope to specific
     script paths until Claude Code #9354 resolves ${CLAUDE_PLUGIN_ROOT} in
     command frontmatter. Only invoke bash for project scripts (scripts/*). -->

## Trigger

- Keywords: review, PR, code review, second opinion, audit, check

## When NOT to Use

- Document review (use `doc-review`)
- Security-specific review (use `security-review`)
- Test coverage review (use `test-review`)
- Just want to understand code (use `code-explore`)

## Variants

| Variant | Command | Scope | Pre-checks |
|---------|---------|-------|------------|
| Fast    | `/codex-review-fast` | Diff only | None |
| Full    | `/codex-review` | Diff + local checks | lint:fix + build |
| Branch  | `/codex-review-branch` | Full branch | None |

## Shared Workflow

```
Step 0 (PENDING) → Collect changes → [Pre-checks if Full] → Dual Review (Codex + Task) → Await Results → Aggregate → Emit Gate → Loop if Blocked
```

### Step 0: Dual Review Init (Fail-closed)

Execute: `bash scripts/emit-review-gate.sh PENDING`

This sets `review_mode=dual` and `aggregate_gate.executed=false` in state file, ensuring fail-closed semantics — if the process crashes before Step 4.5, stop-guard blocks.

### Step 1: Collect Change Metadata

Collect **metadata only** — Codex reads the actual diffs and file contents itself via sandbox access.

| Variant | Collection Method |
|---------|-------------------|
| Fast    | `CHANGED_FILES`: `git diff --name-only HEAD` + `DIFF_STAT`: `git diff --stat HEAD` |
| Full    | Same as Fast |
| Branch  | Same + `CURRENT_BRANCH` + `BASE_BRANCH` + `COMMIT_COUNT` |

Codex independently reads full diffs and file contents via `git diff HEAD -- <file>` + `cat` (per research instructions).

### Step 1.5: Feature Context & AC Detection (Spec-Driven Review)

Execute: `bash scripts/resolve-feature.sh` → parse JSON output.

| Field | Use |
|-------|-----|
| `has_requests` | Gate: only proceed if true |
| `docs_path` | Glob for request docs |
| `confidence` | Require >= medium |

If `has_requests=true` AND `confidence` in (high, medium):
1. Glob `${docs_path}/requests/*.md`, sort descending, take latest
2. Read latest request doc
3. Extract `## Acceptance Criteria` section (parse `- [ ]` / `- [x]` items)
4. Filter out quality-gate ACs matching: `/codex-review-fast`, `/codex-review-doc`, `/codex-review`, `/precommit`, `/precommit-fast`, `/pr-review`
5. Cap: max 20 ACs (truncate with "... and N more" note)
6. Build `SPEC_CHECKLIST` variable, set `REQUEST_DOC_PATH`

Graceful degradation: resolve-feature fails / no requests / no AC section / parse error → `SPEC_CHECKLIST = null` (skip silently).

### Step 1.6: Deferred Finding Context

> **Prerequisite**: Requires R4 (Nit History Persistence) hook-side write path. Until R4 is deployed, `.claude_nit_history.json` will not exist and this step is a no-op (graceful degradation).

Read `.claude_nit_history.json` (if exists):
1. Filter `.deferred[]` entries where `last_seen + ttl_days` > now
2. **Sanitize each entry** before injection (mandatory):
   - `canonical_issue` <= 120 chars (truncate)
   - Strip markdown control chars (`**`, backticks, `#`, `>`, `|`)
   - No raw code snippets; only file:line references
   - No secrets/tokens/passwords/API keys (per `rules/security.md`)
   - Reject entries with shell metacharacters (`;`, `&`, `|`, backtick, `$(`)
3. Format as `<deferred_context>` XML block (max 10 entries)
4. Store in `DEFERRED_CONTEXT` variable

Inject into all prompt variants after research instructions, before Review Dimensions:

```
${DEFERRED_CONTEXT ? DEFERRED_CONTEXT : ''}
```

Format:

```xml
<deferred_context>
Previously deferred (do not re-report without new evidence):
- [Nit] src/service.ts | naming convention (deferred 2x)
- [P2] src/utils.ts | error handling pattern (deferred 1x)
</deferred_context>
```

Graceful degradation: file missing / invalid JSON / no entries / sanitization failure → `DEFERRED_CONTEXT = null` (skip silently).

### Step 2: Pre-checks (Full variant only)

```bash
{LINT_FIX_COMMAND}
{BUILD_COMMAND}
```

These placeholders are resolved from the host project's `CLAUDE.md` or `package.json` scripts. Record results as `LOCAL_CHECKS`.

### Step 3: Dual Review (Parallel Dispatch)

**Case A: First review (no `--continue`)**

Launch **two reviewers in parallel** (single message, multiple tool calls):

1. **Codex MCP (primary)**: Use `mcp__codex__codex` with variant-specific prompt:

   | Variant | Prompt Template |
   |---------|-----------------|
   | Fast    | `references/codex-prompt-fast.md` |
   | Full    | `references/codex-prompt-full.md` |
   | Branch  | `references/codex-prompt-branch.md` |

   Config: `sandbox: 'read-only'`, `approval-policy: 'never'`

   **Save the returned `threadId`.**

2. **Secondary reviewer**: Use `Task` tool with reviewer selection cascade:

   | Priority | Reviewer | subagent_type | Condition |
   |----------|----------|---------------|-----------|
   | 1 | `pr-review-toolkit:code-reviewer` | `pr-review-toolkit:code-reviewer` | Default choice |
   | 2 | `strict-reviewer` | `strict-reviewer` | Priority 1 fails/times out |
   | 3 | Codex-only (degraded) | — | Both unavailable |

   **Selection**: Try priority 1 first. If Task fails or times out (30s), try priority 2. If both unavailable, fall back to Codex-only (degraded mode — proceed with Codex results only, apply degradation matrix from `references/review-common.md`).

   **Task prompt** (provide changed file list + diff stats, request P0/P1/P2/Nit findings in standard output format):

   ```
   Review the code changes for correctness, security, performance, and maintainability issues.

   ## Changed Files
   <git diff --name-only output>

   ## Diff Stats
   <git diff --stat output>

   Read the actual diffs and file contents yourself to perform the review.

   Before reporting findings, independently verify each one:
   1. Evidence check: what specific code proves it's real? (file:line)
   2. Context check: did you read enough surrounding code?
   3. False positive check: could it be intentional design?
   4. Severity check: could it be more severe than initially assessed?
   5. Gap check: what related issues might you have overlooked?
   Only report findings that survive all 5 checks.

   Output findings in this format:
   - [P0/P1/P2/Nit] file:line issue description → fix recommendation

   Group by severity. Include a final gate: ✅ Ready (no P0/P1) or ⛔ Blocked (has P0/P1).
   ```

**Case B: Loop review (has `--continue`)**

- **Codex**: Use `mcp__codex__codex-reply` with re-review template from `references/review-common.md`
- **Secondary**: Re-dispatch in parallel (same mechanism as first pass, fresh context). Always dispatched in v1 — no skip exception. Cycle resets on any code edit.

### Step 3.5: Await Codex + Reconcile Secondary

Codex is the **blocking** reviewer — await its result for the initial gate. Secondary runs in background (`run_in_background: true`) and is **non-blocking**:

| Secondary Status | Action |
|-----------------|--------|
| Completed before Codex | Include in aggregation (Step 4) |
| Completed after Codex, before precommit | Reconcile at pre-precommit checkpoint |
| Still running at precommit | Proceed with Codex gate (authoritative); if late result has P0/P1, re-open fix→re-review loop |
| Failed/timed out | Apply degradation matrix per `references/review-common.md § Dual Reviewer Aggregation` |

### Step 4: Consolidate Output (Dual Mode)

Apply `references/review-common.md` §Dual Reviewer Aggregation for severity mapping, normalization, deduplication, source attribution, sorting, degradation, and the gate decision.

### Step 4.5: Emit Review Gate

Execute: `bash scripts/emit-review-gate.sh READY` or `bash scripts/emit-review-gate.sh BLOCKED`

This updates `aggregate_gate.executed=true` and `aggregate_gate.gate` in the state file.

Then output the standard gate sentinel:
- `✅ Ready` — if READY (no P0/P1)
- `⛔ Blocked` — if BLOCKED (has P0/P1)

## Shared Definitions

See `references/review-common.md` for severity, dimensions, gates, re-review, sentinels, and dual-review aggregation.

## Review Loop

Auto-loop semantics: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Anti-loop & output.

Blocked → fix P0/P1 → `/codex-review-fast --continue <threadId>` → repeat until Ready.
Ready + P2/Nit → batch fix → 1 Codex `--continue` verify → evaluate (see `rules/auto-loop.md` P2/Nit Quality Sweep).

3 rounds on same issue → report blocker, request intervention.

### Dual Mode Loop Behavior

Use `references/review-common.md` §Review Loop and §Dual Reviewer Aggregation. Codex remains stateful; secondary is freshly dispatched after every code edit.

### Pre-precommit Checkpoint

Before `/precommit`, reconcile pending secondary results using `references/review-common.md` §Dual Reviewer Aggregation. A late P0/P1 reopens the fix/re-review loop.

## Verification

- [ ] Each issue tagged with severity (P0/P1/P2/Nit)
- [ ] Gate is clear (✅ Ready / ⛔ Blocked)
- [ ] Issues include: file:line, description, fix suggestion
- [ ] Codex performed independent project research
- [ ] Branch variant: dimension rating table included

## References

- Shared definitions: `references/review-common.md`
- Fast prompt: `references/codex-prompt-fast.md`
- Full prompt: `references/codex-prompt-full.md`
- Branch prompt: `references/codex-prompt-branch.md`
- Research instructions: `references/codex-research-instructions.md`

## Examples

```
Input: /codex-review-fast
Action: emit PENDING → git diff → Codex + Task(code-reviewer) parallel → aggregate → emit gate → P0/P1/P2/Nit + Gate

Input: /codex-review-branch origin/develop
Action: emit PENDING → branch diff + history → Codex + Task parallel → aggregate → emit gate → Rating table + Findings + Gate
Input: /codex-review-fast (Codex unavailable)
Action: emit PENDING → git diff → Task(code-reviewer) only → degraded aggregate → emit gate + ⚠️ warning
```
