---
name: library-author
description: 'Author and review published PHP/Laravel libraries, map testsuites, and plan version-matrix cells. Routes provider/facade design, Testbench setup, Composer contracts, polyfill audits, suite selection, and cell onboarding to separate modes. Not for application code or single-version framework advice. Output follows the selected mode.'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Library author

Use a natural-language library task or an explicit mode followed by its inputs.

1. Select the mode below from the requested deliverable. An explicit mode wins;
   clarify a genuinely ambiguous deliverable before loading a procedure.
2. Identify the consumer package, declared PHP/framework/dependency range, and
   existing matrix from local metadata. Preserve each procedure's version
   inference; do not invent pins where consumer evidence is missing.
3. Load only the selected mode procedure. Load its named sibling reference only
   for the relevant branch. Complete its input, authority, and verification gates.
4. Return that mode's output with actual check results and remaining gaps.
   A release plan does not authorize publication, tags, or external changes.

| Mode | Task and input | Procedure | Output |
| --- | --- | --- | --- |
| author | Provider, facade, publishing or discovery design; supported range | [author](references/author.md) | Authoring decision or package design with compatibility gates |
| testbench | Multi-major Laravel matrix; package dependency metadata | [testbench](references/testbench.md) | Per-cell CI matrix, TestCase, database and discovery evidence |
| composer | Public API, Composer manifest, dependency floor or release contract | [composer](references/composer.md) | Semver verdict, audited manifest or release gate |
| polyfill-audit | File, symbol or all version guards; declared and executed matrices | [polyfill-audit](references/polyfill-audit.md) | Branch enumeration, matrix gaps and asymmetric-edit report |
| suite-map | Edited paths and actual phpunit.xml suite directories | [suite-map](references/suite-map.md) | Selected suites, commands and boundary warnings |
| cell-onboard | Proposed pinned runtime/dependency tuple and current workflow | [cell-onboard](references/cell-onboard.md) | Composer, workflow, polyfill, Testbench and focused-test cell plan |

Distinct deliverables retain distinct contracts. A task spanning modes may run
them in a stated sequence, retaining each mode's evidence and authority.

This relocatable skill is separate from the consumer content module
`modules/library-author/`. Its mode references are resources, not peer skills.
