# migration-reviewer — Core Data model-migration traps

Applies when the `ios-platform` module is active OR a `*.xcdatamodeld` is present.
Core Data model migrations (`.xcdatamodeld` version bump + mapping model) are migrations
too: read the agent-body Audit Checklist's up/down symmetry as "mapping completeness"
and idempotency/reversibility as "no silent data loss on store recreation".

| Trigger | Action | Non-apply |
|---------|--------|-----------|
| Model-version bump without an inferred or explicit mapping model | Every model-version change ships a mapping model; flag any version bump that lacks one (mapping completeness) | — |
| Unclassified or misclassified migration (lightweight vs heavyweight) | Confirm the classification. Lightweight (inferred) covers additive / renamable changes; non-trivial transforms (entity splits/merges, attribute type changes, derived data) need an explicit `NSMappingModel` + `NSEntityMigrationPolicy` | — |
| Heavyweight transform that drops an attribute/relationship without an annotated path | Preserve existing rows; no silent data loss — verify no attribute/relationship is dropped without an intentional, annotated migration path | — |
| Code that deletes/recreates the persistent store (including "drop store on migration failure") | No destructive store recreation on real data; never run that fallback against real user data | Empty-template / first-run store reset |
