# OpenSpec Apply Resume — Manual Procedure

Use this fallback when the package-local `scripts/` helpers (`detect-phase.sh`,
`extract-compact.sh`, `write-handoff.sh`, `set-handoff-state.sh`, `post-obs.sh`)
are absent or cannot execute.

## Safety Rules

- Run this skill **only on an explicit user request**; stop and ask before any
  write if selected autonomously.
- The live worktree is the single source of truth. Never delete, revert, or
  stash uncommitted changes to make a handoff appear clean.
- Refuse a handoff path that is empty, starts with `-`, contains NUL, or has an
  empty, `.`, or `..` component. Refuse any symlinked path component (the leaf and every existing
  parent, such as `.scratch`, `.claude`, `.dhpk`) and any existing leaf that is
  not a regular file.
- Keep `commit: SKIPPED`, optional provider failures, and unexecuted stages as
  `UNAVAILABLE` / `NOT_RUN` rather than failing the handoff or reporting an
  overall `PASS`.
- Report `mode: manual` in the final handoff summary.

## Stage: detect-phase

1. Resolve `HANDOFF_PATH` in priority order:
   1. `.scratch/<change-id>/apply-resume.md` (preferred for all Hosts)
   2. `.claude/artifacts/apply-resume/latest.md` (legacy)
   3. `.dhpk/artifacts/apply-resume/latest.md` (legacy)
   If `<change-id>` was omitted on resume, check for a single `.scratch/*/apply-resume.md`
   in `saved` or `consuming` state (ignoring `consumed-*.md` archives).
2. Read the handoff file (if present) using `Read` and inspect its YAML frontmatter
   `state` and `saved_at` timestamp. Compute age as the current time minus
   `saved_at`. A missing or unparseable `saved_at` means age is infinity, so
   `state: saved` gives `resume`. Never use the file mtime:
   - Absent file, or missing, corrupt, or unknown `state` → `save`
   - `state: consuming` → `consuming`
   - `state: saved` with age `< 60s` → `warn-recent`
   - `state: saved` with age `>= 60s` → `resume`
3. Apply the path rules in Safety Rules to `HANDOFF_PATH` before recording the
   phase token. An unsafe path is a failure, not `save`; an absent leaf under
   a safe parent chain is `save`.

## Stage: extract-compact

1. Locate the newest `compact-*.json` if compact state is enabled; if none
   exists, record `compact: UNAVAILABLE` and fall back to conversation context
   or the embedded summary.
2. When present, read the JSON file via `Read` and extract `L0` (one-liner),
   `session_goal`, `completed`, `in_progress`, `key_decisions`, and
   `failed_approaches`. Use these shapes:
   - `L0` and `session_goal`: the string, or `(未取得)` when the field is
     missing.
   - `completed` and `in_progress`: one line per item. A string item is used
     as is; an object item uses `task`, else `description`, else its JSON text.
   - `key_decisions`: a string item is `[<text>]`; an object item is
     `[<decision or summary, else (無標題)>] <reason>`.
   - `failed_approaches`: `lesson: <text>`; an object item uses `lesson`, else
     `description`, else its JSON text.
   - An empty or missing list is `(none)`.
3. Summarize the extracted fields cleanly for handoff without dumping raw JSON
   beyond what is needed.

## Stage: post-observation

The script health-checks the memory worker, skips a payload identical to the
last one posted for the same change, and returns `null` on any failure. This
stage is optional and never blocks Save.

1. Use the user's memory tool only if it is available in this session. Save one
   observation with the handoff title and content. Do not repost an identical
   observation. Record the returned id as `claude_mem_obs_id`.
2. If no memory tool is available, or it fails, record `claude_mem_obs_id: null`
   and `memory: UNAVAILABLE`, and mark this stage `UNAVAILABLE` / `NOT_RUN`.
   Do not fabricate an id or persistence. Include `mode: manual` in the report.

## Stage: write-handoff

1. Run `grep -E '^- \[[ ~]\]' openspec/changes/<change-id>/tasks.md` (or `Grep`)
   to count remaining tasks cleanly; stop `BLOCKED` if `tasks.md` is missing.
2. Follow [save.md](save.md) to collect the non-blocking snapshot fields:
   `change_id`, `saved_at` (ISO-8601 UTC), `state: saved`, `model_suggestion`,
   `risk_level`, `precommit`, `commit`, `compact`, `remaining_tasks_count`,
   `compact_json_path`, `claude_mem_obs_id`, `claude_mem_tags`, and `memory`,
   followed by `## Compact Summary`, `### Completed`, `### In Progress`,
   `## Next Actions`, and `## Completion Criteria`.
3. Check `HANDOFF_PATH` against the path rules in Safety Rules, then write the
   payload with `Write`, then re-read to verify `state: saved` and all required
   sections. The `Write` tool is not atomic. This is an accepted downgrade from
   the script, which writes a temp file with `O_NOFOLLOW` and atomically
   replaces the target. Report `mode: manual`.

## Stage: set-handoff-state

1. Verify `HANDOFF_PATH` passes the path rules in Safety Rules and is an
   existing regular file. Allowed states are `saved`, `consuming`, `consumed`;
   any other value fails. If the file has no line starting with `state:`, fail;
   do not add one. The script rewrites every line that starts with `state:`, so
   change every such line, not only the first.
2. On Resume before invoking `openspec-apply-change`, follow [resume.md](resume.md):
   update frontmatter `state:` from `saved` to `consuming` with `Edit` while
   keeping the handoff file on disk. After every `state:` change, re-read the
   file and confirm every line starting with `state:` has the requested value;
   if not, fail.
3. On successful continuation completion, update `state:` to `consumed` with
   `Edit` and move the file (`mv -- "$HANDOFF_PATH" "$(dirname "$HANDOFF_PATH")/consumed-<timestamp>.md"`)
   instead of deleting it. If continuation did not finish, leave `consuming` in
   place and report `NOT_RUN` / `BLOCKED` rather than overall `PASS`. Include
   `mode: manual`.
