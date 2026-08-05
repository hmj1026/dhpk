# Model Guides

Per-model behavioral deltas to layer on top of `general-techniques.md`. Pick the section
matching the model detected in Workflow step 2. Each snippet below is copy-paste-ready —
drop it into the optimized prompt when the matching symptom applies to the task at hand.
Don't add a snippet whose symptom doesn't apply; these are targeted fixes, not a checklist
to include wholesale.

## Claude Sonnet 5

- **Effort default is `high`.** Raise to `xhigh` for the hardest coding/agentic work. Adaptive
  thinking is ON by default (no `thinking` param needed) — pass `thinking:{type:"disabled"}`
  to turn it off. If thinking triggers more than wanted (common with large system prompts):
  `"Thinking adds latency and should only be used when it will meaningfully improve answer
  quality, typically for problems that require multi-step reasoning. When in doubt, respond
  directly."`
- **More agentic than Sonnet 4.6** — reaches for tools and self-verification loops readily.
  With thinking disabled it under-triggers tools; add an explicit nudge if tool use is
  required in that configuration.
- **Literal, explicit instruction-following**, especially at low effort — it will not
  silently generalize an instruction from one item to all. State scope explicitly: `"Apply
  this to every section, not just the first."`
- **Response length auto-calibrates to task complexity.** Add `"Provide concise, focused
  responses. Skip non-essential context, keep examples minimal."` only if a fixed, shorter
  style is required regardless of complexity.
- **No `temperature`/`top_p`/`top_k`** (400 error on this model) — for stylistic/design
  variety use a system-prompt instruction instead, e.g. `"Before building, propose N distinct
  directions, then implement only the one the user picks."`
- **Code-review harnesses**: a prompt like "only report high-severity issues" or "don't
  nitpick" is followed more literally than on older models, which can look like a recall
  drop. If coverage matters more than a single filtered pass: `"Report every issue you find,
  including low-severity or uncertain ones — a separate step will filter. Include a
  confidence and severity estimate per finding."`

## Claude Opus 4.8

- **Effort**: start at `xhigh` for coding/agentic use cases; `high` minimum for other
  intelligence-sensitive work. Thinking is OFF by default — set `thinking:{type:"adaptive"}`
  explicitly to enable it.
- **Favors reasoning over tool calls** — if you need more tool use, raise effort first, or
  add an explicit instruction naming which tool to use and why.
- **More literal at low effort**, same explicit-scope guidance as Sonnet 5 applies.
- **Better default progress updates** — remove old scaffolding like "summarize every 3 tool
  calls"; only re-add an explicit format if the default cadence doesn't fit.
- **Spawns fewer subagents by default.** To encourage more parallel delegation: `"Spawn
  multiple subagents in the same turn when fanning out across independent items or files.
  Don't delegate work you can finish directly in one response."`
- **Strong default design/frontend house style** (warm cream backgrounds, serif display type,
  terracotta accents) that a vague "don't use cream, make it minimal" instruction won't
  escape — it just shifts to a different fixed palette. Either give a concrete alternative
  spec (exact colors/fonts/layout), or ask it to propose options first: `"Before building,
  propose 4 distinct visual directions (bg hex / accent hex / typeface + one-line rationale).
  Ask the user to pick one, then implement only that direction."`
- **Code-review harness caveat**: same literal-instruction-following note as Sonnet 5.

## Claude Fable 5 / Claude Mythos 5

- **Aim it at genuinely hard, long, or ambiguous problems** — testing it only on simple
  workloads undersells it. Effort is the primary intelligence/latency/cost lever: `high` for
  most tasks (the default), `xhigh` for the hardest, step down to `medium`/`low` for routine
  work — low effort here often beats `xhigh` on older models.
- **Runs can take minutes to hours.** To stop it from over-surveying an ambiguous task:
  `"When you have enough information to act, act. Do not re-litigate a decision already made
  or narrate options you won't pursue. If weighing a choice, give a recommendation, not an
  exhaustive survey."`
- **Very strong instruction-following** — a short brevity/scope instruction outperforms a long
  negative list. For unrequested scope creep: reuse the anti-overengineering block from
  `general-techniques.md` rather than writing a new one.
- **Ground long-run progress claims in evidence**: `"Before reporting progress, audit each
  claim against a tool result from this session. Only report work you can point to evidence
  for; state explicitly what's unverified."`
- **State explicit boundaries** for irreversible or unrequested actions (destructive commands,
  drafting messages nobody asked for) — see the reversibility block in
  `general-techniques.md`.
- **Dispatches parallel subagents readily** — give explicit delegation criteria if you want
  to shape when it does this rather than leave it fully autonomous.
- **Never ask it to echo or transcribe its own reasoning as response text** — this can trigger
  the model's `reasoning_extraction` refusal category and cause an elevated fallback to Opus
  4.8. If reasoning visibility is genuinely needed, read the structured `thinking` blocks
  instead of asking the model to narrate them.
- **Long/multi-session work** benefits from a persistent memory-file convention: `"Store one
  lesson per file with a one-line summary at the top. Record corrections and confirmed
  approaches alike, including why. Update existing notes rather than duplicating."`

## Older models (Claude Sonnet 4.6, Claude Opus 4.5-4.7)

The effort table in `effort-guide.md` still applies (Sonnet 4.6 defaults to `high`; Opus
4.5-4.7 default to `high`, start `xhigh` for coding). Skip the newest-model-specific deltas
above — literal-instruction-following emphasis, the `reasoning_extraction` refusal risk, and
Fable/Mythos-specific memory/checkpoint scaffolding don't apply. General best practices in
`general-techniques.md` still fully apply.
