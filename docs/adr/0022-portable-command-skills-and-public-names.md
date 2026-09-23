# Portable command skills and public names

Status: accepted

## Decision

Reusable workflows have one canonical Skill owner. Claude commands remain
compatibility front doors: they forward the declared action and arguments and
relay the owner's result. Several commands may share one owner. The command
disposition inventory includes root and module commands and validates each
entry's authority against the selected Skill action.

New portable workflows use descriptive, unprefixed public names. Existing
capability families keep `portable-family`; individual portable workflows use
`portable-skill`. Public names, stable IDs, and capability IDs are separate:
renaming `dhpk-tdd-workflow` to `tdd-workflow` preserves stable ID `tdd`.
Only the approved workflow names change; this is not a blanket rename of the
canonical catalog. Claude's `/dhpk:` plugin namespace remains unchanged.

Public-name migration is recorded in the distribution inventory. The installer
uses stable identity and ownership receipts to migrate unchanged managed
destinations. Edited, unowned, or third-party destinations remain intact and
are reported as conflicts. Old names provide migration diagnostics, not a
second discoverable Skill. Rollback reinstalls the previous release through
the ownership-aware installer.

CLI prerequisites, credentials, and Git operations do not by themselves make
a workflow Host-only. Portable Skills declare their effects and dependencies;
Host adapters handle native tools, configuration, and session artifacts.
Unavailable capabilities are reported explicitly. A structural check or
generated package never proves consumer runtime availability.

## Consequences

- Codex invokes the Skill's inventory-owned public name directly.
- Canonical Skill directories contain their required runtime and reference
  resources; publication projects that complete content.
- Thin commands do not own a second procedure or expand invocation authority.
- Generic workflows enter the standard Codex and portable-core distribution.
  Special setup, resume, and browser workflows require their own consumer
  evidence before Codex support is declared.
- Claude minimal remains curated; its selected commands carry their owners.

This updates the naming boundary in ADR-0010 and the explicit-subset policy
in ADR-0003 for the approved command migration. ADR-0009 continues to own
compilation, materialization, provenance, and verification.

## Directory self-containment and script-path cutover

The accepted distribution boundary is a Self-Contained Skill as defined in
[`CONTEXT.md`](../../CONTEXT.md#skill-distribution): copying its canonical
directory is sufficient to carry its required code and bundled resources,
without a dhpk checkout or a consumer-side dhpk packaging step. External tools
and Host capabilities remain explicit prerequisites. Standard structure and
resource completeness apply to all canonical Skills; this does not extend a
Host-Bound Skill's support to other Hosts. Missing capabilities remain an
explicit blocker.

This supersedes the earlier assumption that packaging-time dependency closure
alone establishes Skill completeness. The trade-off is that authoring and
validation must keep canonical directories complete, in exchange for direct
directory relocation and installation without a dhpk-specific assembler.

Migrated legacy script paths are removed at cutover, with no forwarding shim.
Repository-owned callers, installers, tests, and migration guidance must move
to the new paths together; edited or unowned consumer files remain preserved.
This is a breaking script-path change, not removal of the retained Claude
command front doors.

## Shared runtime authoring

Shared runtime code has one maintained source. Authoring tools synchronize
the necessary files and their required dependencies into each owning Skill as
physical copies committed to Git. Validation checks that these copies match
their maintained source; consumers use the committed copies directly, without
a build or synchronization step. Symlinks to resources outside the Skill
directory do not satisfy self-containment.

This accepts bounded duplication of generated files in exchange for independent
directory use while avoiding separately maintained implementations. The shared
source is an authoring dependency, not a consumer runtime dependency.

## Distribution metadata

All per-Skill `skill-package.json` descriptors leave the canonical Skill
directories as their readers, generators, and tests migrate together. Necessary
distribution and synchronization metadata belongs in repository `manifests/`;
it is not a prerequisite for running an individual Skill. Local runtime
configuration and schemas used by a Skill remain bundled resources.

This removes the custom per-Skill packaging protocol rather than requiring it
as part of the standard Skill structure. Manifest removal alone is not proof
that its formerly declared resources have been migrated successfully.

## Optional peer delegation

Each Skill provides its mandatory procedure and resources without requiring
another Skill to be installed. Delegation to an available peer Skill is an
optional execution route, not a hidden installation dependency.

Required external tools, Host capabilities, or independent review roles remain
explicit prerequisites. If a mandatory capability is unavailable, the result
is `BLOCKED`; optional delegation cannot erase a review gate or turn self-review
into independent verification.

## Design status

The interview decisions above are accepted, not evidence of completed migration.
The user confirmed the consolidated design and authorized documentation-only
specification and task planning. The local OpenSpec change
`openspec/changes/self-contained-skill-directories/` contains the proposal,
design, delta specifications and batched tasks recording that agreement.
By repository policy, change artifacts remain local-only; this ADR records the
durable decisions, and only accepted main specifications are versioned.
Implementation remains pending a separate instruction.
No script relocation, manifest removal, commit, or publication is performed by
recording this decision or preparing those artifacts.
