# projection-journal Specification

## Purpose

Own the crash order of a Codex or Cursor install, update, uninstall, or rollback in one JS Projection Journal that records both the native assets and the Shared Project Projection, so one commit point decides the whole transaction and recovery reads only that journal ([ADR-0033](../../../docs/adr/0033-one-projection-journal-owns-install-crash-order.md), [ADR-0036](../../../docs/adr/0036-js-projection-journal-replaces-two-phase-install.md)).

## Requirements

### Requirement: REQ-4 One commit point per installer transaction

An install, update, uninstall, or rollback SHALL have exactly one commit point: its Projection Journal reaching `published`. Native asset effects and Shared Project Projection effects SHALL be recorded in that one journal. A failure before the commit point SHALL roll back every recorded effect, native and shared, in reverse order; a failure at or after it SHALL NOT roll back and SHALL leave the journal for roll-forward.

#### Scenario: Native install fails after the projection effects

- **WHEN** the shared projection effects have run and a native asset install then fails before the commit point
- **THEN** every recorded effect is undone in reverse order, including legacy native skill copies, and the projection, Host Bindings, and receipts match the state before the run

#### Scenario: Failure after the commit point

- **WHEN** a receipt write fails after the journal reached `published`
- **THEN** the run exits non-zero, nothing is rolled back, and the journal remains for roll-forward

### Requirement: REQ-5 Recovery follows the commit point

Recovery of an interrupted transaction SHALL read only the Projection Journal. It SHALL roll forward every remaining recorded effect when the journal reached `published`, and otherwise SHALL undo every recorded effect that ran, in reverse order. Each recovery step SHALL be idempotent, so a recovery that is itself interrupted can be run again with the same result.

#### Scenario: Killed before the commit point

- **WHEN** the installer is killed after some native and shared effects ran and before `published`
- **THEN** the next run undoes those effects, restores the previous state, and completes its own install

#### Scenario: Killed after the commit point

- **WHEN** the installer is killed after `published` and before the final receipt
- **THEN** the next run completes the remaining effects and records the transaction as committed without rolling anything back

#### Scenario: Recovery is interrupted

- **WHEN** a recovery is killed partway through
- **THEN** running recovery again reaches the same final state as an uninterrupted recovery

### Requirement: REQ-6 Explicit recovery for fail-closed states

A Projection Journal in `rollback_incomplete` SHALL keep blocking ordinary runs with a message that lists the remaining paths and the backup directory. An explicit recovery request (`dhpk-install --recover` or the installer's `--recover`) SHALL replay that journal's remaining undo effects and record `rolled_back` when it succeeds.

#### Scenario: rollback_incomplete is reported

- **WHEN** an ordinary run finds a `rollback_incomplete` journal
- **THEN** it blocks and names the remaining paths and the backup directory

#### Scenario: Explicit recovery replays the rollback

- **WHEN** the user runs the explicit recovery after fixing the cause
- **THEN** the remaining rollback completes, the journal records `rolled_back`, and ordinary runs proceed

### Requirement: REQ-7 Effects are recorded as data before they run

Every filesystem effect of a transaction, including staging directories, backups, rollback candidates, and Host Binding changes, SHALL be written to the Projection Journal together with its inverse before the effect runs. No effect SHALL happen before the journal records it.

#### Scenario: Staging is journaled

- **WHEN** a transaction creates a staging or rollback-candidate directory
- **THEN** the journal already records that directory and how to remove it

#### Scenario: Crash right after an effect

- **WHEN** the process dies immediately after any single effect
- **THEN** recovery finds that effect in the journal and can undo or complete it

### Requirement: REQ-8 Crash at any step leaves a recoverable state

For every step N of an install, update, uninstall, or rollback, a crash after step N followed by recovery SHALL leave either the complete previous state or the complete new state, never a mix, and this SHALL be verifiable in-process without a process boundary.

#### Scenario: Crash injected after each step

- **WHEN** a test injects a crash after step N, for every N of an install, and then runs recovery
- **THEN** each outcome equals the state before the install or the state after a successful install

### Requirement: REQ-9 Previous journal formats for one minor release

Recovery SHALL recognise the journal formats written by the previous minor release and SHALL complete or undo them according to that format's commit point. A journal format older than the previous minor release SHALL fail closed with remediation that names the earlier release whose `--recover` handles it. The Python installer journal and the Node publisher's held journal were written by 0.72 and 0.73, so from 0.75.0 they are older than the window: an unfinished Python Host journal (`active` or `rollback_incomplete`) or a publisher journal carrying a `hold` SHALL block without changing files and name `--recover` of dhpk 0.74.x. Python Host journals already `committed` or `rolled_back` remain accepted as history. Receipts SHALL NOT be rewritten to a new format by this recovery.

#### Scenario: In-flight previous-release journal

- **WHEN** a run finds an interrupted installer journal written by the previous minor release
- **THEN** it completes or undoes that transaction under the previous rules and then proceeds

#### Scenario: Journal older than the window

- **WHEN** a run finds a journal format from two or more minor releases back
- **THEN** it blocks without changing files and names the release whose `--recover` to run first

#### Scenario: Unfinished 0.72 or 0.73 journal

- **WHEN** a run finds an unfinished Python Host journal or a publisher journal with a `hold`
- **THEN** it blocks without changing files and names `--recover` of dhpk 0.74.x
