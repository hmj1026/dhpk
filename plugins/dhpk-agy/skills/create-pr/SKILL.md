---
name: create-pr
description: 'Create a GitHub pull request from a pushed branch with ticket-aware title and body generation. Not for: committing, pushing, merging, releasing, or editing an existing PR. Output: a dry-run gh pr create command by default, or the created PR URL after explicit execution.'
argument-hint: '[--head=<branch>] [--base=<branch>] [--title=<text>] [--execute] [--dry-run]'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# Create PR

## Workflow

Run in the consumer repository and preserve the supplied arguments. Resolve
`--head` to the current branch and `--base` to `{TARGET_BRANCH}` or `main`
when they are omitted. Gather the branch, remote, existing PRs, recent
commits, and diff statistics before composing the request.

Extract a ticket from the branch with `{TICKET_PATTERN}` (default
`[A-Z]+-\d+`), then generate `<type>: [<TICKET>] <summary>` unless
`--title` overrides it. Build the body from a concise summary, the ticket link
when resolved, and verification evidence. Separate checks actually run from
planned checks marked `NOT RUN`; for behavior changes, include a compact
before/after example or evidence. Label an unobserved after-state as expected
and list its check as `NOT RUN`. Add rollback and blast-radius details when
they materially affect review. Use a visual aid only when it clarifies the
change; do not include one by default. Before any PR creation, run the
pre-flight checks in
[`references/workflow.md`](references/workflow.md), including
`git rev-list --count <base>..HEAD`. A zero count stops with the exact message
`No commits between <base> and HEAD — nothing to open a PR for`.

Dry-run is the default and only prints a copy-pasteable `gh pr create`
command. `--execute` is the sole creation path: verify the branch is pushed,
verify no PR already exists, require the existing GitHub authorization, ask
for confirmation, and then report the URL. Do not push or create commits.

## When NOT to Use

- The branch still needs commits or a push.
- An existing PR must be edited, merged, or closed.
- A release, tag, or deployment is the requested operation.

## Output

- Dry-run: one copy-pasteable `gh pr create` command block and no PR URL claim.
- Execute: the URL returned by `gh pr create`.
- Missing refs, no commits, an unpushed branch, an existing PR, unavailable
  `gh`, failed authorization, or failed confirmation are terminal failures;
  never report a created PR without the URL evidence.

## Verification

- [ ] Head and base resolve and the base-to-HEAD commit count is non-zero.
- [ ] The head is pushed and no matching PR already exists.
- [ ] Dry-run performed no PR mutation, or execute mode has a returned URL.
- [ ] The title and body match the branch diff and any resolved ticket.
- [ ] Observed checks and planned `NOT RUN` checks are distinct; behavior
      changes include before/after evidence, with unobserved after-states
      marked expected; material rollback or blast radius is described.

## References

- [`references/workflow.md`](references/workflow.md) — option resolution,
  pre-flight evidence, command shape, and failure handling.
