# Library and documentation retirement ledger

Retirement release is frozen as `0.66.2`; rollback pins `0.66.1`. The inventory
owns machine-readable skill rows, former public names, canonical paths and
prior surfaces. This ledger records the closed wave and the three agents.

| Former public name | Canonical path | Replacement | Reason |
| --- | --- | --- | --- |
| dhpk-laravel-package-author | skills/dhpk-laravel-package-author | library-author author | library-doc-family-consolidation |
| dhpk-laravel-testbench-matrix | skills/dhpk-laravel-testbench-matrix | library-author testbench | library-doc-family-consolidation |
| dhpk-composer-package-hygiene | skills/dhpk-composer-package-hygiene | library-author composer | library-doc-family-consolidation |
| dhpk-polyfill-version-matrix-audit | skills/dhpk-polyfill-version-matrix-audit | library-author polyfill-audit | library-doc-family-consolidation |
| dhpk-library-dual-testsuite-map | skills/dhpk-library-dual-testsuite-map | library-author suite-map | library-doc-family-consolidation |
| matrix-cell-onboard | skills/matrix-cell-onboard | library-author cell-onboard | library-doc-family-consolidation |
| update-docs | skills/update-docs | doc-maintain update | library-doc-family-consolidation |
| update-codemaps | skills/update-codemaps | doc-maintain codemap | library-doc-family-consolidation |
| doc-refactor | skills/doc-refactor | doc-maintain refactor | library-doc-family-consolidation |
| agy-fast-worker | agents/agy-fast-worker.md | agy-worker | elapsed-one-release-forwarder |
| codex-fast-worker | agents/codex-fast-worker.md | codex-worker | elapsed-one-release-forwarder |
| codex-deep-reasoner | agents/codex-deep-reasoner.md | codex-reasoner | elapsed-one-release-forwarder |

The three former agents were registered on the Claude plugin surface and
represented in the Codex role map as merged/manual-fallback roles. They were
not direct native Codex role files. Their replacement agents own the existing
behavior and prompt-composition/TDD preload contracts. Retired identifiers
return BLOCKED before dispatch and give successor plus rollback guidance.

The historical `0.54.0` ledger and archived SCF 25-ID mapping remain unchanged.
No keep-separate identity or MERGE C entry is part of this ledger. The existing
`modules/library-author/` content module remains distinct from the skill package.

Marketplace catalog availability is separate from installation selection:
`library-author` has one self-owned `host-only` marketplace catalog entry,
visible in the current marketplace generator host views for Claude and Codex
native. Its existing distribution surfaces, including `cursor-sync`,
`claude-module`, and `codex-sync`, remain unchanged. Its optional installation
profile is separate, and it is excluded from `common.skillIds`. `doc-maintain`
replaces the common documentation entry. Generated package proof requires a
clean canonical revision, four-surface generation, marketplace generation and
the aggregate gate; dirty-tree generation is `releaseEligible: false`.
