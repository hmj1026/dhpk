# Effort Guide

This file covers the *decision* — which effort level fits the task — not API request
mechanics. For live parameter syntax and model IDs, see the `claude-api` skill instead of
re-deriving them here.

## Effort levels (API `output_config.effort`)

| Level | Description | Typical use case |
|---|---|---|
| `max` | Absolute max capability, no constraint on token spend. Can show diminishing returns / overthinking on structured or less intelligence-sensitive tasks. | Genuinely frontier problems only. |
| `xhigh` | Extended capability for long-horizon work (30+ min, million-token budgets). Only on Fable 5, Mythos 5, Opus 4.8, Opus 4.7, Sonnet 5. | Hardest coding/agentic tasks: repeated tool calling, deep search, long exploration. |
| `high` | High capability. Equivalent to omitting `effort` entirely — this is the API default. | Complex reasoning, difficult coding, agentic tasks — the safe default. |
| `medium` | Balanced, moderate token savings. | Cost-sensitive agentic work that still needs decent quality. |
| `low` | Most efficient, real capability reduction. | Simple lookups/classification, subagents, high-volume or latency-sensitive work. |

Effort affects **all** tokens in the response — text, tool calls/arguments, and thinking.
Lower effort means fewer or combined tool calls and less preamble; higher effort means more
tool calls, more explanation, and more thorough self-verification.

**Every model respects effort strictly at the low end** — at `low`/`medium` the model scopes
work to exactly what was asked rather than going above and beyond. If you see shallow
reasoning on a moderately complex task, **raise effort rather than prompting around it**. If
effort must stay low for latency reasons, add: `"This task involves multi-step reasoning.
Think carefully through the problem before responding."`

At `xhigh`/`max`, set a large `max_tokens` (start around 64k) so the model has room to think
and act across subagents and tool calls.

## Per-model calibration

| Model | Default | Raise to `xhigh` for | Notes |
|---|---|---|---|
| Claude Sonnet 5 | `high` | Hardest coding/agentic work | No `xhigh` gap vs Opus — same recommendation shape. |
| Claude Opus 4.8 | `high` | Coding/agentic use cases (start here, not at `high`) | Favors reasoning over tool calls; effort is also the lever to increase tool usage. |
| Claude Fable 5 / Mythos 5 | `high` | The most capability-sensitive workloads only | Step down to `medium`/`low` for routine work — often still beats `xhigh` on older models. |
| Claude Sonnet 4.6 | `high` | N/A — `xhigh` not available on this model | Set effort explicitly to avoid unexpected latency. |
| Claude Opus 4.5-4.7 | `high` | Opus 4.7 only (Opus 4.5/4.6 lack `xhigh`) | Same "respect strictly at low end" caveat applies. |

## Mapping to dhpk / Claude Code

> Tier/cost rationale — which model each role runs on, and the master cost rules — lives in `rules/model-economics.md`. This guide owns only the **effort** dimension; the two are cross-linked, neither restates the other.

Once you've picked an API-style effort value, state its dhpk/Claude-Code equivalent too:

- **dhpk agent-frontmatter `effort:` field** (`low`/`medium`/`high` only — no dhpk agent
  currently uses `xhigh`/`max`). Confirmed distribution across the 23 agents that set it:
  `architect`, `security-reviewer`, `spec-miner`, `swift-build-resolver` → `high`;
  `docs-lookup`, `harness-reviser` → `low`; the remaining ~17 (most reviewers, `tdd-guide`,
  `doc-updater`, build-resolvers, etc.) → `medium`. Use this table as the reference point
  when the optimized prompt is destined for a new or edited dhpk agent/skill.
- **Claude Code's interactive effort dial** — same low/medium/high/xhigh/max vocabulary.
  `ultracode` is not a separate API level; it pairs `xhigh` with standing permission for
  multi-agent workflows.
- **`Task`/`Agent`/`Workflow` tool `effort` options** accept the API values directly
  (`low`/`medium`/`high`/`xhigh`/`max`) — no translation needed when recommending an effort
  for a subagent dispatch.

## Fallback instruction for forced-low effort

When cost or latency requires staying at `low`/`medium` despite a task that has real
multi-step reasoning in it, always append: `"This task involves multi-step reasoning. Think
carefully through the problem before responding."` This is cheaper than raising effort and
recovers most of the quality gap on moderately complex tasks.
