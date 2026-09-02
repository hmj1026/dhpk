# codex-dependency-docs Specification

## Purpose
TBD - created by archiving change readme-doc-optimization. Update Purpose after archive.

## Requirements

### Requirement: Codex surfaces are documented per-surface with accurate dependencies

`README.md` SHALL document the Codex integration as three distinct surfaces in a single table — the CLI-only `codex-code-review --backend cli` path (and its sibling CLI-backed roles: `codex-worker`, `codex-reasoner`, `codex-reviewer`, `dhpk-codex-bridge`), the external `openai/codex-plugin-cc` app-server plugin (`/codex:*` commands), and a historical note that Codex MCP (`mcp__codex__codex`/`mcp__codex__codex-reply`, `codex mcp-server`) was retired as of this change, with a pointer to the retirement ledger and the capability-parity matrix showing where each capability moved. No dhpk doc SHALL claim any active skill or command requires the Codex MCP server; the `CODEX=on` and `/dhpk:do --codex` legacy MCP-peer flags are documented as removed/replaced per their finalized deprecation plan, not silently reinterpreted.

#### Scenario: Reader checks what the CLI review backend needs

- **WHEN** a reader consults the README Codex section for `codex-code-review --backend cli`
- **THEN** the table states it requires only the Codex CLI binary (Bash shell-out, no MCP server) and names the Codex-free fallback

#### Scenario: Stale 6-skills claim is gone

- **WHEN** `grep -rn "6 .codex\|3 .codex\|9 .codex" README.md README.zh-TW.md docs/configuration.md docs/configuration.zh-TW.md` runs for any stale MCP-backed-skill-count phrasing
- **THEN** no match asserts any dhpk skill currently requires the Codex MCP server

#### Scenario: Commands dependency is visible

- **WHEN** a reader looks for whether `/dhpk:codex-security` needs the MCP server
- **THEN** the README table states this command's semantics were redirected to a backend-neutral skill with `--backend cli`, or documents its exact deprecation replacement, with no remaining MCP path

#### Scenario: Reader checks whether `CODEX=on` is still the recommended path

- **WHEN** a reader consults the README Codex section for `CODEX=on` or `/dhpk:do --codex`
- **THEN** the table states this is a legacy MCP-peer interface with a published deprecation-and-replacement plan, not silently reinterpreted as CLI `codex exec`, worker/reasoner dispatch, or the external plugin

### Requirement: Degradation behavior is stated honestly

The Codex section SHALL state that no current dhpk skill or command depends on or invokes Codex MCP; the retired MCP surface is historical-only and has no automatic fallback path. It SHALL map each current Codex surface to its supported CLI/app-server or Codex-free counterpart (`codex exec`, `openai/codex-plugin-cc`, `security-review`, `code-explore`, sentinel reviewer agents, `create-dev` default path), and SHALL state when a missing optional dependency leaves a capability unavailable or degraded.

#### Scenario: User without the Codex plugin reads the section

- **WHEN** a user who has not installed `openai/codex-plugin-cc` reads the Codex section
- **THEN** they learn that no current invocation relies on the retired MCP surface, which supported CLI/app-server or Codex-free counterpart to use, and that no automatic MCP fallback is available

### Requirement: Requirements line appears at the point of install

`README.md` SHALL carry a one-line **Requirements** statement immediately after the Install code block, declaring current dhpk capabilities Codex-MCP-free and linking to the historical/retirement note at `docs/configuration.md#codex-mcp-dependency-not-a-userconfig-knob`.

#### Scenario: New user evaluates install cost

- **WHEN** a user reads the Install section top-to-bottom
- **THEN** before reaching any workflow content they see the Requirements line stating current capabilities do not require Codex MCP, with a working link to the historical configuration note

### Requirement: Badge block renders live values

`README.md` SHALL carry a badge block directly under the H1 containing exactly four shields.io badges: License MIT (linking `./LICENSE`), version from GitHub tags with `sort=semver` (linking the tags page), CI workflow status for `ci.yml` on `main` (linking the workflow runs page), and a static Claude Code plugin badge (linking the plugins docs).

#### Scenario: Version badge reflects the latest release

- **WHEN** the badge block is rendered on GitHub after tag `v0.23.0`
- **THEN** the version badge displays `v0.23.0` (or a later semver tag) rather than a hardcoded value

#### Scenario: CI badge tracks the workflow

- **WHEN** the `CI` workflow on `main` is green
- **THEN** the CI badge shows a passing status and links to the `ci.yml` runs page

### Requirement: English and Traditional-Chinese docs stay in parity

Every change this capability introduces to `README.md` and `docs/configuration.md` SHALL be mirrored in `README.zh-TW.md` and `docs/configuration.zh-TW.md` within the same commit, with zh-TW anchors targeting the zh-TW configuration doc (`#codex-mcp-依賴並非-userconfig-旋鈕`).

#### Scenario: zh-TW reader gets the same table

- **WHEN** a reader opens `README.zh-TW.md` after the change lands
- **THEN** the same three-surface Codex table, retired-MCP historical note, Requirements line, badge block, and CHANGELOG link are present, with links resolving to the zh-TW configuration doc anchor

### Requirement: Codex MCP server setup is documented accurately as direct registration

`docs/configuration.md` (and its zh-TW mirror) SHALL retain, as historical reference only, the explanation of what `mcp__codex__codex`/`mcp__codex__codex-reply` were and how `codex mcp-server` registration worked, clearly labeled as retired and no longer required or recommended for any current dhpk capability. It SHALL NOT be presented as a current setup step.

#### Scenario: Reader wants to understand what powers the codex-* skills' MCP tools

- **WHEN** a reader follows the README's historical-note link to `docs/configuration.md`
- **THEN** they find that `mcp__codex__codex`/`mcp__codex__codex-reply` were provided by directly registering `codex mcp-server` (not by `openai/codex-plugin-cc`), with the two tools' names and configurable parameters (`approval-policy`, `sandbox`, `model`, `profile`, `cwd`), that this mechanism is retired, and a pointer to the parity matrix showing what replaced each capability

#### Scenario: Reader sets up the Codex MCP dependency

- **WHEN** a reader searches `docs/configuration.md` for how to set up the Codex MCP server for a current dhpk capability
- **THEN** they find no current setup instructions — only the historical note explaining the retired mechanism and pointers to the supported CLI (`codex exec`) and external-plugin (`openai/codex-plugin-cc`) alternatives

### Requirement: `openai/codex-plugin-cc` is documented as a separate, optional collaboration surface

`docs/configuration.md` (and its zh-TW mirror) SHALL document `openai/codex-plugin-cc` (installed via `/plugin install codex@openai-codex`) as a genuinely separate, optional integration from the retired Codex MCP mechanism: it drives the Codex CLI's distinct `app-server` subcommand through its own broker scripts (`scripts/app-server-broker.mjs`, `scripts/codex-companion.mjs`), not `mcp-server`, providing slash commands (`/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:transfer`, `/codex:status`, `/codex:result`, `/codex:cancel`, `/codex:setup`), a `codex-rescue` subagent, background job polling, a `codex resume <session-id>` transfer mechanism, and an optional Stop-hook review gate. The doc SHALL state plainly that installing this plugin does not register or revive the retired MCP server mechanism and remains an optional collaboration surface for current workflows.

#### Scenario: Reader installs the plugin expecting it to replace the retired MCP mechanism

- **WHEN** a reader has installed `openai/codex-plugin-cc` via `/plugin install codex@openai-codex` but has not separately registered `codex mcp-server`
- **THEN** `docs/configuration.md` tells them the `mcp__codex__codex` tool remains retired and unavailable as a current backend, that the app-server plugin is independent of the historical registration, and that no current dhpk skill requires either MCP setup or this optional plugin

### Requirement: Release history is linked from the README body

`README.md` SHALL contain a real Markdown link to `CHANGELOG.md` in prose (not only inside the repo-layout code block).

#### Scenario: Reader looks for release history

- **WHEN** a reader searches the rendered README for release history
- **THEN** a clickable `CHANGELOG.md` link exists in the License (or equivalent footer) section
