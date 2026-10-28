# dhpk Project Convention

Applies only when developing the dhpk repository. Consumer projects supply
their own Project Convention; portable skills and execution bundles do not
load this file. Its presence among Claude package-root maintainer documents
does not make it a consumer workflow requirement.

The root `AGENTS.md` selects this convention alongside the generic execution
policy. User authorization and the execution-policy kernel's safety, dirty-work,
and evidence boundaries still apply.

## Branches and Git authority

Use dhpk's git-flow model: `feat|fix|docs|refactor/*` targets `develop`; release
work integrates into the configured release branch. This repository's PR base
is `develop`. For `create-pr`, pass `--base develop` or supply
`{TARGET_BRANCH}` as `develop` through the project instructions.

Keep staging, commit, push, and stash inside the user's authorization and
assigned scope. Use the applicable commit and PR tools or sufficient existing
evidence; a verification verdict alone does not grant Git write authority.
Before a follow-up push, check the PR's state and base so a merged/deleted
branch does not receive orphaned work.

PR self-merge is classifier-blocked in this repository. Hand merge to a human;
do not attempt `gh pr merge --admin` or remote branch deletion from an agent
session.

After syncing this checkout, check a locally installed compatibility projection
when `.agents/skills/.dhpk-projection.json` exists with `npm run check:local-skills`.
Use `npm run sync:local-skills` to update owned files from canonical sources and
validate the result. Preserve reported modified or unmanaged conflicts; keep a
backup before repair. This local installation check is separate from package CI
and is not required in a fresh checkout without that receipt.

## Delivery and verification

Resolve all assigned tasks, applicable reviews, and verification obligations
before handoff. For work using an OpenSpec change, complete its required
verification, archive, and spec synchronization under
[OpenSpec authoring](../docs/agent-guidance/openspec-authoring.md). A known-cause
repair or an adequate confirmed specification does not acquire an OpenSpec
authoring requirement from this convention. External `/opsx:apply` is unchanged.

Every non-test-only change includes a valid changelog fragment or `.none`
marker under the [plugin development contract](../docs/agent-guidance/plugin-development.md).
Daily verification follows [testing governance](../docs/testing-governance.md):
the authoritative plan's required checks and affected surfaces close the scoped
obligation, with no added unconditional `npm run ci`. For outputs the plan
selects, follow the scoped clean-source provenance and generated-output steps
in the plugin development contract. Full and release routes retain complete
validation, including four-surface generation when required and `npm run ci`
on a clean generated-output commit. Reuse evidence under the kernel's snapshot
rule and report local aggregate, focused checks, and Hosted CI separately.

Open a Draft PR targeting `develop`, monitor that PR's actual CI to a terminal
conclusion, and retain the human merge checkpoint. Prefer `gh run watch`
over shell polling. Queued or partial CI and unavailable required consumer
evidence remain incomplete.

For squash-merge PRs, include an `Unrelated Changes` section when relevant:
list unrelated paths, size, reason, and reviewer. The `change-verdict` PR
mode's unrelated-change checker remains advisory.

## Closeout

Before substantial handoff, after a large edit, or before smart-commit, use
`$flow-guide close` to account for changed files, applicable gates, risks, and
the next action. Daily single-line edits, pure research, and typos do not
need it. Fix applicable unmet obligations before claiming completion; the
closeout report does not itself prove merge, release, or deployment.
When a CI plan applies, report its base/head/checkout identity, classification
status and reason, required and skipped checks, observed outcomes, and remaining
gaps according to testing governance.

## Shell habits

This development environment uses zsh. `status` is read-only: use `st` or `rc`
for captured exit codes. Quote words beginning with `=` to avoid zsh command
path expansion. Consumer environments choose their own shell conventions.
