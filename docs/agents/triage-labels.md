# Issue Triage Labels

Use this guide with the [issue-tracker procedures](issue-tracker.md), which
remain authoritative for reading, labeling, commenting on, and closing GitHub
issues. The descriptions below match the existing repository labels.

Apply only the existing label names listed here. Labels record an issue’s
current triage state or route; they do not authorize implementation, external
writes, shared-data changes, deployment, merge, or release. Explicit user
authorization and the required project gates still apply.

## `needs-triage`

> Maintainer needs to evaluate this issue

Apply while a maintainer still needs to classify the request, identify its
owner, or choose the next triage step. Clear it after that evaluation and
update labels to reflect the issue’s current state.

## `needs-info`

> Waiting on reporter for more information

Apply after a maintainer has asked the reporter a specific question needed to
evaluate or proceed with the issue. Keep the request in the issue discussion.
Re-evaluate the issue when the reporter responds; retain this label only while
the needed information is still outstanding.

## `ready-for-agent`

> Fully specified, ready for an AFK agent

Apply after a maintainer confirms that the issue states its target, scope,
acceptance evidence, relevant inputs, and known dependencies or stop
conditions clearly enough for unattended work. The label signals readiness
for that work; it does not grant permission to cross an authorization or
project gate.

## `ready-for-human`

> Requires human implementation

Apply after triage determines that a person must implement the issue. Record
the reason in the issue so the label routes the work clearly.

## `wontfix`

> This will not be worked on

Apply after maintainers decide not to pursue the issue, and record the reason
in the issue. This label alone does not close the issue; follow the
issue-tracker procedure if closing it.
