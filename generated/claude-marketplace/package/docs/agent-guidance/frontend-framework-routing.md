# Frontend Framework Routing

This file is the shared family-routing SSOT for the versioned React and
Next.js skills. Read it before choosing a versioned note; the selected skill
then owns API details, migration traps, and verification gates for that major.

## Selection

1. Read `package.json` (or the lockfile) for the `react`, `react-dom`, and
   `next` constraints.
2. Load exactly one React note when the task is React-language work and exactly
   one Next.js note when the task is Next framework work. Load both for a
   cross-stack change.
3. Keep versioned IDs separate. A migration task loads the source and target
   notes only when their compatibility details are needed.

## Compatibility map

| Next.js family | React family | Routing note |
| --- | --- | --- |
| 15.5 | 18 or 19 | Pair `dhpk-nextjs-15-5-notes` with the selected React note. |
| 16 | 18.2+ or 19 | Pair `dhpk-nextjs-16-notes` with the selected React note. |
| standalone | 18 or 19 | Use the matching React note without a Next.js note. |

Do not copy this matrix into a versioned skill. If package constraints are
ambiguous, report the missing evidence and stop before applying versioned
guidance.
