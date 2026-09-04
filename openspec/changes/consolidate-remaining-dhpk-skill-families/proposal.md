## Why

The remaining DHPK skill catalog still exposes narrow, overlapping skills and
host-specific invocation hints that are not discoverable in Codex. Consolidate
the durable behavior behind fewer owners, make the workflow boundary legible,
and give every Codex-invokable skill one generated usage contract before the
catalog grows further.

## What Changes

- **BREAKING** retire 21 stable skill identities without discovery aliases:
  eleven deprecated Laravel/PHPUnit version aliases, five harness skills,
  `agy-commit`, `feasibility-study`, `tech-spec`, `create-request`, and
  `op-session`.
- Preserve `git-smart-commit` unchanged as the commit-grouping owner and route
  retired `agy-commit` callers to it without retaining AGY delegation.
- Rename the active Laravel and PHPUnit family public names to `laravel` and
  `phpunit` while preserving their stable IDs and selector behavior.
- Add the explicit-only `harness-govern` family with `health`, `budget`,
  `fill`, `revise`, and `sync` modes.
- **BREAKING** move deterministic routing into `flow-guide`, replace its public
  modes with `route`, `rules`, `next`, and `close`, and add a read-only `help`
  metadata action. Make `flow-drive` a mode-free explicit implementation entry
  for confirmed specifications.
- Retire the proposed `flow-drive:author` interface. Route OpenSpec authoring to
  `openspec-propose` and preserve the useful legacy spec/request checks in one
  project-owned OpenSpec authoring policy.
- Add an inventory-owned usage schema for every Codex-invokable skill and
  generate Codex help cards, OpenAI default prompts, Claude argument hints,
  documentation tables, and validation from that source.
- Add `flow-guide` to the Codex sync and native projections so documented help
  and routing are actually discoverable in a fresh Codex consumer.

## Capabilities

### New Capabilities

- `skill-usage-discovery`: Defines the machine-readable invocation contract,
  generated usage cards, help behavior, and cross-host projection rules.

### Modified Capabilities

- `skill-capability-families`: Expands portable families and changes Flow family
  ownership and modes.
- `skill-retirement-migration`: Adds the closed 21-identity retirement wave,
  public-name diagnostics, external/operator replacements, and rollback rules.
- `skill-invocation-policy`: Defines the authority boundary for Flow help,
  routing, and mode-free implementation.
- `skill-routing-guidance`: Moves the deterministic route owner to
  `flow-guide` and updates successor routes.
- `capability-bundle-selection`: Updates family membership and exact profile
  selections after consolidation.
- `codex-projection-adoption`: Publishes `flow-guide` and generated usage help
  on the Codex subset.
- `codex-skill-metadata-parity`: Generates supported OpenAI metadata from the
  inventory usage contract without adding unsupported fields.
- `distribution-projection-contract`: Carries usage artifacts and renamed
  family packages through deterministic projections.
- `distribution-projection-parity`: Requires every selected surface to match
  the inventory-owned identities, usage metadata, and retirement closure.
- `skill-discovery-context-budget`: Recomputes static catalog counts and keeps
  detailed help behind progressive disclosure.

## Impact

The change affects canonical skill packages, distribution inventory and
validators, routing scripts and schemas, generated Claude/Codex/Cursor/AGY
packages, installers and receipts, OpenSpec authoring guidance, documentation,
and tests. It intentionally changes public Flow invocation syntax and removes
deprecated skill identities; release `0.53.0` remains the rollback pin for the
target `0.54.0` migration. External GitNexus packages, internal CLI runtime
packages, merge authority, publication, and release execution are out of scope.
