---
trigger: model_decision
description: Opt-in model tier and cost rules
---
# Model Economics — tier map & cost rules

SSOT for **which model tier each role runs on, and the cost rules that govern tier and effort choices**. The dispatch *routing* decision — which agent handles which work shape — lives in `${POLICY_BUNDLE_ROOT}/rules/execution-policy.md` §Implementation dispatch; this file owns the *cost lens* over that routing and does not restate its work-shape rows. Native-vs-external candidate selection follows the shared Native dispatch baseline in `execution-policy.md`; model economics ranks an already-valid candidate and never enables cross-provider probing. Resource-layer markdown, opt-in — referenced from `execution-policy.md` §Agent dispatch (model-tier + configured-role paragraphs).

> Reviewers keep a sonnet floor — no downward tiering. `reviewer_target` is the only public reviewer entry. Runtime-tunable via `userConfig`: the four `<role>_target` keys (`worker_target`, `reasoner_target`, `planner_target`, `reviewer_target`, format `<agent>/<model>[:<effort>]`) carry model and effort for every Role, including the CLI-backed `codex-worker`, `codex-reasoner`, `codex-reviewer`, and `agy-worker` (their model and effort come from the matching `<role>_target` when its target Agent is that CLI; agy bakes effort into the model name). The former `*_model` / `*_effort` keys (`fast_worker_*`, `deep_reasoner_*`, `codex_fast_worker_*`, `codex_deep_reasoner_*`, `agy_fast_worker_model`, and the rest) are removed keys, reported `BLOCKED` and not applied; see the configuration guide's "Removed in 0.69.0" section. Only timeouts stay role-specific: `codex_worker_timeout_secs`, `codex_reasoner_timeout_secs`, `codex_reviewer_timeout_secs`, with the shared `codex_timeout_secs`; budgets are integer seconds, `0` is an intentional dispatcher-attested no-deadline request, and malformed values fail closed. The portable runner, never a shell timeout backstop, enforces an attested nonzero deadline. The rest of the map is documentation for humans, not a runtime dial.

## Tier map

| Role | Model | Why |
|---|---|---|
| Orchestrator (main session) | opus | Owns decide → dispatch → verify; spends the expensive tier on judgment, risk, and evidence packets — never bulk discovery. |
| `deep-reasoner` | opus | Reasoning-heavy judgment (root cause, algorithm, design synthesis), ideally on a distilled evidence packet rather than raw breadth. A single dispatch MAY raise to `fable` only for multi-question policy/spec adjudication where a wrong ruling is costly; root-cause analysis, single-failure diagnosis, and diff tracing stay on opus (Fable 5.2 cost 1.3-3.7x opus on the same task, median about 2.7x; on the 2026-11-12 root-cause benchmark Fable did not improve quality, see [Role default benchmark](#role-default-benchmark-2026-11-12) and [#1299](https://github.com/hmj1026/dhpk/issues/1299)). |
| `codex-reasoner` (selector-driven) | external CLI — codex, default `gpt-6.1-sol` @ `high` (`reasoner_target`, `codex/<model>[:<effort>]`) | Reasoning-heavy judgment offloaded to the codex CLI (read-only sandbox) via `--reasoner=codex/<model>[:<effort>]`; the bare `--reasoner=codex` value is a compatibility shorthand; same conclusion contract as `deep-reasoner`; confirmed CLI or auth/model unavailability with no side effect follows the shared native-first fallback, while safety/task/timeout failures stay on their existing paths. |
| `fast-worker` | sonnet | Mechanical application of a clear spec — the cheaper execution tier the policy routes to by default. |
| `codex-worker` (selector-driven) | external CLI — codex, default `gpt-6-luna` @ `xhigh` (`worker_target`, `codex/<model>[:<effort>]`) | The strong mechanical tier: selected explicitly or by configured `auto` availability order; confirmed CLI or auth/model unavailability with no side effect follows the shared native-first fallback. |
| `agy-worker` (selector-driven) | external CLI — agy, default `Gemini 3.8 Flash (High)` (`worker_target`, `agy/<model>`) | The high-throughput tier: selected explicitly or by configured `auto` availability order; confirmed CLI or auth/model unavailability with no side effect follows the shared native-first fallback. |
| `codex-reviewer` (opt-in, internal-only in this rollout) | external CLI — codex, default `gpt-6.1-sol` @ `high` (`reviewer_target`, `codex/<model>[:<effort>]`) | Read-only peer review through a supported current Host route; the standalone bridge entry is retired. Contained dispatcher deadlines remain enforced by the Python runner. |
| Reviewers (code / db / security / frontend / polyfill / migration) | sonnet | High-frequency gate work; sonnet floor, raised to opus only for a HIGH-risk diff (up-only). |
| `doc-reviewer` | haiku | Lightweight frontmatter / link / SSOT lint — the cheapest tier that passes. |
| Built-in `Explore` (no dhpk frontmatter) | haiku @ low | Search and file discovery only. Pass `model: "haiku"` and `effort: "low"` on every `Agent` call, because no frontmatter can set them. Review and judgment never go through `Explore`; use `code-reviewer` or `deep-reasoner`. |
| Built-in `general-purpose` (no dhpk frontmatter) | explicit `model` required | Only for work with no typed role. Always pass an explicit `model`; never haiku for file edits. Reassignment of work that has a typed role is owned by `${POLICY_BUNDLE_ROOT}/skills/flow-guide/references/implementation-dispatch.md`. |
| `architect` | fable @ medium | Highest per-token Claude tier in current pricing evidence, the default tier for cross-module / DDD design judgment; `medium` scored 5/5 against 4.5/5 at `low` in the 2026-11-12 benchmark ([#1299](https://github.com/hmj1026/dhpk/issues/1299)); `deep-reasoner` may also raise to it, see its row. `architect_model` / `architect_effort` are removed keys with no dispatch effect. |

**`fast-worker` sonnet vs haiku boundary.** sonnet stays the default. A single dispatch MAY pass the `Agent` call `model: haiku` only when every condition holds: the spec names each target file and the exact edit, the edit is a mechanical sweep (rename, docblock or anchor text, format-only, or applying a literal fix-spec), no step needs a judgment call about behavior, and one deterministic command verifies the result. Keep sonnet for anything that reads behavior, chooses between alternatives, touches tests' expectations, or spans an unresolved spec. On a haiku dispatch pass an explicit `effort` (usually `medium` or `low`) rather than raising it to compensate (see the note below). A haiku dispatch that fails its first verification goes back to sonnet (rule 6), not to a second haiku retry.

As checked 2026-10-05, the Anthropic API's `sonnet` alias resolves to Claude Sonnet 5.5 (`claude-sonnet-5-5`, released 2026-09-28, `$2/$10` per million input/output tokens) and defaults to `high` effort. Sonnet 5.5 recalibrates effort relative to Sonnet 5; for agentic coding and multistep tool use, Anthropic recommends starting at `medium` for well-specified work and `high` for harder or longer tasks. As checked 2026-10-31, the `haiku` alias resolves to Claude Haiku 5.5 (`claude-haiku-5-5`, `$0.10/$0.50` per million input/output tokens up to 100K-token prompts, `$0.50/$2.50` above), which supports effort with default `medium`; Anthropic recommends `medium` for most Haiku work and `xhigh` only for long-horizon tasks. Provider-neutral dispatch has no haiku route in `manifests/provider-model-catalog.json`, so a haiku effort travels on the native `Agent` call, not through the dispatch engine. Observed 2026-10-31: a user-level `modelSettings` effort for haiku applies to built-in agents (Explore, general-purpose) that declare no effort, so `xhigh` there makes every Explore run think at xhigh. The `opus` alias resolves to Opus 5.5 (`claude-opus-5-5`, `$4/$20`) with `medium` effort by default; it cannot disable thinking. As checked 2026-11-10 against the official model table, `fable` resolves to Fable 5.2 (`claude-fable-5-2`, `$8/$40` per million input/output tokens), the highest per-token Claude tier; Fable 5.1 (`$10/$50`) is the superseded predecessor. Alias resolution can differ by provider or explicit environment override. Set effort explicitly where a role depends on it (rule 4). Sources: [Sonnet 5.5 model overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [effort guidance](https://platform.claude.com/docs/en/build-with-claude/effort), [Claude model overview](https://platform.claude.com/docs/en/models/overview), and [Claude Code model configuration](https://code.claude.com/docs/en/model-config), and [Haiku 5.5 prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5).

## Architect vs deep-reasoner

Both roles answer a question before a writer acts; they differ in when the question arises and what it asks. Tiers and Role Defaults stay in the tier map above; raising either one follows rule 7 below.

| | `architect` | `deep-reasoner` |
|---|---|---|
| When | Before implementation | During implementation |
| Question | How should the structure be designed | Why did it happen, and how to fix it |
| Examples | Whether two Hosts share one lock, module boundaries, whether a new ADR is needed, an on-disk format migration (for example the Projection Journal) | A timeout root cause, a test number that does not match, algorithm design, multi-file debugging |
| Output | A design decision and an implementation plan | A root cause with file:line evidence and next steps a `fast-worker` can follow |
| Raise | A high-risk design may raise effort; a migration spanning several Hosts may go one effort level up | One dispatch may raise to `fable` only for multi-policy or multi-spec adjudication (see the tier map row); ordinary debugging stays on opus |

A multi-stage migration (3 or more independently releasable stages) may be led by a Fable main session; this is a description of an option, not a prompt or an automatic suggestion.

## Role default benchmark (2026-11-12)

Evidence for the role defaults in the tier map, from a 2 model x 2 effort run recorded in [#1299](https://github.com/hmj1026/dhpk/issues/1299). It is the task-class effort benchmark that ADR-0024 (dhpk repository) requires before a role default is assigned; its scope is one task per role. The tier map stays the SSOT for the resulting defaults.

| Role | Result (cost per run) | Tier map outcome |
|---|---|---|
| `architect` | fable@low 4.5/5 $1.74; fable@medium 5/5 $1.51; opus@low 4/5 $0.47; opus@medium 4.5/5 $1.15 | Row changed to `medium`: best score, and cheaper than fable@low in this run. |
| `deep-reasoner` | All four correct: opus@medium $1.49; opus@high $1.77; fable@medium $3.08; fable@high $5.86 | Row unchanged. The task did not discriminate; re-run on a harder task before lowering. |
| `fast-worker` | All four produced identical passing diffs; sonnet@medium $0.13 was cheapest | Row unchanged. Low-first (rule 8) did not save cost here. |

- **Fable 5.2 vs opus:** the same-task cost ratio was 1.3-3.7x, median about 2.7x. It replaces the Fable 5.1 figure of about 2.3x.
- **Cost basis:** costs include cache tokens, with cache read priced at 0.1x and cache write at 1.25x of the input price (an assumption). The telemetry report excludes cache and undercounts these costs by about 3x; that gap is tracked in [#1331](https://github.com/hmj1026/dhpk/issues/1331).
- **Limits:** n=1 per cell, and run-to-run variance was observed. Quality scores were assigned by the orchestrating session and are pending maintainer confirmation in #1299. The architect runs had GitNexus disabled, unlike daily use, and the four deep-reasoner runs shared one worktree and interfered with each other. Costs describe this one benchmark, not a general price. The Codex projection was not benchmarked.

## Codex projection map

This section is the Codex-specific projection of the policy above. Codex custom
agents set `model` and `model_reasoning_effort` per role; they do not expose a
custom `max_output_tokens` field, so token economics are controlled through the
model tier, effort, prompt scope, concurrency, and retry policy. The current
standard API rates used for comparison are documented in the [OpenAI model
catalog](https://developers.openai.com/api/docs/models) and [API pricing
guide](https://developers.openai.com/api/docs/pricing) (checked 2026-10-28):
GPT-6.1 Sol (`gpt-6.1-sol`) is `$2/$10`, GPT-6.1 Terra is `$1/$5`, and GPT-6
Luna is `$0.10/$0.50` per million input/output tokens. The Codex models cache
read on 2026-10-21 (CLI 0.163.0, cache client_version 0.162.0), for this Host,
advertises `gpt-6.1-sol` and `gpt-6-sol` as `low`, `medium`, `high`,
`xhigh`, `max`, and `ultra`, and `gpt-6-luna` as `low`, `medium`, `high`,
`xhigh`, and `max` without `ultra`. That cache is not a promise for every
API or Host route. `none` and `minimal` are not in the cache. CLI worker
default stays `xhigh`, the Codex-native worker default is `gpt-6.1-sol` at
`medium`, and the Claude-host Codex fallback stays `high`. Existing explicit
`gpt-6-sol` compatibility routes remain available. GPT-6.1 Terra is documented
for visual reasoning, computer use, concise writing, and scoped code fixes; its
model page lists `medium` as the default reasoning effort. Terra is declared
only for Codex-native worker and reviewer requests at `medium`. API model
documentation does not establish Codex CLI runtime support, so effective model
and effort remain separate runtime evidence.
GPT-6 Astra (`$10/$50`) is the frontier tier and stays an explicit opt-in,
never a role default. See the [GPT-6.1 Sol model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
[GPT-6.1 Terra model page](https://developers.openai.com/api/docs/models/gpt-6.1-terra),
and [model-selection guide](https://developers.openai.com/api/docs/guides/model-selection)
for current model guidance and effort support.

Do not copy live `model` / `model_reasoning_effort` values into this page.
Generated Codex agents are owned by `RUNTIME_METADATA` in
`$PROJECT_DIR/scripts/gen-codex-agents.js`. The four hand-maintained roles
(`bug-investigator`, `explorer`, `monitor`, `worker`) pin their values in
`codex/agents/*.toml`. Host dispatch defaults for `planner`, `reasoner`, and
`worker` live in `manifests/host-profiles.json` (`host: codex-cli`
`role_defaults`); `reviewer` has no single generated-agent mapping. A JSON
compare in `tests/codex-runtime-contract.test.js` fails closed when a mapped
canonical role drifts, unless the drift is listed in that compare's exception
object.

Cost/quality rationale, without restating the live values:

- Design, root-cause, migration-risk, and spec judgment have high failure/retry
  cost; use the agentic-coding tier without defaulting to maximum effort or
  Astra.
- High-frequency review stays below that peak, with explicit escalation for
  high-risk changes.
- Structured specialist checks benefit from more reasoning while avoiding
  Astra; E2E remains quality-sensitive and fail-loud when the browser
  capability is absent.
- Read-heavy evidence gathering needs breadth and coherent synthesis, not
  frontier judgment by default.
- Test-first guidance establishes observable RED evidence before a worker
  implements the confirmed change; the handoff separates acceptance design
  from implementation cost.
- Terra roles are task-scoped candidates for UI observation, source-grounded
  writing, and confirmed local fixes. Compare them with Sol on identical inputs
  and effort before making quality or rework claims.
- Deterministic frontmatter/link/SSOT checks are narrow and frequent.
- Polling and state-change reporting are low-complexity, high-volume work.

Global Codex defaults live in `codex/config.toml.example`. Direct roles pin
their own exceptions in TOML rather than inheriting those defaults. Escalate
only when the acceptance contract or observed retries justify it, and
calculate accepted outcome cost across parallel calls rather than comparing
one-call prices.

Routing (which role for which work shape) is the `execution-policy` §Implementation dispatch table — see it, do not restate it here.

## Master cost rules

1. **Cheapest passing model.** Route to the cheapest model expected to pass the acceptance criteria — not the most capable available.
2. **Accepted-outcome cost, not single-call price.** Weigh the total cost to a passing result (retries and subagent calls included), not the sticker price of one call. A cheap model that loops can cost more than one stronger pass.
3. **Gather breadth cheaply, reason expensively (situational — not a dhpk default).** In principle, for broad discovery a read-only cheap pass (`Explore` / `fast-worker`-tier) can compress evidence into a packet the expensive tier then judges, rather than sending the expensive tier to read raw breadth. **A dhpk pilot A/B (2026-07) did not confirm a net saving:** the opus reasoner already bulk-extracts breadth efficiently (~3 tool calls for 58 files), so inserting a separate gather pass raised weighted cost on both a moderate- and a broad-discovery task (opus tokens fell 37–51%, but the sonnet gather's 2× weight more than offset it). Treat gather-first as a judgment call reserved for cases where the expensive tier would otherwise ingest genuinely large raw content it cannot compress cheaply itself — not a standing default.
4. **Effort de-escalation.** `effort` is a token lever independent of tier: run the decision/design layer at higher effort, de-escalate execution once the decision settles, and never default execution to maximum. Per-role effort is carried by the `:<effort>` suffix of `reasoner_target` / `worker_target`. For an ordinary dispatch (not the rule 5 or rule 6 escalations), set a per-dispatch `effort` on the `Agent` call before changing that dispatch's model — e.g. `low` for routine git/deploy-state or lookup Explore runs, and `medium` for a reasoner call that answers one settled question (overriding the configured `reasoner_target` effort).
5. **Reviewer escalation is up-only.** Reviewers hold the sonnet floor (`doc-reviewer` haiku); raise a single dispatch to opus only for a HIGH-risk diff (`security-reviewer` on auth/crypto/money/upload, `migration-reviewer` on a multi-tenant high-volume schema change). Never tier a reviewer down.
6. **Raise a churning worker's tier.** When a `fast-worker` dispatch churns toward its 3-attempt stop, the orchestrator MAY raise that single dispatch one tier via the `Agent` call `model` param — the same mechanism as the HIGH-risk reviewer escalation — instead of only re-dispatching `deep-reasoner`. One stronger pass beats repeated retries (rule 2).
7. **Escalation order.** When a worker's output fails: (1) first confirm the worker can verify its own output (a runnable check, test, or diff); without that, escalation only buys a more confident wrong answer; (2) raise `effort` one level on the same model; (3) only then move to the next model tier, starting at a lower effort than the smaller model used. Rule 6 is the worker-churn case of this order.
8. **Low-first.** For work with an automatic pass/fail check, run the first pass at `low` effort and re-run only the failures at a higher effort, following rule 7. Do not default to high effort for the whole batch.

Compare configured role models and effort against this map when reviewing cost posture. The dedicated governance budget audit and prompt-optimization skill are retired; this guidance remains the economics owner.
