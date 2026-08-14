## 0. Dependency gate

- [ ] 0.1 Verify `harden-agent-architecture-governance` is implemented and passes its strict OpenSpec verification, inventory projection-schema tests, deterministic plan tests, and compatibility gates; keep tasks 1-5 `BLOCKED` until this evidence exists.
- [ ] 0.2 Map `skill_routing_families`, selectors, references, and aliases onto the accepted inventory/plan schema without creating a parallel manifest or projection interface.

## 1. Baseline and contract preparation

- [ ] 1.1 Capture the current `node scripts/ci/context-budget.js` report as implementation evidence: 133 discovery-visible entries, 45 optional discovery-visible entries, 18 surface violations, and 15 unique violating skill IDs.
- [ ] 1.2 Reconcile the router/alias data shape with the inventory/plan conventions from `harden-agent-architecture-governance`, documenting any field-name adapter needed before implementation.
- [ ] 1.3 Add inventory validation for one Laravel family router (5.4–11 plus Mix), one PHPUnit family router (9–11), explicit version selectors, stable legacy aliases, supported surfaces, invocation class, and safe conditional-reference paths.
- [ ] 1.4 Add negative contract tests for duplicate aliases, missing targets, ambiguous selectors, unsupported surfaces, unsafe reference paths, and conflicting invocation classes.

## 2. Shared version routers and compatibility aliases

- [ ] 2.1 Create the Laravel router and conditional reference map for Laravel 5.4, 6, 7, 8, 9, 10, 11, and Mix without moving or deleting legacy reference content prematurely.
- [ ] 2.2 Create the PHPUnit router and conditional reference map for PHPUnit 9, 10, and 11, preserving the existing 9-modern compatibility boundary and version-floor guidance.
- [ ] 2.3 Register every legacy Laravel ID (`laravel-5.4-notes`, `laravel-6-notes`, `laravel-7-notes`, `laravel-8-notes`, `laravel-9-notes`, `laravel-10-notes`, `laravel-11-notes`, `laravel-mix-notes`) as a stable alias to one router/version pair.
- [ ] 2.4 Register every legacy PHPUnit ID (`phpunit-9-modern`, `phpunit-10-notes`, `phpunit-11-notes`) as a stable alias to one router/version pair.
- [ ] 2.5 Preserve existing public names, invocation classes, module/profile membership, publication surfaces, and exact human/Codex invocation forms; reject any breaking rename or implicit alias collision.

## 3. Discovery metadata and progressive loading

- [ ] 3.1 Reduce all 15 unique baseline violators to concise initial-discovery descriptions while preserving purpose, positive trigger, exclusion/boundary, expected output, authorization, destructive-action, and completion cues.
- [ ] 3.2 Keep Laravel and PHPUnit version mechanics, migration traps, examples, and extended policy in conditional references selected only after router/version selection.
- [ ] 3.3 Reduce non-family violators individually (`ios-platform`, `js-lint-config`, `openspec-artifact-guard`, `nextjs-16-notes`, `php-pro`, `php-modern-pro`, `react-18-notes`, `react-19-notes`, `swift-test-strategy`, `swift-language`, `swiftui-architecture`, `php56-yii-dev`, `agy-fast-worker`, and `skill-judge`) without merging React/Next or specialist roles.
- [ ] 3.4 Verify audit, judge, stocktake, GitNexus, investigation, and review entries retain distinct scope, output, authority, and handoff cues after metadata reduction.
- [ ] 3.5 Add or update progressive-loading tests proving optional descriptions remain discovery-visible while conditional reference bodies are not counted against the initial budget.

## 4. Cross-surface projection and invocation parity

- [ ] 4.1 Extend deterministic Claude and Codex projection generation to consume one inventory-owned router/alias manifest rather than independently authored family lists.
- [ ] 4.2 Add parity checks for sorted stable IDs, public names, alias targets, version selectors, lifecycle/surface membership, budget values, and canonical source fingerprints across every declared publication surface.
- [ ] 4.3 Add invocation tests for every retained Laravel and PHPUnit alias on each supported surface, including exact identifier resolution and one-to-one router/version targeting.
- [ ] 4.4 Add repeat-generation tests that compare byte-identical projection metadata/content and report the stable ID plus surface when drift is introduced.

## 5. Strict gates and deferred frontend follow-up

- [ ] 5.1 Make strict context-budget validation fail on either word or token overflow and pass only when all declared discovery-visible surfaces report zero violations.
- [ ] 5.2 Run focused budget, inventory, alias-resolution, invocation, routing, and projection-parity tests, then run the repository's applicable validation aggregate and record exact results.
- [ ] 5.3 Add a regression guard proving React 18/19 and Next.js 15.5/16 remain separate IDs and mappings in this change, with the current evidence and a follow-up reference for any future consolidation.
- [ ] 5.4 Record unresolved environment or consumer-runtime checks as `NOT RUN`/`BLOCKED` with the reason and resume command; do not upgrade static projection parity into runtime consumer support.
- [ ] 5.5 Confirm the final diff is confined to the approved implementation paths for this change, leaves unrelated dirty platform-installation docs/tests untouched, and preserves all legacy IDs before handoff for review/archive.
