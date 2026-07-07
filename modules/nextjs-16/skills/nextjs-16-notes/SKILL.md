---
name: nextjs-16-notes
description: "Next.js 16 (current stable major, now at 16.2.x) signature features and the breaking-change traps from 15.x -> 16.0. Use when writing or reviewing code in a Next.js 16 project, or planning an upgrade from Next.js 15.x. Covers Turbopack-by-default (dev and build), the async-only Request APIs (params/searchParams/cookies/headers), the Node.js 20.9+ floor, the removal of next lint and AMP, next/image priority -> preload, removed runtime-config APIs, and the 16.1 next upgrade CLI. Not for application business logic — load when working on framework-touching code or planning a 15.x -> 16 upgrade. Note: Next.js 16 supports React 18.2+ or 19 — React 19 is recommended but NOT required."
---

# Next.js 16 — current stable major

Current stable major of Next.js, now at 16.2.x.

> Version floors: **Node.js 20.9.0+** (Node 18 dropped), **TypeScript
> 5.1.0+**, **React 18.2.0+ or 19**. React 19 is recommended and is
> the default for new apps, but it is NOT required — a React 18.3.1
> app adopts Next.js 16 without a React major upgrade. For
> React-language guidance, pair this cross-stack with the `react-18`
> or `react-19` module.

---

## Signature features

### Turbopack by default

Turbopack is the default bundler for both `next dev` and `next
build` in 16 — no `--turbopack` flag needed anymore, and its absence
no longer means webpack. Opt out with `--webpack`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build"
  }
}
```

```bash
next build --webpack   # opt out of Turbopack
```

### `next upgrade` CLI

Added in 16.1.0 — an automated upgrade helper:

```bash
next upgrade
```

The general codemod runner still applies for broader migrations:

```bash
npx @next/codemod@canary upgrade latest
```

---

## Migration traps

Ordered by blocker severity, most severe first.

### 1. Async-only Request APIs (the biggest code-level break)

`params`, `searchParams`, `cookies`, `headers`, and `draftMode` are
now **async-only** (Promises). The temporary synchronous
compatibility shim from v15 is fully removed in 16. Code written
against 14-era synchronous props hits this first:

```tsx
// 14-era — no longer works
export default function Page({ params }: { params: { id: string } }) {
  return <div>{params.id}</div>
}

// 16 — async-only
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <div>{id}</div>
}
```

A codemod exists to migrate call sites automatically.

### 2. Node.js 20.9.0+ and TypeScript 5.1.0+ required

Node 18 is no longer supported; TypeScript must be 5.1.0+. This is
an environment-level blocker — check it before anything else.

### 3. React version — correcting a common misconception

Next.js 16 does **not** require React 19. Its peerDependency is
`react: "^18.2.0 || ^19.0.0"`, so React 18.2.0+ is fully supported
and a React 18.3.1 project can adopt Next.js 16 without a React
major upgrade. React 19 is recommended (and the default for new
apps) and unlocks some features, but it is optional, not a
prerequisite. Do not treat React 19 as an upgrade blocker for
Next.js 16.

### 4. `next lint` removed

Deprecated in 15.5 (cross-reference `nextjs-15-5-notes`) and fully
removed in 16. `next build` no longer runs linting. Bring your own
ESLint/Biome CLI; a codemod automates the swap:

```bash
npx @next/codemod@canary next-lint-to-eslint-cli .
```

### 5. AMP support fully removed

`next/amp`, `useAmp`, and page-level AMP config are gone.

### 6. `serverRuntimeConfig` / `publicRuntimeConfig` removed

Use environment variables instead.

### 7. `next/image` `priority` deprecated in favor of `preload`

Deprecated as of 16.0.0.

---

## What's missing compared to later 16.x

Within the 16.x line, `16.0` shipped without some helpers that
arrived later:

- **`next upgrade`** and **`next experimental-analyze`** were added
  in 16.1.0 — absent on 16.0.x
- **JS bundle-size metrics** were removed from `next build` output
  starting in 16.0.0

If reviewing a project pinned to `16.0.x`, those minor-version tools
are absent.

---

## When NOT to Use

Not for application business logic. Not for a project on the 15.x
line — use `nextjs-15-5-notes`. Not for generic JS/TS tooling
concerns (ESLint config, typing strategy) — use the `js` module.

## Output

Framework-touching code or review notes that match Next.js 16's
APIs — flag any synchronous `params`/`searchParams`/`cookies`/
`headers` access (now async-only), leftover `--turbopack` flags (now
redundant), `next lint` invocations, or removed
`serverRuntimeConfig`/`publicRuntimeConfig` usage.

## Verification

- Confirm the project runs 16 (`package.json` `next` on `^16`, or
  `npx next --version`).
- Check the Node.js 20.9+, TypeScript 5.1+, and React 18.2+ floors.
- Cross-check any cited API against Context7 `/vercel/next.js`,
  since Next.js ships frequently.

---

## Cross-references

- `modules/nextjs-15.5/skills/nextjs-15-5-notes/SKILL.md` — the
  prior stable 15.x line (where `next lint` was deprecated,
  Turbopack build was still opt-in beta)
- `modules/react-18/skills/react-18-notes/SKILL.md` and
  `modules/react-19/skills/react-19-notes/SKILL.md` — pair a React major
  cross-stack for React-language guidance
- `modules/js/skills/` — the generic JS/TS ESLint + typing tooling
  module
