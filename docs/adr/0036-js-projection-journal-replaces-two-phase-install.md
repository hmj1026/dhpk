# One JS Projection Journal replaces the two-phase install

Status: accepted

Issues: #1239 (port the installer lifecycle to JS), #1240 (publisher journal
as effects-as-data).

## Context

[ADR-0033](0033-one-projection-journal-owns-install-crash-order.md) made one
Projection Journal own install crash order, but shipped a transition: the
Python installer (about 5,600 embedded lines in `install-codex-skills.sh`)
coordinates, and the Node projection publisher joins through a two-phase
`hold`/`commit`/`abort` protocol. Two journals still exist, each Host
directory has its own Python lock while the shared `.agents` publisher has
none, crash injection works only through `DHPK_TEST_FAIL_*` environment
variables across a process boundary, and `dhpk-install` cannot write. The
publisher still describes progress with flags (`liveBackedUp`, `holdReady`,
...) rather than recorded effects.

## Decision

- Port the installer lifecycle to JS so one Projection Journal covers native
  assets and the Shared Project Projection. The two-phase protocol is removed.
- One project-level install lock serializes every Host's install, replacing
  the per-Host Python locks; cross-Host contention no longer needs
  `TRANSACTION_HELD`.
- The responsibilities around the lifecycle move with it: the Codex native
  plugin provider check, inventory and profile selection, plan output, and
  legacy skill-name migration.
- `install-codex-skills.sh` and `install-cursor-harness.sh` remain as thin
  entry points into the JS installer, so existing hooks, docs, and habits keep
  working.
- Receipt formats do not change: the Projection Receipt (v1-v3) and Host
  receipts (v3) are read and written as today. Only the journal changes.
- An in-flight transaction in the previous journal format is recovered for
  one minor release, then recovery fails closed and tells the user to run the
  previous release's `--recover` first, as in ADR-0031 and ADR-0033.
- The port ships in five stages, each releasable on its own: (1) the publisher
  records effects as data, with staging inside the journal; (2) a JS
  Projection Journal core with in-process crash injection, adopted by the
  publisher; (3) the Codex adapter; (4) the Cursor adapter; (5) thin shell
  entry points, with the embedded Python and `DHPK_TEST_FAIL_*` removed.
  Stages that change an on-disk journal format (1 and 3) each ship in their
  own minor release, so compatibility windows never overlap.

This supersedes the **Transition** paragraph of ADR-0033. Its principles
stand: effects are journaled as data with their inverse before they run,
recovery reads only the journal, and the single commit point is the journal
reaching `published`.

## Considered Options

- **Keep the two-phase protocol.** It works after #1237, but it keeps two
  journals, two languages, per-Host locks, and process-boundary crash tests.
- **Port everything in one change.** Rejected: one 5,600-line rewrite cannot
  ship partially, and both Hosts would change format at once.

## Consequences

- Crash recovery is tested in-process by injecting a crash after step N.
- The installer no longer needs `python3`, which also removes the interpreter
  variance behind #1278.
- `dhpk-install` gains real Codex and Cursor write adapters.
