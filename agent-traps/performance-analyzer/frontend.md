# performance-analyzer — Frontend traps

Client-runtime perf for JS/TS/React/Vue bundles. Loaded when a `js` / `vue` / React /
Next stack is detected. Correctness/type lanes → `code-reviewer/js.md` (+ `vue.md`);
this sheet owns latency, render cost, bundle size, and memory.

| Lane | Flag | Fix |
|---|---|---|
| Algorithmic | O(n²) over large arrays (nested `.find`/`.includes` in a loop, sort inside a loop, repeated `.filter().map()` passes) | precompute a `Map`/`Set` for lookups; sort once; single pass |
| React render | inline object/array/fn literal passed as a prop; expensive compute in render body; missing `React.memo` on a pure child re-rendering with parent | hoist / `useMemo` / `useCallback`; memoize the child; stabilize deps |
| Effects | `useEffect` recomputing derived state that could be computed in render; missing / over-broad dependency array | derive in render; tighten deps (exhaustive-deps lint) |
| Lists | long list rendered without virtualization; `key={index}` defeating reconciliation | `react-window`/virtual scroller; stable id keys |
| Bundle | `import _ from 'lodash'` / `import * as X`; heavy lib imported eagerly on a route that rarely needs it; no code-splitting | named/tree-shakeable imports; `React.lazy` / dynamic `import()`; route-level split |
| Network | independent requests `await`ed sequentially; no caching/dedupe; no debounce on input-driven fetch | `Promise.all`; cache/dedupe (SWR/React Query); debounce |
| **Memory leak** | `addEventListener` / `setInterval` / subscription without teardown; growing module-level cache; closure retaining a large object | remove listener / `clearInterval` / unsubscribe in cleanup; bound the cache; drop the reference |

## Web Vitals budget (flag regressions)

LCP > 2.5s · CLS > 0.1 · INP/TBT high · JS bundle > ~250KB gzip on a critical route → investigate. Red flags needing action: bundle > 500KB gzip, LCP > 4s, steadily growing heap across interactions.

## Worked example

```jsx
// BAD — new array identity every render → child re-renders even when data is unchanged
<List items={rows.filter(r => r.active)} onPick={r => pick(r)} />
// GOOD — memoize the derived data and the handler
const active = useMemo(() => rows.filter(r => r.active), [rows])
const onPick = useCallback(r => pick(r), [pick])
<List items={active} onPick={onPick} />
```

Diagnostics (read-only): a bundle analyzer (`source-map-explorer` / `webpack-bundle-analyzer`), a Lighthouse run, the Profiler flamegraph, `performance.memory` / heap snapshots across repeated interactions.
