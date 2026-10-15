---
name: react
description: "React runtime guidance for root setup, concurrent rendering, StrictMode effects, Actions, hooks, refs, and React 18/19 migrations. Use for version-specific React implementation or review after resolving the target package. Not for Next.js framework APIs or generic JS tooling. Output: target-scoped guidance, migration traps, and verification evidence."
metadata:
  dhpk-invocation-class: implicit-eligible
---

# React

Describe the React task directly, for example: “Review effect cleanup in
packages/admin” or “Migrate packages/web from React 18 to React 19.”
Optional `review` or `migrate` prefixes express the same tasks.

1. **Target.** Read [target-selection.md](references/target-selection.md), then
   resolve the package/subproject and React version from explicit task inputs
   and that package's evidence. Complete its clarification gate before reading
   a version resource or taking a version-dependent action.
2. **Load.** For a resolved React 18 target, read [18.md](references/18.md).
   For React 19, read [19.md](references/19.md). Read both only for an explicit
   18-to-19 migration or multiple resolved targets, and group notes by target.
   Load only the selected resource; the links are a menu, not a preload list.
3. **Apply.** Match root APIs, effects, hooks, and migration traps to the
   selected target and requested change. Keep Next.js framework decisions in
   the separate Next.js family. A React task can finish from this directory
   without finding another skill or an ambient repository document.
4. **Verify.** Report the package path, target/version evidence (including an
   intentional override), selected references, recommendations or applied
   changes, and actual checks. Distinguish guidance from verified runtime
   behavior; report unavailable checks as `NOT_RUN`.

## Resource boundary

Resolve bundled links relative to this skill's real directory. Before loading
a selected resource, verify that it exists and its real path stays within this
directory. Missing, absolute, traversal, or symlink-escaping required resources
return `BLOCKED_RESOURCE_MISSING`; stop the dependent action without searching
the checkout, predecessor skills, sibling skills, or environment for a copy.
Target project manifests and source files are explicit task inputs, not bundled
fallback resources.

## Output

Return target-scoped React guidance or changes, the relevant migration traps,
and verification evidence. For unresolved targets, return one grouped
clarification and wait; provide no version-specific recommendation yet.
