# One JS Projection Journal replaces the two-phase install

Status: accepted

Issues: #1239 (port the installer lifecycle to JS), #1240 (publisher journal
as effects-as-data), #1237 (the two-phase transition this replaces), #1278
(a test failure caused by which `python3` the installer resolved).

## Context

[ADR-0033](0033-one-projection-journal-owns-install-crash-order.md) made one
Projection Journal own install crash order, but shipped a transition: the
Python installer (about 5,600 embedded lines in `install-codex-skills.sh`)
coordinates, and the Node projection publisher joins through a two-phase
`hold`/`commit`/`abort` protocol. Two journals still exist, each Host
directory has its own Python lock while the shared `.agents` publisher has
none, crash injection works only through `DHPK_TEST_FAIL_*` and
`DHPK_TEST_KILL_AT` environment variables across a process boundary, and `dhpk-install` cannot write. The
publisher still describes progress with flags (`liveBackedUp`, `holdReady`,
...) rather than recorded effects.

## Decision

- Port the installer lifecycle to JS so one Projection Journal covers the
  Native Projection and the Shared Project Projection. The two-phase protocol
  is removed.
- One project-level install lock serializes every Host's install, replacing
  the per-Host Python locks; cross-Host contention no longer needs
  `TRANSACTION_HELD`.
- The responsibilities around the lifecycle move with it: the Codex native
  plugin provider check, inventory and profile selection, plan output,
  adoption, Released Entries, and legacy skill-name migration. The Released
  Entry and version-boundary rules of
  [ADR-0031](0031-release-unprovable-ownership-instead-of-failing.md) carry over
  unchanged.
- `install-codex-skills.sh` and `install-cursor-harness.sh` remain as thin
  entry points into the JS installer, so existing hooks, docs, and habits keep
  working.
- Receipt formats do not change: the Projection Receipt (v1-v3) and the
  per-Host receipt in each Host directory (`.codex/` or `.cursor/`
  `.dhpk-installed.json`, v3) are read and written as today. Only the journal
  changes.
- An in-flight transaction in the journal format of the immediately
  previous minor release is recovered; an older format fails closed and tells
  the user to run first the `--recover` of the last release that can read it. This
  follows the fail-closed boundary pattern of
  [ADR-0031](0031-release-unprovable-ownership-instead-of-failing.md) and the
  one-minor window of
  [ADR-0033](0033-one-projection-journal-owns-install-crash-order.md). Each
  window covers only the format written by the release before it: stage 1
  reads publisher v1/v2; stage 3 reads publisher v3 and the Python Host
  journal.
- The port ships in five stages, each releasable on its own: (1) the publisher
  records effects as data, with staging inside the journal; (2) a JS
  Projection Journal core with in-process crash injection, adopted by the
  publisher; (3) the Codex adapter; (4) the Cursor adapter; (5) thin shell
  entry points, with the embedded Python, `DHPK_TEST_FAIL_*`, and
  `DHPK_TEST_KILL_AT` removed.
  Stages that change an on-disk journal format (1 and 3) each ship in their
  own minor release, so compatibility windows never overlap.

This supersedes the **Transition** paragraph of
[ADR-0033](0033-one-projection-journal-owns-install-crash-order.md). Its principles
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
- From stage 5 the installer no longer needs `python3`, which also removes the
  interpreter variance behind #1278.
- `dhpk-install` gains real Codex and Cursor write adapters.
