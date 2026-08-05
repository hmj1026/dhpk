# Effort guide

This file describes the decision shape, not current model availability or
limits. Confirm supported effort values and parameter syntax with Context7 and
official provider documentation before emitting an API recommendation. Record
the lookup date and source; mark the result unverified when live docs cannot be
reached.

## Stable effort vocabulary

| Level | Use when | Trade-off |
|---|---|---|
| `low` | lookup, classification, or a short deterministic edit | least latency/cost, shallowest reasoning |
| `medium` | ordinary coding or analysis with a bounded scope | balanced quality and cost |
| `high` | complex reasoning, debugging, or multi-step tool use | more work and latency |
| `xhigh` | only when live docs confirm the target supports it and the task is long-horizon | highest supported effort; can overthink simple work |
| `max` | only when live docs explicitly document it and the task warrants it | maximum cost/latency; use sparingly |

The selected value must come from the verified target's current API or runtime
controls. Do not translate a value across providers by analogy.

## Fallback when effort must stay low

For a genuinely multi-step task constrained to `low` or `medium`, add:
“This task involves multi-step reasoning. Think carefully through the problem
before responding.” State that this is a quality safeguard, not a substitute
for a supported effort setting.

## dhpk / Claude Code mapping

When the destination is a dhpk agent, use only the frontmatter values that its
current schema accepts (`low`, `medium`, or `high` unless live documentation
says otherwise). When the destination is an interactive runtime or subagent
tool, pass the verified API value directly. If the mapping is not documented,
report the API value and the dhpk equivalent as unknown rather than guessing.
