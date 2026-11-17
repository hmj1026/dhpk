# Claude plugin provision gates project bindings

Status: accepted

## Context

[ADR-0024](0024-current-plugin-distribution-and-unique-discovery.md) requires
one discovery path per Skill Identity. A consumer project that has the official
Claude plugin `dhpk@dhpk` enabled and also receives the project-local
projection sees the same skill twice: once from the plugin and once from the
receipt-owned `.claude/skills/<name>` binding. Issue
[#1464](https://github.com/hmj1026/dhpk/issues/1464) asks the project route to
stop publishing the duplicate binding when the plugin provides it, and to
restore the binding when the plugin is disabled or absent.

Two facts decide the design. Both were observed with Claude Code 2.1.326 and
are not guaranteed by Host documentation.

- `claude plugin list --json` reports an `enabled` value per record. That value
  is the effective state for the current working directory: project and local
  `enabledPlugins` settings flip it for every `dhpk@dhpk` record, including
  records installed for other projects. The Host does not document this, so the
  design runs the command in the project root and never reads settings files.
- The Host offers no structured list of the skills a plugin contains.
  `claude plugin details` prints text only, offers no `--json`, and lists
  commands among skills.

## Decision

The effective state and the provided identities come from two sources, joined
by stable ID rather than by name (`tdd` is published as `skills/tdd-workflow`).

1. State: `claude plugin list --json` run with the real project root as the
   working directory. Only `dhpk@dhpk` records matter. A record applies when its
   scope is `user` or `managed`, or when it is `project` or `local` and its
   `projectPath` contains the project root. `ENABLED` requires every applicable
   record to be enabled with no load errors; all disabled is `DISABLED`; no
   applicable record is `NOT_APPLICABLE`; no record at all is `ABSENT`. A
   malformed record, an unknown scope, mixed `enabled` values or load errors is
   `UNKNOWN`, and a malformed match outranks an enabled one.
2. Identities: the hash-verified catalog `provenance.json` (schema
   `dhpk.claude-marketplace-catalog.v1`, shipped from plugin 0.69.0) in the
   install root the Host reports (`installPath`, and `readFromFolder` when
   present). Each provided stable ID needs exactly one `entry` file at
   `skills/<name>/SKILL.md` whose SHA-256 matches the physical file, the plugin
   manifest must name `dhpk`, match the record version and declare no `skills`
   field, and the physical `skills/*/SKILL.md` set must equal the catalog's.
   Every root of every enabled record must yield the same identity set. The
   directory listing only proves consistency; it is never the source.

The catalog is a premise, not a Host guarantee: it holds only while dhpk keeps
generating `provenance.json` and the Host keeps loading the default `skills/`
root. Any mismatch is `UNKNOWN`, never `ENABLED`.

Policy lives in pure functions of `project-agent-host-binding-policy`; Host I/O
lives only in `claude-plugin-provision`; the publisher receives the result as
an injected `claudePluginProvision` option and spawns nothing.

- `ENABLED`: a selected skill whose stable ID the plugin provides keeps its
  selection, its portable artifact and its Claude sibling, loses only its
  `.claude/skills/<name>` binding, and its receipt entry is marked
  `claudePluginProvided: true`. `hostBindings.claude.pluginProvision` records
  the plugin version and catalog digest while a withdrawal exists, with no
  timestamp. Module entities are never matched.
- `DISABLED`, `NOT_APPLICABLE`, `ABSENT`, `INACTIVE` (override only): publish
  every binding and restore earlier withdrawals through the normal collision
  and adoption rules.
- `CLI_NOT_INSTALLED`: like `ABSENT` unless the previous receipt records a
  withdrawal, then like `UNKNOWN`.
- `UNKNOWN`: carry the previous withdrawals forward, delete and restore nothing,
  and block with `CLAUDE_PLUGIN_STATE_UNKNOWN` if the candidate would add a
  Claude binding path the previous receipt did not own. No write happens.
- No provision supplied (Codex and Cursor installers, which never probe): carry
  forward and never block, so those installers cannot rebuild a withdrawn link.

A same name under a different stable ID (`SAME_NAME_DIFFERENT_IDENTITY`) is
published and reported, not blocked. The reasons: the plugin and the project
then expose different identities, and blocking would stop unrelated work.

The receipt stays schema v3 and `GENERATOR_VERSION` stays 2.1.0; the two new
fields are optional. Receipts without them read as "no withdrawals". An older
dhpk reading a receipt with a withdrawal fails closed with `INVALID_RECEIPT`
because its Claude binding set no longer matches, and deletes nothing. The
portable manifest omits the flag so the portable tree is identical in every
state. Withdrawal reuses the existing ownership checks: a retargeted or replaced
link blocks the run, a missing link is accepted, and an unowned entry at the
path is preserved and reported. `--rollback` restores the snapshot exactly, so
it may rebuild a link the plugin duplicates until the next Claude-targeted run.

`--claude-plugin-state auto|inactive` (environment
`DHPK_CLAUDE_PLUGIN_STATE`, flag first) controls the CLI; `inactive` skips the
probe. The probe is bounded (30 s by default, `DHPK_CLAUDE_PROBE_TIMEOUT_MS`)
and runs only when the install targets Claude.

## Considered options

- Rejected: reading `.claude/settings*.json` ourselves. It duplicates the
  Host's precedence rules and misses managed scope.
- Rejected: taking the identity list from the physical `skills/` directory
  names. Names are not stable IDs, and a drifted directory would silently
  change what is withdrawn.
- Rejected: deleting project bindings on `UNKNOWN`. A transient CLI failure must
  not remove a working discovery path.
- Rejected: a new receipt schema version. The fields are optional and old
  readers already fail closed.

## Consequences

Plugins older than 0.69.0 have no catalog: with the plugin enabled, a fresh
project install blocks and an existing project carries forward unchanged. The
reported `enabled` semantics and the choice between `installPath` and
`readFromFolder` rest on observation of one Host version; a development
checkout installed as a directory source with unsynchronized changes yields
`UNKNOWN`. Fixture tests lock the parsing, not the Host, so re-observe the
behavior when the Claude CLI changes. A release consumer gate check on a real
Host remains a follow-up. `claude-user-config-probe` classifies plugin records
separately; sharing the classifier is a later cleanup.
