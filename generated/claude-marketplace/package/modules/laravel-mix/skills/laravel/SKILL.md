---
name: laravel
description: 'Laravel framework guidance across 5.4, 6, 7, 8, 9, 10, 11, and optional Mix 5. Use when implementing or reviewing framework-touching Laravel code, planning an upgrade, or debugging a version-specific build. Not for Symfony, Yii, or frontend-only work; use dhpk-php-runtime-router for runtime selection. Output: one selected Laravel or Mix reference, compatibility constraints, and verification gates.'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Laravel family router

This family package is self-contained. It routes a Laravel request to one
version reference and keeps version-specific guidance out of the initial
prompt until the selector is known.

## Resolve the selector

Use this order and stop at the first decisive result:

1. **Explicit selector** — honor the caller's version without reading a
   project file. Supported selectors are `5.4`, `6`, `7`, `8`, `9`, `10`,
   `11`, and `mix`. The compatibility aliases `5-4`, `laravel-5.4`,
   `laravel-5-4`, `laravel-mix`, and `mix-5` normalize to `5.4` or `mix`.
2. **Project detection** — if no selector was supplied, read the current
   project's `composer.lock`, then `composer.json`, for
   `laravel/framework`. A package-only asset project may also resolve `mix`
   from `package.json` when `laravel-mix` is declared. These files are read
   directly by the family-local resolver.
3. **Ask** — if the selector is missing, malformed, unsupported, or
   ambiguous, ask which supported selector applies. Never guess a nearby
   major or silently use the newest reference.

Project detection never consults dhpk installation or publication manifests.
The family package must continue to work when copied by itself.

## Load exactly one reference

After resolution, load only the matching file below. Do not preload sibling
versions. For a cross-version review or upgrade, consult
[`compatibility.md`](compatibility.md) or [`migration.md`](migration.md) after the selector-specific
reference; those shared notes are not selector targets.

| Selector | Reference |
| --- | --- |
| `5.4` (or `5-4`) | [`references/5-4.md`](references/5-4.md) |
| `6` | [`references/6.md`](references/6.md) |
| `7` | [`references/7.md`](references/7.md) |
| `8` | [`references/8.md`](references/8.md) |
| `9` | [`references/9.md`](references/9.md) |
| `10` | [`references/10.md`](references/10.md) |
| `11` | [`references/11.md`](references/11.md) |
| `mix` (or `laravel-mix`) | [`references/mix.md`](references/mix.md) |

The resolver reports the selected relative reference and its complete file
contents. A successful resolution therefore has exactly one loaded reference;
an ask result has none.

## When NOT to Use

- Use `dhpk-php-runtime-router` for Symfony, Yii, or general PHP runtime
  selection that is not Laravel-specific.
- Use framework-neutral guidance for frontend-only work; select `mix` only
  when the project owns the Laravel Mix pipeline described above.

## Output

Return the selected Laravel or Mix selector, the one loaded reference, the
applicable PHP/framework floor, and the verification gates from that reference.
For an unresolved or ambiguous project, return the actionable ask and report
that no version reference was loaded.

## Verification

- Run `node scripts/resolve-version.js --json [--version <selector>]` and
  confirm the result names the expected family, selector, source, and
  reference.
- Run `php artisan --version` or `composer show laravel/framework` when the
  project is available, then compare it with the selected reference.
- For a copied family directory, run the CLI with `NODE_PATH` empty and an
  explicit selector to prove that resolution has no repository dependency.

The family-local `scripts/resolve-version.js` is the JSON CLI entrypoint. It
accepts an optional explicit selector and exits non-zero when resolution asks
for input or encounters an error. `scripts/version-resolver.js` is the
programmatic resolver used by the CLI; it returns the selected reference and
loaded contents, or an ask result with no loaded references.

## Apply the selected guidance

- Confirm the installed framework version with `php artisan --version` or
  `composer show laravel/framework` when the project is available.
- Check the PHP floor, source-generation layout, and package constraints in the
  selected reference before writing framework-coupled code.
- Treat the reference as locked framework documentation, not the application's
  policy SSOT. Keep domain and product decisions in the application sources.
- Run the reference's verification gates and report any version mismatch or
  unresolved migration trap explicitly.

## Mix boundary

`mix` is an optional upgraded legacy asset-pipeline selector for Laravel Mix 5
and webpack 4. It is not default Laravel framework coupling. Select it for a
project that actually owns `webpack.mix.js`, `laravel-mix`, and the associated
npm scripts; otherwise use the Laravel framework selector alone.

## Portable package boundary

All resolver imports and reference paths are family-relative. Core resolution
requires no dhpk manifest, hook, agent, MCP server, or repository working state.
