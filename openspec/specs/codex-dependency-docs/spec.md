# codex-dependency-docs Specification

## Purpose
TBD - created by archiving change readme-doc-optimization. Update Purpose after archive.
## Requirements
### Requirement: Codex surfaces are documented per-surface with accurate dependencies

`README.md` SHALL document the Codex integration as four distinct surfaces in a single table — MCP-backed skills (5: `codex-architect`, `codex-brainstorm`, `codex-code-review`, `codex-explain`, `codex-implement`), the CLI-only skill (`codex-cli-review`, which shells out to the `codex` binary and needs no MCP server), the 7 MCP-backed `/dhpk:codex-*` commands, and the `CODEX=on` dispatch path — each row stating what the surface needs and what happens without it. No dhpk doc SHALL claim that 6 skills require the Codex MCP server. The table's mechanics statement MUST attribute the `mcp__codex__*` tools to direct `codex mcp-server` registration (see Requirement: Codex MCP server setup is documented accurately as direct registration), not to `openai/codex-plugin-cc`.

#### Scenario: Reader checks what codex-cli-review needs

- **WHEN** a reader consults the README Codex section for `codex-cli-review`
- **THEN** the table states it requires only the Codex CLI binary (Bash shell-out, no MCP server) and names a fallback (`codex-code-review` or the sentinel `code-reviewer`)

#### Scenario: Stale 6-skills claim is gone

- **WHEN** `grep -rn "6 .codex" README.md README.zh-TW.md docs/configuration.md docs/configuration.zh-TW.md` runs (and the zh-TW equivalent phrasing `6 個`)
- **THEN** no match asserts that 6 skills require the MCP server

#### Scenario: Commands dependency is visible

- **WHEN** a reader looks for whether `/dhpk:codex-security` needs the MCP server
- **THEN** the README table's commands row lists all 7 `/dhpk:codex-*` commands as MCP-backed with their Codex-free alternatives

### Requirement: Degradation behavior is stated honestly

The Codex section SHALL state that MCP-backed skills and commands fail with a tool-permission error when the upstream plugin is absent (no automatic fallback), SHALL map each Codex surface to its Codex-free counterpart (`security-review`, `code-explore`, sentinel reviewer agents, `create-dev` default path), and SHALL state that a missing `CODEX=on` dependency degrades silently to single-assistant dispatch.

#### Scenario: User without the Codex plugin reads the section

- **WHEN** a user who has not installed `openai/codex-plugin-cc` reads the Codex section
- **THEN** they learn invocation will surface a tool-permission error and which Codex-free counterpart to use instead

### Requirement: Requirements line appears at the point of install

`README.md` SHALL carry a one-line **Requirements** statement immediately after the Install code block, declaring Codex MCP optional, everything else Codex-free, and linking to the setup/verification anchor `docs/configuration.md#codex-mcp-dependency-not-a-userconfig-knob`.

#### Scenario: New user evaluates install cost

- **WHEN** a user reads the Install section top-to-bottom
- **THEN** before reaching any workflow content they see the Requirements line stating Codex MCP is optional, with a working link to the configuration doc anchor

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
- **THEN** the same four-surface Codex table, Requirements line, badge block, and CHANGELOG link are present, with links resolving to the zh-TW configuration doc anchor

### Requirement: Codex MCP server setup is documented accurately as direct registration

The README Codex table SHALL include a one-line statement naming the actual mechanism behind the `mcp__codex__codex` / `mcp__codex__codex-reply` tools: directly registering the Codex CLI's own `codex mcp-server` subcommand as an MCP server (e.g. `claude mcp add --transport stdio codex -- codex mcp-server`, or an equivalent manual `.mcp.json`/`.claude.json` entry). `docs/configuration.md` (and its zh-TW mirror) SHALL carry the full explanation — the `codex mcp-server` command, its two tools, and their configurable parameters — and SHALL document this registration as the setup step, not as an optional bypass of some other install method. No dhpk doc SHALL claim that installing `openai/codex-plugin-cc` registers an MCP server or otherwise provides the `mcp__codex__*` tools.

#### Scenario: Reader wants to understand what powers the codex-* skills' MCP tools

- **WHEN** a reader follows the README's one-line mechanics aside to `docs/configuration.md`
- **THEN** they find that `mcp__codex__codex` / `mcp__codex__codex-reply` come from registering `codex mcp-server` directly (not from `openai/codex-plugin-cc`), the two tools' names, and their configurable parameters (`approval-policy`, `sandbox`, `model`, `profile`, `cwd`)

#### Scenario: Reader sets up the Codex MCP dependency

- **WHEN** a reader wants the `codex-*` skills' MCP tools available
- **THEN** `docs/configuration.md` documents `claude mcp add --transport stdio codex -- codex mcp-server` (or equivalent manual config) as the setup step, `claude mcp list` to check status, and `/mcp` to verify inside a session — and does not present installing `openai/codex-plugin-cc` as sufficient for this

### Requirement: `openai/codex-plugin-cc` is documented as a separate, optional collaboration surface

`docs/configuration.md` (and its zh-TW mirror) SHALL document `openai/codex-plugin-cc` (installed via `/plugin install codex@openai-codex`) as a genuinely separate, optional integration from the Codex MCP server: it drives the Codex CLI's distinct `app-server` subcommand through its own broker scripts (`scripts/app-server-broker.mjs`, `scripts/codex-companion.mjs`), not `mcp-server`, providing slash commands (`/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:transfer`, `/codex:status`, `/codex:result`, `/codex:cancel`, `/codex:setup`), a `codex-rescue` subagent, background job polling, a `codex resume <session-id>` transfer mechanism, and an optional Stop-hook review gate. The doc SHALL state plainly that installing this plugin does not register an MCP server and does not satisfy the MCP dependency dhpk's `codex-*` skills require.

#### Scenario: Reader installs the plugin expecting it to satisfy the codex-* skills' MCP dependency

- **WHEN** a reader has installed `openai/codex-plugin-cc` via `/plugin install codex@openai-codex` but has not separately registered `codex mcp-server`
- **THEN** `docs/configuration.md` tells them the `mcp__codex__codex` tool is still unavailable, invoking a `codex-*` skill will surface a tool-permission error, and that the plugin and the MCP server registration are independent — a reader may have either, both, or neither installed

### Requirement: Release history is linked from the README body

`README.md` SHALL contain a real Markdown link to `CHANGELOG.md` in prose (not only inside the repo-layout code block).

#### Scenario: Reader looks for release history

- **WHEN** a reader searches the rendered README for release history
- **THEN** a clickable `CHANGELOG.md` link exists in the License (or equivalent footer) section
