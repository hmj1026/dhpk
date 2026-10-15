# SwiftLint configuration

## Tier strategy

Scale rules from a clean greenfield app up without a flag day:

- **Default rules on**, plus a curated set of `opt_in_rules` (the high-value ones
  SwiftLint ships disabled): `force_unwrapping`, `empty_count`,
  `first_where`, `contains_over_filter_count`, `redundant_nil_coalescing`,
  `unused_import`, `weak_delegate`, `closure_spacing`.
- **`analyzer_rules`** (need a compiled build) for deeper checks:
  `unused_declaration`, `unused_import` — run in CI, not on every edit.
- Treat newly-surfaced violations as a backlog (`warning` first), promote to
  `error` per rule once the codebase is clean for it.

## Root `.swiftlint.yml`

```yaml
opt_in_rules:
  - force_unwrapping
  - weak_delegate
  - empty_count
  - unused_import
disabled_rules:
  - todo                 # tracked elsewhere
excluded:
  - .build
  - "**/*.generated.swift"
  - "**/Snapshots"       # snapshot reference images dir
force_unwrapping: error  # aligns with swift module "no force-unwrap" rule
line_length:
  warning: 120
  error: 200
```

## Per-package overrides

- Each SPM package can carry its own `.swiftlint.yml`; SwiftLint uses the nearest
  config up the tree. Keep shared rules at the repo root, package-specific
  excludes local.
- Generated code, vendored sources, and snapshot dirs go in `excluded`.

## Alignment with the swift module

- `force_unwrapping: error` enforces the swift module's "no `!` in non-test code"
  rule mechanically. Test targets can relax it (`excluded:` the test dirs, or a
  per-dir config) since force-unwrap is acceptable in tests.

## Running

- Per file (what the post-edit hook does): `swiftlint lint --quiet --path <file>`.
- Whole project: `swiftlint lint --quiet`.
- Autocorrect safe rules: `swiftlint --fix` (review the diff; not all fixes are
  semantics-preserving).
- Install: `brew install swiftlint` (the hooks self-skip if it's missing).
