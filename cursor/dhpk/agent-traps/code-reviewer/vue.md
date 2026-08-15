# code-reviewer — Vue traps

Vue-specific reactivity / template / component lanes. Generic TS type-safety + async
correctness → `code-reviewer/js.md` (load both on a `.vue` diff). ESLint-tier / AJAX
facade → `frontend-reviewer`. Detect the major from `package.json` `vue` (the `vue-2`
module pins Options-API conventions); confirm `eslint-plugin-vue` + `vue-tsc` exist.

| Lane | Flag | Fix |
|---|---|---|
| **Reactivity** | destructuring `defineProps` in Vue < 3.5 (snapshot, not reactive); `reactive()` on a primitive; reassigning a whole `reactive()` object; `watch(() => myRef, …)` (watches the ref, not its value); `watch(count, …)` on a 3.5 destructured prop (compile error) | `toRefs()` / `props.x`; `ref()` for primitives; mutate fields or `Object.assign`; `watch(() => myRef.value, …)`; `watch(() => count, …)` |
| `.value` | `ref()` object read without `.value` inside `<script>` | add `.value` (templates auto-unwrap; script does not) |
| **Template** | `v-for` without `:key`; `:key="index"`; `v-if` + `v-for` on the same element; `v-model` to a computed without a setter; `v-bind="$attrs"` without `inheritAttrs:false` | stable id key; `<template v-for>` + inner `v-if` or a filtered computed; writable ref / get+set; disable inherit |
| Composable | side effects in module scope; missing cleanup (`watch`/listener/interval/fetch); stores a `.value` snapshot of a passed ref; returns non-reactive data; not `use`-prefixed | move into `setup`/lifecycle; teardown via `onUnmounted`; keep the ref; return `ref`/`computed`; rename `useFoo` |
| Component | SFC > 300 lines; mutating a prop; prop without `type`; raw `document.querySelector`/DOM ref | extract subcomponents/composables; `emit`/`v-model` up; typed `defineProps`; `useTemplateRef` |
| Router | guard returns `false` with no redirect; `useRoute().params` destructured at top level; lazy route without error/loading fallback | redirect/explain; `toRefs`/`computed`; provide fallback |
| Pinia | multi-field mutation outside an action/`$patch`; non-serializable state; action without error handling | move into actions; keep state serializable; guard async |
| **SSR (Nuxt)** | `window`/`document`/`localStorage` without `process.client`/`onMounted`; `useAsyncData`/`useFetch` without `key`; secret in `useRuntimeConfig().public`; `<ClientOnly>` around SEO content | client-guard; add `key`; server-only config; render SEO content server-side |
| Perf (MEDIUM) | expensive `computed` over large data; `ref()` on a giant immutable; `v-show` vs `v-if` misuse; `<KeepAlive>` without `:max` | memoize/watcher; `shallowRef`; pick by toggle frequency; bound the cache |

Security: `v-html` with unsanitized input (Vue's `dangerouslySetInnerHTML`) and `:href`/`:src` accepting `javascript:`/`data:` URLs are CRITICAL — sanitize (DOMPurify) at the call site / validate the URL scheme; the OWASP baseline lives in `security-reviewer`.

## Worked example

```vue
<!-- BAD (Vue < 3.5) — destructured props are a snapshot; title never updates -->
<script setup>
const { title } = defineProps(['title'])
</script>
<!-- GOOD — keep the reactive link -->
<script setup>
const props = defineProps(['title'])   // use props.title, or toRefs(props)
</script>
```

Diagnostics: `vue-tsc --noEmit` · `eslint . --ext .vue,.ts,.js` · `npm run typecheck --if-present`.
