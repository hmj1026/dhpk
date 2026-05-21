---
name: "OPSX: Apply Resume"
description: 'Context handoff wrapper for long-running opsx:apply sessions — save state before /fork or /new, then resume seamlessly'
category: Workflow
tags: [workflow, context, resume, experimental]
argument-hint: '[change-id]'
---

Cross-session handoff for interrupted `/opsx:apply` sessions. Run when context is ~70% full to save state, then run again after `/fork` or `/new` to resume.

**Input**: Optionally specify a change name (e.g., `/opsx-apply-resume add-auth`). Used to skip interactive change selection.

---

## Phase Detection

Run the detection script — it outputs a single token:

```bash
bash .claude/scripts/opsx-apply-resume/detect-phase.sh
```

| Output | Action |
|--------|--------|
| `save` | → **Save Phase** |
| `resume` | → **Resume Phase** |
| `warn-recent` | → warn: 剛建立的存檔（< 60 秒）。是否要覆寫？(y/n)。y → Save Phase；n → 停止並提示先執行 /fork 或 /new |
| `consuming` | → 上次 Resume 啟動了 opsx:apply 但未完成。是否重新嘗試？(y/n)。y → 跳至 Resume Phase Step 5；n → 停止 |

---

## Save Phase

**Goal**: Commit progress, snapshot context, write handoff, recommend next action.

### Step 1 — Commit current progress

Invoke the `smart-commit` skill to commit any completed work.

- If there are unstaged changes, list them and ask whether to include
- If the user skips commit: record `commit: SKIPPED` in handoff and continue
- This ensures `tasks.md` checkbox state in git is the ground truth

### Step 2 — Quick quality check

Invoke the `precommit-fast` skill (lint:fix + test:unit).

- PASS → continue
- FAIL → warn with failure details, ask: "仍要存檔繼續？(y/n)"
  - yes → record `precommit: FAILED` in handoff and continue
  - no → stop, let user fix first

### Step 3 — Generate compact summary

Invoke the `compact-save` skill. It writes a JSON file to `./compact-notes/`.

After invoking, verify the output exists:

```bash
ls -t compact-notes/compact-*.json 2>/dev/null | head -1
```

- No file found → report error:
  > compact-save 執行失敗或找不到輸出檔案。
  > 是否要帶空白摘要繼續？空白摘要會降低 Resume Phase 的 context 品質。(y/n)
- Found → record as `COMPACT_JSON_PATH` (e.g. `compact-notes/compact-2026-04-27-12-00.json`)

Extract fields using the script:

```bash
bash .claude/scripts/opsx-apply-resume/extract-compact.sh "$COMPACT_JSON_PATH"
```

Read the output to obtain: `L0`, `session_goal`, `completed`, `in_progress`, `key_decisions`, `failed_approaches`.

### Step 3b — Store observation in claude-mem (fire-and-forget)

Invoke the `opsx-post-obs` skill with:
- `title`: L0 value
- `content`: session_goal + in_progress[].task + key_decisions[].decision + reason + failed_approaches[].lesson
- `concepts`: `[<change_id>, <stage>, <wave>, "opsx-apply-resume"]`

The skill returns `OBS_PID` and `OBS_RESULT_FILE`. Before writing the handoff in Step 7, collect the result:

```bash
wait $OBS_PID
CLAUDE_MEM_OBS_ID=$(cat "$OBS_RESULT_FILE" 2>/dev/null || echo null)
```

- `CLAUDE_MEM_OBS_ID` = integer string or `null`

### Step 4 — Identify change and remaining tasks

Determine the active change-id using this priority order:
1. Command argument (e.g., `/opsx-apply-resume my-change`)
2. Most recent `/opsx:apply <name>` invocation visible in conversation
3. Run `openspec list --json` and use **AskUserQuestion** to let the user select

Announce: "Using change: `<name>`" once determined.

**Slim read** — grep only unchecked and in-progress lines from `tasks.md`:

```bash
grep -E "^- \[[ ~]\]" openspec/changes/<change-id>/tasks.md
```

If file not found, stop and report:
> openspec/changes/<change-id>/tasks.md 不存在，請確認 change-id 是否正確。

From the grep output:
- Count both `- [ ]` and `- [~]` lines → `remaining_count`
- Scan for complexity keywords: 架構、設計、重構、遷移、migration, refactor, schema, architecture
- Classify lines:
  - **Next Actions**: numbered stage steps with explicit commands
  - **Completion Criteria**: DoD checks without explicit steps

### Step 5 — Risk snapshot (non-blocking)

Invoke the `risk-assess` skill. Record `risk_level` (low/medium/high/critical). Do not block.

### Step 6 — Model recommendation (non-blocking)

| Condition | Suggestion |
|-----------|-----------|
| Complexity keywords present OR remaining tasks ≥ 5 | `opus` |
| 1–4 general implementation tasks | `sonnet` (current) |
| Only docs/config tasks | `haiku` |

### Step 7 — Write handoff file

Ensure `.claude/artifacts/apply-resume/` directory exists (`mkdir -p` via Bash).

Write `.claude/artifacts/apply-resume/latest.md`:

```
---
change_id: <id>
saved_at: <ISO 8601 timestamp>
state: saved
model_suggestion: <opus|sonnet|haiku>
risk_level: <low|medium|high|critical>
precommit: <PASS|FAIL|SKIPPED>
commit: <DONE|SKIPPED>
remaining_tasks_count: <N>
compact_json_path: <COMPACT_JSON_PATH>
claude_mem_obs_id: <integer | null>
claude_mem_tags: [<change_id>, <stage>, <wave>]
---

## Compact Summary

<session_goal, or "(未取得)" if compact-save failed>

完整 compact 檔：`<COMPACT_JSON_PATH>`

### Completed
<completed list from extract-compact output, or "(未取得)">

### In Progress
<in_progress list from extract-compact output, or "(未取得)">

## Next Actions

<actionable remaining tasks — numbered stage steps with explicit commands>

## Completion Criteria

<DoD pass/fail checks — no explicit commands, boolean outcome>
```

### Step 8 — Recommend context switch

| Remaining tasks | Recommendation | Reason |
|-----------------|---------------|--------|
| ≤ 3 | `/fork` | Preserves conversation branch; low context rebuild cost |
| > 3 | `/new` | Clean restart with compact summary is more reliable |

```
狀態已存檔。
  Change: <change-id>
  剩餘任務: <N> 項  |  Risk: <level>  |  Precommit: <result>
  模型建議: <model>（執行 /model <model> 切換）
  Claude-mem: <obs #<id> 存入成功 | 未寫入（worker 不可用）>

建議執行 `/<fork|new>`，完成後再執行 `/opsx-apply-resume` 繼續。
（/fork 保留對話分支；/new 完全乾淨重啟）
```

If `commit: SKIPPED`, append this warning:

```
警告：你有未提交的變更。若 tasks.md 勾選狀態已修改，
/new 後這些進度將遺失（git HEAD 不含未 commit 的勾選）。
強烈建議：執行 /fork 而非 /new，以保留未 commit 的檔案狀態。
```

---

## Resume Phase

**Goal**: Restore context, hand off to `opsx:apply` which auto-resumes from the first unchecked task.

### Context check (before Step 1)

If the current session has had significant prior tool activity (model judgment: clearly not a fresh /fork or /new session), display:

```
偵測到此 Session 仍有活躍工作內容。
直接 Resume 可能導致 Context 雙倍消耗。
建議先執行 /fork 或 /new，再執行 /opsx-apply-resume。
是否仍要在此 Session 中繼續？(y/n)
```

- y → continue
- n → stop

### Step 1 — Load handoff

Read `.claude/artifacts/apply-resume/latest.md`. Parse:
- `change_id`, `model_suggestion`, `risk_level`, `precommit`, `commit`
- `compact_json_path` (may be absent in older handoffs)
- `claude_mem_obs_id` (may be absent in older handoffs — treat as null)
- Next Actions section (or legacy Remaining Tasks section)
- Completion Criteria section

### Steps 1b–1d — Load context (fallback chain)

Invoke the `opsx-load-context` skill with:
- `claude_mem_obs_id`: from handoff frontmatter (integer or null)
- `compact_json_path`: from handoff frontmatter (path string, or absent for legacy handoffs)
- `next_action_hint`: first Next Action from handoff (key terms for cross-session search)

The skill returns: `CONTEXT_SOURCE`, `session_goal`, `completed`, `in_progress`, `cross_session_observations`.

### Step 2 — Validate change still exists

Confirm `openspec/changes/<change-id>/tasks.md` exists. If not:
> Change `<change-id>` 的 tasks.md 不存在，change 可能已被封存或重新命名。
> 請手動確認後再繼續。

Stop and do not proceed further.

### Step 3 — Display restore summary

```
[自動恢復] 從上次進度繼續
  Change: <change-id>
  Context 來源: <claude-mem obs #<id> | compact JSON | compact JSON (heuristic) | handoff only>
  上次進度摘要:
    目標: <session_goal>
    已完成: <completed list>
    進行中: <in_progress list>

  Next Actions:
    <Next Actions list from handoff>

  模型建議: <suggestion>（可執行 /model <model> 切換）
  上次 Precommit: <result>  |  Commit: <DONE|SKIPPED>
```

If cross-session observations found in Step 1d:
```
## Cross-Session Context
  <fetched observation summaries>
```

If `precommit: FAILED`:
> 注意：上次 precommit 失敗，建議先執行 `/precommit-fast` 修復後再繼續。

If `commit: SKIPPED`:
> 注意：上次有未提交的變更，請確認是否需要先提交。

### Step 4 — Mark handoff in-flight

Update `latest.md` state to `consuming` (non-destructive, recoverable):

```bash
bash .claude/scripts/opsx-apply-resume/set-handoff-state.sh consuming
```

`latest.md` remains on disk. If `opsx:apply` fails, the user can reset manually:
```bash
bash .claude/scripts/opsx-apply-resume/set-handoff-state.sh saved
```

### Step 5 — Invoke opsx:apply

Directly invoke the `opsx:apply` skill with `<change-id>` as argument. Do not ask the user to run it manually — the goal is seamless continuation.

`opsx:apply` will:
- Run `openspec instructions apply --change "<change-id>" --json`
- Automatically locate the first `- [ ]` task in `tasks.md`
- Resume implementation from that point

The context loaded in Steps 1–3 gives Claude the conversational context without needing to inject task position into `opsx:apply`'s mechanics.

### Step 6 — After opsx:apply completes

Archive the handoff:

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
mv .claude/artifacts/apply-resume/latest.md \
   .claude/artifacts/apply-resume/consumed-${TIMESTAMP}.md
```

Archive only happens after successful completion. If `opsx:apply` did not complete, `latest.md` remains with `state: consuming` for manual retry.

### Step 6b — Invoke next-step

Invoke the `next-step` skill:

- Remaining tasks still found → suggest `/opsx:apply <change-id>` again (and `/opsx-apply-resume` if context is getting full)
- All done, no P0 issues → suggest `/opsx:verify` then `/opsx:archive`
- P0 issues found → list them and suggest fixing before verify

---

## Repeatable

```
/opsx-apply-resume (Save) → /fork or /new → /opsx-apply-resume (Resume) → ...
→ /opsx:verify → /opsx:archive
```

Each Save Phase creates a new `latest.md` (previous runs become `consumed-*.md`).

---

## Guardrails

- Never modify `opsx:apply` or any external skill
- `compact-save` outputs to `./compact-notes/compact-*.json` — always validate file exists after invoking
- `opsx:apply` finds its own task checkpoint via `openspec instructions apply --json` — do not inject task position manually
- `set-handoff-state.sh consuming` before `opsx:apply`; archive to `consumed-*.md` after completion — never delete
- Model recommendation is always non-blocking — user decides whether to switch
- If `openspec/changes/<change-id>/tasks.md` missing in Resume Phase, stop immediately
- change-id priority: (1) command argument, (2) most recent `/opsx:apply <name>` in conversation, (3) AskUserQuestion
- claude-mem obs write is fire-and-forget (background `post-obs.sh &`) — never block on it; `null` obs_id is always valid
- Fallback chain (always completes): Tier 0 (pinned obs) → compact_json_path → heuristic compact → handoff_only
- Recovery from `consuming` state: user runs `bash .claude/scripts/opsx-apply-resume/set-handoff-state.sh saved`
