# graduation-scan-scope Specification

## Purpose
TBD - created by archiving change harvest-advice-20260712. Update Purpose after archive.
## Requirements
### Requirement: The graduation Stop hook only scans and regenerates the candidates report

`scripts/hooks/stop-graduation-scan.sh` SHALL limit its writes to its two artifacts — `.claude/artifacts/memory-usage-counts.json` (cross-session count/confidence accrual) and the auto-generated region of `.claude/artifacts/graduation-candidates.md` — and SHALL NOT create directories or files under `openspec/changes/`. Turning a graduation candidate into an OpenSpec change remains a human / `dhpk:rules-distill` decision driven by the candidates report.

#### Scenario: A high-confidence candidate produces no change directory

- **WHEN** the hook processes a transcript citing a memory entry whose accrued confidence and count exceed the former auto-draft thresholds (confidence ≥ 0.7, count ≥ 3)
- **THEN** the candidates report lists the entry as a graduation candidate, and no `openspec/changes/graduate-<entry>/` directory is created

#### Scenario: Candidates report regeneration stays idempotent

- **WHEN** the hook runs twice over the same transcript state
- **THEN** only the `<!-- AUTO-GENERATED -->` region of `graduation-candidates.md` differs from the template baseline, and repeated runs produce identical output

### Requirement: The auto-draft removal leaves no dead references

Removing the OpsX auto-draft path SHALL also remove the `CLAUDE_HOOK_SKIP_OPSX_DRAFT` escape hatch and the never-consumed `graduated_at` field, and SHALL leave no reference to the auto-draft behavior in tests, templates, or docs. The hook's test SHALL assert the no-draft behavior as a regression case instead of skipping the path.

#### Scenario: No skip-variable or dead-field residue

- **WHEN** the repository is grepped for `CLAUDE_HOOK_SKIP_OPSX_DRAFT` and `graduated_at` after the change
- **THEN** no occurrence remains under `scripts/`, `tests/`, `templates/`, or `docs/`

#### Scenario: Test exercises the no-draft path directly

- **WHEN** `tests/stop-graduation-scan.test.js` runs against a fixture whose entry meets the former auto-draft thresholds
- **THEN** the test asserts that no `openspec/changes/` path is created, without relying on a test-mode skip variable
