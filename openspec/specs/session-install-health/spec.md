# session-install-health Specification

## Purpose
TBD - created by archiving change add-session-install-health-gate. Update Purpose after archive.
## Requirements
### Requirement: Session-start install health gate is advisory and local

A SessionStart install-health gate SHALL evaluate plugin version freshness and project module configuration using only locally available state. It SHALL NOT perform network calls, SHALL NOT block the session (never exit 2), and SHALL degrade silently to a no-op when the state it reads is absent, unreadable, or unparseable. A failure inside the gate SHALL NOT fail the SessionStart hook.

#### Scenario: Missing plugin state degrades silently

- **WHEN** `~/.claude/plugins/installed_plugins.json` or `~/.claude/plugins/known_marketplaces.json` is absent, unreadable, or not valid JSON
- **THEN** the gate emits no version finding, raises no question, and the SessionStart hook still exits 0

#### Scenario: The gate never blocks

- **WHEN** the gate detects both a stale version and a contradicted module configuration
- **THEN** the session still starts normally and the hook exit code is 0

#### Scenario: No network access is attempted

- **WHEN** the gate evaluates version freshness
- **THEN** it reads only local files and issues no network request, so the result is identical on an offline machine

### Requirement: Version freshness is computed from local install and marketplace state

The gate SHALL determine the installed dhpk version from `~/.claude/plugins/installed_plugins.json`. The available version SHALL be resolved through the following chain: the marketplace that provides dhpk is looked up in `~/.claude/plugins/known_marketplaces.json` to find its `installLocation`; that location's `.claude-plugin/marketplace.json` is read; the entry in that file's `plugins` array whose `name` is `dhpk` is selected; that entry's `source` path is resolved relative to the marketplace location; and the resulting directory's `.claude-plugin/plugin.json` supplies the available `version`. A marketplace commonly lists many plugins — the entry MUST be selected by matching `name`, not merely by reading whatever plugin manifest a marketplace happens to contain.

#### Scenario: Installed version is behind the marketplace version

- **WHEN** the installed version is `0.28.17` and the marketplace's plugin manifest declares `0.29.0`
- **THEN** the gate reports the installed version, the available version, and the age of the marketplace's last fetch

#### Scenario: Versions match

- **WHEN** the installed version equals the version the marketplace makes available
- **THEN** the gate raises no question about the version

#### Scenario: Correct entry is selected from a multi-plugin marketplace

- **WHEN** the resolved marketplace's `marketplace.json` lists several plugins and the entry whose `name` is `dhpk` has a `source` different from the other entries
- **THEN** the gate reads the `plugin.json` at that entry's resolved `source` path, not another plugin's manifest, to determine the available version

### Requirement: Version currency claims are bounded by marketplace fetch age

Because a marketplace clone is only as current as its last fetch, the gate SHALL NOT state that an install is up to date without qualification. Every currency claim SHALL be expressed relative to the marketplace's recorded last-update time, so a stale clone can never assert that a newer release does not exist.

This requirement constrains the CONTENT of a currency claim, not whether one is made. The gate does not volunteer currency: a matching version produces no output on its own, and the currency line is emitted only when the gate is already speaking for another finding, where it serves as context rather than reassurance.

#### Scenario: Currency is reported relative to fetch age

- **WHEN** the installed version matches the marketplace version, the marketplace was last updated 40 days ago, and a currency message is composed
- **THEN** that message contains the fetch age (e.g. "40 days ago") and matches none of the bare-currency phrases "up to date", "up-to-date", or "current" used without an age qualifier

#### Scenario: A current install is not told it is current

- **WHEN** the installed version matches the marketplace version and there is no other finding
- **THEN** the gate emits nothing at all, rather than a reassurance message

### Requirement: Directory-source installs are exempt from the version ask

When the marketplace providing dhpk has a `directory` source, its "available version" is a live working tree whose version floats with development state. The gate SHALL NOT raise a version question for such installs.

#### Scenario: Maintainer's directory-source install is not nagged

- **WHEN** the marketplace entry for dhpk has `source.source` of `directory` and the working tree's manifest version differs from the installed version
- **THEN** the gate raises no version question

### Requirement: Only a minor or major version gap raises the question

A patch-level gap SHALL be reported in the advisory output only. The version question SHALL be raised only when the gap is at the minor or major level.

#### Scenario: Patch gap is advisory only

- **WHEN** the installed version is `0.28.17` and `0.28.18` is available
- **THEN** the drift appears in the advisory output and no question is raised

#### Scenario: Minor gap raises the question

- **WHEN** the installed version is `0.28.17` and `0.29.0` is available
- **THEN** the gate raises the question

### Requirement: Module configuration is validated against project evidence

The gate SHALL compare the enabled stack module set against evidence collected from the project. Evidence SHALL include both stack manifests and source-file presence, because a project can contain a stack's source files without carrying that stack's manifest.

#### Scenario: Enabled module contradicts a present manifest

- **WHEN** a `php-*` module is enabled and the project has a `package.json` but no `composer.json` and no PHP sources
- **THEN** the gate reports that module as contradicted by the project's evidence

#### Scenario: Stack modules enabled with no stack manifest at all

- **WHEN** stack modules are enabled and the project has neither `package.json` nor `composer.json`, and source-file evidence contradicts at least one enabled module
- **THEN** the gate reports that module as contradicted, rather than staying silent for lack of a manifest

#### Scenario: Contradicted modules are reported even when other configured modules match

- **WHEN** the configured module set contains both stack modules with no supporting evidence and at least one module that does match the project's evidence
- **THEN** the gate reports a finding naming the unsupported modules, rather than staying silent because every detected family already has a matching module

#### Scenario: Source-file evidence is used where manifests are absent

- **WHEN** a project has no `package.json` and no `composer.json` but contains JavaScript sources outside vendored and ignored paths
- **THEN** the collected evidence includes the JavaScript signal

#### Scenario: Vendored and ignored paths contribute no evidence

- **WHEN** a stack's source files exist only under vendored or version-control-ignored directories
- **THEN** those files contribute nothing to the evidence

### Requirement: Inheriting the global module list is not a defect

A project that declares no `modules` override and therefore inherits the globally configured list SHALL NOT trigger the gate on that basis alone. Per-project override precedence is a supported configuration for a machine that works across several stacks, and treating its absence as a defect would fire on healthy installs.

#### Scenario: No project override and no contradiction stays silent

- **WHEN** a project has no project-level `modules` override and the inherited module set does not contradict the project's evidence
- **THEN** the gate raises no module question

#### Scenario: Inherited modules are still validated for contradiction

- **WHEN** a project has no project-level `modules` override and the inherited module set contradicts the project's evidence
- **THEN** the gate reports the contradiction, because the finding rests on the contradiction and not on the absence of an override

### Requirement: The gate emits exactly one question-raising instruction per session

When findings are actionable the gate SHALL emit instruction context asking the model to raise a single `AskUserQuestion`. When both the version check and the module check produce findings, they SHALL be combined into that one question. The gate SHALL emit at most one question-raising instruction per session invocation; the instruction itself SHALL state that only one question is to be raised, covering all findings, rather than one per finding.

#### Scenario: Both checks fire, one instruction is emitted

- **WHEN** the gate finds both a minor version gap and a contradicted module configuration
- **THEN** exactly one question-raising instruction is emitted, covering both findings

#### Scenario: No findings, no question

- **WHEN** neither check produces a finding
- **THEN** no question-raising instruction is emitted

### Requirement: A finding produces a single user-facing prompt

A SessionStart hook cannot invoke `AskUserQuestion` itself; it can only emit instruction context for the model to act on. When the gate has findings, it SHALL emit exactly one question-raising instruction. Whether that instruction reliably drives an `AskUserQuestion` on the user's first turn is an implementation mechanism validated by a live probe (see design D7), not asserted as fact by this requirement; if the probe shows the mechanism does not hold, the gate SHALL instead emit an advisory-only message pointing at the `claude-health` skill, and that advisory-only output SHALL satisfy this requirement.

#### Scenario: Question precedes the user's requested work

- **WHEN** the ask mechanism is validated and the gate has findings, and the user's first message asks for unrelated work
- **THEN** the emitted instruction states that the question is to be raised before the requested work begins, and that the requested work proceeds in the same turn after it is answered

#### Scenario: Ask mechanism unavailable falls back to advisory only

- **WHEN** the live probe of the ask mechanism (design D7) has failed
- **THEN** the gate emits an advisory-only message naming the findings and pointing at the `claude-health` skill, and raises no question-raising instruction

### Requirement: Suppression is keyed on observed state

Once a finding has been raised and dismissed, the gate SHALL stay quiet for that finding. The suppression key SHALL be derived from the observed state — the installed version, the available version, and the enabled module set — so that a changed situation re-opens the question while an unchanged, dismissed one never asks twice.

#### Scenario: Dismissed finding does not ask again

- **WHEN** a finding was raised in an earlier session and the installed version, available version, and enabled module set are all unchanged
- **THEN** no question is raised

#### Scenario: A newer release re-opens the question

- **WHEN** a version finding was previously dismissed and the marketplace subsequently offers a newer version than the one that was dismissed
- **THEN** the question is raised again

#### Scenario: A changed module set re-opens the question

- **WHEN** a module finding was previously dismissed and the enabled module set has since changed
- **THEN** the question is raised again

### Requirement: Remediation is offered, never applied silently

The gate SHALL NOT modify project or user configuration on its own. A module override SHALL be written to `.claude/settings.local.json` only after the user confirms the detected stack. For a stale version the gate SHALL surface the exact update command and state that a hook cannot run it and that it takes effect in a fresh session.

#### Scenario: Module override requires confirmation

- **WHEN** the gate reports a contradicted module configuration
- **THEN** no configuration file is modified unless the user confirms, and only `.claude/settings.local.json` is written

#### Scenario: Version remediation is a command, not an action

- **WHEN** the gate reports a stale version
- **THEN** it surfaces the exact `claude plugin update dhpk@dhpk` command and states that the update requires a fresh session to take effect

### Requirement: The gate routes into the existing audit rather than replacing it

The gate SHALL remain a shallow trigger. Deep configuration auditing SHALL continue to belong to the `claude-health` skill, and the gate SHALL point at it rather than reimplementing its checks. Version messaging SHALL be coordinated with the existing compatibility-pin advisory so that a single session never presents two competing version messages.

The governing rule is that the freshness finding speaks only when the project has expressed no version policy — that is, when no pin file exists. The precedence rule follows from it: when both would speak, the compatibility-pin advisory SHALL take precedence and the freshness finding SHALL be suppressed. A pin file is an explicit, project-owned version policy, and a newer release is not necessarily a version that project accepts.

Critically, the freshness finding SHALL key on the ABSENCE OF A PIN FILE, not on the pin advisory happening to be silent. A pin file whose `verified` range covers the running version produces no advisory, yet the project has still expressed a policy; recommending an upgrade to a version that policy has not blessed would push the user into the exact state the next session flags.

#### Scenario: Deep audit is referenced, not duplicated

- **WHEN** the gate reports a finding
- **THEN** it points the user at the existing health-check skill for the full audit

#### Scenario: Version messages do not stack

- **WHEN** the project pins compatible versions, the compatibility advisory has something to say about the running version, and a newer version is also available
- **THEN** at most one version-advisory block is emitted for the session, and it is the compatibility-pin advisory; the freshness finding is suppressed for that session

#### Scenario: Freshness speaks when no pin file exists

- **WHEN** a newer version is available and the project has no pin file at all
- **THEN** the freshness finding is emitted

#### Scenario: A silent pin advisory does not license an upgrade recommendation

- **WHEN** the project has a pin file whose verified range covers the running version — so the compatibility advisory is silent — and a newer version is available that the pin file's verified ranges do not cover
- **THEN** the gate does not recommend the upgrade; any output names the pin file as the reason the newer version is not being recommended
