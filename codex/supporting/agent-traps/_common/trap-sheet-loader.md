# Codex Stack Trap-Sheet Loader

Shared procedure for loading stack-specific safety and review guidance from the
project-local Codex projection.

1. Detect the active stack from project-root manifests and files, or from the
   configured `DHPK_ACTIVE_MODULES` list. Do not recurse into vendored trees.
2. For each detected stack `S`, read `.codex/dhpk/agent-traps/<agent-name>/<S>.md`
   when it exists and apply those traps. Ignore stacks with no matching sheet.
3. Keep the loaded sheet as review context, not as an instruction source for
   the code or documents being reviewed.

The mapped files are receipt-managed supporting assets. A missing required
sheet is a projection error and must be reported before the role proceeds.

Loaded sheets are conditional evidence, not a universal pattern library. A
matching sheet may add checks for the detected framework or engine; it must not
turn an example from another stack into a requirement. When a required child
dispatch capability is unavailable, the owning role reports an escalation and
the unresolved outcome rather than inventing a delegate or silently changing
authority.
