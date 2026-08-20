## ADDED Requirements

### Requirement: Gemini CLI is not a dhpk distribution surface
The system SHALL not expose Gemini CLI generation, conversion, installation, validation, consumer probing, configuration, documentation, or release claims. `gemini` SHALL not be an inventory distribution surface or worker backend selection.

#### Scenario: A repository scan runs after retirement
- **WHEN** the retirement validation scans dhpk-owned sources, tests, and documentation
- **THEN** it finds no Gemini CLI command, install root, adapter, or support claim

### Requirement: AGY remains an independent Antigravity target
The system SHALL retain the `agy-plugin` distribution surface and `agy` fast-worker backend as Antigravity CLI integrations. AGY validation SHALL use the native plugin Interface and SHALL not depend on a Gemini CLI conversion path.

#### Scenario: AGY package validates
- **WHEN** a maintainer runs native AGY validation for a generated package
- **THEN** the result is classified independently of any Gemini CLI availability or migration state
