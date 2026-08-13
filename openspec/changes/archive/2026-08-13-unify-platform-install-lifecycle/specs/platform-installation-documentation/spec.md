## MODIFIED Requirements

### Requirement: One bilingual installation guide is the documentation SSOT

The project SHALL maintain `docs/platform-installation.md` and
`docs/platform-installation.zh-TW.md` as the canonical installation and
operations guides for Claude, Codex, Agent Plugin, and Cursor. The guides
SHALL document the unified `dhpk-install <surface> <action>` lifecycle,
surface-specific scopes/options, receipts, ownership, staging, rollback, and
consumer evidence while retaining client-specific routes. Every README or
explanatory document that mentions Codex, Cursor, plugin installation,
marketplace publication, update, or rollback SHALL either contain only
surface-specific context or link to the relevant canonical section. No
secondary document may publish a contradictory command list.

#### Scenario: A user starts from the root README

- **WHEN** a user follows the Codex or Cursor installation link in `README.md`
  or `README.zh-TW.md`
- **THEN** the link reaches the canonical guide and the user can identify the
  exact `dhpk-install` surface/action, project-scope where applicable,
  prerequisites, install route,
  verification, update, and rollback steps

#### Scenario: A package README has surface-specific instructions

- **WHEN** `plugins/dhpk/README*`, `plugins/dhpk-agent/README*`, or
  `plugins/dhpk-cursor/README*` describes installation
- **THEN** it names only its own surface, links to the canonical guide, and
  does not imply that a static manifest or local receipt proves runtime
  support

#### Scenario: A user chooses Cursor profiles

- **WHEN** a user reads the Cursor lifecycle section
- **THEN** it documents the 66 portable skills at `.agents/skills`, native
  agent profiles at `.cursor/agents`, repeatable `--agent` additions, and the
  atomic rollback boundary

### Requirement: Codex installation paths are explicit and evidence-scoped

The canonical guide SHALL document `dhpk-install codex-sync`,
`dhpk-install codex-native`, and `dhpk-install agent-plugin` lifecycle routes
as distinct surfaces, while retaining three distinct Codex-related routes:
Supported project-local sync through `install-codex-skills.sh`; retained
legacy/native marketplace installation through the verified `codex plugin`
route; and the standard Agent Plugin package as a separate interoperability
artifact whose Codex install command remains `BLOCKED` or `UNAVAILABLE` until
a real client probe proves it. Each route SHALL document prerequisites, exact
command syntax, copy/symlink and receipt behavior, update/uninstall/rollback,
discovery verification, and the support tier. The 15-entry `codex-native`
subset SHALL never be documented as the portable Agent Plugin or Cursor
selection.

For project-local sync, the guide SHALL show both supported invocation forms:
`bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh` from a standalone
checkout and `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"`
when executed inside the Claude plugin runtime. The guide SHALL explain that
the script resolves its own checkout root when `CLAUDE_PLUGIN_ROOT` is absent.

#### Scenario: Project-local Codex setup is documented

- **WHEN** a user selects the Supported Codex route
- **THEN** the guide gives the project-root command, the unified lifecycle
  equivalent, `--copy`, `--update`, `--migrate`, `--uninstall`, guarded
  `--force`, schema-v3 receipt, collision-preservation, verification, and
  rollback instructions

#### Scenario: Native Codex CLI is unavailable

- **WHEN** the user cannot run the real `codex` CLI or the marketplace route is
  not supported by that version
- **THEN** the guide marks the native result `UNAVAILABLE`/`BLOCKED`, keeps the
  project-local sync fallback visible, and does not claim installation success

#### Scenario: Static standard package is mistaken for Codex runtime support

- **WHEN** `plugins/dhpk-agent/plugin.json` passes schema validation but no
  Codex consumer probe has run
- **THEN** the guide reports structural conformance separately and does not
  publish an unverified Codex install command as Supported

### Requirement: Cursor standard and Cursor-native installation are separate

The canonical guide SHALL document the unified Cursor project-scope bundle and both package
artifacts: installing the root `plugin.json` Agent Plugin (`dhpk-agent`) for
portable skills/MCP and installing the `.cursor-plugin/plugin.json` Cursor
Plugin (`dhpk-cursor`) for rules, agents, commands, hooks, and variables. The
marketplace and `--plugin-dir` route SHALL require both artifacts. The native
route SHALL state that its default portable store is the 66-skill
`.agents/skills` projection and that native agents are selected into
`.cursor/agents` by the inventory-owned `core`, `extended`, or `full` profile;
repeatable `--agent` additions SHALL be documented. Materialization failure
of either root SHALL roll back both. Each route SHALL include local
development from `~/.cursor/plugins/local`, reload/update/remove behavior,
marketplace or `.cursor-plugin/marketplace.json` discovery where applicable,
component verification, and the boundary between portable and native
support.

The canonical status taxonomy SHALL be shared by all installation sections:
`PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`,
and `UNAVAILABLE`, with `INSTALL_PASS + CONSUMER_BLOCKED` documented as a
non-PASS aggregate. Definitions SHALL distinguish a failed applicable check,
an unexecuted check, an absent configuration, a policy-backed
incompatibility, unavailable tooling, and a client-blocked observation.

#### Scenario: Cursor loads the portable package locally

- **WHEN** the user places `plugins/dhpk-agent/` under
  `~/.cursor/plugins/local/dhpk-agent` and reloads Cursor
- **THEN** the guide tells the user how to verify discovered portable
  skills/MCP and states that Cursor-native agents/components require
  `dhpk-cursor`

#### Scenario: Cursor-native package is configured

- **WHEN** the user loads `plugins/dhpk-cursor/` locally or from a reviewed
  marketplace source
- **THEN** the guide covers `.cursor-plugin/plugin.json`, both package
  identities, profile selection, component discovery, variable configuration
  without committed secrets, hook safety, refresh, update, remove, shared
  skill ownership, and Cursor-owned rollback

#### Scenario: Cursor materialization fails in one root

- **WHEN** one portable skill or native agent cannot be materialized during a
  unified Cursor install
- **THEN** the guide states that both `.agents/skills` and `.cursor/agents`
  roll back and the result is not PASS

### Requirement: Installation docs disclose prerequisites and status vocabulary

Every installation section SHALL list required client/version/OS/tooling
assumptions, the exact `dhpk-install` command or UI observation, the receipt
and ownership evidence, and the meaning of `PASS`, `INSTALL_PASS`,
`CONSUMER_BLOCKED`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`,
`BLOCKED`, and `UNAVAILABLE`. A package manifest, marketplace listing,
receipt, or generated file alone SHALL never be described as a runtime
consumer proof.

#### Scenario: Cursor is not installed on the maintainer host

- **WHEN** documentation is updated without a live Cursor consumer probe
- **THEN** the release evidence records the structural/package result and
  `NOT_RUN`/`UNAVAILABLE` consumer status with a rerun case, without promoting
  the support tier

#### Scenario: Installation command changes upstream

- **WHEN** a Codex or Cursor client changes its CLI/UI install route
- **THEN** maintainers update the canonical guide first, update linked package
  READMEs, and fail the documentation drift check until all references agree

### Requirement: Documentation updates are tested as a cross-file contract

The documentation gate SHALL scan all named README, docs, Codex, package, and
marketplace files for canonical-guide links, stale `dhpk-install` or legacy
install commands, broken relative links, bilingual section parity, and
unsupported support claims. The gate SHALL report the affected surface and
file rather than silently accepting drift.

#### Scenario: A secondary guide keeps an obsolete command

- **WHEN** `docs/basic-operations.md` retains a stale Codex or Cursor install
  command after the canonical guide changes
- **THEN** the documentation gate fails and names the stale file, surface, and
  canonical replacement section

#### Scenario: All explanatory files link to the SSOT

- **WHEN** every affected document has current surface-specific instructions or
  a canonical-guide link and both language variants agree
- **THEN** the documentation gate passes its cross-file consistency checks

## ADDED Requirements

### Requirement: Explicit-only lifecycle actions are documented as human commands

The canonical guides SHALL identify install, update, uninstall, rollback,
publication, and other high-authority lifecycle actions as explicit-only. They
MAY show the exact human `dhpk-install <surface> <action>` syntax, but SHALL
not instruct a model or advisory hook to invoke those actions implicitly.

#### Scenario: A user reads an advisory install suggestion

- **WHEN** an explanatory document recommends installing a platform
- **THEN** it links to the exact lifecycle command and confirmation/evidence
  requirements without claiming that a model-invoked skill performed it
