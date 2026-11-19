# Flow Drive migration

The current `$flow-drive` entry accepts one bounded task, task-file path, or confirmed specification/change ID. `$flow-drive --help` is the only option. The current Host and Model execute the task with their native capabilities.

## Retired invocation interfaces

These forms select a separate execution route or role and are rejected as Flow Drive invocation syntax:

| Previous form | Disposition |
| --- | --- |
| `--mode route` or `--mode implement` | Retired. The old invocation-policy examples did not describe an option accepted by the pinned v0.66.7 parser. Flow Drive has no route or mode switch; provide a task, or invoke the optional Flow Guide separately for routing. |
| `--backend cli` or `--backend agy` | Retired. These appeared in older Codex Options guidance but are not accepted by the pinned v0.66.7 parser. The current Host and Model handle the task. |
| `--worker=auto` or `--worker=<provider>[/<model>[:<effort>]]` | Retired. Use the current Host and Model. |
| `--reasoner=<provider>[/<model>[:<effort>]]` | Retired. Use current Host reasoning or its explicitly authorized native roles. |
| Provider selections `claude`, `codex`, or `agy` through `--worker=` / `--reasoner=`; historical `--reasoner=codex-cli/<model>[:<effort>]` and `--reasoner=codex` forms | Retired. The v0.66.7 parser accepts the worker/reasoner provider selectors, including `--reasoner=codex`, but not the `codex-cli` spelling documented by an older Codex Options guide. There is no standalone `--provider` option in the pinned parser. No Provider selection remains in current Flow Drive. |
| `--cross` and `--cross-provider` | Retired. Flow Drive does not request alternate Providers or expand candidate sets. |
| `--plan`, `--plan=auto`, `--plan=bounded`, `--plan=discovery`, and `--plan-mode=<mode>` | Retired. The Host may plan within the supplied task and repository rules. |
| `--plan=<model>:<effort>` | Retired. Flow Drive does not select a planner model or effort. |
| `--worker-target=<provider>/<model>[:<effort>]` | Retired. Flow Drive does not select an external worker target. |
| `--architect` and `--no-architect` | Retired. Architecture consultation follows the current Host's own behavior and authorization. |
| `--codex` | Retired. There is no Codex-only diagnostic or shortcut. |
| `runFlowDrive(...)` and the package's exported runner | Removed. Invoke the skill through a supporting Host; there is no programmatic compatibility engine. |

Historical Provider, Model, effort, role, and backend values attached to those selectors are also retired. Their old backend-selection meaning is not a supported Flow Drive API. An option-like argument supplied as invocation syntax must be rejected with this migration guidance rather than treated as a task.

Reject retired or unrecognized invocation options before making dependent edits. The current entry accepts one task input, or the separate read-only `--help` invocation; it does not combine task input with help. If a caller supplies `--provider=<provider>`, it is not a legacy parser option from the pinned release, but the task-only boundary still rejects it as invocation syntax.

A literal option string that appears inside quoted task text, a task file, or a confirmed spec/change remains ordinary task content. For example, a task to edit a README example containing `--cross` should edit or discuss that example; it must not select a Provider.

## Keep the previous runner

Users who need the retired parser, selectors, or programmatic API can pin v0.66.7 at commit `5440dc516a7ffd0b52620546bb8f106210e79ce4`. For Codex, use the Codex-materialized skill at [`plugins/dhpk/skills/flow-drive`](https://github.com/hmj1026/dhpk/tree/5440dc516a7ffd0b52620546bb8f106210e79ce4/plugins/dhpk/skills/flow-drive), whose metadata is in the form Codex loads. For programmatic or other installation paths, use the canonical legacy directory at [`skills/flow-drive`](https://github.com/hmj1026/dhpk/tree/5440dc516a7ffd0b52620546bb8f106210e79ce4/skills/flow-drive). Keep files from the same revision together; do not combine either legacy directory with current Flow Drive files. A raw copy of the canonical legacy directory is not a Codex-loadable substitute for the materialized path.

This migration does not fix or backport the earlier [#1107 parser issue](https://github.com/hmj1026/dhpk/issues/1107) in v0.66.7. The current task-only entry removes the separate parser from its public path; the pinned legacy implementation retains its previous behavior.
