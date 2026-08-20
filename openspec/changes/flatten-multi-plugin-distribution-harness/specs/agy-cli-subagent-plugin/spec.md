## ADDED Requirements

### Requirement: AGY uses the native Antigravity plugin contract
The AGY package SHALL be generated and validated as an Antigravity CLI native plugin with root `plugin.json` and declared optional native directories. Its runtime evidence SHALL be obtained through AGY commands only.

#### Scenario: Native package is validated
- **WHEN** `agy plugin validate` is available for the generated package
- **THEN** validation reports AGY-native skills and agents without invoking or importing Gemini CLI assets
