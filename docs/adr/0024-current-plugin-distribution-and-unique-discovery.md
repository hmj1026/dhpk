# Current plugin distribution and unique skill discovery

Status: accepted design; builder tasks 6.1–6.3 delivered; full implementation and submission preparation remain pending

The user confirmed shared understanding of this scope on 2026-09-30.
The planning artifacts are in the local OpenSpec change
`prepare-marketplace-workflow-plugin`; confirmation does not mark its
implementation or consumer evidence complete.

The next dhpk requirement prepares a skills-only Public Plugin for Codex and
ChatGPT Work. The user chose current official packaging and installation over
maintaining parallel legacy routes, because legacy paths and duplicate skill
discovery make installation and the public catalog difficult to understand.
Claude Code, Cursor, and AGY retain their current supported integrations; each
Host's obsolete schemes are retired as part of the implementation plan.

## Current delivery and deferred work

The skills-only OpenAI package builder, complete-catalog ZIP validation, and
retained-Host catalog synchronization for tasks 6.1–6.3 were merged in PR #824
at `ae830ba1`. This delivers the package-generation slice; it does not establish
consumer cutover, fresh-session workflow acceptance, a final rendered-budget
result, platform approval, or public publication. Current candidate metadata
and the operator checklist are maintained in
[`docs/openai-submission.md`](../openai-submission.md).

The work items `4.2–4.5`, `4.8–4.9`, `5.1–5.5`, and `6.4` remain deferred until
after public publication, as agreed for this implementation sequence. A
one-time installation cutover executor is not shipped or promised by this
delivery. Optional role/custom-role distribution has separate plugin
acceptance and is outside the skills-only package.

Review Gate runtime, contracts, and receipts were retired by
[ADR-0026](0026-remove-review-gate.md). Deferred work must follow that decision
and must not restore the retired Review Gate lifecycle or artifacts.

## Settled decisions

- Use the current portable root `plugin.json` package format for the Public
  Plugin. Retire the legacy OpenAI manifest format and its executable
  compatibility paths. Local and repository marketplaces are Development
  Marketplaces, not alternative daily-use public distribution channels.
- Official plugin installation is the sole daily-use skill installation route
  for Codex and ChatGPT Work. Retire parallel project-local/global dhpk skill
  copy and sync installation routes for these Hosts. Other retained Hosts keep
  their current integrations and ownership boundaries.
- Review every active canonical skill for user-visible purpose, distinct
  value, overlap, effects, and actual Codex/Work execution evidence before
  selecting the public package. Existing native membership is not an automatic
  shipping list. Internal runtime resources are not public workflow entries.
- First-release Public Workflows expose general development tasks. Language,
  framework, and version knowledge is loaded as Specialist References when the
  task requires it, rather than shipped as a separate public entry for every
  stack. Required specialist behavior and version-specific safety guidance must
  retain an explicit owner and test coverage during any consolidation.
- Use six first-release task families to evaluate Public Workflow membership:
  requirements and planning, implementation and TDD, change review, code
  tracing/diagnosis, verification, and documentation maintenance. Final names
  and entry count follow overlap analysis and runtime evidence; six task
  families are not a quota of six skill directories. Commit, PR creation, and
  release do not become implicit completion actions.
- Apply the same general task catalog, public names, and conditional stack
  references to all retained Hosts. Any Host-specific public workflow must
  demonstrate a distinct need and execution contract.
- Review removal of `dhpk-` while preserving the remainder of existing names
  as the naming baseline. Present a candidate list before deciding broader
  task-oriented renames; names such as `plan-work` are proposals, not accepted
  replacements. Preserve Skill Identity when names change and retire old
  invokable aliases. Final names and third-party name collisions remain
  decisions for the skill selection review.
- Begin selection probes with seven existing public names: `flow-guide`,
  `flow-drive`, `tdd-workflow`, `change-verdict`, `code-trace`, `repo-verify`,
  and `update-docs`. This candidate set covers the six task families and keeps
  TDD independently accessible. It is an accepted validation starting point,
  not approval to ship seven entries without overlap and runtime evidence.
- Installation, update, and reinstall must expose each selected Skill Identity
  once in a Host and consumer context. Distinct capabilities competing for the
  same Public Skill Name are conflicts, not interchangeable skills.
- Automatically remove obsolete entries only when dhpk ownership and unchanged
  content are proven. Modified managed content, unowned entries, and third-party
  conflicts remain intact; report the conflict and stop activating the new
  installation within the supported cutover workflow. Removing one Host's
  entries must preserve shared content still required by another Host.
- Provide a one-time migration/preflight tool before first activation of the
  official plugin for existing installations. It checks receipt ownership,
  unchanged content, and competing discovery sources. This is a cutover tool,
  not a parallel daily OpenAI installation route or a legacy compatibility
  route. The skills-only ZIP has no documented preinstall mechanism to prevent
  a user from bypassing preflight and installing directly. Uniqueness and
  conflict blocking are guaranteed by the supported cutover workflow and its
  consumer acceptance evidence, not by every possible direct installation.
- Same-project coexistence of the retained Hosts is a required acceptance case.
  Updating or removing one Host must preserve the others' usable installations
  and must not expose duplicate entries on any affected Host. A shared source
  another Host uses is still a conflict if Codex automatically discovers it
  alongside the Public Plugin; removing only native links is not sufficient
  evidence of a complete cutover.
- Retained-Host directory skill content must live outside Codex's automatic
  discovery paths and be exposed through verified native Host bindings.
  Preserve receipt ownership while changing projection location. AGY's current
  flat Markdown output needs a separate consumer probe; its destination and
  visibility cannot be inferred from Claude/Cursor directory behavior.
- First-release workflows must execute using their bundled procedures and the
  current Host's native capabilities, without a prerequisite installation of
  extra dhpk agents, rules, or another plugin. Required independent review is
  preserved; a missing capability is an explicit blocker, never a fabricated
  PASS. Selection therefore depends on actual consumer execution evidence.
- CX, GitNexus, OpenSpec, and claude-mem are optional integrations. General
  workflows must have a native route in a new project without those tools.
  Explicit consumer-project instructions and genuine independent-review
  requirements remain authoritative; an optional integration cannot erase
  them or justify a false runtime PASS.
- Validate actual fresh-session discovery and selected workflows after a clean
  install and after replacement of an old installation. Static structure,
  package generation, and an installer success message do not prove uniqueness
  or usable runtime behavior.
- Resolve the agents, prompts, AGENTS guidance, model-selection and context-budget
  audit within this change, after test-consolidation acceptance and before final
  engineering acceptance. First classify each existing role/configuration as
  retained, adapted or retired; repair only surviving contracts and verify
  successors instead of rebuilding an obsolete OpenAI installer. Read-only
  reviewers return identity-bound evidence; contract-required persistence belongs
  to an authorized parent, and saving failure cannot create a review PASS. An
  advisory returned-evidence route gains no new filesystem-write obligation. Optional Codex
  custom-role support remains separate from the skills-only plugin. Every
  retained Host requires version-scoped model/tool/schema and context evidence;
  one Host's structural or budget PASS cannot establish another Host's runtime.
  Shipped Opus/Sonnet and Codex Sol defaults migrate to the current model lines
  (decided 2026-10-01; `haiku`/`fable` tiers and Luna stay as declared), and
  retained wording is calibrated to each selected line's official prompting
  guidance; neither rewrites user-owned or global configuration.
  The historical readiness audit and change plan remain local development
  records. The tracked [submission guide](../openai-submission.md) records the
  current candidate and publication boundary; change design/tasks own the
  repair order and checks.
- This requirement completes at engineering acceptance and submission
  preparation: a validated submission artifact, the agreed retirement/naming/
  discovery behavior, usable consumer workflow evidence, and submission
  materials. OpenAI approval and publication are tracked separately and are
  not required to close the engineering requirement. Preparing a package does
  not establish that platform scans or review have passed.
- Engineering handoff includes the ZIP, listing metadata, privacy/support and
  licensing materials, runtime evidence, and a submission operation checklist.
  Account identity verification, portal upload, platform scans, and actual
  submission are subsequent user-operated steps. Record each unexecuted step
  as NOT_RUN; they are outside engineering closure.

## Relationship to prior decisions

For the next OpenAI consumer distribution, this decision supersedes the Codex
project-sync support and parallel legacy publication choices in
[ADR-0003](0003-curate-dhpk-distribution-surfaces.md) and
[ADR-0006](0006-codex-native-publication-artifact.md), and the Codex skill-install
route in [ADR-0023](0023-native-installers-delegate-skills-to-the-shared-projection.md).
The shared projection ownership boundary in
[ADR-0019](0019-shared-project-projection-with-host-adapters.md) remains applicable
to the retained integrations. Its shared discovery location and the retained
Host binding topology in ADR-0023 must change where they expose directory
skills to Codex alongside the official plugin. This is not permission to remove
shared content another Host still owns or uses.

The broader public-name review replaces the limited naming scope of
[ADR-0022](0022-portable-command-skills-and-public-names.md); its stable identity,
self-containment, independent review, and foreign-content protections remain.
These supersessions describe the accepted next-version design, not a claim
that today's executable implementation or consumer installations have changed.

## Consequences and remaining decisions

This is a breaking distribution and naming change. Retirement includes obsolete
generators, adapters, installers, configuration, documentation, and tests whose
contracts have genuinely been removed; retained behavior still needs tests.
Historical Git revisions do not constitute a supported compatibility route.

Current public names and accepted membership are recorded in the
[marketplace catalog](../contracts/marketplace-catalog.md). Historical candidate
comparisons remain local development records; future naming changes still
require a recommendation list and selection evidence.
Catalog selection must also name the planning-authoring owner. Evaluate the
existing proposal capability while preserving `flow-guide` as a router, then
prove the native journey from a vague request through a plan, user confirmation,
implementation/TDD, independent review and verification. No additional public
entry count is implied.

The approved model-line migration does not settle every role's effort. Keep
`rules/model-economics.md` as the role-tier/effort economics SSOT, preserving
the existing catalog, Host Role Defaults and override precedence; benchmark task-class
effort candidates before assigning role defaults. Astra remains opt-in, and an
independent reviewer need not use a different model. Version/support evidence,
the precise submission preparation checklist, feasible discovery topology and
native review capability evidence remain architecture and verification work.
No implementation, consumer cutover, GitHub publication or marketplace
submission is authorized by recording this design slice.

## Official references

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
  distinguishes the portable root `plugin.json` layout, the legacy
  `.codex-plugin/plugin.json` layout, and public versus local distribution.
  Submission metadata for the selected portable format maps through
  `extensions.com.openai.interface`; verify that mapping against the current
  schema when building. Selecting portable-only is dhpk's decision; the legacy
  format remains documented but is not a required project route.
- [Submit and publish](https://developers.openai.com/plugins/deploy/submission)
  describes ZIP upload, review, publication, and current submission exclusions.
- [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)
  describes installed-plugin evaluation in a new conversation.
- [Build skills](https://learn.chatgpt.com/docs/build-skills) describes Codex's
  repository and user `.agents/skills` discovery and notes that same-name skills
  can both appear in selectors; it does not establish any current consumer's
  observed selector state.
