---
name: dhpk-prompt-optimize
description: 'Rewrite a raw task prompt into a model-aware, effort-calibrated version before you run it. Use when: the user asks to "optimize this prompt", "improve this prompt for Claude", "what effort should I use", "make this a good API prompt/template", or pastes a rough instruction before a big Claude Code or API task. Detects the target model (current session or a named one), classifies task complexity, recommends an effort level (low/medium/high/xhigh/max, plus the dhpk agent-frontmatter/Claude Code equivalent), asks up to 4 AskUserQuestion questions only for missing required info, then applies model-specific behavioral rewrites. Not for: generic few-shot/CoT/template technique coaching with no model or effort selection (use prompt-engineering-patterns), or auditing token/cache budget (use dhpk-harness-budget). Output: optimized prompt block + effort recommendation with rationale + bullet list of rewrites applied.'
argument-hint: '"<raw prompt text>" [--model <name>]'
allowed-tools: 'Read, Bash(bash:*), AskUserQuestion, mcp__context7__resolve-library-id, mcp__context7__query-docs, WebSearch, WebFetch'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Prompt Optimize

Rewrite a raw, informally-written task prompt into a model-aware, effort-calibrated version before you run it.

## When NOT to Use

- Generic few-shot / chain-of-thought / prompt-template technique coaching with no model or effort selection involved — use `prompt-engineering-patterns`.
- Auditing token/context-window budget or cache hit rate — use `dhpk-harness-budget`.
- Actually executing the prompt — this skill only rewrites it; run the result yourself afterward.
- Linting an existing `SKILL.md`'s own frontmatter/structure — use `dhpk-skill-health-audit` / `dhpk-skill-quality-judge`.

## Workflow

1. **Collect the raw prompt.** Take the user's pasted text verbatim, or `Read` the file if they pointed at one instead of pasting. Do not start rewriting yet.
2. **Detect and verify the target model.** Default to the current session's model, or use an explicit override from the user. Resolve the relevant library with `mcp__context7__resolve-library-id`, query it with `mcp__context7__query-docs`, then use `WebSearch` to locate the provider's official documentation and `WebFetch` to confirm the same parameter or capability there. These are explicit tools in this skill's `allowed-tools`; do not claim a live lookup was completed if one is unavailable. Follow the dated process in `references/live-model-verification-2026-08-05.md`; record the date and sources, or mark the recommendation `unverified` and keep it generic.
3. **Classify the task and pick an effort level.** Bucket the task as one of: simple lookup/classification, complex reasoning, coding/agentic tool-use, long-horizon autonomous, creative/design. Use `references/effort-guide.md` for the stable decision shape, then confirm the target's supported values in the live docs. State one verified effort value plus a one-line rationale and its dhpk/Claude-Code equivalent. If the task needs more than shallow reasoning but latency/cost forces a lower effort, add the fallback line from `references/effort-guide.md`.
4. **Run the completeness gate.** Check the raw prompt against `references/completeness-checklist.md`. For every REQUIRED gap, draft a question; call `AskUserQuestion` once with up to 4 batched questions (split into further calls only if more than 4 required gaps exist). For OPTIONAL gaps, don't ask — record the default assumption you'll state in the final output instead. Do not skip this step even if the prompt looks "good enough."
5. **Apply verified model-aware rewrites.** Once required gaps are answered, rewrite the prompt: general best practices first (`references/general-techniques.md`), then only the target deltas confirmed by live docs (`references/model-guides.md`). Apply the reusable-template technique (`{{variable}}` placeholders) only if the prompt shows real signs of reuse with variable inputs — not by default.
6. **Assemble the final output** in the exact shape below. Never emit the optimized prompt without having run step 4's gate first.

## Output

Exactly three parts, in this order:

1. The optimized prompt, in a single fenced code block, ready to copy.
2. Recommended effort — one line: level + API value + dhpk/Claude-Code equivalent + why.
3. A short bullet list (not an essay) of the specific rewrites applied, any
   default assumptions, and the verified live sources with their lookup date.

## Verification

- [ ] Target model detected and checked through `mcp__context7__resolve-library-id` + `mcp__context7__query-docs`, then `WebSearch` + `WebFetch` for official documentation (or explicitly marked unverified)
- [ ] Completeness gate run against `references/completeness-checklist.md`; all REQUIRED gaps asked via one batched `AskUserQuestion` call; all OPTIONAL gaps have a stated default in the output
- [ ] Effort recommendation cites verified live sources and their lookup date,
  then states both the API value and the dhpk/Claude-Code equivalent
- [ ] Output has exactly the 3 parts above, no extra essay
- [ ] For a repo change to this skill itself: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/run-skill.sh" dhpk-skill-health-audit skill-lint.js --fix-hint` (or `/dhpk:check-skill dhpk-prompt-optimize`) passes clean

## References

- `references/model-guides.md` — verified target-class deltas with no stale model catalog. Read at step 2/5 once the target model is known.
- `references/effort-guide.md` — stable effort decision shape and mapping guardrails. Read at step 3.
- `references/live-model-verification-2026-08-05.md` — dated Context7/official-doc verification process. Read before any model-specific claim.
- `references/completeness-checklist.md` — required-vs-optional information gate and the `AskUserQuestion` batching contract. Read at step 4.
- `references/general-techniques.md` — all-models best-practices toolbox plus the reusable-template technique. Read at step 5.

## Related Skills

| Skill | Purpose |
|-------|---------|
| `prompt-engineering-patterns` | Generic few-shot/CoT/template techniques (no model or effort selection) |
| `dhpk-harness-budget` | Token/cache/context-window budget accounting |
| `claude-api` | Live API parameter/model-ID mechanics |
