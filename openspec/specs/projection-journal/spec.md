# projection-journal Specification

## Purpose

Own the crash order of a Codex or Cursor install, update, or uninstall that spans the native installer journal and the shared project projection publisher journal, so one commit point decides both sides and recovery never leaves one committed and the other rolled back ([ADR-0033](../../../docs/adr/0033-one-projection-journal-owns-install-crash-order.md)).

## Requirements

### Requirement: REQ-1 Held projection publication

The project projection publisher SHALL support a held publication that performs every projection effect, including the receipt write, and leaves its journal open and attributed to a named installer transaction instead of committing. A held uninstall that finds no projection to remove SHALL report that no transaction is held and SHALL leave no journal.

#### Scenario: Held install leaves an attributed journal

- **WHEN** an installer runs the shared projection install with a hold for transaction `T`
- **THEN** the projection files, Host Bindings, and receipt are in their new state, the journal remains, and it names transaction `T` and its Host

#### Scenario: Nothing to remove

- **WHEN** a held uninstall finds no projection receipt
- **THEN** it reports `held: false` and no journal exists

### Requirement: REQ-2 Automatic recovery never resolves a held journal

Every publisher entry that recovers interrupted transactions SHALL refuse to roll back a held journal that has not reached `published`, and SHALL fail with `TRANSACTION_HELD` naming the Host and transaction, without changing any file.

#### Scenario: Another Host's run meets a held journal

- **WHEN** a Cursor install runs while a Codex install holds transaction `T`
- **THEN** the Cursor shared-projection step fails with `TRANSACTION_HELD` naming Codex and `T`, and the held projection is unchanged

### Requirement: REQ-3 Commit and abort resolve only their own transaction

Committing a held transaction SHALL make it final and remove its journal; aborting it SHALL restore the previous projection. Both SHALL report `ABSENT` when no journal exists and SHALL fail with `TRANSACTION_MISMATCH`, changing nothing, when the journal names another transaction.

#### Scenario: Commit

- **WHEN** the holder commits `T`
- **THEN** the new projection stays, the journal and transaction backup are gone, and the next publisher entry succeeds

#### Scenario: Abort

- **WHEN** the holder aborts `T`
- **THEN** the previous projection files, Host Bindings, and receipt are restored byte-for-byte

#### Scenario: Wrong transaction

- **WHEN** `commit` or `abort` names `U` while the journal holds `T`
- **THEN** the call fails with `TRANSACTION_MISMATCH` and nothing changes

### Requirement: REQ-4 One commit point per installer transaction

An installer transaction that holds a projection publication SHALL record the held transaction in its own journal before calling the publisher, and SHALL commit in this order: durable partial receipt, recorded commit intent, publisher commit, final receipt. A failure before the commit intent SHALL abort the publisher transaction before the installer rolls back its own effects; a failure at or after the commit intent SHALL NOT roll back and SHALL leave the installer journal active for roll-forward.

#### Scenario: Native install fails after the projection step

- **WHEN** the shared projection is held and a native asset install then fails
- **THEN** the publisher transaction is aborted, then the installer restores its own effects including legacy native skill copies, and the projection, Host Bindings, and both receipts match the state before the run

#### Scenario: Failure after commit intent

- **WHEN** the final receipt write fails after the publisher committed
- **THEN** the run exits non-zero, nothing is rolled back, and the installer journal stays active

### Requirement: REQ-5 Recovery follows the commit point

Installer recovery of an interrupted transaction that recorded a held publication SHALL roll forward when the commit intent was recorded (commit the publisher transaction if still held, then finalize the partial receipt) and SHALL otherwise abort the publisher transaction before rolling back its own effects. Recovery SHALL NOT leave one journal committed and the other rolled back.

#### Scenario: Killed after the projection step, before commit intent

- **WHEN** the installer process is killed after the held projection step and before commit intent
- **THEN** the next run aborts the publisher transaction, restores the installer's effects, and completes its own install

#### Scenario: Killed while the projection is being published

- **WHEN** the installer is killed while the publisher is still publishing
- **THEN** the next run restores the previous state without `RECOVERY_CONFLICT`

#### Scenario: Killed after the publisher commit

- **WHEN** the installer is killed after the publisher committed and before the final receipt
- **THEN** the next run finalizes the receipt and records the transaction as committed without rolling anything back

### Requirement: REQ-6 Explicit recovery for fail-closed states

An installer journal in `rollback_incomplete` SHALL keep blocking ordinary runs with a message that lists the remaining paths and the backup directory. An explicit recovery request SHALL replay that journal's rollback and record `rolled_back` when it succeeds. Explicit recovery SHALL abort a held publisher transaction whose installer journal is no longer active, and SHALL refuse, naming the installer to rerun, while that installer journal is still active.

#### Scenario: rollback_incomplete is reported

- **WHEN** an ordinary run finds a `rollback_incomplete` journal
- **THEN** it blocks and names the remaining paths and the backup directory

#### Scenario: Explicit recovery replays the rollback

- **WHEN** the user runs the explicit recovery after fixing the cause
- **THEN** the remaining rollback completes, the journal records `rolled_back`, and ordinary runs proceed

#### Scenario: Orphaned held publication

- **WHEN** a held publisher journal exists and its installer journal is gone or terminal
- **THEN** explicit recovery aborts it and ordinary publisher entries succeed again
