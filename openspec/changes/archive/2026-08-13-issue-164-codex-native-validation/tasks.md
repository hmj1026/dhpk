## 1. Surface-boundary regression

- [x] 1.1 Add a deterministic offline regression that rejects Claude strict-validation commands targeting `plugins/dhpk/` and requires the canonical root/native command ownership.
- [x] 1.2 Run the regression before documentation edits and capture the expected failure from the existing false claim.

## 2. Historical bootstrap contract repair

- [x] 2.1 Update `docs/design/bootstrap-dhpk-plugin/tasks.md` so Claude strict validation targets the canonical repository root/marketplace and the Codex-only package names its native validators and smoke test.
- [x] 2.2 Update the `plugin-manifest`, `modules-architecture`, and `core-harness` bootstrap specs to preserve the Claude/Codex surface boundary without changing runtime behavior.

## 3. Verification and handoff

- [x] 3.1 Run the focused regression and relevant documentation/full test commands; record exact results, including any unavailable native consumer outcome.
- [x] 3.2 Run strict OpenSpec validation and `git diff --check`; inspect the final diff for documentation/spec-only scope and mark this change complete.
