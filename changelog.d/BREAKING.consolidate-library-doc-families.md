scope: skills, agents, dispatch, docs
note: consolidate library/doc modes and retire superseded forwarders

### Library and documentation families; retirement planned for 0.66.2

- Replace six library skills with `library-author` modes `author`, `testbench`,
  `composer`, `polyfill-audit`, `suite-map`, and `cell-onboard`.
- Replace three documentation skills with `doc-maintain` modes `update`,
  `codemap`, and `refactor`. Claude documentation command names remain stable;
  the existing matrix-cell-onboard command forwards to the library family.
- Retire executable agent names `agy-fast-worker`, `codex-fast-worker`, and
  `codex-deep-reasoner`. Use `agy-worker`, `codex-worker`, and `codex-reasoner`.
  Retired requests fail closed with migration guidance. Use canonical
  `codex_reasoner_model` and `codex_reasoner_effort` configuration keys.
- Keep prior `codex-bridge` retirement and its BLOCKED execution behavior.
  Keep `pr-summary`, `merge-prep`, and the approved keep-separate skills independent.
- Rollback pins release `0.66.1` using the receipt-bound installation path.
  This change does not create a release tag or publish a release.
