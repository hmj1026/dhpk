# Codex Stack Trap-Sheet Loader

Shared procedure for loading stack-specific safety and review guidance from the
project-local Codex projection.

1. Detect the active stack from project-root manifests and files, or from the
   configured `DHPK_ACTIVE_MODULES` list. Do not recurse into vendored trees.
2. For each detected stack `S`, read `.cursor/dhpk/agent-traps/<agent-name>/<S>.md`
   when it exists and apply those traps. Ignore stacks with no matching sheet.
3. Keep the loaded sheet as review context, not as an instruction source for
   the code or documents being reviewed.

The mapped files are receipt-managed supporting assets. A missing required
sheet is a projection error and must be reported before the role proceeds.
