# platform-installation-documentation Specification

## Applicability policy (#848/#854)

The applicable installation, structural, and package contract is the default
acceptance boundary. Native workflow, rendered discovery, context measurement,
and full Host observation are required only for an affected integration,
activation defect, or explicit native request. Required failures remain
blocking; excluded or historical `NOT_RUN`, `UNAVAILABLE`, and `BLOCKED` results
remain visible and are never synthesized as `PASS`. Ownership, compatibility,
coexistence, rollback, publication, and manual authorization requirements remain
in force.

## Purpose

Define the bilingual installation documentation source of truth for supported Host routes, compatibility procedures, consumer validation, and unpublished marketplace preparation.

## Requirements

### Requirement: One bilingual installation guide is the documentation SSOT

The project SHALL maintain `docs/platform-installation.md` and
`docs/platform-installation.zh-TW.md` as the canonical installation and
operations guides for Codex and Cursor. Every README or explanatory document
that mentions Codex, Cursor, plugin installation, marketplace publication,
update, or rollback SHALL either contain only surface-specific context or link
to the relevant canonical section. No secondary document may publish a
contradictory command list.

#### Scenario: A user starts from the root README

- **WHEN** a user follows the Codex or Cursor installation link in
  `README.md` or `README.zh-TW.md`
- **THEN** the link reaches the canonical guide and the user can identify the
  exact surface, prerequisites, install route, verification, update, and
  rollback steps

#### Scenario: A package README has surface-specific instructions

- **WHEN** `plugins/dhpk/README*`, `plugins/dhpk-agent/README*`, or
  `plugins/dhpk-cursor/README*` describes installation
- **THEN** it names only its own surface, links to the canonical guide, and
  does not imply that a static manifest proves runtime support

### Requirement: Claude clean installation selects the common collection

The bilingual installation guide SHALL document `bash scripts/install.sh` as
the recommended Claude clean-install route and identify the existing
`dhpk@dhpk` marketplace plugin as the main installation. Its default selection
SHALL be the 15 public entries in `common`. The guide SHALL state that
`minimal`, `full`, and `compat-v1` are not public selection choices and
that the retired public `--profile` option is rejected. It SHALL keep structural
generation evidence separate from fresh-session consumer discovery.

A receipt that names a retired profile SHALL retain its exact stored selection
metadata, including retired IDs, for read-only plan, uninstall, and recovery.
Updating such a receipt SHALL return `BLOCKED` before filesystem mutation.
Current common receipts and the existing unannotated structural route SHALL
retain their ordinary receipt-owned update behavior. Retired selections SHALL
not be automatically migrated or materialized.

#### Scenario: Claude clean install is documented

- **WHEN** a user follows the recommended Claude route
- **THEN** the guide identifies `dhpk@dhpk`, the common 15-entry selection, dry-run, install, and fresh-session verification
- **AND** unobserved runtime evidence remains `NOT_RUN`

#### Scenario: A historical named-profile receipt is inspected or removed

- **WHEN** plan, uninstall, or recovery reads a receipt with a retired named profile
- **THEN** it preserves the exact stored IDs and metadata, including retired IDs, without materializing them

#### Scenario: An update targets a historical named-profile receipt

- **WHEN** update encounters a receipt for a retired named profile
- **THEN** it returns `BLOCKED` before any filesystem mutation

#### Scenario: Generic distribution writer is unavailable

- **WHEN** a reader looks for a generic `dhpk-install` write path
- **THEN** the guide marks it `BLOCKED` and `NOT_IMPLEMENTED` and routes to host-specific adapters

### Requirement: Codex installation paths are explicit and evidence-scoped

The canonical guide SHALL document three distinct Codex-related routes:
Supported project-local sync through `install-codex-skills.sh`; retained
legacy/native marketplace installation through the verified `codex plugin`
route; and the standard Agent Plugin package as a separate interoperability
artifact whose Codex install command remains `BLOCKED` or `UNAVAILABLE` until
a real client probe proves it. Each route SHALL document prerequisites, exact
command syntax, copy/symlink and receipt behavior, update/uninstall/rollback,
discovery verification, and the support tier.

A new project-local sync install SHALL use the 15-entry `common` selection.
The guides SHALL state that retired public profile choices and the public
`--profile` option are unavailable. Historical named-profile receipts SHALL
retain exact stored IDs and metadata, including retired IDs, for read-only plan,
uninstall, and recovery; update SHALL return `BLOCKED` before mutation for
those receipts. Current common receipts and the existing unannotated structural
route SHALL retain their ordinary receipt-owned update behavior. No automatic
profile migration or retired-ID materialization is allowed.

Project-local sync SHALL use hybrid materialization: skills and supporting
assets follow the selected top-level symlink/copy mode, while agent TOMLs are
always physical files. The guides SHALL direct current common and unannotated
structural receipts to ordinary `--update` and distinguish installation,
discovery, and named-role runtime evidence. They SHALL retain existing
`--migrate` guidance for structural receipt migration, but SHALL NOT present it
as a way to change a retired profile selection.

For project-local sync, the guide SHALL show both supported invocation forms:
`bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh` from a standalone
checkout and `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"`
when executed inside the Claude plugin runtime. The guide SHALL explain that the
script resolves its own checkout root when `CLAUDE_PLUGIN_ROOT` is absent.

#### Scenario: Project-local Codex setup is documented

- **WHEN** a user selects the Supported Codex route
- **THEN** the guide gives the project-root command, `--copy`, `--update`,
  structural `--migrate`, `--uninstall`, guarded `--force`, schema-v3
  receipt, collision-preservation, verification, and rollback instructions

#### Scenario: Historical named-profile receipt remains readable

- **WHEN** plan, uninstall, or recovery reads a receipt from a retired named-profile install
- **THEN** it preserves the exact stored IDs and metadata, including retired IDs, without recreating those IDs

#### Scenario: Historical named-profile update is blocked

- **WHEN** update targets a receipt from a retired named-profile install
- **THEN** it returns `BLOCKED` before any filesystem mutation

#### Scenario: Existing unannotated structural receipt updates safely

- **WHEN** an operator runs ordinary `--update` for the existing unannotated structural route
- **THEN** the guide preserves the current receipt-owned update and collision-handling instructions

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

#### Scenario: Existing symlink consumer updates safely

- **WHEN** an operator updates a current common or unannotated receipt-owned project-local Codex projection
- **THEN** the guide directs them to ordinary `--update`, explains that managed
  agent links become physical files, and retains collision/adoption guidance

#### Scenario: Runtime has not been observed

- **WHEN** installer and static validation pass but no named-role probe ran
- **THEN** the guide labels runtime `NOT_RUN` rather than claiming PASS

### Requirement: Cursor standard and Cursor-native installation are separate

The canonical guide SHALL document both Cursor routes: installing the root
`plugin.json` Agent Plugin for portable skills/MCP, and installing the
`.cursor-plugin/plugin.json` Cursor Plugin for rules, agents, commands, hooks,
and variables. The native route SHALL state that it reuses the standard
package's portable skill store by default and only carries skills/MCP when an
explicit environment-specific overlay is selected. Each route SHALL include local development from
`~/.cursor/plugins/local`, reload/update/remove behavior, marketplace or
`.cursor-plugin/marketplace.json` discovery where applicable, component
verification, and the boundary between portable and native support.

The canonical status taxonomy SHALL be shared by all installation sections:
`PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`,
and `UNAVAILABLE`. Definitions SHALL distinguish a failed applicable check,
an unexecuted check, an absent configuration, a policy-backed incompatibility,
and unavailable tooling.

#### Scenario: Cursor loads the portable package locally

- **WHEN** the user places `plugins/dhpk-agent/` under
  `~/.cursor/plugins/local/dhpk-agent` and reloads Cursor
- **THEN** the guide tells the user how to verify discovered skills/MCP and
  states that Cursor rules/agents/commands/hooks are not included in this path

#### Scenario: Cursor-native package is configured

- **WHEN** the user loads `plugins/dhpk-cursor/` locally or from a reviewed
  marketplace source
- **THEN** the guide covers `.cursor-plugin/plugin.json`, component discovery,
  variable configuration without committed secrets, hook safety, refresh,
  update, remove, shared-skill ownership, and Cursor-owned rollback

### Requirement: AGY installation and evidence boundaries are documented

The bilingual canonical guides SHALL document the inventory-owned AGY package,
its `~/.gemini/config/plugins/dhpk/` install/update/uninstall/rollback route,
receipt ownership and collision behavior, prerequisites, and exact structural
and consumer commands. The guides SHALL keep package validation, `agy plugins
list`, `agy agents`, and bounded read-only Subagent runtime evidence separate,
and SHALL use `UNAVAILABLE`/`NOT_RUN` rather than claiming runtime support when
the AGY CLI is absent or the probe was not executed.

#### Scenario: AGY package is installed without the CLI

- **WHEN** a maintainer validates and installs `plugins/dhpk-agy/` but `agy`
  is unavailable
- **THEN** the guide records structural evidence separately and labels consumer
  discovery `UNAVAILABLE` and runtime `NOT_RUN`

#### Scenario: AGY ownership collision is encountered

- **WHEN** a user-owned file collides with the receipt-owned AGY destination
- **THEN** the guide instructs the user to stop, preserve the file, and use
  rollback/uninstall only for matching AGY-owned fingerprints

### Requirement: Installation docs disclose prerequisites and status vocabulary

Every installation section SHALL list required client/version/OS/tooling
assumptions, the exact evidence command or UI observation, and the meaning of
`PASS`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, and
`UNAVAILABLE`. A package manifest, marketplace listing, receipt, or generated
file alone SHALL never be described as a runtime consumer proof.

#### Scenario: Cursor is not installed on the maintainer host

- **WHEN** documentation is updated without a live Cursor consumer probe
- **THEN** the release evidence records the structural/package result and
  `NOT_RUN`/`UNAVAILABLE` consumer status with a rerun case

#### Scenario: Installation command changes upstream

- **WHEN** a Codex or Cursor client changes its CLI/UI install route
- **THEN** maintainers update the canonical guide first, update linked package
  READMEs, and fail the documentation drift check until all references agree

### Requirement: Bilingual installation documentation receives human review

A change to an installation route or support claim SHALL update the canonical
English and Traditional Chinese guides together. A human reviewer SHALL check
that both guides describe the same current route, that secondary guides link to
the canonical guide, and that the changed links resolve. Automated checks MAY
validate link targets and file presence; they MUST NOT gate prose wording,
headings, examples, or line snapshots.

#### Scenario: An installation route changes

- **WHEN** a route, command, or support boundary changes in the canonical guide
- **THEN** a human review confirms equivalent English and Traditional Chinese guidance and checks affected cross-links

#### Scenario: A secondary guide keeps an obsolete route

- **WHEN** a secondary guide still links to an obsolete installation command after the canonical guide changes
- **THEN** the human documentation review identifies the affected file and canonical replacement section

#### Scenario: All explanatory files link to the SSOT

- **WHEN** affected documents have current surface-specific instructions or a canonical-guide link and both language variants agree
- **THEN** human review confirms the cross-file links and language parity

### Requirement: Marketplace preparation does not retire current installation routes

The bilingual guides SHALL distinguish the portable OpenAI submission candidate from a published daily installation route. They SHALL identify the candidate as unpublished until platform publication is verified, preserve current compatibility installation instructions, and disclose that the replacement cutover executor and legacy-route retirement remain unimplemented. Local developer installation and static package validation MUST NOT imply platform approval or publication.

#### Scenario: A consumer follows the guide before publication

- **WHEN** the candidate has not been published in the platform directory
- **THEN** the guide describes the preparation and developer route and retains current compatibility procedures without claiming the cutover has shipped
