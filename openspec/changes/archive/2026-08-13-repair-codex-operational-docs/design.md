## Context

The supported Codex project-local installer is invoked from a consumer project,
while `scripts/ci/validate-openai-metadata.js` and
`tests/install-codex-skills.test.js` live in the dhpk source checkout. The
current bilingual platform guide presents all three commands as if they share
the consumer working directory, which produces false `MODULE_NOT_FOUND`
failures after a successful install (#155).

The repository now contains 16 package-owned `codex/agents/*.toml` files and a
projection manifest declaring 12 generated roles. Four current operational
pages still contain the historical 11-role/7-generated wording (#156). The
canonical role manifest and filesystem are the source of truth; historical
changelog and bootstrap documents are not current installation guidance.

## Goals / Non-Goals

**Goals:**

- Make every current verification example explicit about its working root.
- Keep the consumer receipt/discovery check runnable from the consumer root.
- Make current English and Traditional Chinese role counts derive from the
  checked-in projection contract through deterministic tests.
- Preserve the existing supported/experimental status boundaries and all
  unrelated documentation.

**Non-Goals:**

- No installer behavior, receipt schema, Codex CLI implementation, or package
  layout change.
- No rewrite of historical changelogs, archived OpenSpec specs, or bootstrap
  snapshots.
- No claim that a static source validator proves a live Codex consumer.

## Decisions

### 1. Keep the consumer and source checks as separate command groups

The guide will show a consumer-root block containing only the receipt check,
then a checkout-root block using `DHPK_ROOT` for both source validators. This
preserves copy-ready commands without assuming that the dhpk checkout is the
consumer project. An alternative of copying source validators into every
consumer is rejected because it would create a second distribution surface and
version-drift risk.

### 2. Use the projection manifest for generated-role wording

The prose will state the current 16/12 contract, while the regression test
reads `codex/agent-projection-manifest.json` and `codex/agents/*.toml` to ensure
the documented counts remain synchronized. The manifest remains the ownership
SSOT; documentation will not introduce another role inventory.

### 3. Scope parity checks to current operational documents

The tests target the four files named by #156 and the two canonical platform
installation guides named by #155. Historical changelog/spec text may retain
historical counts and is intentionally excluded from the current-doc scan.

### 4. Preserve bilingual command shape

English and Traditional Chinese examples will use the same command sequence and
path variables. Existing locale parity tests remain authoritative for heading,
link, and command structure; new assertions add root semantics without
duplicating the entire documentation parser.

## Risks / Trade-offs

- [Risk] A user may not have a stable checkout path → [Mitigation] document
  `DHPK_ROOT=/absolute/path/to/dhpk` as an explicit placeholder and retain the
  consumer-only receipt check.
- [Risk] Future role expansion can make prose stale again → [Mitigation] derive
  expected counts from the projection manifest in a focused regression test.
- [Risk] Broad docs scans may flag historical material → [Mitigation] limit the
  current-contract assertion to the four operational files and leave historical
  sources unchanged.

## Migration Plan

No runtime migration is required. Update the paired docs and tests in one
change, run the focused documentation validators, then run strict OpenSpec
validation. Rollback is a documentation-only revert.

## Open Questions

None. Issue scope, current source-of-truth files, and test boundaries are
resolved by the repository and live issue evidence.
