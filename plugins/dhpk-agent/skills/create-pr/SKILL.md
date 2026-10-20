---
name: create-pr
description: "Create a GitHub pull request from a pushed branch with ticket-aware title and body generation. Not for: committing, pushing, merging, releasing, or editing an existing PR. Output: a dry-run gh pr create command by default, or the created PR URL after explicit execution."
metadata:
  dhpk-capability-id: "dhpk.skill.create-pr"
  dhpk-invocation-class: "explicit-only"
  dhpk-name-style: "portable-skill"
  dhpk-next:
    PASS: "none"
    FAIL: "none"
    BLOCKED: "none"
    NOT_RUN: "none"
    UNAVAILABLE: "none"
---

# Create PR

## Workflow

Run in the consumer repository and preserve the supplied arguments. Resolve
the selected head and base once, before the commit count, log, diff, ticket,
push check, existing-PR query, or `gh` command. An explicit `--head` wins.
When it is omitted, the selected head is the current branch. An explicit
`--base` wins. When it is omitted, use `{TARGET_BRANCH}` and then `main`. A
ref that does not resolve is `BLOCKED`; do not substitute the checkout or
another branch.

Extract a ticket from the selected head name with `{TICKET_PATTERN}` (default
`[A-Z]+-\d+`), then generate `<type>: [<TICKET>] <summary>` unless
`--title` overrides it. Build the body from a concise summary, the ticket link
when resolved, and verification evidence for that selected range. Separate
checks actually run on the selected range from planned checks marked
`NOT RUN`. A result observed only on a different checkout is `NOT RUN` for
this request. For behavior changes, include a compact before/after example or
evidence. Label an unobserved after-state as expected and list its check as
`NOT RUN`. Add rollback and blast-radius details when they materially affect
review. Use a visual aid only when it clarifies the change; do not include
one by default. Before any PR creation, run the pre-flight checks in
[`references/workflow.md`](references/workflow.md). Count commits with
`git rev-list --count <selected-base>..<selected-head>`. A zero count stops
with `No commits between <selected-base> and <selected-head> — nothing to open a PR for`.

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

- [ ] The selected head and base resolve, and that range's commit count is non-zero.
- [ ] The selected head is pushed and no matching PR already exists for that head and base.
- [ ] Dry-run performed no PR mutation, or execute mode has a returned URL.
- [ ] The title, body, ticket, and diff describe the selected head and base.
- [ ] Observed checks and planned `NOT RUN` checks are distinct; behavior
      changes include before/after evidence, with unobserved after-states
      marked expected; material rollback or blast radius is described.

## References

- [`references/workflow.md`](references/workflow.md) — option resolution,
  pre-flight evidence, command shape, and failure handling.
