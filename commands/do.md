---
description: 'Smart Router — map a natural-language task to the right dhpk workflow, then run it. Deterministic route-table fast path, LLM fallback for misses.'
argument-hint: '[--codex] <natural language task, e.g. "fix the login bug" / "幫我修一個 bug">'
allowed-tools: 'Bash, Skill, Read, Grep, Glob'
---

# /dhpk:do — Smart Router

One entry point for dhpk's ~70 commands. You describe the task in plain
language; this router resolves it to the right workflow — deterministically
when the request matches the route table, otherwise by your own
classification.

## Step 0 — parse codex intent (default: codex-free)

dhpk runs **codex-free by default** — not every install has the Codex CLI/MCP.
Codex is an explicit opt-in:

- Set `CODEX=on` only if the request carries an explicit opt-in: a `--codex`
  token, or an unmistakable natural-language directive ("use codex",
  "with codex", "用 codex", "走 codex"). Otherwise `CODEX=off`.
- **Strip** the `--codex` token (and a leading "use/with codex" directive) from
  the request text before matching, so it never pollutes the route patterns.
  Call the stripped text the *cleaned query*.
- If `CODEX=on` but no `mcp__codex__*` tool and no Codex CLI is available, warn
  once (`Codex requested but unavailable — falling back to codex-free.`) and set
  `CODEX=off`.

## Step 1 — deterministic pre-route (run this first)

Run the matcher with the **cleaned query** as a single quoted argument:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/lib/pre-route.sh" "<cleaned query>"
```

If `CLAUDE_PLUGIN_ROOT` is unset, skip the Bash call and proceed directly
to LLM classification (the NO_MATCH path).

The matcher prints exactly one line:

- `MATCH<TAB><skill><TAB><label>` — a high-confidence deterministic route.
- `NO_MATCH` — nothing matched; you classify.
- `NO_QUERY` — the user gave no task text.

## Step 2 — ENHANCE (optional context)

If a `[learned-context]` block was injected at session start (the learning DB
is enabled), read those recurring signatures now — before classifying.
Factor them into Step 3's NO_MATCH decision and into the downstream workflow
(e.g. a repeatedly-failing reviewer or a hot trap that relates to this request).

## Step 3 — act on the result

Pass the **cleaned query** (the full task with only the `--codex` opt-in token
removed) as the task to the downstream skill, applying the codex-mode rule below
to decide the codex flag.

- **`MATCH`** → invoke `<skill>` immediately with the **Skill** tool (e.g.
  `dhpk:bug-fix`). Do **not** re-classify — the route table already matched.
  State one line: `Routing to /<skill> (<label>).`
- **`NO_MATCH`** → classify the request yourself and pick the single best-fit
  dhpk command, then invoke it via the **Skill** tool. State one line:
  `No deterministic route; routing to /<chosen> because <reason>.`
  Common targets: `dhpk:adaptive-dev-workflow` (substantial bug/feature changes —
  classify + gate before implementing), `dhpk:bug-fix`, `dhpk:feature-dev`,
  `dhpk:code-explore`, `dhpk:review-pending`, `dhpk:security-review`,
  `dhpk:project-audit`, `dhpk:simplify`, `dhpk:tech-spec`, `dhpk:risk-assess`,
  `dhpk:deploy-list`, `dhpk:feasibility-study`, `dhpk:verify`, `dhpk:create-pr`,
  `dhpk:smart-commit`. If nothing fits, say so and ask one clarifying question
  instead of guessing.
- **`NO_QUERY`** → ask the user what they want to do; do not route.

### Codex-mode rule (how `CODEX` shapes the invocation)

- **`CODEX=off` (default):** invoke the target codex-free.
  - One exception — `dhpk:feasibility-study` defaults codex-**on**, so pass
    `--no-codex` to it to honor the codex-free default.
- **`CODEX=on`:** append `--codex` when the target supports a codex mode —
  `dhpk:adaptive-dev-workflow`, `dhpk:bug-fix`, `dhpk:feature-dev`. Special cases:
  - **Security** has no in-skill codex mode: route to the dedicated codex command
    instead — `dhpk:security-review` (default) → **`dhpk:codex-security`** under `--codex`.
  - `dhpk:feasibility-study`: invoke **without** `--no-codex` (its default already uses Codex).
  - An explicit `dhpk:codex-*` skill: route as-is.
  - Any other target: the flag has no effect — route normally.

## Notes

- The route table is the SSOT: `scripts/lib/route-table.json`. To add or retune
  a deterministic route, edit that file — both this router and the
  UserPromptSubmit skill-hint pick it up automatically.
- This command **adds an entry point**; it never replaces the underlying
  commands. Invoking `/dhpk:bug-fix` directly still works exactly as before.
- **Codex is opt-in.** The default route is codex-free so the plugin works
  without the Codex CLI/MCP. Pass `--codex` (or say "use codex") to route the
  Codex-enhanced path for skills that support it (`bug-fix`, `feature-dev`,
  `security-review`, `feasibility-study`). The dedicated `dhpk:codex-*` skills
  remain available for direct use.

User request: $ARGUMENTS
