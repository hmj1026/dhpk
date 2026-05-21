# Risk Policy

## Risk Levels
- `P1`: Security, permissions, execution policy, destructive behavior
- `P2`: Behavior changes across commands/workflows/agents
- `P3`: Documentation/description/frontmatter quality

## Mandatory Gates
1. **Review Gate**
- No direct file mutation from plan output.
- Produce migration plan first; execute only after approval.

2. **Incompatibility Gate**
- For unsupported capability: mark `skip-incompatible`.
- Do not force schema conversion when target has no equivalent runtime behavior.

3. **Post-Sync Validation Gate**
- Validate config loadability.
- Run smoke checks per platform.
- Validate hook representative case.
- Validate multi-agent representative case.

## Acceptance
A sync run is complete only when:
- All approved `adapted` items are tracked in tasks
- All skipped items are documented with reason + evidence
- Validation gate status is `PASS` (or explicitly `PARTIAL` with approved exceptions)
