## ADDED Requirements

### Requirement: Installer values cross the shell-to-Python boundary as data

The jq-optional installer path SHALL pass plugin paths, preset names, and module names to Python through arguments or environment/file descriptors. It SHALL NOT interpolate those values into Python source code or shell-constructed quoted literals.

#### Scenario: Plugin path contains an apostrophe

- **WHEN** the installer runs its jq-optional preset lookup from a plugin path containing an apostrophe
- **THEN** Python receives the exact path as data, parses the profile, and returns the same preset selection as a path without an apostrophe

#### Scenario: Preset name contains shell metacharacters

- **WHEN** a discovered preset key contains characters that have meaning in shell or Python string syntax
- **THEN** the lookup treats the key as an opaque JSON value and does not execute or truncate it

### Requirement: Preset and module extraction fail closed

The installer SHALL check the status and shape of every jq-optional profile lookup and module extraction. A missing profile, invalid JSON, missing preset, or missing module SHALL emit a stable diagnostic and exit non-zero before any install action is started.

#### Scenario: Profile JSON is invalid

- **WHEN** the profile file cannot be parsed as JSON
- **THEN** the installer reports a profile-extraction error, returns non-zero, and does not prompt for or install a module

#### Scenario: Requested preset is absent

- **WHEN** the user selects a preset that is not present in the profile
- **THEN** the installer reports the invalid selection and exits non-zero without falling through to a different preset

### Requirement: The no-jq safety contract has regression coverage

The installer test suite SHALL execute the jq-optional branch with a valid apostrophe-containing path and failure fixtures, and SHALL assert exit status, diagnostic class, and absence of partial installation side effects.

#### Scenario: No-jq dry-run succeeds safely

- **WHEN** `jq` is unavailable and a dry-run uses a valid plugin path containing an apostrophe
- **THEN** the test observes a zero exit status and the expected planned modules without writing installed assets

#### Scenario: No-jq extraction fails safely

- **WHEN** the no-jq branch receives malformed profile data
- **THEN** the test observes a non-zero exit status and no newly created managed destination
