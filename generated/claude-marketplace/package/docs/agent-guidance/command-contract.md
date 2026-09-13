# Command Contract

Every command keeps its frontmatter invocation class and route semantics in
the command file. This page defines the shared writing boundary:

- State the trigger and nearest non-use boundary before detailed mechanics.
- Preserve accepted arguments, flags, target routes, and tool entitlements.
- Stop on missing or invalid input and report the exact failure; do not claim
  completion from a plan or a command that did not run.
- Completion reports the observable output path, count, PASS/FAIL/verdict, or
  next handoff required by the command.
