# migration-reviewer — Core Data model-migration traps

Applies when the `ios-platform` module is active OR a `*.xcdatamodeld` is present.
Core Data model migrations (`.xcdatamodeld` version bump + mapping model) are migrations
too: read the agent-body Audit Checklist's up/down symmetry as "mapping completeness"
and idempotency/reversibility as "no silent data loss on store recreation".

## Core Data migration checklist

- [ ] **Mapping completeness** — every model-version change ships an inferred or explicit mapping model; flag any version bump that lacks one.
- [ ] **Lightweight vs heavyweight** — confirm the migration classification. Lightweight (inferred) migration covers additive / renamable changes; non-trivial transforms (entity splits/merges, attribute type changes, derived data) need an explicit `NSMappingModel` + `NSEntityMigrationPolicy`.
- [ ] **No silent data loss** — heavyweight transforms preserve existing rows; verify no attribute/relationship is dropped without an intentional, annotated migration path.
- [ ] **No destructive store recreation on real data** — flag any code that deletes/recreates the persistent store (the classic "drop store on migration failure" fallback). Gate such deletion to the empty-template / first-run state; never run it against real user data.
</content>
