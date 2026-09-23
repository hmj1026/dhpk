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
`--title` overrides it. The body contains summary bullets, the ticket link,
and a test plan. Before any PR creation, run the pre-flight checks in
[`references/workflow.md`](https://github.com/hmj1026/dhpk/blob/main/skills/create-pr/references/workflow.md), including
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
- [ ] The selected title, ticket, body, and test plan are present.

## References

- [`references/workflow.md`](https://github.com/hmj1026/dhpk/blob/main/skills/create-pr/references/workflow.md) — option resolution,
  pre-flight evidence, command shape, and failure handling.
