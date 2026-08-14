# sensitive-file-guard Specification

## Purpose
TBD - created by archiving change harvest-advice-20260711. Update Purpose after archive.
## Requirements
### Requirement: Sensitive-file write protection is symmetric across Write/Edit and Bash
The harness SHALL block Bash shell writes into `.env` files (redirection `>`/`>>` and `tee`,
including `.env.<suffix>` variants) with the same policy that blocks Write/Edit against them, so
the guard cannot be bypassed by switching tools. Template files (`.env.example`, `.env.sample`,
`.env.dist`) SHALL remain writable. The block message SHALL name the sanctioned alternative (ask
the user; use .env.example as a template).

#### Scenario: Heredoc bypass is closed
- **WHEN** a Write to `.env` is blocked and the model retries via `cat > .env <<'EOF'`
- **THEN** the Bash guard blocks the redirection with a message explaining the policy and the sanctioned path

#### Scenario: Template env files remain writable
- **WHEN** the model writes `.env.example`
- **THEN** neither guard blocks the write
