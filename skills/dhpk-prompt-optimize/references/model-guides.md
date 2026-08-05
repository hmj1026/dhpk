# Model guidance

This reference deliberately contains no model IDs, vendor promises, or token
limits. Those facts drift too quickly for a static skill. Before applying a
model-specific rewrite, use Context7 and the provider's official documentation,
then record the lookup date and URL in the output. If either source is
unavailable, label the recommendation `unverified` and keep it generic.

## Target classes

After live verification, classify the target as one of these stable classes:

- **frontier reasoning** — use explicit scope, evidence checkpoints, and a
  higher effort only when the task needs multi-step reasoning;
- **balanced general** — keep the prompt direct, define the observable output,
  and avoid speculative tool or parameter claims;
- **latency/cost constrained** — minimize context, state the quality trade-off,
  and add a concise self-check rather than promising a capability;
- **unknown or legacy** — do not infer capabilities from the name; ask for a
  verified model identifier or treat the target as balanced general.

## Behavioral rewrites

Apply only the deltas confirmed by live documentation:

1. State the exact scope (for example, “every item in the list”) when literal
   coverage matters.
2. Name the required tool or source only when the target's documentation
   confirms it; otherwise say “use the available project tools”.
3. Ask for a progress/checkpoint format when the task is long-running, but do
   not invent cadence, context-window, or token-budget numbers.
4. Keep quality and latency trade-offs visible when recommending a lower effort.

For a verified API parameter or model identifier, cite the official source and
the date next to the recommendation. Never copy an old model-specific snippet
without repeating the live lookup.
