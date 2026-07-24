---
name: laravel-mix-notes
description: Laravel Mix 5 (^5.0.9) signature features and the webpack 4 era build traps. Use when editing webpack.mix.js, the resources/assets/ asset sources, or the package.json npm build scripts in a Laravel 5.4 / Mix 5 project, or diagnosing why a dev/watch/prod build fails on a newer Node. Covers the entry/output mapping, mix() versioning + manifest, the dev/watch/hot/prod script ladder, the Elixir heritage, and the legacy-OpenSSL flag. Not for application or Vue component logic — load when working on the asset pipeline itself or planning a Mix 5 → 6 upgrade. Output: build guidance, migration traps, and verification gates.
---

# Laravel Mix 5 — webpack 4 wrapper

Mix `^5.0.9` is the last 5.x line. It is a thin, opinionated wrapper
over **webpack 4** that lives in `webpack.mix.js` at the project root.
You describe entry/output pairs with a fluent API; Mix generates the
webpack config underneath.

> Era: Laravel 5.4, Vue `^2.5.17`, PHP `>=5.6.4`. Mix 5 pins
> webpack 4 — it does **not** use webpack 5 or Vite.

---

## Signature features

### Entry / output mapping

`webpack.mix.js` declares each compiled bundle as a source → output
directory pair:

```js
const mix = require('laravel-mix');

mix.js('resources/assets/js/app.js', 'public/js')
   .js('resources/assets/js/kds.js', 'public/js')
   .sass('resources/assets/sass/app.scss', 'public/css');
```

`mix.js()` emits `public/js/app.js` and `public/js/kds.js`;
`mix.sass()` compiles `app.scss` to `public/css/app.css`. The second
argument is a directory (Mix keeps the source basename) — pass a file
path to rename the output. `mix.js()` enables Vue SFC support and
Babel transpilation out of the box for this era.

### Versioning and the manifest

```js
mix.js('resources/assets/js/app.js', 'public/js')
   .version();
```

`.version()` appends a content hash query string and writes
`public/mix-manifest.json` mapping logical paths to hashed ones. In
Blade, resolve the hashed asset with the `mix()` helper:

```blade
<script src="{{ mix('/js/app.js') }}"></script>
```

This is the cache-busting mechanism — never hardcode the hash. Without
`.version()`, `mix()` still works and returns the plain path.

### npm script ladder

`package.json` scripts wrap the Mix CLI at different modes:

```json
"scripts": {
  "dev": "npm run development",
  "development": "cross-env NODE_ENV=development node_modules/.bin/webpack --config=node_modules/laravel-mix/setup/webpack.config.js",
  "watch": "npm run development -- --watch",
  "watch-poll": "npm run watch -- --watch-poll",
  "hot": "cross-env NODE_ENV=development node_modules/.bin/webpack-dev-server --inline --hot --config=node_modules/laravel-mix/setup/webpack.config.js",
  "prod": "npm run production",
  "production": "cross-env NODE_ENV=production node_modules/.bin/webpack --no-progress --config=node_modules/laravel-mix/setup/webpack.config.js"
}
```

- `dev` / `development` — one unminified build.
- `watch` — rebuild on file change (inotify).
- `watch-poll` — polling watcher for filesystems that drop events
  (Docker bind mounts, network shares, WSL).
- `hot` — webpack-dev-server with hot module replacement.
- `prod` / `production` — minified, optimized build for deploy.

---

## Migration traps / gotchas

### Elixir → Mix heritage

Mix is the successor to **Laravel Elixir** (the gulp-based pipeline of
Laravel 5.0–5.3). A 5.4 project carried over from an earlier release
may still have `gulpfile.js` and `laravel-elixir` artifacts — those are
dead and the API (`elixir(mix => {...})`) does not map to
`webpack.mix.js`. Delete the Elixir remnants; do not try to run both.

### Legacy-OpenSSL prod-build flag on newer Node

Mix 5 / webpack 4 use an MD4-based hash that Node 17+ rejects under
OpenSSL 3, failing with `ERR_OSSL_EVP_UNSUPPORTED` ("digital envelope
routines::unsupported"). Set the legacy provider for the build:

```bash
NODE_OPTIONS=--openssl-legacy-provider npm run prod
```

Bake it into the npm script (cross-platform via `cross-env`) so CI and
local builds match. The cleaner long-term fix is pinning Node to the
14/16 LTS line for this project, but the flag unblocks newer Node.

### Source maps

Source maps are **off by default**. Enable explicitly for dev
debugging — and keep them off (or hidden) in production:

```js
mix.js('resources/assets/js/app.js', 'public/js');
if (!mix.inProduction()) {
    mix.sourceMaps();
}
```

### BrowserSync

`mix.browserSync('localhost:8000')` proxies the app and live-reloads
on asset rebuild. It needs a separate watcher running (`npm run watch`)
and the correct proxy target — behind Docker/nginx, point it at the
container-exposed host:port, not `localhost`, or reloads silently fail.

---

## What's *missing* compared to Mix 6

Mix 6 is a breaking upgrade — do not assume its API works here:

- **webpack 5** — Mix 6 moves to webpack 5; Mix 5 is locked on
  webpack 4 (and so are its loader/plugin versions).
- **`mix.js()` signature** — Mix 6 changed asset-compilation defaults
  and how Vue versions are selected (explicit `mix.vue()` /
  `vue: { version }`); Mix 5 wires Vue 2 implicitly.
- **PostCSS 8** — Mix 6 bumps to PostCSS 8 with a different plugin
  config shape; Tailwind/autoprefixer setups copied from a Mix 6
  guide will not load under Mix 5.

Keep upgrade plans separate from day-to-day Mix 5 edits.

---

## When NOT to Use

Not for application or Vue component logic (use the `laravel-5.4` /
`vue-2` notes), and not for a Mix 6+ / webpack 5 / Vite project — the
APIs differ. This skill is only for the Mix 5 asset pipeline itself.

## Output

`webpack.mix.js` / `package.json` edits that build cleanly under Mix 5
(webpack 4) — flag anything copied from a Mix 6 / Vite guide.

## Verification

- Confirm `laravel-mix` resolves to `^5.x` (`npm ls laravel-mix`).
- On Node 17+, confirm `NODE_OPTIONS=--openssl-legacy-provider` is set.
- Run `npm run dev` (and `npm run prod`) to confirm the build succeeds.

---

## Cross-references

- `modules/vue-2/skills/vue-2-notes/SKILL.md` — Vue 2 SFCs are compiled
  through Mix via `vue-loader`; the two modules pair on the frontend
  build
- `modules/js/skills/js-lint-config/SKILL.md` — ESLint tier strategy
  and progressive TypeScript for the JS that Mix bundles
- `modules/js/skills/js-static-check-strategy/SKILL.md` — static-check
  tiers for the same `resources/assets/` sources Mix consumes
