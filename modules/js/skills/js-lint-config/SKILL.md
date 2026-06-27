---
name: js-lint-config
description: ESLint 9 flat-config tier pattern (Tier 1 strict / 1.5 core-exempt / 1.7 deferred-migration / 2 test / Global vendor ignores), custom no-restricted-syntax AST selectors, the legacy-globals whitelist three-way sync (ESLint config / TS ambient .d.ts / JSDoc typedef), TypeScript noEmit gate, and progress-measurement grep templates. Use when planning per-leaf cleanup, adding a leaf that introduces a new global, interpreting /ts-check-status output, validating the Phase 2 exit gate, editing eslint.config.js or tsconfig.json, frontend-reviewer auditing tier consistency, or deciding which tier a new file belongs to. Not for everyday JS business logic or simple AJAX wrapper lookups.
---

# JS lint config — tier framework

`modules/js/references/static-checks.md` is the always-loaded index. This
skill is the **detail companion** — load it when you need the full tier
design, AST selectors, three-list sync pattern, or progress-measurement
grep templates.

> SSOT is `eslint.config.js`. This skill maps the design behind it so you
> don't have to read 1000+ lines of config to grok the tiers.

---

## Tier model

The framework scales from a clean greenfield codebase up to a legacy
monolith mid-migration. Each tier expresses a different blast-radius /
acceptable-rule trade-off.

### Tier 1 — Strict

The cleaned-up source — small leaf files in a frontend subdirectory.

- `no-undef: error` — catch undeclared global references.
- `no-implicit-globals: error` — no script-top implicit globals (IIFE OK).
- `no-restricted-syntax: error` — block bare AJAX (`$.ajax`, `fetch`, `axios`).
- `no-restricted-globals: error` — backstop the `MemberExpression` variant
  (`window.fetch`, `globalThis.fetch`).

### Tier 1A — JSDoc-globals SSOT (if you use one)

If the project keeps an ambient typedef SSOT (`js/<root>/jsdoc-globals.js`),
that one file must be `no-implicit-globals: off`. The script-top declarations
are intentional ambient typedef definitions.

### Tier 1.5 — Core-exempt

Legacy monolith entry-point files (often 5–10 hand-curated bundle files at
the root of `js/`). These exempt 4 rules — `no-undef`,
`no-implicit-globals`, `no-restricted-syntax`, `no-restricted-globals` —
because they are the source of cross-leaf globals, PHP-style polyfills, and
late-init runtime state. Forcing `no-undef` here generates hundreds of false
positives and drowns out real findings.

Maintain the list at `eslint.config.js` (Tier 1.5 files: array literal). The
hook-side tier detector (`modules/js/hooks/_lib/js-tier-detect.sh`) reads
the same list from `module.yaml`'s `js.core_files`. **Two-way sync** — see
the three-list sync section below.

### Tier 1.6 — Admin / non-frontend-facing subpath

If your codebase has an admin area (e.g. `js/admin/**`) that loads in a
different runtime than the customer-facing frontend (no shared SSOT
facade), it usually wants:

| Rule | Setting |
|---|---|
| `no-restricted-syntax` | off |
| `no-restricted-globals` | off |
| `no-implicit-globals` | off |
| `no-undef` | error (keep) |

Rationale: admin pages typically use a script-top `window.foo = ...` pattern
that pre-dates the frontend SSOT facade and uses jQuery direct.

### Tier 1.7 — Deferred-migration

Files with known `$.ajax` / `axios` callsites that are scheduled for a future
PR. They opt out of `no-restricted-syntax` + `no-restricted-globals` but
keep `no-undef` and `no-implicit-globals` (so real bugs still surface).

Each such file should have a tracked exit plan — a per-leaf cleanup PR that
removes the legacy callsites and migrates the file back to Tier 1.

### Tier 2 — Tests

Jest / Vitest / Mocha test files. CommonJS by default (most test runners),
`globals.jest` + `globals.node`. `no-undef: error`, `no-implicit-globals:
off` (CommonJS module scope is implicit-global from ESLint's POV).

### Global ignores

Vendored third-party libraries you don't own. Examples seen in the wild:

- `js/vendor/**`, `js/ckeditor/**`, `js/ckfinder/**`, `js/jquery-*`,
  `js/dataTables.*`, `js/paho-mqtt/**`, `js/ueditor/**`.
- Any file matching `*.min.js`.
- Anything explicitly listed in `module.yaml`'s `js.vendor_globs`.

> **Hook-side parity.** `modules/js/hooks/_lib/js-tier-detect.sh` reads the
> same `js.vendor_globs` from `module.yaml`. Drift between ESLint Global
> ignores and the hook detector causes false-positive lint warnings on
> vendored files. When a vendor path is added to ESLint, also add it to
> `module.yaml` (and vice versa).

---

## Custom `no-restricted-syntax` AST selectors

When the project has a canonical AJAX facade (e.g. a `MyApp.api.request()`
wrapper), use AST selectors to enforce its usage:

| Selector | Catches |
|---|---|
| `CallExpression[callee.object.name="$"][callee.property.name=/^(ajax\|post\|get)$/]` | `$.ajax`, `$.post`, `$.get` |
| `CallExpression[callee.object.name="jQuery"][callee.property.name=/^(ajax\|post\|get)$/]` | `jQuery.ajax` etc. |
| `CallExpression[callee.name="fetch"]` | bare `fetch(...)` |
| `CallExpression[callee.type="MemberExpression"][callee.object.name=/^(window\|globalThis)$/][callee.property.name="fetch"]` | `window.fetch` / `globalThis.fetch` |
| `ImportDeclaration[source.value="axios"]` | axios ESM import |
| `CallExpression[callee.name="axios"]` | bare `axios(...)` |
| `CallExpression[callee.object.name="axios"]` | `axios.get(...)` |

Pair each selector with an actionable `message` pointing at the canonical
wrapper.

---

## Legacy-globals whitelist — three-list sync

A legacy frontend monolith typically has dozens of `window.*` globals that
need to be **declared three places** so all three tools agree they exist:

1. **`eslint.config.js`** — a `<projectName>LegacyGlobals` constant (or
   equivalent), passed to flat config `languageOptions.globals`. SSOT for
   `no-undef`.
2. **`<frontend-root>/<project>-ambient.d.ts`** (or similar) — `declare
   var Foo: any;` for each global. SSOT for `tsc --noEmit` (bare identifier
   resolution).
3. **`<frontend-root>/jsdoc-globals.js`** — `@typedef`s. **Only required**
   when the ambient `.d.ts` `any` is too loose and a global needs a real
   shape. Optional refinement layer.

Per-leaf cleanup PR that adds a new global **must** update all three. CI
catches drift after the fact (`no-undef` / TS2304), but reviewer should
verify the three-way sync proactively.

Common buckets to organise the whitelist into:

- **Project namespace** — your top-level facade (`MyApp`, `Display`,
  `Customer`, `Booking`, etc.).
- **Polyfills / shims** — `isset`, `is_array`, `number_format`, `implode`
  (if the project shimmed PHP idioms into JS).
- **Cross-leaf re-exports** — symbols deliberately re-exposed via `window`.
- **Vendor libraries used unprefixed** — `_` (lodash), `moment`,
  `sprintf`, `Swal`, `QRCode`, `Vue`, `CKEDITOR`, etc.
- **UI helpers** — modal / alert / loading helpers.
- **Runtime mutables** — `socket`, timers, `flag`, etc. Mark these
  `writable: true` in ESLint globals.
- **Editor / table plugin globals** — `editText`, `editOption`, etc.

---

## Progress-measurement grep (line-anchored)

When the codebase is mid-`// @ts-check` rollout, measure progress with:

```bash
# Strict opt-in: leaves with `// @ts-check` on its own line
find <frontend-root> -maxdepth 1 -name '*.js' -exec \
    grep -lE '^[[:space:]]*//[[:space:]]*@ts-check[[:space:]]*$' {} \;

# Transitional: still on `// @ts-nocheck`
find <frontend-root> -maxdepth 1 -name '*.js' -exec \
    grep -lE '^[[:space:]]*//[[:space:]]*@ts-nocheck' {} \;
```

> **Trap.** A naïve `grep -l '@ts-check'` matches `// TODO: enable
> @ts-check` and `// see @ts-check below` — both produce a false-green.
> Always use a line-anchored regex (`^\s*//\s*@ts-check\s*$`) so only a
> dedicated leading directive counts.

Use the `/ts-check-status` command for a one-shot rendered summary.

---

## Sibling skill / references

- `modules/js/skills/js-static-check-strategy/SKILL.md` — the per-leaf
  rollout playbook (`// @ts-check` discipline, tsconfig `exclude` strategy,
  19-leaf-style classification template, line-anchored grep traps).
- `modules/js/references/static-checks.md` — always-loaded index pointing
  at this skill, the strategy skill, and the relevant hooks.
- `modules/js/references/frontend-review-patterns.md` — patterns the
  `frontend-reviewer` agent consults when this module is active.

---

## When NOT to Use

Not for everyday JS business logic or simple AJAX-wrapper lookups (the
always-loaded `references/static-checks.md` index covers those). Not for the
per-leaf `// @ts-check` rollout itself — that is the sibling
`js-static-check-strategy`. Load this for tier design, AST selectors, and the
three-list global sync.

## Output

A correctly tiered `eslint.config.js` (Tier 1 / 1.5 / 1.6 / 1.7 / 2 + Global
ignores) whose Tier 1.5 list and vendor globs stay in sync with `module.yaml`,
custom `no-restricted-syntax` selectors that point at the canonical AJAX facade,
and any new global declared in all three lists.

## Verification

- `eslint.config.js` Tier 1.5 files == `module.yaml` `js.core_files`; Global
  ignores == `js.vendor_globs`.
- A newly added global exists in the ESLint globals, the ambient `.d.ts`, and
  (if shaped) the JSDoc typedef — no `no-undef` / TS2304 drift.
- `tsc --noEmit` passes; bare `$.ajax` / `fetch` / `axios` appear only in exempt
  tiers.
