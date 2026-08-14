# e2e-native-dialog-handling Specification

## Purpose
TBD - created by archiving change harvest-advice-20260708. Update Purpose after archive.
## Requirements
### Requirement: e2e-runner registers a native-dialog handler before a destructive interaction

The `e2e-runner` agent SHALL pre-register a native-dialog handler before interacting with any control that can raise a native `confirm()` / `alert()` / `prompt()` (delete / confirm / discard / clear / void-class destructive actions), because such dialogs block Playwright — the driving call does not resolve until the dialog is handled, and an unhandled dialog stalls the journey silently with no error. The handler accepts or dismisses per the test's intent (`page.once('dialog', d => d.accept())` / `d.dismiss()`, or the `playwright-cli` skill's `dialog-accept` / `dialog-dismiss` command). The always-loaded Playwright trap sheet (`agent-traps/e2e-runner/playwright.md`) SHALL document this trap, its diagnostic signature (an interaction that stalls with no error and no assertion failure), and a worked example.

#### Scenario: Destructive action pre-registers a dialog handler

- **WHEN** an `e2e-runner` journey clicks a control that raises a native `confirm()` (e.g. a
  delete/clear/void action)
- **THEN** a dialog handler is registered before the click, so the click resolves and the journey
  proceeds instead of hanging on the unhandled dialog

#### Scenario: Trap sheet documents the native-dialog trap

- **WHEN** the `e2e-runner` trap sheet `agent-traps/e2e-runner/playwright.md` is loaded
- **THEN** it lists a native-dialog trap describing that `confirm()`/`alert()`/`prompt()` block until
  handled, names the pre-registered-handler fix, and notes that a silent stall with no error is the
  signature of an unhandled dialog

#### Scenario: Agent key principle points to the dialog trap

- **WHEN** the `agents/e2e-runner.md` key-principles section is read
- **THEN** it includes a line directing the agent to register a dialog handler before destructive
  clicks, referencing the trap sheet
