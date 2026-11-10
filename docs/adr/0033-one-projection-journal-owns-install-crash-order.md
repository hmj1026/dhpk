# One Projection Journal owns install crash order

Status: accepted (the Transition paragraph is superseded by
[ADR-0036](0036-js-projection-journal-replaces-two-phase-install.md))

Issues: #1234 (publisher effects outside its journal), #1235 (two journals
across the Python↔Node handoff).

## Context

A Codex or Cursor install runs two journals that do not know about each
other. `install-codex-skills.sh` keeps a Python journal for native assets and
legacy native skill copies, and calls the Node projection publisher inside
that transaction. The publisher keeps its own journal for the Shared Project
Projection, commits, and deletes it before returning. The Python journal
records nothing about the Node step. As a result:

- When Node commits and Python then fails or crashes, Python rolls back while
  `.agents` content and Host Bindings stay committed, and an adopted legacy
  `.codex/skills/<name>` backup is silently stranded.
- When the run is killed while Node is publishing, Python recovers first and
  restores a directory where Node's recovery expects a binding link, so every
  later run stops on `RECOVERY_CONFLICT`.
- The publisher itself performs effects outside its journal: the rollback
  stage and backup are created before the journal is written, and a rollback
  restores adopted Host Bindings after the journal is removed.

## Decision

- One **Projection Journal** owns the crash order of a Projection install,
  update, uninstall, or rollback. Recovery reads only it to decide whether to
  finish or undo. It owns no content; the Projection Receipt still does.
- Every filesystem effect is written to the journal as data with its inverse
  before it runs, including backups and staging. Recovery steps are
  idempotent.
- The single commit point of an install is the Projection Journal reaching
  `published`. Before it, recovery rolls back; after it, recovery only rolls
  forward.
- **Transition** (superseded by
  [ADR-0036](0036-js-projection-journal-replaces-two-phase-install.md)): the Python installer stays the coordinator. The publisher's
  CLI gains `prepare`, `commit`, and `abort`. Python records the Node
  transaction id, installs native assets, asks Node to commit, then writes its
  own receipt. Python recovery rolls forward when the recorded Node
  transaction is `published`, otherwise aborts Node and rolls back. The
  "already up-to-date" path and uninstall go through the same protocol.
- **End state:** the Python lifecycle is ported to JS, so one Projection
  Journal covers the whole install and `dhpk-install` runs it through real
  per-Host adapters. That port is a separate, later change.
- `rollback_incomplete` stays fail-closed. The error lists the remaining paths
  and backup locations, and `dhpk-install --recover` performs the recovery.
- The new journal carries a schema version. Recovery reads the previous Node
  and Python journal formats for one minor release, then fails closed with
  remediation steps, as in ADR-0031.

## Considered Options

- **Reorder so Node runs last.** Rejected: a Python crash after Node commits
  still needs roll-forward logic; this narrows the gap without closing it.
- **Port the Python lifecycle to JS first.** Rejected as the first step: it
  delays fixing live crash-order defects behind a 5,000-line port. It remains
  the end state.

## Consequences

- AGY's package receipt in `provenance.json` is out of scope; it belongs to the
  package receipt work, not the Projection Journal.
- Crash recovery becomes testable in-process by injecting a crash after step
  N. Only the Python↔Node scenarios need process-boundary tests, and the
  `DHPK_TEST_FAIL_*` injection points are phased out.

This refines the lifecycle ownership in
[ADR-0019](0019-shared-project-projection-with-host-adapters.md) and the
installer delegation in
[ADR-0023](0023-native-installers-delegate-skills-to-the-shared-projection.md);
both stay accepted.
