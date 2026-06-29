# code-reviewer — JS / TypeScript traps

Code-quality + correctness lanes for `.ts/.tsx/.js/.jsx`. Vue-specific reactivity /
template lanes → `code-reviewer/vue.md` (load both on a `.vue` diff). ESLint-tier /
AJAX-facade / `@ts-check` placement → `frontend-reviewer`. Run the project's canonical
`typecheck` script (or `tsc --noEmit -p <config that owns the changed files>`) before
commenting; skip cleanly for JS-only projects.

| Lane | Flag | Fix |
|---|---|---|
| Type safety | `any` without justification; `value!` non-null without a preceding guard; `as` cast to an unrelated type; a `tsconfig` edit that weakens strictness | `unknown` + narrow, or a precise type; add a runtime guard; fix the type; call out the strictness regression |
| Async | `async` fn called without `await`/`.catch()` (floating promise); `await` in a loop over independent work; `array.forEach(async …)` | handle/await; `Promise.all`; `for…of` or `Promise.all` |
| Error handling | empty `catch {}`; `JSON.parse` without try/catch; `throw "str"`; React data subtree with no error boundary | act/log in catch; wrap parse; `throw new Error(...)`; add `<ErrorBoundary>` |
| Idiomatic | module-level mutable state; `var`; missing return type on public fn; `==` | immutable + pure; `const`/`let`; explicit return type; `===` |
| Node | `fs.readFileSync` in a request handler; no schema validation (zod/joi) at an external boundary; `process.env.X` with no fallback/startup check | async fs; validate inbound data; validate env at startup |
| Perf (MEDIUM) | inline object/array prop causing re-render; N+1 calls in a loop; `import _ from 'lodash'` | hoist/memoize; batch / `Promise.all`; named tree-shakeable imports |

Security lanes (`eval`/`new Function`, `innerHTML`/`dangerouslySetInnerHTML` XSS,
SQL/NoSQL injection, `child_process` with user input, prototype pollution, hardcoded
secrets) are reportable here too, but the OWASP baseline lives in `security-reviewer`.

## Worked examples

```ts
// BAD — forEach does not await; errors vanish, "done" logs before writes finish
items.forEach(async (i) => { await save(i) })
console.log('done')
// GOOD — await the batch
await Promise.all(items.map((i) => save(i)))
console.log('done')
```

```ts
// BAD — any erases the contract; the cast hides a real shape mismatch
function parse(input: any) { return (input as User).id }
// GOOD — accept unknown, validate, then it is a User
function parse(input: unknown): string {
  const u = UserSchema.parse(input)   // zod throws on mismatch
  return u.id
}
```

Diagnostics: `npm run typecheck --if-present` · `eslint . --ext .ts,.tsx,.js,.jsx` · `npm audit`.
