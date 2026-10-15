---
name: yii1
description: 'Yii1.1 backend development, regression tests, framework hardening, and static security audit of controllers/models/configuration. Use for Yii1 request, AR/DAO, scenario, authorization, upload or session tasks. Not for Yii2, frontend-only work, or generic PHP language decisions. Output: compatible implementation evidence or a categorized framework audit.'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Yii1

Use `$yii1 <task>`; natural development, review, and security requests select
internal procedures. PHP language/runtime ownership remains with `php`; this
family owns Yii1.1 framework behavior and its runtime-compatible adaptations.
It needs no peer skill to complete a scoped Yii task.

## Establish the target before loading

Identify the application/subproject, Yii version, PHP deployment floor and
configured test runner from request and entrypoint/manifest/configuration
facts. An intentional explicit version override wins; retain its rationale.
Yii::createWebApplication, protected controllers/models/views, CController or
CActiveRecord, and components configuration are framework evidence. Yii2 is
outside this family. A missing/ambiguous target, broad incompatible ranges or
conflicting evidence requires asking and waiting before framework/version
references or dependent actions. Local `php --version` describes the execution
environment. Migration needs an explicit destination; group multiple targets
and evidence separately. Never infer PHP5.6 just from Yii1 identity; preserve
PHP5.6 compatibility when the target requires it.

## Select the procedure

- Implementation, known bugfix, refactor, or hardening: read
  [development](references/development.md), then only the needed backend,
  DDD-lite, compatibility, TDD, or legacy-test references it selects.
- Static framework-security audit: read [security](references/security.md) and
  [patterns](references/yii1-security-patterns.md). Establish at least three
  Yii1.1 identity evidence points before auditing; insufficient evidence stops
  the audit with its cause. Review all eight checklist categories.
- An ordinary code review uses development's findings output. Security-specific
  evidence uses the audit procedure; do not automatically load both procedures.

Read local references from this folder. Context7 is an external knowledge
capability for uncertain APIs, not a required bundled resource. The local
[source/query rules](references/context7-sources-and-query-rules.md) preserve
provenance and inference reporting; unavailable sources stay disclosed rather
than fabricated. Missing local references are `BLOCKED` and cannot be recovered
from predecessors or ambient repository modules.

## Preserve runtime and authority

For a PHP5.6 target, use PHPDoc instead of PHP7 scalar/return syntax and the
confirmed PHPUnit5.7 APIs. Keep controllers thin; use application/domain and
repository seams only where needed. Validate safe attributes under the actual
scenario, bind SQL values, allow-list identifiers/sorts, treat queryRow and
queryScalar no-result as false, and pass queryAll parameters in its second
argument. Yii framework conventions do not authorize a PHP floor upgrade.

Implementation requests authorize scoped app/test changes and test-first work.
Design/review/security audit requests keep application source/configuration
read-only. The security report is an output artifact at the requested path,
otherwise `{source_path}_audit/framework_audit/yii1_{timestamp}.md`; preserve
unrelated output files. Static audit supplies an observable, unexecuted PoC
framework, never a claimed exploit result. It does not authorize sending exploit
requests, applying fixes, shared DB writes, DDL, commits or publication. A later
explicit fix request authorizes only its bounded implementation.

## Completion

Development returns task classification, source basis or its unavailability,
design/compatibility decisions, test-first evidence, implementation or findings,
actual verification, and residual risks. Security returns framework identity,
AccessControl/RBAC/CSRF/XSS/SQL/MassAssignment/File/Session results; each finding
has AUTH/CSRF/XSS/SQL/CFG/LOGIC/FILE mapping, file:line, concrete data-flow or
ownership evidence, unexecuted observation plan, and Yii1.1 API remedy. Report
safe binding separately from interpolation. Keep local tests, DB/device/runtime
checks, security review and release readiness distinct; an unrun check is
`NOT_RUN`, and an audit never clears an unrelated gate.
