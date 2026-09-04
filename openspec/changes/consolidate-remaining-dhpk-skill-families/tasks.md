## 1. Characterization and RED contracts

- [x] 1.1 Add closed-set tests for the 21 retirements, nine portable families,
  unchanged `git-smart-commit`, public-name rename ledger, exact canonical and
  profile counts; verify each mutation canary fails for the intended mismatch.
- [x] 1.2 Add usage-schema and catalog tests for every Codex-invokable skill,
  including invalid keys, duplicate IDs, option references/defaults, syntax,
  examples, invocation class, effect authority, deterministic ordering, and
  unknown help targets; verify
  the new suites are RED because the compiler and metadata are absent.
- [x] 1.3 Add Flow ownership and route-result-v3 tests for
  `help|route|rules|next|close`, `--go`, explicit-target refusal, removed modes
  and flags, and mode-free confirmed implementation; verify RED points to the
  former ownership and public contract rather than fixture failure.

## 2. Usage and Flow interfaces

- [x] 2.1 Implement and unit-test the pure usage
  validator/normalizer/renderer plus the fixture-driven core of one
  `--check|--write` generator; do not mutate the live inventory or projections
  in this wave.
- [x] 2.2 Implement the usage-card helper against generated-fixture catalogs,
  keep `openai.yaml` within supported fields, and verify help-list, detail,
  JSON, and unknown-target behavior without claiming live catalog parity.
- [x] 2.3 Move the route table, matcher, parser, and schema to `flow-guide`,
  implement route-result v3 and the new actions, simplify `flow-drive` to the
  confirmed-spec implementation entry, and verify old route paths and removed
  flags are absent while focused routing tests pass.

## 3. Capability consolidation and lifecycle

- [x] 3.1 Build explicit-only `harness-govern` with
  `health|budget|fill|revise|sync`, move each predecessor's unique references and
  scripts behind mode pointers, and verify every mode preserves its dry-run,
  output, and completion contract without loading sibling procedures.
- [x] 3.2 Rename the canonical Laravel/PHPUnit family paths and public names,
  retain stable IDs/selectors and standalone operation, and verify the eleven
  version predecessors are no longer projected or invokable aliases.
- [x] 3.3 Move quantitative feasibility guidance to
  `software-architecture:compare`, move durable spec/request checks to the
  project OpenSpec authoring policy, preserve
  `skills/dhpk-git-smart-commit/**` byte/contract identity, and verify all
  successor behavior before deleting the remaining
  predecessor packages.
- [x] 3.4 In one inventory revision, update the active inventory, every
  resulting Codex-invokable `usage` record, retirement and rename ledgers,
  profiles, modules, routes, and reference integrity; verify counts
  `65/9/56`, profiles `8/55/62`, shared surfaces `37`, and exact successor
  diagnostics with `0.54.0`/`0.53.0` lifecycle data.

## 4. Projection and documentation synchronization

- [ ] 4.1 Connect the single normalized usage/catalog identity to Claude,
  Codex native/sync, Cursor, Agent, and AGY projection compilers; then generate
  the live catalog, OpenAI metadata, argument hints, docs, packages, profiles,
  and provenance from the exact 3.4 inventory revision in one projection
  transaction. Verify byte parity, deterministic check mode, help behavior,
  and usage fingerprints without hand-editing generated copies.
- [x] 4.2 Add the accepted Flow/usage ownership ADR and synchronize agent
  guidance, execution policy pointers, English/Traditional-Chinese README,
  operation, migration, index, and Codex usage documents; verify generated
  sections, links, terminology, and historical-document boundaries.

## 5. Completion gates

- [ ] 5.1 Run focused suites, strict skill/distribution/OpenSpec validators,
  package/provenance checks, the complete bounded Node suite, whitespace checks,
  and `gitnexus_detect_changes`; record exact PASS/FAIL/NOT_RUN evidence.
- [ ] 5.2 Run one fresh Codex consumer probe for `/skills`,
  `$flow-guide help flow-drive`, routing, and mode-free `$flow-drive` when the
  executable/environment is configured; otherwise record the exact
  `NOT_CONFIGURED`, `UNAVAILABLE`, or `NOT_RUN` boundary.
- [ ] 5.3 Complete code, documentation, and security reviews, repair all
  blocking findings with focused re-verification, and mark the change ready for
  OpenSpec verify/archive and a conventional-commit Draft PR to `develop`
  without merging, tagging, publishing, or releasing.
