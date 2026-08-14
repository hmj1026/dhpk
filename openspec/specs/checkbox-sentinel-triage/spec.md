# checkbox-sentinel-triage Specification

## Purpose
TBD - created by archiving change harvest-advice-20260711. Update Purpose after archive.
## Requirements
### Requirement: Checkbox-only classification uses the per-edit delta, not the cumulative diff
The post-edit sentinel triage SHALL classify a tasks.md edit as checkbox-only from the edit's own
old/new payload when available (Edit tool old_string/new_string), falling back to the cumulative
`git diff HEAD` cancellation check only when no per-edit payload exists (Write, heredoc). A pure
checkbox flip SHALL NOT arm `.pending-doc-review` regardless of unrelated uncommitted prose
changes elsewhere in the same file.

#### Scenario: Flip after an uncommitted prose edit does not re-arm doc-review
- **WHEN** tasks.md already carries an uncommitted prose delta (e.g. a `[blocked: ...]` annotation) and a subsequent Edit flips one checkbox `- [ ]` to `- [x]`
- **THEN** the flip edit does not arm `.pending-doc-review` (the earlier prose edit already armed its own review when it happened)

#### Scenario: Mixed single edit keeps the sentinel
- **WHEN** one Edit both flips a checkbox and changes prose in its old/new pair
- **THEN** the triage keeps `.pending-doc-review` armed

#### Scenario: Non-Edit writes fall back to cumulative classification
- **WHEN** tasks.md is written via Write or a Bash heredoc (no old/new payload)
- **THEN** the triage applies the existing cumulative-diff cancellation check
