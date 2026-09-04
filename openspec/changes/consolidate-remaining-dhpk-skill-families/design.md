## Context

See `proposal.md` for motivation. The distribution inventory is the lifecycle,
surface, and selection source of truth; canonical `SKILL.md` files own behavior;
generated packages are projections. Codex can list skills but has no typed skill
argument schema, while the current Claude-only `argument-hint`, OpenAI
`default_prompt`, docs, and Flow parser have drifted apart. The current
`flow-guide` is also documented for Codex but absent from both Codex surfaces.

## Goals / Non-Goals

**Goals:**

- Cut over atomically to 65 canonical skills and nine portable families.
- Make routing read-only and local to `flow-guide`; make `flow-drive` mean only
  confirmed implementation.
- Preserve unique predecessor behavior behind one owner before deletion.
- Give every Codex-invokable skill one validated, progressively disclosed usage
  contract that generates host metadata and docs.
- Preserve receipt ownership, deterministic projection, and stage-honest runtime
  evidence.

**Non-Goals:**

- Rename or modify protected external GitNexus skills or internal CLI runtime
  packages.
- Change `git-smart-commit` identity or its confirmation boundary.
- Fork or rewrite the external OpenSpec skills.
- Merge, tag, publish, release, or claim consumer runtime evidence without a
  fresh exact-artifact probe.

## Decisions

### Inventory owns invocation grammar; skills own behavior

Each invokable skill selected by `codex-native` or `codex-sync` receives this
normalized inventory object:

```json
{
  "usage": {
    "display_name": "Public display name",
    "summary": "Short user-facing purpose",
    "syntax": "$public-name <input>",
    "input_kind": "mixed",
    "invocation_class": "explicit-only",
    "effect_authority": "workspace-write",
    "actions": [],
    "options": [],
    "examples": [{"prompt": "$public-name example", "summary": "Example"}]
  }
}
```

`input_kind` is one of `none`, `free-text`, `identifier`, `path`,
`action-first`, or `mixed`. Actions contain unique `id`, `summary`, `syntax`,
`input_kind`, and `effect_authority` fields. Options contain unique `id`, `syntax`,
`value_kind`, `required`, `summary`, and optional `default`, `enum_values`, and
`applies_to` fields. `invocation_class` is `implicit-eligible` or
`explicit-only` and must match the canonical invocation policy.
`effect_authority` is one of `read-only`, `delegate`, `workspace-write`,
`git-write`, or `external-write`; a child action cannot exceed its parent's
maximum effect authority, and git/external write requires an explicit-only
entry.
Syntax and every example start with the inventory public name. Non-Codex
entries may omit usage.

This object is intentionally limited to public grammar. Procedures, safety
rules, and completion criteria remain in `SKILL.md`, avoiding a second behavior
SSOT. Alternatives rejected: custom `openai.yaml` fields, which are unsupported;
and hand-maintained help text, which caused the current drift.

### Generated help is one disclosed catalog

A pure usage module validates, normalizes, and renders every output. A thin
`--check|--write` command compiles Codex-invokable records in public-name order
to `dhpk.skill-usage-catalog.v1`, consumed only by `flow-guide help`. The same
normalized records drive supported OpenAI display/description/default-prompt
values, Claude `argument-hint` projections when applicable, and dedicated
English/Traditional Chinese Codex usage documentation. Existing broad cheat
sheets link to the generated guide rather than being overwritten wholesale.

`$flow-guide help` lists available Codex skills; `$flow-guide help <skill>`
returns one card; an unknown or non-Codex identity returns a distinct diagnostic.
Help never invokes the target, loads target procedures, or grants authority.

### Flow ownership follows guide versus drive

Move the route table, route-result schema, parser, and deterministic matcher
from `flow-drive` to `flow-guide`. Cut the public result directly to
`dhpk.route-result.v3`. It is a closed object with required fields `schema`,
`action`, `host`, `cleanedQuery`, `options`, `target`, `availability`, `diagnostics`,
`disposition`, `requiredEvidence`, and `nextAction`. `options` is exactly
`{go: boolean}`. `target` is either `null` or exactly
`{id, publicName, invocationClass, command}`. `availability` is one of
`available`, `unavailable`, or `not-configured`; `diagnostics` and
`requiredEvidence` are string arrays; `disposition` is one of `advice`,
`ready`, `explicit-required`, `blocked`, or `unavailable`; and `nextAction` is
a string; `host` is `claude`, `cursor`, or `codex`. Unknown fields fail validation. Implementation backend options no
longer appear in a routing result. The public actions become `route`, `rules`,
`next`, and `close`; `help` is a metadata action rather than a workflow mode.
Former `classify` and `do/route` behavior converge at `route`, `policy` becomes
`rules`, and `checklist` becomes `close`.

`flow-guide` is an advisory owner whose normal actions are read-only. Its
maximum effect authority is `delegate` solely because `route --go` may produce
one bounded handoff to an implicit-eligible target. The guide never executes
the target, dispatches an explicit-only target, or inherits target authority.

`flow-drive` becomes a mode-free explicit-only workflow. Its input is a
confirmed specification or OpenSpec change identifier. It retains
implementation-only planner, worker, reasoner, and architecture controls.
`--codex` remains a blocking retirement diagnostic. Route-only, one-use
explicit-dispatch, and OpenSpec-authoring flags are removed or replaced by
`flow-guide route --go`; explicit-only targets still return
`explicit-required` rather than inheriting authority.

Alternative rejected: `flow-drive:propose`. OpenSpec already owns proposal,
design, delta-spec, and task authoring, so an adapter would duplicate a public
workflow and blur the implementation boundary.

### Legacy authoring knowledge becomes project policy

Move only the durable checks from `tech-spec` and `create-request` into one
project-owned OpenSpec authoring policy: requirement coverage, quantitative
split signals, traceability, acceptance criteria, risks, public test seams, and
completion evidence. Repo agent guidance points OpenSpec authoring at this
policy. Bespoke numbered feature/request document lifecycle and duplicated
templates are retired.

### Retirement and rename are alias-free

The 21 identities form a closed retirement set. `agy-commit` points to the
unchanged `git-smart-commit`; feasibility work points to
`software-architecture` compare mode; spec/request work points to the external
`openspec-propose` owner plus project policy; `op-session` points to the
non-invokable operator action `onepassword-cli/signin`; version and harness
predecessors point to their family selector/mode.

`laravel` and `phpunit` keep stable IDs while public names and canonical paths
lose the prefix. A separate non-discovery rename ledger produces diagnostics;
active `legacy_names` are not used for the old public names. Replacement kinds
gain `external-skill` and `operator-action`; neither creates an invokable package.

### Migration is inventory-first and projection-atomic

Tests establish the closed mappings, usage contract, and counts before source
changes. Successor content and routing land before predecessor deletion. The
inventory and normalized view update once, then every package/profile is
regenerated from that revision. Receipt reconciliation removes only unchanged
managed predecessors and preserves modified, retargeted, or unowned paths.

## Risks / Trade-offs

- **Breaking Flow syntax** → No aliases are emitted; retirement/rename
  diagnostics, generated usage cards, migration docs, and rollback `0.53.0`
  make the cutover explicit.
- **Large inventory edit can drift projections** → Mutation-canary tests,
  normalized usage fingerprints, generator `--check`, and full package parity
  fail before publication.
- **Moving routing can leave stale imports** → Move route tests with the owner,
  scan live references, and require zero references to the former paths before
  deleting them.
- **Usage metadata can duplicate skill prose** → Schema permits grammar only;
  validators reject missing identity/authority parity while review removes
  procedural duplication.
- **OpenSpec successor may be unavailable on a host** → External-owner
  diagnostics report availability and exact installation/invocation guidance;
  they never fabricate a local alias.
- **Static success may be overstated** → Structural, package, and consumer
  runtime gates retain independent evidence states.

## Migration Plan

1. Add RED tests for usage validation, help generation, Flow ownership, exact
   retirement/rename rows, and target counts.
2. Add usage validation/compiler and the deterministic usage projection
   generator; populate every resulting Codex-invokable entry.
3. Move routing artifacts and public actions to `flow-guide`; simplify
   `flow-drive`; add Codex surfaces for `flow-guide`.
4. Build `harness-govern`, rename the Laravel/PHPUnit family packages, and move
   legacy authoring/feasibility knowledge to the selected owners.
5. Update the inventory atomically, delete predecessor sources, regenerate all
   projections/profiles/provenance, and synchronize documentation.
6. Run focused, strict, full-suite, review, and exact consumer checks. Roll back
   by pinning release `0.53.0`; do not reconstruct aliases in `0.54.0`.
