# Resume context

Read this procedure only during Resume, after parsing the explicit handoff.
It owns context loading inside this family; it requires no peer Skill.
Inputs are `HANDOFF_PATH`, `change_id`, optional `claude_mem_obs_id`, optional
`compact_json_path`, and the first Next Action as `next_action_hint`.

Initialize `session_goal = "(未取得)"`, `completed = []`, `in_progress = []`,
and `cross_session_observations = []`. A source is usable only when it supplies
meaningful goal/summary or completed/in-progress content. Empty objects,
whitespace, `(未取得)`, `(none)`, and unavailable markers are not context.
An available tool or successful JSON parse alone is not a successful tier.

## Carry-forward precedence

When the Host declares unattended carry-forward support, check the selected
active change's `.hard-rule-escalation.md` before its `.resume-note.md`.

- An escalation, including an unreadable or malformed one, is a blocking human
  decision. Set `CONTEXT_SOURCE = ".hard-rule-escalation.md"`, report the path,
  and wait for the human's resolution before continuation. Keep the conflict
  distinct from ordinary resume context.
- A fresh readable resume note supplies remaining unchecked tasks, any unfixed
  CRITICAL reviewer finding, and its next-focus hint. Map these to
  `in_progress` and `session_goal`, set `CONTEXT_SOURCE = ".resume-note.md"`,
  and skip the ordinary tiers if the note is usable. An unreadable, stale, or
  empty note falls through.

These are task artifacts, not package resources. With no declared source or
no matching artifact, continue to the ordinary chain.

## Ordered fallback

Stop at the first usable source; lower tiers remain unread.

1. **Pinned memory.** With a non-null integer `claude_mem_obs_id` and an
   available permitted memory provider, request
   `get_observations(ids=[<id>])`. Extract the goal, completed, and in-progress
   fields from its body. Usable content sets
   `CONTEXT_SOURCE = "claude-mem obs #<id>"`. Empty data, denial, unavailable
   capability, or service error falls through without posting anything.
2. **Compact JSON.** Prefer the explicit handoff `compact_json_path`.
   Otherwise select the newest `compact-notes/compact-*.json` inside the
   declared live worktree, recording heuristic discovery. Resolve the
   extractor only as `"$SKILL_DIR/scripts/extract-compact.sh"`; its absence or
   non-executable mode records `BLOCKED_RESOURCE_MISSING`, not a service
   failure. Preserve that diagnostic and continue to the embedded handoff;
   never borrow an ambient extractor. This recovery does not pass package
   closure validation: the required asset must still be present in delivery.
   When the extractor is available, run it with the explicit compact path.
   A missing task input, parse error,
   or no usable extracted fields falls through. Usable data sets
   `CONTEXT_SOURCE = "compact JSON"` or `"compact JSON (heuristic)"`; use L0 as
   the summary when the goal is absent. Preserve completed/in-progress lists.
3. **Embedded handoff.** Read `## Compact Summary`, `### Completed`, and
   `### In Progress` from `HANDOFF_PATH`. Usable content sets
   `CONTEXT_SOURCE = "handoff only"`. If all three tiers supply no usable
   context, return `BLOCKED` with `CONTEXT_UNAVAILABLE` and
   `CONTEXT_SOURCE = "handoff unavailable"`; keep the initialized fields and
   preserve the handoff. Continue neither state mutation nor external apply.

## Optional cross-session context

After usable context is selected, a non-empty `next_action_hint` may trigger
an available permitted memory search. Use 3–6 key terms, the declared project,
decision/discovery types, and limit 5 results. Fetch at most 3 relevant
observations. Denial, failure, no useful results, or no hint leaves
`cross_session_observations = []`. This enrichment neither replaces the chosen
tier nor blocks otherwise valid Resume.

## Result

Always return `CONTEXT_SOURCE`, `session_goal`, `completed`, `in_progress`,
`cross_session_observations`, and all diagnostics. A usable embedded handoff
can recover context after an unavailable compact extractor; preserve the
missing-resource diagnostic separately from `CONTEXT_SOURCE`. If no tier is
usable, the result remains `BLOCKED` with `CONTEXT_UNAVAILABLE`. Display heuristic
sources and optional provider failures accurately. Resume performs no
observation POST, even when every memory source fails.
