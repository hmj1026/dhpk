# Completeness Checklist

Check the raw prompt against every row below. REQUIRED rows block the rewrite until
answered; OPTIONAL rows never block — state the default assumption in the final `Output`
block instead.

## Required — ask if missing

| Item | Why it blocks | Example question |
|---|---|---|
| Goal / success criteria | Without a definition of "done," the rewrite can't tell the model what to optimize for. | "What does success look like here — what would you check to confirm it worked?" |
| Output format & length | Determines structure of the rewritten prompt itself (code block vs prose vs structured data, rough length). | "Do you want a code change, a written explanation, structured data, or something else?" |
| Act-vs-suggest (agentic/tool-using tasks only) | Changes the rewrite from imperative ("change this function") to advisory ("suggest changes") — the single biggest lever for whether the model actually does the work. | "Should Claude make the change directly, or just propose options for you to review?" |

## Optional — never ask, state a default instead

| Item | Default if unstated |
|---|---|
| Constraints / non-goals | None stated; note any implicit constraint surfaced while rewriting (e.g. "must stay under 150 lines" inferred from context). |
| Role / audience / tone | Neutral technical tone, no persona. |
| Safety / reversibility boundary | For a Mode-A prompt (this or another Claude Code session) the user's global CLAUDE.md "Executing actions with care" section already covers this — don't duplicate it. Only state an explicit reversibility boundary when the optimized prompt is destined for a standalone API integration that won't inherit that system prompt. |
| Examples | None, unless the task is classification, style-matching, or format-matching — then note that 1 example would meaningfully cut ambiguity and ask for one if none exists. |

## `AskUserQuestion` batching contract

- One call, up to 4 questions, covering REQUIRED gaps only.
- If more than 4 required gaps exist, that itself is a signal the raw prompt was too
  underspecified for a single pass — say so plainly, then batch the first 4 and follow up
  with a second call after they're answered.
- Never spend a question slot on an OPTIONAL row — those get a default assumption instead,
  never a question.
- Phrase each question so it's answerable without having seen the rewritten prompt yet — the
  user is being asked *before* the rewrite exists, not asked to review a draft.
