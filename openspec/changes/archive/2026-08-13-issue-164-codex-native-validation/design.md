## Context

The bootstrap material under `docs/design/bootstrap-dhpk-plugin/` is a
historical record, but its completed validation checklist is still read as a
contract by maintainers. The repository now has two intentionally different
publication surfaces: the canonical Claude checkout/root owns
`.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`, while
`plugins/dhpk/` owns the generated Codex-native package and
`.codex-plugin/plugin.json`. Claude's official validator rejects the latter
because it has no Claude manifest.

This is a documentation/spec-only repair. The regression must be deterministic
and offline: it should inspect the checked-in text and prove that commands and
claims are bound to their owning surface. It must not invoke Claude or Codex,
regenerate a package, or infer consumer availability from static files.

## Goals / Non-Goals

**Goals:**

- Make every Claude strict-validation example in the affected bootstrap docs
  target the canonical repository root/marketplace.
- Make the Codex-native checklist name the existing native package verifier,
  manifest test, and install smoke test as the owning evidence.
- Preserve the historical bootstrap framing and unrelated current
  documentation.
- Add one focused regression test that fails against the current false claim.

**Non-Goals:**

- Do not change manifests, generators, validators, installer behavior, or
  generated publication artifacts.
- Do not claim a live Claude or Codex consumer PASS from the documentation test.
- Do not rewrite the broader platform-installation SSOT, which already
  describes the surfaces separately.

## Decisions

### 1. Use the canonical root for Claude validation

The affected checklist and plugin-manifest scenario will use the repository
root (`claude plugin validate <checkout-root> --strict`) as the Claude official
validation target. The root is the marketplace/package owner; the nested
Codex-native package is explicitly excluded from this command.

Alternative rejected: keeping both root and `plugins/dhpk` commands and
labelling the latter as an optional check. The official Claude validator has no
valid manifest in that directory, so this would preserve the false claim.

### 2. Use native evidence for the Codex package

The bootstrap checklist will identify these existing, deterministic/native
checks for `plugins/dhpk/`: `scripts/ci/verify-codex-native-package.js`,
`tests/codex-plugin-manifest.test.js`, and
`tests/codex-native-install-smoke.test.js`. Their real consumer availability
and skip semantics remain owned by those validators and are not reinterpreted
by this documentation change.

Alternative rejected: adding a new validator or calling the Claude validator
with a different manifest path. The existing native gates already own this
artifact and avoid duplicating runtime policy.

### 3. Test the contract through command ownership

The regression test will scan only the four affected historical files. It will
reject any Claude validation command containing `plugins/dhpk`, require the
canonical-root Claude command, and require the native command set in the
bootstrap checklist. It will also assert that affected spec scenarios name the
surface boundary, so a future prose-only reintroduction is caught.

## Risks / Trade-offs

- [Historical text can be mistaken for current support] → retain the existing
  historical banner and point readers to current distribution documentation.
- [Native smoke test may be unavailable on a host] → document the command but
  leave its verdict/skip behavior to the test itself; this regression is
  static and makes no PASS claim.
- [A broad text scan could reject valid prose] → inspect validator command
  occurrences and assert explicit surface wording rather than banning every
  `plugins/dhpk` mention.

## Migration Plan

1. Add and run the focused regression test before changing the affected docs;
   it must fail on the existing nested Claude command.
2. Update the checklist and three affected specs with the surface-specific
   commands and wording.
3. Run the focused test, relevant documentation/full test commands, strict
   OpenSpec validation, and `git diff --check`.

Rollback is a documentation-only revert of the affected files and regression
test; no runtime or generated artifacts require migration.

## Open Questions

None. The issue reproduction and current tracked manifests establish the
surface ownership needed for this narrow repair.
