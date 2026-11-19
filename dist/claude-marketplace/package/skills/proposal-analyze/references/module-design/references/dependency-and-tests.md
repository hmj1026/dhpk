# Dependency Boundaries and Tests

Use this reference when a module design changes who owns a dependency, what
callers can vary, or how behavior is verified. Trace the current code paths
before proposing a seam.

## Name the owner and real callers

Identify the module that owns the dependency’s configuration, lifecycle, and
failure handling. Trace actual callers and state which behavior each one uses.
Do not design for hypothetical consumers.

## Expose only caller-needed variation

For each real caller, identify the choice or input that must vary. Expose that
variation at the narrowest useful boundary and keep other decisions with the
owner. If callers need the same behavior, do not add options for imagined
future use.

## Reuse available replacements

Check the repository for existing replacements, fakes, adapters, and fixtures.
Name which one lets each relevant caller test its contract. Add a new seam only
when a real caller or test needs substitution that the existing boundary cannot
provide.

## State observable success and failure

Describe what callers observe on success and on failure, including relevant
results, side effects, and error handling. Keep these outcomes stable across
the proposed boundary and test them through the caller-visible contract.

## Protect existing behavior independently

Identify the existing tests and the behavior each protects. Preserve those
assertions when changing an interface. If a test must change, keep independent
coverage of the same behavior through a real caller or another public
boundary; do not let an interface rewrite erase the only protection.

## Separate evidence from gaps

Unit tests provide evidence for the local contract. Integration tests provide
evidence that real callers and dependencies are wired together. Permissions
and deployment behavior need evidence from their appropriate environment and
owner. Record what was exercised and name any integration, permission, or
deployment check that remains open.

## Stop at a missing decision

If the dependency owner, real caller, required variation, or success/failure
contract is unknown, name the missing decision and who can resolve it. Keep
the design bounded until that boundary is clear; do not add a generic
abstraction to hide an unresolved ownership decision.
