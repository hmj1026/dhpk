# Vue Review Traps

Apply these checks only when the changed code uses Vue. First identify the configured Vue version and compiler path from the project’s dependency lock and build configuration; use that version’s semantics.

## Reactivity and template unwrapping

**Trigger → evidence/action:** A ref or reactive value crosses between script, template, nested object, array, or collection code. Inspect the exact access context and test the rendered or updated behavior. Vue unwraps top-level template-context refs, while nested expressions and refs inside arrays or collections have different behavior; see [Reactivity Fundamentals](https://vuejs.org/guide/essentials/reactivity-fundamentals.html).

**Do not apply when:** The value is a plain object or the code already follows the configured version’s access rules. A `.value` occurrence or its absence is not a defect without a demonstrated stale or incorrect update.

## List identity

**Trigger → evidence/action:** A `v-for` list can reorder, insert, remove, or render stateful child components or form controls. Check whether each item has a stable key from its domain identity, then test reordering and state retention. Vue’s [list-rendering guide](https://vuejs.org/guide/essentials/list.html) describes when keyed identity matters.

**Do not apply when:** The rendered list is static or its output has no child or DOM state that depends on item identity. Do not require a key to be globally unique outside its list.

## Resources and subscriptions

**Trigger → evidence/action:** A component or watcher creates a timer, listener, observer, subscription, or request that can outlive the state that created it. Trace its owner and stop or dispose it at the matching lifecycle boundary; test unmount, replacement, and stale watcher results as relevant. See Vue’s [lifecycle hooks](https://vuejs.org/guide/essentials/lifecycle.html).

**Do not apply when:** Vue already owns and stops a synchronously created component-scoped effect, or the resource is deliberately application-scoped with an explicit owner and shutdown path. Do not demand redundant teardown for framework-managed effects.

## Server rendering

**Trigger → evidence/action:** The project configuration shows Vue SSR or another server-rendered entry. Check module-level mutable state for cross-request sharing, and check setup-time side effects and browser globals against the server/client lifecycle. See [Vue SSR guidance](https://vuejs.org/guide/scaling-up/ssr.html).

**Do not apply when:** The project is client-only and has no server-rendering entry. Do not add SSR constraints based on a possible future deployment mode.

For generic TypeScript boundaries, promises, and async error ownership, use the [JavaScript review traps](js.md).
