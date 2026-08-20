## ADDED Requirements

### Requirement: Surface operations use the unified command seam
Every retained surface SHALL expose generation, structural validation, and verification through the unified distribution command seam. Per-surface generator or validator executables SHALL not remain public maintained Interfaces; private test-only integration fixtures are permitted.

#### Scenario: A maintainer invokes validation
- **WHEN** a maintainer requests `dhpk distribution cursor-plugin validate`
- **THEN** the command returns the structured result from the shared distribution Module and no legacy validator is required

## REMOVED Requirements

### Requirement: Projection migration is characterization-gated
**Reason**: The approved major release performs one reviewed breaking cut to the unified Interface rather than retaining dual pipelines.
**Migration**: Use the unified distribution command and its contract tests; legacy per-surface generator and validator commands are removed from public documentation, CI, release gates, and consumer automation.
