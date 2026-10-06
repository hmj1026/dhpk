# Frontend-reviewer — JS-module audit patterns

Loaded by the `frontend-reviewer` agent when the dhpk `js` module is
active. Each section describes a pattern to grep for + the verdict shape.

## SSOT-facade adherence

If the project has a canonical AJAX facade (e.g. `MyApp.api.request`,
`MyApp.list.ajaxPromise`, `MyApp.postData`), enforce its use outside
the explicit exemption set.

```bash
# Bare AJAX in non-exempt files (adjust to your project's facade name)
rg -nE '\$\.(ajax|post|get)\(|jQuery\.(ajax|post|get)\(|(^|[^.])\bfetch\(|\baxios(\.|\()' \
    <frontend-root>/ \
    --type js --type ts \
    -g '!<exempt-tier-1.5>/**' -g '!<exempt-tier-1.7>/**' -g '!*.min.js'
```

Findings → CRITICAL if in `Tier 1` files; WARN if in `Tier 1.7` files
(those are the documented deferred-migration set, but each should still
be tracking down).

## Globals attached to `window`

Project convention is usually "globals on `<project-namespace>.*`, never
bare `window`". Grep for `window.<lowercase identifier>` assignments in
non-exempt code:

```bash
rg -n 'window\.[a-z_][a-zA-Z0-9_]*\s*=' \
    <frontend-root>/ \
    --type js --type ts \
    -g '!<exempt-tier-1.5>/**' -g '!*.min.js'
```

Constants on `window.<UPPER_SNAKE>` may be intentional — verdict
INFO unless clearly wrong.

## ESLint tier consistency

When a new file lands under `<frontend-root>/<subdir>/`, it inherits
Tier 1 strict rules. Verify:

1. The file does not appear in `eslint.config.js` Global ignores
   (would silently exempt it from Tier 1).
2. The file is NOT in `module.yaml`'s `js.vendor_globs` (the hook-side
   detector would mis-classify it as `vendor`).
3. If it introduces a new global, the legacy-globals whitelist gets
   updated in all three files (`eslint.config.js`, ambient `.d.ts`,
   `jsdoc-globals.js`) per the three-list sync rule.

## `// @ts-check` line anchoring

Reject substring-match grep usage (`grep -l '@ts-check'`) in any newly
added script. The valid form is the line-anchored regex
`^\s*//\s*@ts-check\s*$`. See the
`js-static-check-strategy` skill for the rationale and the trap pattern.

## Vendored / minified files

Never edit `*.min.js` directly — edit the source and re-minify. If the
diff includes a `*.min.js` change without a paired source change, flag
HIGH.

## Inline `<script>` blocks in server-side templates

If the project has a template language that emits inline JS (PHP `.php`
views, Rails `.erb`, Django `.html`, etc.), inline `<script>` blocks
typically bypass ESLint unless the project has explicit per-template lint
rules. Flag any large inline block (> ~20 lines) as a candidate to
extract into a `<frontend-root>/<view-name>.js` companion file.

## Removal annotations

Removed code should carry a `// Removed YYYY-MM-DD — <reason>` line when
the reason is non-obvious from git blame (cross-leaf side effect, deferred
re-introduction, etc.). Missing annotation on a non-trivial removal in
a Tier 1.5 file: WARN.
