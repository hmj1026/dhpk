---
name: vue-2-notes
description: Vue 2 (^2.5.17, Options API era) component structure and the reactivity caveats that bite when mutating reactive state. Use when writing or reviewing .vue single-file components in a Vue 2 project (resources/assets/js), or a codebase whose package.json pins vue ^2.5.x. Covers the data() / computed / methods / watch + lifecycle shape, props-down + $emit events-up, vue-loader SFC compilation, the Vue.set / array-mutation traps, and @vue/test-utils 1.x + vue-jest 3 testing. Not for Vue 3 or 2.7 Composition API (predates setup() / <script setup>) — load when touching components or planning a Vue 2 → 3 migration.
---

# Vue 2 — Options API baseline

Targets `vue ^2.5.17`. **Options API only** — the Composition API
(`setup()`, `ref`, `reactive`, `<script setup>`) does not exist here;
it arrives in 2.7 as a backport and is the default in Vue 3.

> SFCs (`.vue`) are compiled by `vue-loader` driven by Laravel Mix
> (webpack 4). Source lives under `resources/assets/js`. See the
> `laravel-mix` module for the build wiring.

---

## Signature features

### Options API component structure

```js
export default {
    name: 'OrderTicket',

    props: {
        order: { type: Object, required: true },
        compact: { type: Boolean, default: false },
    },

    // data MUST be a function returning a fresh object, so each
    // component instance gets its own state (not a shared reference).
    data() {
        return {
            expanded: false,
            note: '',
        };
    },

    computed: {
        // cached, re-evaluated only when a reactive dependency changes
        title() {
            return this.compact ? this.order.no : this.order.fullName;
        },
    },

    methods: {
        toggle() {
            this.expanded = !this.expanded;
        },
    },

    watch: {
        // imperative side effects on a value change
        'order.status'(next, prev) {
            if (next === '6') this.$emit('done', this.order.id);
        },
    },

    created() {
        // instance + reactivity ready; DOM NOT yet mounted
    },

    mounted() {
        // DOM available; safe to read $refs / attach listeners
    },
};
```

Lifecycle order: `beforeCreate → created → beforeMount → mounted →
beforeUpdate → updated → beforeDestroy → destroyed`. Fetch data in
`created` (no DOM needed); touch the DOM in `mounted`.

### Props down, events up

State flows one direction. A child never mutates a prop; it emits an
event and lets the owner of the state change it.

```js
// child
methods: {
    remove() {
        this.$emit('remove', this.item.id); // ask parent to mutate
    },
},
```

```html
<!-- parent template -->
<order-item
    :item="item"
    @remove="onRemove"
/>
```

Mutating a prop in place triggers a Vue warning and is overwritten on
the next parent re-render.

### Single-file components

`<template>` + `<script>` + `<style>` in one `.vue` file, compiled by
`vue-loader`. The template compiles to a render function at build time
(not at runtime), so the runtime-only Vue build is enough.

---

## Reactivity caveats (the classic Vue 2 traps)

Vue 2 reactivity is built on `Object.defineProperty`, which can only
observe properties that exist **when the component is created**. Three
mutations silently fail to trigger re-renders:

### 1. Adding a new property to a reactive object

```js
// NOT reactive — the view will not update
this.order.discount = 10;

// reactive
this.$set(this.order, 'discount', 10);
// or, outside a component:
Vue.set(this.order, 'discount', 10);
```

Declare every key you intend to mutate up front in `data()` (even as
`null`) to avoid needing `$set` at all.

### 2. Array index assignment

```js
// NOT reactive
this.items[0] = newItem;

// reactive
this.$set(this.items, 0, newItem);
// or
this.items.splice(0, 1, newItem);
```

### 3. Array length mutation

```js
// NOT reactive
this.items.length = 0;

// reactive — splice is observed
this.items.splice(0);
```

The array methods Vue patches and observes: `push`, `pop`, `shift`,
`unshift`, `splice`, `sort`, `reverse`. Index/length writes are not
among them.

---

## Testing

`@vue/test-utils` **1.x** (the line that targets Vue 2) + `vue-jest`
**3** to compile SFCs under Jest with the `jsdom` environment.

```js
import { shallowMount } from '@vue/test-utils';
import OrderTicket from '@/components/OrderTicket.vue';

describe('OrderTicket', () => {
    it('emits done when status reaches 6', async () => {
        const wrapper = shallowMount(OrderTicket, {
            propsData: { order: { id: 7, status: '5', no: 'A1' } },
        });

        wrapper.setProps({ order: { id: 7, status: '6', no: 'A1' } });
        await wrapper.vm.$nextTick();

        expect(wrapper.emitted('done')[0]).toEqual([7]);
    });
});
```

- `mount` renders child components; `shallowMount` stubs them (faster,
  isolates the unit).
- State changes are async — `await wrapper.vm.$nextTick()` (or
  `await wrapper.setProps(...)`) before asserting on rendered output.
- jsdom env in `jest.config.js`: `testEnvironment: 'jsdom'`.

---

## What's *missing* compared to 2.7 / Vue 3

If reviewing this codebase, these are absent — do not reach for them:

- **No Composition API** — no `setup()`, `ref`, `reactive`, `computed`
  as standalone imports. Logic reuse is via **mixins** or render-prop
  / scoped-slot patterns, not composables.
- **No `<script setup>`** — every component is an exported options
  object.
- **No Teleport, no Fragments** — a component template requires a
  **single root element**; multiple sibling roots are a compile error.
  Wrap in one `<div>`.
- **`v-model`** binds `value` + `input` only (no named `v-model` /
  multiple models — that is Vue 3).

Migration awareness: a 2 → 3 move means rewriting `Vue.set` calls
(reactivity is Proxy-based in 3, so the traps above largely disappear),
relaxing the single-root rule, and converting global API calls
(`new Vue()` → `createApp`).

---

## When NOT to Use

Not for Vue 3 or the 2.7 Composition API — this baseline predates `setup()` /
`<script setup>`, so `ref` / `reactive` / composables do not exist. Not for the
build pipeline (see the `laravel-mix` module) or non-`.vue` JS (see
`js-static-check-strategy`). Load when touching `.vue` SFCs in a `vue ^2.5.x`
codebase, or planning a 2 → 3 migration.

## Output

Options-API `.vue` components with `data()` as a function, props-down /
`$emit`-up data flow, reactive mutations via `$set` / `splice` (never index or
`length` assignment), a single root element, and `@vue/test-utils` 1.x +
`vue-jest` 3 specs that `await $nextTick()` before asserting.

## Verification

- No prop mutated in place; no `this.obj.newKey =`, `this.arr[i] =`, or
  `this.arr.length =` on reactive state.
- Each component template has exactly one root element.
- Tests use `shallowMount` / `mount` from `@vue/test-utils` 1.x under the `jsdom`
  env and `await` a tick before reading emitted / rendered output.

---

## Cross-references

- `modules/laravel-mix/skills/laravel-mix-notes/SKILL.md` — the webpack
  build that compiles these `.vue` SFCs and maps them to `public/`
- `modules/js/skills/js-static-check-strategy/SKILL.md` — ESLint /
  TypeScript tier strategy that governs the `.vue` and `.js` sources
