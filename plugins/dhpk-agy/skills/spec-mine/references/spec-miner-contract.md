# Spec-miner role contract

This reference is the portable boundary around the required registered
`spec-miner` role. It does not authorize the current worker to impersonate the
role when the registry cannot provide it.

## Delegation

Pass the optional capability name or path unchanged. The role must discover the
project structure itself, present a capability list when no capability was
selected, and mine one capability at a time. It may read source, tests, docs,
configuration, and call paths, but its only write target is
`openspec/specs/<capability>/spec.md`.

If the role is missing, unconfigured, or fails before producing a verified
artifact, report `UNAVAILABLE` or `BLOCKED` with the exact reason. Never remap
to a general planner, architect, worker, or inline approximation.

## Mining rules

- A capability is a cohesive cluster of entry points and backing directories.
- Sample entry points first, expand one call-chain level to verify behavior, and
  defer unread files. Do not mine every module in one pass.
- Every behavior is a flat `### Requirement:` (triggered WHEN → THEN) or
  `### Invariant:` (always true). Do not create type-classification chapters.
- Every Requirement has at least one `#### Scenario:`. Invariants have none.
- Metadata comments use `id`, `entities`, `enforced`, `test`, `depends_on`, and
  `triggers` only when known and statically traceable. Never invent behavior.
- Record uncertainty as `<!-- uncertainty: ... -->`; record unread files as
  `<!-- deferred: ... -->`.
- Stamp every mining pass with `Last verified: <date> (commit <hash>)`.

## Artifact shape

```markdown
# Spec: <capability-name>
> Auto-extracted by spec-miner. Last mined: YYYY-MM-DD.
> Source: <key files analyzed>
> Last verified: YYYY-MM-DD (commit abc1234)

---

### Requirement: <behavior name>
<!-- id: FileName.methodName -->
<!-- entities: EntityA, EntityB -->
<!-- enforced: FileName.methodName() -->

<Concise SHALL/MUST description.>

#### Scenario: <scenario name>
<!-- test: TestClass.testMethod() -->
- **WHEN** <precise condition>
- **THEN** <observable outcome>

---

### Invariant: <invariant name>
<!-- entities: EntityA -->
<!-- enforced: FileName.methodName() -->

<What must ALWAYS be true. Use SHALL.>
```

The role’s completion relay must name the artifact path, capability, commit
stamp, and deferred list. A role plan or a capability list alone is not a
completed spec.
