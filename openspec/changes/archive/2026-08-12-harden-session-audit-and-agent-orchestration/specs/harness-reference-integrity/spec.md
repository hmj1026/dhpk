## MODIFIED Requirements

### Requirement: Slash-command references resolve

Every `/dhpk:<name>` reference in shipped harness markdown SHALL resolve to a registered command (`commands/<name>.md` or a registered module command) or a shipped skill (`skills/<name>/SKILL.md` or a registered module skill). Imperative handoff phrases such as `invoke`, `run`, or `use` followed by a named capability SHALL resolve through the same canonical registry. The check SHALL fail on a reference whose target does not exist, unless the reference is listed in an explicit whitelist of intentional examples or an explicit alias map resolves it to a canonical target.

#### Scenario: Docs reference a command name that does not resolve

- **WHEN** shipped markdown references `/dhpk:setup` and no registered command or skill named `setup` exists
- **THEN** the reference-integrity check reports the dangling reference and exits non-zero

#### Scenario: An intentional example is whitelisted

- **WHEN** a doc illustrates a hypothetical command listed in the whitelist
- **THEN** the reference-integrity check skips it and does not fail

#### Scenario: A natural-language handoff names a missing capability

- **WHEN** a workflow says to invoke `compact-save` but no skill or command with that canonical name is registered
- **THEN** validation reports the line and requires a supported replacement or an explicit optional-capability gate

#### Scenario: A legacy alias has a canonical replacement

- **WHEN** a workflow names `opsx-post-obs` and the registry defines `dhpk-opsx-post-observation`
- **THEN** validation requires the canonical name or an alias-map entry that resolves to it
