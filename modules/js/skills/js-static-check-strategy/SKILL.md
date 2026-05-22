---
name: js-static-check-strategy
description: Progressive `// @ts-check` per-leaf rollout playbook for legacy JS bundles. Covers the three-list legacy-globals sync (ESLint globals / TypeScript ambient .d.ts / JSDoc typedef), tsconfig exclude strategy for files that resist type-check, leaf classification (typedef-widening-fixable vs permanent-exclude), line-anchored progress grep traps, and Phase-2 exit-gate semantics. Use when planning a per-leaf cleanup PR, introducing a new leaf-level global, editing tsconfig's exclude list, interpreting /ts-check-status output, or validating that the strict-checkJs exit gate is met. For day-to-day lint-rule lookups, the sibling skill js-lint-config and the references/static-checks.md index are enough.
---

# JS static-check strategy — progressive rollout playbook

> Always-loaded SSOT rule: `modules/js/references/static-checks.md`.

This skill carries the long-form execution detail so the always-loaded rule
stays short. Load this when you are actually doing the rollout work.

## Legacy-globals — three-list sync

When a leaf introduces a new global, **all three lists must update together**
(no automatic derivation — three independent maintained files):

1. **`eslint.config.js`** `<projectName>LegacyGlobals` constant — readonly /
   writable annotation. SSOT for `no-undef`.
2. **`<frontend-root>/<project>-ambient.d.ts`** — `declare var X: any;`
   block. SSOT for `tsc --noEmit` bare-identifier resolution.
3. **`<frontend-root>/jsdoc-globals.js`** — `@typedef` (only when the
   default `any` from the ambient `.d.ts` is too loose and a real shape
   adds value).

A leaf PR that misses any of the three surfaces later as `no-undef` or
TS2304. CI catches drift after the fact; reviewers should still verify
three-way sync proactively.

## `// @ts-check` progressive strategy

- One leaf per PR: add `// @ts-check` + clean up the JSDoc + run the
  unit / contract tests to confirm no regression.
- Track the rollout against your mechanical-extraction cadence (Stage A,
  B, C…). Each stage produces a batch of leaves ready for type-check
  enablement.
- A stuck leaf can land `// @ts-nocheck` with a TODO comment as a transitional
  state — but every transitional file should have a tracked exit PR.

Measure progress with the **line-anchored** grep (anything looser is
gameable — see the trap below):

```bash
# Step 1 — strict opt-in (exit gate: this list must end up empty)
find <frontend-root> -maxdepth 1 -name '*.js' -exec \
    grep -lE '^[[:space:]]*//[[:space:]]*@ts-check[[:space:]]*$' {} \;

# Step 2 — files still on `// @ts-nocheck` (governance indicator;
# should trend toward zero, but some files may be permanent exclusions —
# see classification below).
find <frontend-root> -maxdepth 1 -name '*.js' -exec \
    grep -lE '^[[:space:]]*//[[:space:]]*@ts-nocheck' {} \;
```

`/ts-check-status` runs both queries plus a summary.

### Leaf classification template

When a leaf gets stuck on `// @ts-nocheck`, classify which exit path applies:

- **Typedef-widening fixable** — blocker is a too-narrow ambient `@typedef`
  conflicting with the leaf's constructor / inference pattern. **Exit
  path:** widen the typedef (or write a more precise JSDoc) in the
  per-leaf cleanup PR, then flip back to `// @ts-check`.
- **Permanent exclude** — blocker is cross-leaf late-init globals
  (typically the core monolith and a couple of helper modules sitting
  next to it). Widening the typedef doesn't help — the issue is runtime
  semantics, not a type definition. **Exit path:** add the file to
  `tsconfig.json`'s `exclude` array (same treatment as the truly massive
  leaves that resist any single-PR cleanup). Expected to live on
  `// @ts-nocheck` indefinitely.

Misclassifying a permanent-exclude file as "typical leaf cleanup" wastes
work. Look at the leaf's relationship to the monolith first.

### Trap — grep gameable

A bare `grep -l '@ts-check'` is a substring match. During the transitional
period, files often carry **both** `// @ts-nocheck` (the active directive)
**and** a comment mentioning `@ts-check` (e.g. `// TODO: enable @ts-check
after widening User typedef`). The bare grep matches the comment and
reports the file as already opted into strict mode.

The line-anchored form (`^\s*//\s*@ts-check\s*$`) only matches a dedicated
leading directive, which is the actual TypeScript opt-in trigger.

## `tsconfig.json` strategy

```jsonc
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,           // see note below
    "noEmit": true,
    "strict": false,
    "target": "ES2017",         // adjust to project's runtime baseline
    "module": "CommonJS",       // or ESNext for modern bundler projects
    "moduleResolution": "node",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": false,
    "lib": ["ES2017", "DOM", "DOM.Iterable"]
  },
  "include": [
    "<frontend-root>/**/*.js",
    "<frontend-root>/**/*.d.ts",
    "<frontend-root>/jsdoc-globals.js"
  ],
  "exclude": [
    // The monolith bundle files and any leaf classified as "permanent exclude"
    "<frontend-root>/<monolith-entry>.js",
    "<frontend-root>/<helper-1>.js",
    "<frontend-root>/<helper-2>.js",
    "node_modules"
  ]
}
```

**`checkJs` design choice.** Two reasonable interpretations:

- **Strict project-wide** (`checkJs: true`) — every `.js` file is checked
  unless it carries `// @ts-nocheck`. Suitable when ≥ ~80% of leaves
  already have `// @ts-check`.
- **Per-leaf opt-in** (`checkJs: false`) — only files with `// @ts-check`
  are checked. Suitable when most leaves are still being audited.

Mid-rollout, **per-leaf opt-in wins**. Flip to project-wide once the
opt-in count hits the threshold above and the `// @ts-nocheck` set has
stabilised (only the permanent-exclude files remain).

## Ambient typedef standard

`<frontend-root>/jsdoc-globals.js` is where structural typedef SSOT lives:

- `@typedef` for the project namespace + its main sub-objects.
- `@typedef` for the canonical AJAX wrapper (`MyApp.api.request`,
  `MyApp.list.ajaxPromise`, etc.) — gives leaves accurate parameter /
  return types without per-leaf JSDoc.
- `@typedef` for major domain modules.

Leaf PRs annotate call sites via JSDoc `@type`, `@param`, `@returns`; TS
resolves cross-leaf types through the ambient typedef.

## Future evolution

| Work | Trigger |
|---|---|
| Migrating Tier 1.5 / Tier 1.7 files toward Tier 1 | One-by-one as their `$.ajax` / `axios` callsites get migrated |
| Promoting `checkJs` to `true` | When per-leaf strict opt-in reaches the threshold above |
| Linting `<script>` blocks inside server-side templates | Optional Phase-3 — usually scoped to the view files holding inline config / page-config SSOT |
| Bundler / ESM migration | Separate effort — once the modular structure is stable and the SSOT-facade has matured |

## Related rule

- `modules/js/references/static-checks.md` — always-loaded index pointing at
  this skill and the lint-config skill.
- `modules/js/skills/js-lint-config/SKILL.md` — companion skill with the
  ESLint tier model, custom AST selectors, and the legacy-globals
  three-list sync detail.
