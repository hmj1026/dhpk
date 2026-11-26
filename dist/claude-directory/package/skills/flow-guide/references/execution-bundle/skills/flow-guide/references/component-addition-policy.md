# Component-addition policy

`$PROJECT_DIR` denotes the root of the consumer project selected by the
governance route. It is documentation notation resolved by the caller, not a
Skill resource lookup. The `INDEX`, `$PROJECT_DIR/tests/`, and
`$PROJECT_DIR/scripts/` paths named here are consumer-project inputs for an
explicitly selected governance route. They are not a fallback resource
closure for a raw Skill directory.

Before adding a reviewer agent, sentinel slot, or hook, document in the relevant INDEX (or hook header) why the existing component considered cannot cover the need and name its concrete gap. A component without recorded justification is rejected in review.

Removal is symmetric: delete its INDEX row and every reference, slot token,
sentinel literal, and count claim in the same change.
`$PROJECT_DIR/tests/sentinel-slots.test.js` and
`$PROJECT_DIR/scripts/ci/catalog.js` enforce the mechanical integrity.
