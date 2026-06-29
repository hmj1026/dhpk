---
name: opsx-load-context
description: 'Load opsx-apply-resume Resume Phase context via a 4-tier fallback (claude-mem pinned obs → compact JSON path → heuristic latest compact → handoff summary), optionally fetching cross-session observations. Use when: opsx-apply-resume enters Resume Phase Steps 1b–1d. Not for: saving observations (use opsx-post-obs) or goal generation (use opsx-goal). Output: CONTEXT_SOURCE + session_goal/completed/in_progress/cross_session_observations fields.'
allowed-tools: Bash
---

# opsx-load-context

Context loading skill for `opsx-apply-resume` Resume Phase.
Implements a 4-tier fallback so that context is always available even if earlier tiers fail.

## When NOT to Use

- Saving / posting a session observation → use `opsx-post-obs`
- Generating a `/goal` condition for a fresh session → use `opsx-goal`
- Any phase other than `opsx-apply-resume` Resume Phase (Steps 1b–1d)

## Inputs

| Variable | Source | Description |
|----------|--------|-------------|
| `claude_mem_obs_id` | Handoff frontmatter | Integer obs ID, or null / absent |
| `compact_json_path` | Handoff frontmatter | Relative path like `compact-notes/compact-*.json`, or absent |
| `next_action_hint` | First Next Action from handoff | Key terms for cross-session search; may be empty |

## Fallback Chain

Work through tiers in order. Stop at the first successful tier and record `CONTEXT_SOURCE`.

---

### Pre-chain — Unattended stop resume note (highest priority)

**Condition**: An active change carries a `.resume-note.md` (written by
`opsx-goal`'s Part 4 when an unattended session hit its turn or wall-clock
limit). Check this before the tiers below — it is the freshest, most specific
carry-forward for a resumed run.

```bash
RESUME=$(ls -t openspec/changes/*/.resume-note.md 2>/dev/null | head -1)
```

- File found → read it; extract the remaining unchecked tasks, the last pending
  sentinels, and the one-line next-focus hint. Map them to `in_progress` and
  `session_goal`. Set `CONTEXT_SOURCE = ".resume-note.md"`. Skip Tiers 0–3 (still
  run the optional cross-session step below).
- No file (the common case) → fall through to Tier 0. Behavior unchanged.

Best-effort only: a malformed or unreadable note → silently fall through.

---

### Tier 0 — Claude-mem pinned observation

**Condition**: `claude_mem_obs_id` is present and not null.

```
get_observations(ids=[<claude_mem_obs_id>])
```

- Returns observation → extract `session_goal`, `completed`, `in_progress` from the observation body.
  Set `CONTEXT_SOURCE = "claude-mem obs #<id>"`. Skip Tier 1 and Tier 2.
- Returns empty or error → fall through to Tier 1.

---

### Tier 1 — Compact JSON (explicit path)

**Condition**: `compact_json_path` is present in handoff frontmatter.

```bash
bash .claude/scripts/opsx-apply-resume/extract-compact.sh "<compact_json_path>"
```

- File exists and outputs fields → parse L0, session_goal, completed, in_progress.
  Set `CONTEXT_SOURCE = "compact JSON"`. Skip Tier 2.
- File not found or script errors → fall through to Tier 2.

---

### Tier 2 — Heuristic latest compact

**Condition**: Tier 1 failed or compact_json_path absent.

```bash
LATEST=$(ls -t compact-notes/compact-*.json 2>/dev/null | head -1)
```

- File found → run `bash .claude/scripts/opsx-apply-resume/extract-compact.sh "$LATEST"` → parse fields.
  Set `CONTEXT_SOURCE = "compact JSON (heuristic)"`. Skip Tier 3.
- No file found → fall through to Tier 3.

---

### Tier 3 — Handoff embedded summary (always succeeds)

Use the `## Compact Summary`, `### Completed`, and `### In Progress` sections embedded in
`.claude/artifacts/apply-resume/latest.md` (already read in Resume Phase Step 1).

Set `CONTEXT_SOURCE = "handoff only"`.

---

## Post-chain: Cross-session context (optional)

**Condition**: fallback chain has completed (any tier set `CONTEXT_SOURCE`) AND `next_action_hint` is non-empty.

```
search(
  query="<next_action_hint — key terms only, 3–6 words>",
  project="<your-project>",
  obs_type="decision,discovery",  # decision/discovery 類型最能反映跨 session 決策脈絡
  limit=5                          # 上限 5 筆避免 context 膨脹
)
```

- Relevant results → `get_observations(ids=[<up to 3 IDs>])` → store as `cross_session_observations`.
- No relevant results or search fails → set `cross_session_observations = []`. Silently skip.

Cross-session context is always optional — never retry or block on it.

---

## Output

| Variable | Type | Description |
|----------|------|-------------|
| `CONTEXT_SOURCE` | string | One of: ".resume-note.md", "claude-mem obs #N", "compact JSON", "compact JSON (heuristic)", "handoff only" |
| `session_goal` | string | Goal from context, or "(未取得)" |
| `completed` | list | Completed items, or empty list |
| `in_progress` | list | In-progress items, or empty list |
| `cross_session_observations` | list | Up to 3 fetched observations, or empty list |

All variables always set — no undefined outputs. The caller (Resume Phase Step 3) uses these fields directly in the restore summary display.

## Verification

- [ ] `CONTEXT_SOURCE` set to exactly one tier label
- [ ] Pre-chain `.resume-note.md` checked first; absent → falls through silently to Tier 0
- [ ] Stopped at the first successful tier (no redundant lower-tier calls)
- [ ] All return fields set — no undefined outputs (Tier 3 always succeeds from handoff)
- [ ] Cross-session search failure handled silently (`cross_session_observations = []`)

## Guardrails

- Never throw on partial failure — always complete the chain and return `CONTEXT_SOURCE`
- "compact JSON (heuristic)" is acceptable quality; note in Step 3 display that it is a heuristic path
- Cross-session search failure is silent — the resume can proceed without it
- If all tiers fail (impossible in practice since Tier 3 always succeeds from handoff), set `CONTEXT_SOURCE = "handoff only"` and use empty strings for context fields
