## Why

The historical bootstrap contract incorrectly says that Claude's official
validator passes against `plugins/dhpk/`, even though that directory is the
Codex-native publication artifact and intentionally has no Claude manifest.
This makes a native-package verification failure look like a Claude defect and
can turn a documentation claim into a misleading release check.

## What Changes

- Replace Claude validation examples in the bootstrap checklist and delta specs
  with the canonical repository/marketplace root target.
- State that `plugins/dhpk/` is validated with the native Codex package gate,
  manifest test, and native install smoke test rather than Claude's validator.
- Add a deterministic documentation regression test that rejects cross-surface
  validator claims and requires the native verification commands.
- Preserve the bootstrap files' historical framing and make no runtime or
  generated-package changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-native-publication`: documentation and acceptance evidence must keep
  Claude marketplace validation separate from Codex-native package validation.

## Impact

- Documentation/spec contract: `docs/design/bootstrap-dhpk-plugin/tasks.md` and
  its `plugin-manifest`, `modules-architecture`, and `core-harness` specs.
- Focused regression coverage under `tests/`.
- OpenSpec planning artifacts for issue #164.
- No application runtime, package generation, installation behavior, or
  production data changes.
