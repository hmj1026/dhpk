# code-reviewer — JS / TypeScript traps

Code-quality + correctness lanes for `.ts/.tsx/.js/.jsx`. Vue-specific reactivity /
template lanes → `code-reviewer/vue.md` (load both on a `.vue` diff). ESLint-tier /
AJAX-facade / `@ts-check` placement → `frontend-reviewer` (JS module references).
Run the project's canonical `typecheck` script (or `tsc --noEmit -p <config that owns
the changed files>`) before commenting; skip cleanly for JS-only projects.

| Lane | Trigger | Action | Non-apply |
|---|---|---|---|
| Type safety | `any` without justification; `value!` without a preceding guard; `as` to an unrelated type; a `tsconfig` edit that weakens strictness | `unknown` + narrow, or a precise type; add a runtime guard; fix the type; call out the strictness regression | `any` in generated `.d.ts`; `as const`; JS-only projects (skip typecheck) |
| Async | `async` fn called without `await`/`.catch()`; `await` in a loop over independent work; `array.forEach(async …)` | handle/await; `Promise.all`; `for…of` or `Promise.all` | a fire-and-forget logger the project already documents as un-awaited |
| Error handling | empty `catch {}`; `JSON.parse` without try/catch; `throw "str"`; React data subtree with no error boundary | act/log in catch; wrap parse; `throw new Error(...)`; add `<ErrorBoundary>` | a catch that rethrows after logging |
| Idiomatic | module-level mutable state; `var`; missing return type on public fn; `==` | immutable + pure; `const`/`let`; explicit return type; `===` | `== null` as an explicit null-or-undefined check |
| Node | `fs.readFileSync` in a request handler; no schema validation at an external boundary; `process.env.X` with no fallback/startup check | async fs; validate inbound data; validate env at startup | CLI/build scripts that are allowed to be sync |
| Perf (MEDIUM) | inline object/array prop causing re-render; N+1 calls in a loop; `import _ from 'lodash'` | hoist/memoize; batch / `Promise.all`; named tree-shakeable imports | a one-off script outside the UI bundle |

Security lanes (`eval`/`new Function`, `innerHTML`/`dangerouslySetInnerHTML` XSS,
SQL/NoSQL injection, `child_process` with user input, prototype pollution, hardcoded
secrets) are reportable here too, but the OWASP baseline lives in `security-reviewer/js.md`.

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
  const u = UserSchema.parse(input)
  return u.id
}
```

Diagnostics: `npm run typecheck --if-present` · `eslint . --ext .ts,.tsx,.js,.jsx` · `npm audit`.
