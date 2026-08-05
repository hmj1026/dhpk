# Agent Architecture Audit Model

Load this reference when selecting audit layers or classifying a finding. Keep the
workflow and evidence contract in `SKILL.md`; this file holds the branch-specific
diagnostic vocabulary.

## The 12 layers

| # | Layer | Typical failure |
|---|---|---|
| 1 | System prompt | Conflicting instructions or instruction bloat |
| 2 | Session history | Stale context injected into a new turn |
| 3 | Long-term memory | Cross-session pollution or old topics resurfacing |
| 4 | Distillation | Compressed artifacts re-entering as pseudo-facts |
| 5 | Active recall | Redundant summaries consuming context |
| 6 | Tool selection | Wrong routing or a required tool being skipped |
| 7 | Tool execution | Claimed execution without an actual tool call |
| 8 | Tool interpretation | Tool output misread or ignored |
| 9 | Answer shaping | The internal answer is reformatted incorrectly |
| 10 | Platform rendering | UI, API, or CLI transport mutates valid output |
| 11 | Hidden repair loops | Silent fallback or second-pass LLM mutation |
| 12 | Persistence | Expired state or cached artifacts treated as live evidence |

## Failure pattern signals

| Pattern | Signal to falsify |
|---|---|
| Wrapper regression | Direct model output works while the wrapped path degrades |
| Memory contamination | Unrelated history or stale corrections reappear |
| Tool discipline failure | Prompt-only tool requirements or unvalidated tool results |
| Rendering/transport corruption | Logs are correct but the delivered output differs |
| Hidden agent layers | An untracked retry, repair, recall, or summarization pass runs |

Map each finding to the narrowest layer and pattern supported by evidence. Do not infer
memory or model failure before checking wrapper, tool, transport, and persistence paths.
