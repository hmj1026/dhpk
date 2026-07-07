---
name: nextjs-15-5-notes
description: "Next.js 15.5 (current stable; the 15.x line ends at v15.5.19 — 15.6 never shipped stable, canary only before the jump to 16.0) signature features and traps. Use when writing or reviewing code in a Next.js 15.5 project, or a package whose package.json constraint is ^15.5. Covers next typegen, stable typed routes, beta Turbopack production builds, and the next lint deprecation (removed in 16). Not for application business logic — load when working on framework-touching code (App Router files, next.config, build tooling) or planning a 15.5 -> 16 upgrade."
---

# Next.js 15.5 — current stable

Current stable release of the 15.x line. **The 15.x line ends at
v15.5.19** — 15.6 never shipped stable (canary-only) before the jump
to 16.0, so there is **no `nextjs-15.6` module**.

> React floor: 18/19 dual support. For React-language guidance (hooks,
> concurrent features, migration), pair this cross-stack with the
> `react-18` or `react-19` module.

---

## Signature features

### `next typegen`

Introduced in 15.5.0. Generates TypeScript definitions for routes and
route params, writing to `<distDir>/types`, without running a full
`next build`:

```bash
next typegen
```

### Stable typed routes

`typedRoutes` is promoted out of `experimental` — it is now a
top-level `next.config` key (requires TypeScript in the project):

```js
/** @type {import('next').NextConfig} */
const nextConfig = { typedRoutes: true }
module.exports = nextConfig
```

### Beta Turbopack production builds

```bash
next build --turbopack
```

Turbopack production-build support was experimental in 15.3.0 and
became **beta** in 15.5.0. Turbopack for `next dev` has been
**stable since 15.0.0**. In 15.5, Turbopack is **not yet the
default** for builds — you opt in with the flag; its absence still
means webpack.

### AMP support deprecated

AMP support is deprecated in the 15.x line.

---

## Migration traps

### `next lint` deprecated

`next lint` is deprecated in 15.5 (scheduled for removal in 16 —
cross-reference `nextjs-16-notes`). Migration path off it is the
ESLint CLI directly; a codemod automates the swap:

```bash
npx @next/codemod@canary next-lint-to-eslint-cli .
```

Note: projects already using a non-ESLint linter see no build-time
lint step run automatically once `next lint` is dropped.

### 15.x line end-of-life at v15.5.19

The 15.x line ends at **v15.5.19** — 15.6 never went stable (canary
only before the jump to 16.0). Do not expect a `nextjs-15.6` module;
plan upgrades straight from 15.5 to 16.

---

## What's missing compared to 16

- **Turbopack is not yet the default** — still opt-in via
  `--turbopack` for `next build` (stable default arrives in 16)
- **`next lint` still exists** — deprecated but present; removed in
  16
- **Synchronous access to Request APIs** (`params`, `searchParams`,
  `cookies`, `headers`) still has a compatibility shim in 15.5 — 16
  removes it (async-only)

---

## When NOT to Use

Not for application business logic. Not for a project on a different
Next.js major — use `nextjs-16-notes`. Not for generic JS/TS tooling
concerns (ESLint config, typing strategy) — use the `js` module.

## Output

Framework-touching code or review notes that match Next.js 15.5's
APIs (App Router files, `next.config`, build tooling) — flag any
`next lint` usage, un-opted Turbopack build assumption, or sync
Request-API access that actually belongs to a different major.

## Verification

- Confirm the project runs 15.5 (`package.json` `next` on `^15.5`,
  or `npx next --version`).
- Note the React 18/19 floor before using version-gated React APIs.
- Cross-check any cited API against Context7 `/vercel/next.js`,
  since Next.js ships frequently.

---

## Cross-references

- `modules/nextjs-16/skills/nextjs-16-notes/SKILL.md` — the upgrade
  target (Turbopack-by-default, `next lint` removed)
- `modules/react-18/skills/react-18-notes/SKILL.md` and
  `modules/react-19/skills/react-19-notes/SKILL.md` — pair a React major
  cross-stack for React-language guidance
- `modules/js/skills/` — the generic JS/TS ESLint + typing tooling
  module
