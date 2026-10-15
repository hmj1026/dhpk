---
name: nextjs
description: "Next.js framework guidance for routing, typegen, typed routes, build tooling, async Request APIs, configuration, and Next.js 15.5/16 migrations. Use for version-specific Next.js implementation or review after resolving the target package. Not for standalone React APIs or generic JS tooling. Output: target-scoped guidance, migration traps, and verification evidence."
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Next.js

Describe the framework task directly, for example: “Review build scripts in
apps/store” or “Migrate apps/store from Next.js 15.5 to Next.js 16.”
Optional `review` or `migrate` prefixes express the same tasks.

1. **Target.** Read [target-selection.md](references/target-selection.md), then
   resolve the package/subproject and Next.js version from explicit task inputs
   and that package's evidence. Complete its clarification gate before reading
   a version resource or taking a version-dependent action. Finish this step
   with a read plan naming the package, requested task, compatibility target,
   and allowed version resource(s). Complete the plan before issuing any read
   that includes a version resource.
2. **Load.** For a resolved Next.js 15.5 target, read [15.5.md](references/15.5.md).
   For Next.js 16, read [16.md](references/16.md). Read both only for an explicit
   15.5-to-16 migration or multiple resolved targets, grouping notes by target.
   Execute the read plan only. For a single-target compatibility review, an
   explicit override selects exactly one version resource; the installed or
   manifest version is evidence, not permission to read its resource. A review
   targeting 16.0.10 with a 15.5.9 manifest reads only `16.md`. Source-plus-target
   loading requires a requested migration comparison with both roles resolved.
3. **Apply.** Match framework APIs, environment floors, build configuration,
   and migration traps to the selected target. Confirm the target package's
   React compatibility separately before any React-dependent advice. Standalone
   React implementation belongs to the separate React family; a Next.js task
   can finish from this directory without finding a peer skill.
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

Return target-scoped Next.js guidance or changes, the relevant migration traps,
and verification evidence. For unresolved targets, return one grouped
clarification and wait; provide no version-specific recommendation yet.
