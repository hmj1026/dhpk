# Implementation evidence

## Issue findings

- GitHub #155: after a successful `--copy` sync into a temporary consumer
  project, the receipt check passed but consumer-root execution of
  `node scripts/ci/validate-openai-metadata.js --root .` and
  `node tests/install-codex-skills.test.js` failed with `MODULE_NOT_FOUND`.
- GitHub #156: `find codex/agents -maxdepth 1 -name '*.toml'` reports 16 files;
  `codex/agent-projection-manifest.json` declares 12 generated roles; the four
  current operational documents contained the stale 11/7 wording.

## Regression and verification

### RED baseline

- Before the documentation edits, the new command-context and role-parity
  assertions failed on the stale documents; the focused suite was 6/8. The
  command check lacked `DHPK_ROOT`, and the role check found the documented
  11/7 counts instead of the live 16/12 projection.

- `node tests/platform-installation-docs.test.js` — PASS (8/8).
- `node tests/documentation-platform-parity.test.js` — PASS (8/8).
- `git diff --check` — PASS.
- `openspec validate repair-codex-operational-docs --strict --no-interactive` —
  PASS.

The source validators remain checkout-root checks and are not claimed as live
consumer runtime proof.
