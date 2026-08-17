---
name: dhpk-react-19-notes
description: "Use when working on React 19 guidance for Actions, new hooks, refs, providers, Server Components, or 18→19 upgrades. Not for ordinary application logic. Remains a separate React 19 route; pair with `dhpk-react-18-notes` for the 18 baseline and `dhpk-nextjs-16-notes` for Next integration. Output: migration traps and verification gates."
metadata:
  dhpk-invocation-class: implicit-eligible
---

# React 19 — current stable major

React 19 (December 2024) centers on Actions (async transitions for data
mutations) and a batch of ergonomics that remove long-standing boilerplate.

> Family routing and the React/Next compatibility matrix live in
> `docs/agent-guidance/frontend-framework-routing.md`. This module owns
> standalone React 19 language guidance after the family is selected.

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
`dhpk-react-18-notes`. Not for generic JS/TS tooling concerns (ESLint config,
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

- `skills/dhpk-react-18-notes/SKILL.md` — the prior major
  (concurrent baseline, `createRoot`, automatic batching)
- `skills/dhpk-nextjs-16-notes/SKILL.md` and
  `skills/dhpk-nextjs-15-5-notes/SKILL.md` — pair a Next.js
  major with this React major cross-stack
- `modules/js/skills/` — the generic JS/TS ESLint + typing tooling module
