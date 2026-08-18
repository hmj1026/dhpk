# agent-trap-sheet-guidance Specification

## Purpose

Canonical `agent-traps/` is a first-class agent-facing document class: `_common/`
owns shared loader and defense text, each `<agent>/<stack>.md` holds only that
pair's unique executable traps, and Codex/Cursor mirrors are regenerated from
the canonical tree.

## Requirements

### Requirement: Common trap files are the shared SSOT

Canonical `agent-traps/_common/` SHALL own the trap-sheet loader, prompt-defense, build-resolver skeleton, and CLI prompt composition texts. Per-agent stack sheets and agent bodies SHALL point at those files instead of copying them. Edits to loader detection order or prompt-defense rules SHALL happen only in `_common/` and only in a change that specifies that behavior.

#### Scenario: A stack sheet does not paste the loader

- **WHEN** validation inspects `agent-traps/<agent>/<stack>.md`
- **THEN** the file does not contain the shared project-root detection procedure owned by `agent-traps/_common/trap-sheet-loader.md`

#### Scenario: Prompt-defense has one full statement

- **WHEN** the repository is searched for the distinctive prompt-defense instructions
- **THEN** `agent-traps/_common/prompt-defense.md` carries the full text and other trap sheets only point at it

### Requirement: Each stack sheet holds only that agent-stack pair

Each `agent-traps/<agent>/<stack>.md` SHALL contain only traps unique to that agent and stack. Cross-agent language floors, OWASP examples, or framework tables that already have an owner SHALL be replaced by a pointer to that owner. `frontend-reviewer` MAY keep using `modules/js/references/` instead of trap sheets until a later change proves duplication with `code-reviewer` js/vue sheets.

#### Scenario: security-reviewer PHP keeps the OWASP pointer

- **WHEN** `agent-traps/security-reviewer/php.md` is rewritten
- **THEN** generic PHP OWASP examples remain a pointer to `skills/dhpk-php-runtime-router/references/agent-extracts/security-owasp-examples.md` and the sheet keeps only security-reviewer-specific false positives and examples

#### Scenario: code-reviewer PHP floor table points at coding-style when that file owns it

- **WHEN** `modules/php-5.6/references/coding-style.md` already states the PHP language-floor or banned-syntax table
- **THEN** `agent-traps/code-reviewer/php.md` points at that file instead of restating the banned-syntax table or the stale `rules/php/coding-style.md` path

#### Scenario: frontend-reviewer is not forced onto trap sheets

- **WHEN** the trap-sheet pass runs
- **THEN** no `agent-traps/frontend-reviewer/` directory is required and `agents/frontend-reviewer.md` may keep loading `modules/js/references/`

### Requirement: Trap rows are executable and bounded

Every retained trap SHALL state an observable trigger and the required agent action, and SHALL include a false-positive or non-apply bound when the pattern is commonly over-fired. Negation-only stacks of “do not” lines without a positive action SHALL be rewritten or removed. Each canonical trap sheet SHALL receive an updated, already-compliant, or exempt disposition in the implementation evidence.

#### Scenario: A PHP injection trap names the fix

- **WHEN** a security-reviewer PHP sheet lists unparameterized SQL
- **THEN** the row names the trigger (string-concatenated query) and the action (bound parameters / prepared statement) plus at least one false-positive bound or non-apply case

#### Scenario: Every canonical sheet has a disposition

- **WHEN** the trap-sheet pass completes
- **THEN** every file under canonical `agent-traps/` including `_common/` has a recorded disposition and none is silently omitted

### Requirement: Trap sheets are edited only in the canonical tree

Canonical `agent-traps/` SHALL be the only authoring tree for trap sheets. Codex and Cursor supporting-asset mirrors SHALL be regenerated from that tree. Hand-editing `cursor/` or `codex/` trap copies SHALL fail validation.

#### Scenario: A generated mirror is hand-patched

- **WHEN** a Codex or Cursor trap-sheet mirror differs from the canonical file after regeneration
- **THEN** validation fails and names the drifted path
