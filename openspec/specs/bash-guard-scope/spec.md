# bash-guard-scope Specification

## Purpose
TBD - created by archiving change harvest-advice-20260711. Update Purpose after archive.
## Requirements
### Requirement: Destructive-command blocking on user-data roots is depth-limited
The pre-bash guard SHALL block `rm -rf` (and equivalent recursive-force deletions) against
`/home`, `/home/<segment>`, `/opt`, `/opt/<segment>`, `/srv`, `/srv/<segment>` (depth ≤ 2), and
SHALL allow the same commands against deeper descendant paths (workspace-internal paths such as
`/home/<user>/projects/<repo>/...`). System roots (etc, usr, bin, sbin, lib, lib64, boot, proc,
sys, dev, run, root, snap) remain blocked at any depth.

#### Scenario: Deep workspace path passes
- **WHEN** the model runs `rm -rf /home/paul/projects/zdpos-217/openspec/changes/<slug>`
- **THEN** the guard allows the command

#### Scenario: Whole-home deletion stays blocked
- **WHEN** the model runs `rm -rf /home/paul` or `rm -rf /home`
- **THEN** the guard blocks the command

#### Scenario: System root at depth stays blocked
- **WHEN** the model runs `rm -rf /etc/nginx/conf.d`
- **THEN** the guard blocks the command
