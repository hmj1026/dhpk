# Save Phase

Save creates a resumable handoff from the live worktree. It does not require a
commit, and it never reverts, deletes, or stashes uncommitted files.

## Package and path contract

`$SKILL_DIR` denotes the physical directory containing the selected `SKILL.md`;
it is path notation, not an ambient environment variable or repository-root
lookup. Resolve it before invoking helpers from an arbitrary consumer cwd.

Use the package-local `"$SKILL_DIR/scripts/"` helpers:

- `"$SKILL_DIR/scripts/detect-phase.sh"` — phase token before entering Save.
- `"$SKILL_DIR/scripts/extract-compact.sh"` — synchronized local copy of the canonical
  `dhpk-opsx-load-context` extractor.
- `"$SKILL_DIR/scripts/post-obs.sh"` — synchronized local copy of the canonical
  `dhpk-opsx-post-observation` observer.
- `"$SKILL_DIR/scripts/set-handoff-state.sh"` — recoverable `saved|consuming|consumed` transition.
- `"$SKILL_DIR/scripts/write-handoff.sh"` — atomically writes the complete handoff payload from
  stdin to one explicit path; it requires the `python3` capability.

The Host adapter resolves `HANDOFF_PATH` as
`.claude/artifacts/apply-resume/latest.md` for Claude or
`.dhpk/artifacts/apply-resume/latest.md` for Codex. Pass that path explicitly
as the helper's trailing handoff-path argument (for example,
`"$SKILL_DIR/scripts/detect-phase.sh" "$HANDOFF_PATH"` or
`"$SKILL_DIR/scripts/set-handoff-state.sh" consuming "$HANDOFF_PATH"`); never
let a helper infer it from the current directory. Call
`"$SKILL_DIR/scripts/write-handoff.sh" "$HANDOFF_PATH"` with the complete
handoff bytes on stdin after the Save content is assembled. Missing package assets are
`BLOCKED_RESOURCE_MISSING`; an unavailable `python3` writer capability is
`BLOCKED` and does not permit a shell fallback.

## Steps

1. **Optional commit gate.** Commit only after a separate explicit request.
   List unstaged changes and ask whether to include them. If skipped or the
   optional `smart-commit` capability is unavailable, record
   `commit: SKIPPED` or `commit: UNAVAILABLE` and continue from the live tree.
2. **Optional precommit gate.** Run `precommit-fast` only when the operator or
   project enables it. `PASS` continues. `FAIL` reports details and asks
   whether to save; a confirmed continuation records `precommit: FAILED`.
   A refusal stops without writing a handoff.
3. **Optional compact provider.** If `compact-save` is installed and enabled,
   invoke it and verify the newest `compact-notes/compact-*.json` exists. No
   file records `compact: UNAVAILABLE` and the embedded summary remains the
   source. A file is recorded as `COMPACT_JSON_PATH`; use the package-local
   `"$SKILL_DIR/scripts/extract-compact.sh"` to read `L0`, `session_goal`, `completed`, `in_progress`,
   `key_decisions`, and `failed_approaches`.
4. **Optional memory provider.** If the package-local observation provider is
   available, build one JSON payload from the compact fields and launch its
   post non-blocking. Collect the result before the handoff write. Record an
   integer `claude_mem_obs_id` or `null`; either is valid. Codex may use a
   native provider or the package-local helper, but never requires Claude-mem.
5. **Identify the change.** Select `change-id` in this order: command
   argument, most recent visible `/opsx:apply <name>`, then the Host's native
   selection prompt. Announce the selected name. Read only unchecked and
   in-progress tasks:

   ```bash
   grep -E '^- \[[ ~]\]' openspec/changes/<change-id>/tasks.md
   ```

   A missing tasks file is `BLOCKED`; do not guess a renamed or archived
   change. Count `[ ]` and `[~]`, classify actionable steps versus completion
   criteria, and preserve the live worktree as truth.
6. **Non-blocking snapshot.** Record the current `change-verdict` risk level
   (`low|medium|high|critical`) when available. Recommend `opus` for complex
   work or at least five remaining tasks, `sonnet` for one to four general
   tasks, and `haiku` for docs/config-only work. This recommendation never
   changes the active model automatically.
7. **Write the handoff.** Create the host artifact directory and assemble the
   handoff payload with frontmatter containing:

   ```text
   change_id, saved_at, state: saved, model_suggestion, risk_level,
   precommit, commit, compact, remaining_tasks_count, compact_json_path,
   claude_mem_obs_id, claude_mem_tags
   ```

   Embed `## Compact Summary`, `### Completed`, `### In Progress`,
   `## Next Actions`, and `## Completion Criteria`. Use `(未取得)` or an
   explicit unavailable marker when an optional provider supplied no data.
   Pipe the complete payload to the package-local
   `"$SKILL_DIR/scripts/write-handoff.sh" "$HANDOFF_PATH"` helper; its `python3` prerequisite must be available before
   Save can pass.
8. **Recommend the boundary.** `remaining_tasks_count <= 3` recommends Claude
   `/fork`; a larger count recommends `/new`. Codex names a new turn/session
   instead and never emits a required Claude slash command. If commit was
   skipped or unavailable, state that uncommitted files remain in the live
   worktree and the same worktree must be retained.

## Output and verification

Return the handoff path, change, remaining count, risk, precommit/commit/
compact/memory states, and one next action. Verify the file exists, has
`state: saved`, contains the required sections, and leaves unrelated files
untouched. A successful Save is evidence of a resumable snapshot, not an
OpenSpec implementation or commit.
