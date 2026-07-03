# Model Economics — tier map & cost rules

SSOT for **which model tier each role runs on, and the cost rules that govern tier and effort choices**. The dispatch *routing* decision — which agent handles which work shape — lives in `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Implementation dispatch; this file owns the *cost lens* over that routing and does not restate its work-shape rows. Resource-layer markdown, opt-in — referenced from `execution-policy.md` §Agent dispatch (model-tier + configured-role paragraphs) and `skills/prompt-optimize/references/effort-guide.md`.

> Reviewers keep a sonnet floor — no downward tiering, no `reviewer_model` key. Only `deep-reasoner` / `fast-worker` are runtime-tunable (model + effort via `userConfig`); the rest of the map is documentation for humans, not a runtime dial.

## Tier map

| Role | Model | Why |
|---|---|---|
| Orchestrator (main session) | opus | Owns decide → dispatch → verify; spends the expensive tier on judgment, risk, and evidence packets — never bulk discovery. |
| `deep-reasoner` | opus | Reasoning-heavy judgment (root cause, algorithm, design synthesis), ideally on a distilled evidence packet rather than raw breadth. |
| `fast-worker` | sonnet | Mechanical application of a clear spec — the cheaper execution tier the policy routes to by default. |
| Reviewers (code / db / security / frontend / polyfill / migration) | sonnet | High-frequency gate work; sonnet floor, raised to opus only for a HIGH-risk diff (up-only). |
| `doc-reviewer` | haiku | Lightweight frontmatter / link / SSOT lint — the cheapest tier that passes. |
| `architect`, `spec-miner` | opus | Cross-module design / behavioral-spec extraction — reasoning-heavy, not discovery. |

Routing (which role for which work shape) is the `execution-policy` §Implementation dispatch table — see it, do not restate it here.

## Master cost rules

1. **Cheapest passing model.** Route to the cheapest model expected to pass the acceptance criteria — not the most capable available.
2. **Accepted-outcome cost, not single-call price.** Weigh the total cost to a passing result (retries and subagent calls included), not the sticker price of one call. A cheap model that loops can cost more than one stronger pass.
3. **Gather breadth cheaply, reason expensively (situational — not a dhpk default).** In principle, for broad discovery a read-only cheap pass (`Explore` / `fast-worker`-tier) can compress evidence into a packet the expensive tier then judges, rather than sending the expensive tier to read raw breadth. **A dhpk pilot A/B (2026-07) did not confirm a net saving:** the opus reasoner already bulk-extracts breadth efficiently (~3 tool calls for 58 files), so inserting a separate gather pass raised weighted cost on both a moderate- and a broad-discovery task (opus tokens fell 37–51%, but the sonnet gather's 2× weight more than offset it). Treat gather-first as a judgment call reserved for cases where the expensive tier would otherwise ingest genuinely large raw content it cannot compress cheaply itself — not a standing default.
4. **Effort de-escalation.** `effort` is a token lever independent of tier: run the decision/design layer at higher effort, de-escalate execution once the decision settles, and never default execution to maximum. Per-worker overrides: `deep_reasoner_effort` (default `high`) / `fast_worker_effort` (default `medium`).
5. **Reviewer escalation is up-only.** Reviewers hold the sonnet floor (`doc-reviewer` haiku); raise a single dispatch to opus only for a HIGH-risk diff (`security-reviewer` on auth/crypto/money/upload, `migration-reviewer` on a multi-tenant high-volume schema change). Never tier a reviewer down.
6. **Raise a churning worker's tier.** When a `fast-worker` dispatch churns toward its 3-attempt stop, the orchestrator MAY raise that single dispatch one tier via the `Agent` call `model` param — the same mechanism as the HIGH-risk reviewer escalation — instead of only re-dispatching `deep-reasoner`. One stronger pass beats repeated retries (rule 2).

> **See also:** `skills/harness-budget` runs a tier-economics audit that flags cost-posture mismatches against this map (a read-only discovery role on opus, a mechanical role at `high` effort, a high-frequency reviewer on an expensive tier).
