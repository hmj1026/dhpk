---
trigger: model_decision
description: Execution policy single source of truth
---
# Execution Policy

For routing, dispatch, review, git, or escalation questions, select the
[full execution policy](../skills/flow-guide/references/execution-bundle/rules/execution-policy.md).
Resolve this link relative to this rule file's directory, not the consumer
working directory. Derive `POLICY_BUNDLE_ROOT` from the selected resource's
real grandparent. Read its kernel first, then load only required sections.
