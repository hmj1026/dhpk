---
description: 'Smart Router — map a natural-language task to the right dhpk workflow, then run it. Deterministic route-table fast path, LLM fallback for misses.'
argument-hint: '<natural language task, e.g. "fix the login bug" / "幫我修一個 bug">'
allowed-tools: 'Bash, Skill, Read, Grep, Glob'
---

# /dhpk:do — Smart Router

One entry point for dhpk's ~70 commands. You describe the task in plain
language; this router resolves it to the right workflow — deterministically
when the request matches the route table, otherwise by your own
classification.

## Step 1 — deterministic pre-route (run this first)

Run the matcher with the user's request as a single quoted argument:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/lib/pre-route.sh" "$ARGUMENTS"
```

If `CLAUDE_PLUGIN_ROOT` is unset (manual install), fall back to
`~/.claude/scripts/lib/pre-route.sh`.

The matcher prints exactly one line:

- `MATCH<TAB><skill><TAB><label>` — a high-confidence deterministic route.
- `NO_MATCH` — nothing matched; you classify.
- `NO_QUERY` — the user gave no task text.

## Step 2 — act on the result

- **`MATCH`** → invoke `<skill>` immediately with the **Skill** tool (e.g.
  `dhpk:bug-fix`), passing the user's original request as the task. Do **not**
  re-classify — the route table already matched. State one line:
  `Routing to /<skill> (<label>).`
- **`NO_MATCH`** → classify the request yourself and pick the single best-fit
  dhpk command, then invoke it via the **Skill** tool. State one line:
  `No deterministic route; routing to /<chosen> because <reason>.`
  Common targets: `dhpk:bug-fix`, `dhpk:feature-dev`, `dhpk:code-explore`,
  `dhpk:code-review`, `dhpk:codex-security`, `dhpk:project-audit`,
  `dhpk:simplify`, `dhpk:tech-spec`, `dhpk:risk-assess`, `dhpk:deploy-list`,
  `dhpk:feasibility-study`, `dhpk:verify`, `dhpk:create-pr`,
  `dhpk:smart-commit`. If nothing fits, say so and ask one clarifying question
  instead of guessing.
- **`NO_QUERY`** → ask the user what they want to do; do not route.

## Step 3 — ENHANCE (optional context)

If a `[learned-context]` block was injected at session start (the learning DB
is enabled), factor those recurring signatures into your choice and into the
downstream workflow — e.g. a repeatedly-failing reviewer or a hot trap that
relates to this request.

## Notes

- The route table is the SSOT: `scripts/lib/route-table.json`. To add or retune
  a deterministic route, edit that file — both this router and the
  UserPromptSubmit skill-hint pick it up automatically.
- This command **adds an entry point**; it never replaces the underlying
  commands. Invoking `/dhpk:bug-fix` directly still works exactly as before.

User request: $ARGUMENTS
