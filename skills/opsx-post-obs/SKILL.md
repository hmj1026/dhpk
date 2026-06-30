---
name: opsx-post-obs
description: 'Post a session observation to claude-mem from opsx-apply-resume Save Phase — builds a JSON payload and runs post-obs.sh as a non-blocking background post (the caller collects the result before the handoff write, so the POST overlaps Save-Phase Steps 4–6). Use when: opsx-apply-resume Save Phase Step 3b, right after compact-save extracts L0/session_goal/completed/key_decisions. Not for: loading Resume context (use opsx-load-context) or goal generation (use opsx-goal). Output: OBS_PID + OBS_RESULT_FILE path for the caller to wait on.'
allowed-tools: Bash, Write
---

# opsx-post-obs

Non-blocking background observer for `opsx-apply-resume` Save Phase — the POST
overlaps Steps 4–6 and the caller collects its result before the handoff write
(it is *not* truly fire-and-forget: the obs_id feeds the handoff frontmatter).
Called with compact-save output fields; posts an observation to the claude-mem worker without blocking the main Save Phase flow.

## When NOT to Use

- Loading Resume Phase context → use `opsx-load-context`
- Generating a `/goal` condition for a fresh session → use `opsx-goal`
- Outside Save Phase Step 3b (do not post observations mid-implementation)

## Inputs

| Variable | Source | Description |
|----------|--------|-------------|
| `title` | L0 from extract-compact | One-liner session headline |
| `content` | Concatenation of compact fields | session_goal + in_progress[].task + key_decisions[].decision + reason + failed_approaches[].lesson；各欄位以 `\n` 分隔，組成單一字串 |
| `concepts` | Caller provides | Array: `[<change_id>, <stage>, <wave>, "opsx-apply-resume"]` — stage 和 wave 從 L0 解析（見下方 Notes） |

### Notes：從 L0 解析 stage / wave

L0 格式範例：`Phase 7 Stage S9c.8.8 Wave C: saveReceipt_new record_mo support`

- `stage` = 正則抓取 `Stage (S[\w.]+)` → 小寫化加前綴，例如 `stage-s9c.8.8`
- `wave` = 正則抓取 `Wave ([A-Z])` → 小寫化加前綴，例如 `wave-c`
- 解析失敗時省略 stage / wave，保留 `[<change_id>, "opsx-apply-resume"]`（見 Guardrails）

## Step 1 — Build payload JSON

Compose a JSON object:

```json
{
  "title": "<title>",
  "content": "<content — multi-line OK, use \\n>",
  "concepts": ["<change_id>", "<stage>", "<wave>", "opsx-apply-resume"]
}
```

- `content` must be a single JSON string. Join all parts with `\n`.
- `concepts` array values: lowercase, no spaces. If stage/wave cannot be parsed, omit them (keep at least change_id and "opsx-apply-resume").

## Step 2 — Write to temp file

Generate a timestamp:

```bash
TS=$(date +%Y%m%d-%H%M%S)
OBS_PAYLOAD_FILE="/tmp/claude-mem-obs-${TS}.json"
OBS_RESULT_FILE="/tmp/claude-mem-obs-${TS}-result.txt"
```

Write the JSON payload to `$OBS_PAYLOAD_FILE` using the Write tool.

## Step 3 — Launch in background

```bash
bash .claude/scripts/opsx-apply-resume/post-obs.sh "$OBS_PAYLOAD_FILE" > "$OBS_RESULT_FILE" &
OBS_PID=$!
```

`post-obs.sh` outputs either an integer obs_id or the string `null`.

## Output

Set these variables for the caller to use later (before Step 7 of Save Phase):

| Variable | Value |
|----------|-------|
| `OBS_PID` | Background process PID |
| `OBS_RESULT_FILE` | Path to result text file |

The caller collects the result before writing the handoff file:

```bash
wait $OBS_PID
CLAUDE_MEM_OBS_ID=$(cat "$OBS_RESULT_FILE" 2>/dev/null || echo null)
```

## Verification

- [ ] Payload is a single valid JSON object (`content` parts joined with `\n`)
- [ ] `concepts` values lowercased, no spaces; stage/wave omitted if unparsable
- [ ] `post-obs.sh` launched with `&` — Save Phase never blocked
- [ ] `OBS_PID` and `OBS_RESULT_FILE` returned; `null` outcomes accepted

## Guardrails

- Never block the Save Phase on this step — always launch with `&`
- If the payload build fails (e.g., all fields empty), write `{}` and still launch — the worker will return null cleanly
- `OBS_PID=null` and `CLAUDE_MEM_OBS_ID=null` are both valid outcomes; the handoff file accepts null without error
- Do not wait for `$OBS_PID` here — the caller waits after Steps 4–6 complete
