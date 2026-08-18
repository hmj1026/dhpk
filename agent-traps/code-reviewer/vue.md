# code-reviewer — Vue traps

Vue-specific reactivity / template / component lanes. Generic TS type-safety + async
correctness → `code-reviewer/js.md` (load both on a `.vue` diff). ESLint-tier / AJAX
facade → `frontend-reviewer`. Detect the major from `package.json` `vue` (the `vue-2`
module pins Options-API conventions); confirm `eslint-plugin-vue` + `vue-tsc` exist.

| Lane | Trigger | Action | Non-apply |
|---|---|---|---|
| Reactivity | destructuring `defineProps` in Vue < 3.5; `reactive()` on a primitive; reassigning a whole `reactive()` object; `watch(() => myRef, …)` | `toRefs()` / `props.x`; `ref()` for primitives; mutate fields or `Object.assign`; `watch(() => myRef.value, …)` | Vue ≥ 3.5 reactive props destructure; a `computed` used instead of `watch` |
| `.value` | `ref()` object read without `.value` inside `<script>` | add `.value` | templates (auto-unwrap); `v-once` static text |
| Template | `v-for` without `:key`; `:key="index"`; `v-if` + `v-for` on the same element; `v-model` to a computed without a setter | stable id key; `<template v-for>` + inner `v-if`; writable get+set | a static list that never reorders |
| Composable | side effects in module scope; missing cleanup; stores a `.value` snapshot of a passed ref | move into `setup`/lifecycle; teardown via `onUnmounted`; keep the ref | a pure helper that does not take refs |
| Component | SFC > 300 lines; mutating a prop; raw `document.querySelector` | extract; `emit`/`v-model` up; `useTemplateRef` | generated SFCs |
| Router | guard returns `false` with no redirect; `useRoute().params` destructured at top level | redirect/explain; `toRefs`/`computed` | a guard that already redirects |
| Pinia | multi-field mutation outside an action/`$patch`; non-serializable state | move into actions; keep state serializable | a store used only in tests |
| SSR (Nuxt) | `window`/`document`/`localStorage` without `process.client`/`onMounted` | client-guard | a `<ClientOnly>` island that is not SEO content |
| Perf (MEDIUM) | expensive `computed` over large data; `<KeepAlive>` without `:max` | memoize/watcher; bound the cache | a computed over a tiny constant list |

Security: `v-html` with unsanitized input and `:href`/`:src` accepting `javascript:`/`data:`
URLs → sanitize (DOMPurify) / validate the URL scheme. OWASP baseline → `security-reviewer/js.md`.

## Worked example

```vue
<!-- BAD (Vue < 3.5) — destructured props are a snapshot; title never updates -->
<script setup>
const { title } = defineProps(['title'])
</script>
<!-- GOOD — keep the reactive link -->
<script setup>
const props = defineProps(['title'])
</script>
```

Diagnostics: `vue-tsc --noEmit` · `eslint . --ext .vue,.ts,.js` · `npm run typecheck --if-present`.
