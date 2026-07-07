---
name: react-19-notes
description: "React 19 (December 2024) signature features and the breaking-change traps from 18 -> 19. Use when writing or reviewing code in a React 19 project, or planning an upgrade from React 18. Covers Actions and async transitions, the new hooks (useActionState/useOptimistic/useFormStatus and the use() API), ref as a regular prop (forwardRef deprecated), <Context> as a provider, document metadata hoisting, resource preloading (preload/preinit), stable Server Components/Actions, and the removal of long-deprecated APIs (ReactDOM.render/hydrate, propTypes/defaultProps on function components, legacy Context, string refs). Not for application business logic — load when working on React-language code or planning an 18 -> 19 upgrade. Note: React 19 is recommended but NOT required for Next.js 16 (React 18.2+ also works)."
---

# React 19 — current stable major

React 19 (December 2024) centers on Actions (async transitions for data
mutations) and a batch of ergonomics that remove long-standing boilerplate.

> Floor role: React 19 is **recommended but not required** for Next.js 16 —
> its peerDependency is `react: "^18.2.0 || ^19.0.0"`, so a React 18.2+ app
> adopts Next.js 16 without a React major upgrade. This module is the
> standalone home for React-language guidance — pair it cross-stack with a
> `nextjs-<version>` module, or use it for any non-Next React app.

---

## Signature features

### Actions + form actions

"Actions" are async transitions that handle pending state, errors, and
optimistic updates. Pass an async function to a `<form action={...}>`:

```js
function ChangeName() {
  const [error, submitAction, isPending] = useActionState(
    async (prev, formData) => {
      const error = await updateName(formData.get('name'))
      if (error) return error
      redirect('/path')
      return null
    },
    null,
  )
  return (
    <form action={submitAction}>
      <input name="name" />
      <button disabled={isPending}>Update</button>
      {error && <p>{error}</p>}
    </form>
  )
}
```

### New hooks

- `useActionState(fn, initial)` -> `[state, dispatchAction, isPending]`.
- `useOptimistic(value)` -> show an optimistic value while an action is
  pending.
- `useFormStatus()` (from `react-dom`) -> read the enclosing form's pending
  state without prop-drilling.
- `use(resource)` — read a Promise or Context; unlike other hooks it may be
  called conditionally / inside loops.

### `ref` as a prop

Function components receive `ref` as a normal prop — `forwardRef` is no
longer needed (and is deprecated):

```js
function MyInput({ placeholder, ref }) {
  return <input placeholder={placeholder} ref={ref} />
}
<MyInput ref={ref} />
```

Ref callbacks may also return a cleanup function.

### `<Context>` as a provider

Render `<Context>` directly instead of `<Context.Provider>`:

```js
const Theme = createContext('')
// React 19
<Theme value="dark">...</Theme>
// was: <Theme.Provider value="dark">...</Theme.Provider>
```

### Document metadata + asset loading

`<title>`, `<meta>`, and metadata `<link>` can render anywhere in the tree
and hoist to `<head>` — no React Helmet needed. Stylesheets and async
scripts gain precedence/dedup support, and Resource Loading APIs
(`preload`, `preinit`, `prefetchDNS`, `preconnect`) give explicit control.

### Server Components + Server Actions (stable)

The `"use client"` / `"use server"` directives and React Server Components
are stable in 19 (surfaced through frameworks such as Next.js).

---

## Migration traps

Ordered by blocker severity, most severe first.

### 1. Removed root/render APIs

`ReactDOM.render`, `ReactDOM.hydrate`, and `unmountComponentAtNode` are
**removed** — use `createRoot`/`hydrateRoot` from `react-dom/client`.
`findDOMNode` is removed too.

```js
// Removed in 19
import { render } from 'react-dom'
render(<App />, document.getElementById('root'))

// React 19
import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')).render(<App />)
```

### 2. `propTypes` and `defaultProps` (function components) removed

`propTypes` is ignored; `defaultProps` for function components is removed —
use ES default parameters instead. (`defaultProps` still works for class
components.)

### 3. Legacy Context and string refs removed

`contextTypes` / `childContextTypes` (legacy context) and string refs
(`ref="x"`) are removed — use `createContext` and ref callbacks / `useRef`.

### 4. Test utilities moved

`react-test-renderer` is deprecated; `act` is imported from `react` (not
`react-dom/test-utils`). `ReactDOMTestUtils.act` warns.

### 5. Ref-cleanup return semantics

If a ref callback returns a value, React 19 treats it as a cleanup
function — an implicit return (e.g. an arrow that returns an assignment)
can break. Return nothing, or an explicit cleanup function.

---

## What's missing / adjacent

- **React Compiler** ships separately (opt-in build tooling), not part of
  the runtime — do not assume it is enabled.
- Some 19 features (Actions ergonomics, RSC) are surfaced through a
  framework (Next.js); a standalone React app wires them up manually.

---

## When NOT to Use

Not for application business logic. Not for a React 18 project — use
`react-18-notes`. Not for generic JS/TS tooling concerns (ESLint config,
typing strategy) — use the `js` module. Not for Next.js framework APIs —
use the `nextjs-*` modules.

## Output

React-language code or review notes matching React 19's APIs — flag removed
`ReactDOM.render`/`hydrate`/`findDOMNode`, `forwardRef` that can now be a
plain `ref` prop, `<Context.Provider>` that can be `<Context>`,
`propTypes`/`defaultProps` on function components, or ref callbacks that
accidentally return a value.

## Verification

- Confirm the project runs 19 (`package.json` `react`/`react-dom` on
  `^19`, or check `node_modules/react/package.json`).
- Remember React 19 is recommended, not required, for Next.js 16 (React
  18.2+ also works).
- Cross-check any cited API against Context7 `/reactjs/react.dev`.

---

## Cross-references

- `modules/react-18/skills/react-18-notes/SKILL.md` — the prior major
  (concurrent baseline, `createRoot`, automatic batching)
- `modules/nextjs-16/skills/nextjs-16-notes/SKILL.md` and
  `modules/nextjs-15.5/skills/nextjs-15-5-notes/SKILL.md` — pair a Next.js
  major with this React major cross-stack
- `modules/js/skills/` — the generic JS/TS ESLint + typing tooling module
