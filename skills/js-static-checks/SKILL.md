---
name: js-static-checks
description: 'JavaScript/TypeScript static-check status, ESLint tier setup, legacy-global synchronization, and progressive checkJs rollout. Use for lint/typecheck configuration or rollout tasks and check, setup, rollout actions. Not for everyday JS business logic. Output: read-only status, scoped configuration, or leaf migration evidence.'
metadata:
  dhpk-capability-id: dhpk.skill.js-static-checks
  dhpk-name-style: portable-family
  dhpk-invocation-class: implicit-eligible
---

# JS static checks

Use `$js-static-checks <task>`; optional `check`, `setup`, and `rollout` actions
select the same task procedures. `status` remains an internal synonym for the
read-only status contract.

## Resolve scope and compatibility

Identify the consumer package/frontend directory and its package.json,
lock/configuration evidence first. An intentional explicit target override wins;
record it separately. For version-sensitive configuration, retain exact versus
range precision for ESLint and TypeScript. Missing, broad incompatible, or
conflicting evidence and unspecified monorepo scope require asking and waiting
before versioned reference loads or dependent changes. Runtime Node/npm versions
describe the environment. Migration requires an explicit destination; group
multi-version results by target. A simple directive-count check needs a scan
path, not a fabricated lint version.

## Select the local procedure

- Read-only status/check: read [rollout](references/rollout.md)'s status contract
  and run this skill's `scripts/status.js [--path <directory>]` with Node from
  the consumer working directory. Omit `--path` to use
  `CLAUDE_PLUGIN_OPTION_JS_CHECK_PATH`, otherwise `js/`. Report deterministic
  JSON buckets and `total=N strict=N nocheck=N unmarked=N`. Scan immediate
  regular `.js` files only; `nocheck` takes precedence and comment mentions do
  not count. Missing/unreadable/symlink paths are `UNAVAILABLE` without counts.
  A completed UNAVAILABLE scan can exit0; its verdict is still not PASS.
- ESLint tier/configuration or shaped globals (`setup`): read
  [setup](references/setup.md); use [static checks](references/static-checks.md)
  and [review patterns](references/frontend-review-patterns.md) only as needed.
- Per-leaf type-check adoption (`rollout`): read
  [rollout](references/rollout.md); use setup detail only for tier/global changes.

The local references contain all required guidance. Hook/module integration is
an optional consumer installation input, not a prerequisite or a resource
recovery path. Preserve shared tools in the consumer; this skill does not
install hooks. Missing bundled procedures/scripts are `BLOCKED`.

## Authority and completion

Check/status and review requests are read-only. Setup/rollout implementation
requests authorize the corresponding scoped configuration/leaf edits; a plan
alone authorizes no writes. Keep vendor/minified files outside owned source
work. Preserve explicit tier exemptions and the canonical AJAX facade. Update
ESLint globals, ambient declarations, and shaped JSDoc typedefs together when a
new shaped global is introduced. Classify typedef-widening fixes separately
from permanent exclusions; retain one-leaf verification and the project-wide
checkJs exit decision.

Report target scope/version, selected procedure, status/configuration or leaf
classification, lint/type/behavior checks actually run, and residual exclusions.
Tool absence is `NOT_RUN`/`UNAVAILABLE`; directive counts alone do not prove
runtime correctness. Commit, push, and publication need separate authorization.
