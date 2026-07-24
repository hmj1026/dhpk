---
name: react-18-notes
description: "React 18 (March 2022) signature features and the migration traps from 17 -> 18. Use when writing or reviewing code in a React 18 project, or a package whose package.json constraint is ^18 (or ^18.2). Covers createRoot/hydrateRoot, automatic batching, the opt-in concurrent features (startTransition/useTransition/useDeferredValue), streaming SSR (renderToPipeableStream), the new hooks (useId/useSyncExternalStore/useInsertionEffect), and StrictMode effect double-invocation. Not for application business logic — load when working on React root setup, concurrent-rendering code, or planning a 17 -> 18 (or 18 -> 19) upgrade. Pairs cross-stack with the nextjs modules; React 18.2+ is the floor Next.js 16 supports. Output: version-specific guidance, migration traps, and verification gates."
---

# React 18 — concurrent-rendering baseline

React 18 (March 2022) shipped the concurrent renderer. Its features are
opt-in per update, unlocked by adopting the new `createRoot` API.

> Floor role: **React 18.2.0+** is the minimum Next.js 16 supports and one
> side of Next.js 15.5's React 18/19 dual support. This module is the
> standalone home for React-language guidance — pair it cross-stack with a
> `nextjs-<version>` module, or use it for any non-Next React app.

---

## Signature features

### `createRoot` / `hydrateRoot` (react-dom/client)

The new root API replaces `ReactDOM.render` and is what turns on all
React 18 features. `ReactDOM.render` still works but warns and runs in a
legacy (non-concurrent) mode.

```js
// Before (React 17)
import { render } from 'react-dom'
render(<App />, document.getElementById('root'))

// React 18
import { createRoot } from 'react-dom/client'
const root = createRoot(document.getElementById('root'))
root.render(<App />)
```

SSR hydration moves from `ReactDOM.hydrate` to `hydrateRoot`.

### Automatic batching

All state updates are now batched — including those inside promises,
`setTimeout`, and native event handlers, not just React event handlers.
Force a synchronous flush with `flushSync` when a DOM read must happen
between updates.

```js
setTimeout(() => {
  setCount(c => c + 1)
  setFlag(f => !f)
  // React 18: one re-render (batched); React 17: two re-renders
}, 1000)
```

### Concurrent features (opt-in)

Enabled per update, not globally:

- `startTransition` / `useTransition` — mark non-urgent updates so urgent
  ones (typing) stay responsive.
- `useDeferredValue` — defer re-rendering a value under load.

```js
import { startTransition } from 'react'
setInputValue(input)              // urgent
startTransition(() => {
  setSearchQuery(input)           // non-urgent transition
})
```

### Streaming SSR + selective hydration

`renderToPipeableStream` (Node) / `renderToReadableStream` (web/edge)
replace `renderToString` for streaming; `<Suspense>` boundaries stream and
hydrate selectively.

### New hooks

- `useId` — stable unique IDs matched across server/client (a11y attrs).
- `useSyncExternalStore` — lets external-store libraries subscribe safely
  under concurrent rendering.
- `useInsertionEffect` — for CSS-in-JS libraries to inject styles before
  layout effects.

---

## Migration traps

Ordered by blocker severity, most severe first.

### 1. Switch the root API to `createRoot`

Until `ReactDOM.render` -> `createRoot` is done, the app runs in legacy
mode and none of the React 18 features (concurrent rendering, batching in
all contexts) are active. `render` also logs a deprecation warning.

### 2. StrictMode double-invokes effects in dev

In development, `<StrictMode>` mounts, unmounts, and remounts each
component once, so effects (and their cleanup) run twice. This is dev-only
(no production effect) but surfaces missing cleanup and breaks code that
assumed a single mount.

### 3. Automatic batching can change assumptions

Code that relied on a re-render between two `setState` calls inside an
async callback now sees a single batched render. Use `flushSync` where a
synchronous flush is genuinely required.

### 4. `react-dom/server` API changes

`renderToString` is discouraged for streaming (move to
`renderToPipeableStream`); `renderToNodeStream` is deprecated.

### 5. TypeScript: `children` no longer implicit

`@types/react` 18 dropped the implicit `children` on `React.FC` — declare
`children` explicitly or type props with `PropsWithChildren`.

---

## What's missing compared to 19

- **No Actions / `useActionState` / `useOptimistic` / `useFormStatus`** —
  form-action ergonomics arrive in 19.
- **No `use()` hook** — reading a Promise/Context conditionally is 19.
- **`ref` still needs `forwardRef`** — 19 makes `ref` a plain prop.
- **Document metadata not hoisted** — `<title>`/`<meta>` in components
  needs a library (React Helmet); 19 hoists natively.
- **Deprecated APIs still present** — `propTypes`, `defaultProps` (function
  components), legacy Context, and string refs still work in 18; 19 removes
  them.

---

## When NOT to Use

Not for application business logic. Not for a React 19 project — use
`react-19-notes`. Not for generic JS/TS tooling concerns (ESLint config,
typing strategy) — use the `js` module. Not for Next.js framework APIs —
use the `nextjs-*` modules.

## Output

React root/setup or review notes matching React 18's APIs — flag leftover
`ReactDOM.render`/`hydrate` (should be `createRoot`/`hydrateRoot`), effects
with no cleanup (StrictMode double-invoke), or async `setState` sequences
that assumed unbatched renders.

## Verification

- Confirm the project runs 18 (`package.json` `react`/`react-dom` on
  `^18`, or check `node_modules/react/package.json`).
- Note React 18.2+ is the minimum Next.js 16 supports.
- Cross-check any cited API against Context7 `/reactjs/react.dev`.

---

## Cross-references

- `modules/react-19/skills/react-19-notes/SKILL.md` — the upgrade target
  (Actions, `use()`, ref-as-prop, document metadata, removed legacy APIs)
- `modules/nextjs-15.5/skills/nextjs-15-5-notes/SKILL.md` and
  `modules/nextjs-16/skills/nextjs-16-notes/SKILL.md` — pair a Next.js
  major with this React major cross-stack
- `modules/js/skills/` — the generic JS/TS ESLint + typing tooling module
