# Parallel worktree workers

Use this page when one orchestrator dispatches several write-capable workers,
each on its own issue in its own linked worktree. Each step ends on its stated
completion criterion. The [execution policy](../../rules/execution-policy.md)
still owns review, CI, and PR checkpoints, and
[maintainer delivery](maintainer-delivery.md) owns the hosted CI watch and the
merge gate.

## Shared machine resources

Workers share one CPU, one memory budget, and one GitHub remote. These rules
apply to every worker on the machine. `<worktrees>` is the shared directory
that holds the linked worktrees.

- **One index refresh at a time.** Wrap the GitNexus refresh command named in
  [GitNexus recovery](gitnexus.md#recovery) in
  `flock <worktrees>/.gitnexus.lock <refresh-command>`. Concurrent refreshes
  can exhaust memory on a constrained host.
- **One timing run at a time.** Wrap every benchmark in
  `flock <worktrees>/.bench.lock <cmd>`, so the before/after medians of perf
  tickets stay comparable.
- **One full suite per worker.** When the plan requires `npm run ci` (see
  [testing governance](../testing-governance.md)), start it once and wait for
  it. Stop only the PIDs that you started; on Linux, other workers' test
  runners are recognized by their working directory, `/proc/<pid>/cwd`, and
  are left running.
- **Worktree count.** Keep three or four active worktrees at most.

Completion criterion: each lock is held only for the command it guards.

## Worker setup

1. Create the worktree from a fresh remote base:

   ```bash
   git -C <repo> fetch origin
   git -C <repo> worktree add --detach <worktrees>/<slug> origin/develop
   ```

2. Inside the worktree, run `git flow feature start <slug>`. If git flow
   refuses because local `develop` has diverged, run
   `git checkout -b feature/<slug> origin/develop` instead.
3. A fresh worktree has no GitNexus index. Build it under the index lock
   before the first `impact` call, following
   [GitNexus recovery](gitnexus.md#recovery) for runner identity.

Completion criterion: `impact` resolves a known symbol in the new worktree.

## Generated surfaces after a develop merge

Merging `origin/develop` into a feature branch usually conflicts only in
generated provenance and fingerprint files. For every conflicted file under
`generated/` or `plugins/*/`, take develop's side and commit the merge. Then
regenerate and check as described in
[plugin development](plugin-development.md#ci-preflight-for-generated-and-release-shaped-changes).

Completion criterion: `npm run check:generated` exits 0 on a clean tree.

## Interrupted workers

A worker stopped by an API error keeps its commits and its worktree. Resume
the same worker with a message that names the last commit and lists the
verification results that it never reported. The resumed worker re-runs only
those checks. Test runners from the stopped turn may still be alive; stop them
by PID after confirming their working directory.

Completion criterion: the resumed worker reports every check result against
the current head.

## Merge order

Merging stays human unless the user authorizes it; then follow the
[delivery gate](maintainer-delivery.md#delivery-gate). Deliver PRs serially:
before each one, merge the latest `origin/develop` into its branch, regenerate,
and push, so the gate sees an up-to-date head.

Completion criterion: the gate reports the merged head equal to the head whose
hosted checks passed.
