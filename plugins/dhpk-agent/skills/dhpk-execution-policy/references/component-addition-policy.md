# Component-addition policy

Before adding a reviewer agent, sentinel slot, or hook, document in the relevant INDEX (or hook header) why the existing component considered cannot cover the need and name its concrete gap. A component without recorded justification is rejected in review.

Removal is symmetric: delete its INDEX row and every reference, slot token, sentinel literal, and count claim in the same change. `tests/sentinel-slots.test.js` and `scripts/ci/catalog.js` enforce the mechanical integrity.
