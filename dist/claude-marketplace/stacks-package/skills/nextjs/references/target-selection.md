# Target selection

Resolve the target before reading a version-specific resource, recommending a
version-dependent API, editing code/configuration, or running a codemod/build.
Reading this nonversioned procedure and the target's manifest, lockfile, and
configuration is allowed while gathering evidence.

1. **Scope.** Identify the requested package/subproject first. In a monorepo,
   use the named workspace's manifest and its matching lock/configuration
   evidence. A root dependency or installed runtime does not select an unnamed
   workspace. If the package scope is unspecified or ambiguous, ask and wait.
2. **Override.** An intentional explicit version override for a named target
   takes precedence over installed/current evidence. Record it as the intended
   compatibility target; do not rewrite the manifest or assume a migration was
   authorized merely because an override was supplied. If intent or scope is
   unclear, ask whether the named version is the requested target. For a
   single-target compatibility review, lock the read plan to the override's
   version resource. For example, a 16.0.10 review overriding a 15.5.9 manifest
   selects only `16.md`; reading `15.5.md` requires a separately requested
   source-to-target migration comparison, or an explicit additional target.
3. **Evidence.** Without an override, use reliable package-scoped lockfile,
   manifest, and relevant configuration evidence at its actual precision.
   A lock entry must belong to the selected package. Conflicting reliable
   evidence requires clarification, not silently choosing a winner. Installed
   executables report the execution environment, not target compatibility.
   Confirm related runtime/dependency constraints before dependent advice.
4. **Precision.** Accept a range only when it uniquely identifies a supported
   guidance lane and supplies any minor/patch precision needed for the action.
   Broad ranges spanning lanes, unsupported versions, floating tags, missing
   manifests/evidence, or unresolved lock/config conflicts require asking and
   waiting. A supported major alone does not establish availability of a
   feature introduced in a later minor; resolve that precision first.
5. **Migration.** Require an explicit destination version and package scope.
   The installed version identifies a possible source, not the desired target.
   Ask and wait if the destination is missing. Once both are resolved, load
   source and target resources only when needed, labeling each role.
6. **Multiple targets.** When the user explicitly requests several targets,
   keep package evidence, references, guidance, changes, and checks grouped by
   target. Resolve every material ambiguity in one grouped clarification and
   wait before loading version resources or taking dependent actions for the
   unresolved work. Independently resolved work may proceed only if it does
   not depend on an unanswered target.

## Clarification gate

Ask one concise question collecting all missing package, compatibility version,
conflict-resolution, and migration-destination choices. State the observed
conflict or missing evidence. Wait for an answer: elapsed time, an available
runtime, a root workspace dependency, or a likely/latest version is not an
answer. Before the answer, return the clarification and gathered nonversioned
evidence only; do not load version resources, apply their advice, mutate files,
or execute dependent actions. Resume from the answered target, preserving the
user's intentional override.

## Next.js lanes

Next.js 15.5 selects `15.5.md`; Next.js 16 selects `16.md`. A broad `^15`
constraint without a resolved package-scoped version does not establish 15.5
features. Next.js 16 minor-specific tools need the resolved minor before advice.
For compatibility, the bundled notes cover React 18/19 with Next.js 15.5 and
React 18.2+ or 19 with Next.js 16; resolve the actual React target separately
before React-dependent action. Other Next.js versions need clarification or
explicitly scoped external evidence rather than silently selecting 15.5/16.
