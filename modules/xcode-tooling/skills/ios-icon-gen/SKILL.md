---
name: ios-icon-gen
description: Generate iOS/macOS asset-catalog imagesets (1x/2x/3x PNG + Contents.json) from SF Symbols (Apple-native, offline, macOS) or the Iconify API (275k+ open-source icons, online). Use when adding icons to an Xcode asset catalog, replacing placeholder glyphs, or searching for an icon that matches a project's style. Part of the xcode-tooling module; requires the swift module.
---

# iOS icon generation

Two sources, **one output**: an Xcode `.imageset` with `@1x/@2x/@3x` PNGs and a
`Contents.json`. Generate straight into the catalog with `--output ./Assets.xcassets/...`.

| Source | Icons | Needs | Best for |
|--------|-------|-------|----------|
| **SF Symbols** | 5000+ Apple symbols | macOS (SF Symbols rendering) | system-matching, offline |
| **Iconify API** | 275k+ from 200+ sets | internet | breadth, a specific open-source style |

Scripts live next to this file in `scripts/`:

- `scripts/iconify_gen.sh` — search / preview / generate from Iconify.
- `scripts/generate_icons.swift` — render an SF Symbol to PNGs (macOS).

## Workflow

1. **Decide** what the icon represents, the target color, and the base size
   (default 68px → @2x 136 / @3x 204).
2. **Search** before generating:
   - Iconify: `bash scripts/iconify_gen.sh search "receipt"`
   - SF Symbols: browse the SF Symbols app, or `scripts/generate_icons.swift --list receipt`
3. **Preview** (Iconify): `bash scripts/iconify_gen.sh preview mdi:receipt-text-outline`
4. **Generate**:
   - Iconify: `bash scripts/iconify_gen.sh mdi:receipt-text-outline editTool_expenseReport --output ./babylon/Assets.xcassets/icons`
   - SF Symbols: `swift scripts/generate_icons.swift doc.text.below.ecg editTool_expenseReport --output ./babylon/Assets.xcassets/icons`
5. **Verify** by reading the generated `@2x` PNG before committing.

## Popular Iconify sets

`mdi` (Material), `ph` (Phosphor), `solar`, `tabler`, `lucide`, `ri` (Remix),
`carbon`, `heroicons`. Format is always `<prefix>:<name>`.

## Rules

- **Search before generating** — match the project's existing icon style (weight,
  color, dimensions) instead of guessing.
- **SF Symbols for system consistency**, Iconify when you need a specific look.
- **Generate into the catalog** with `--output` to skip a copy step.
- **Verify visually** — always read the `@2x` PNG; never commit unseen icons.
- App-icon (`AppIcon`) assets have their own size matrix — this skill targets
  in-app symbol/glyph imagesets, not the marketing app icon.

## When NOT to Use

- App-icon / marketing `AppIcon` assets — different size matrix; this skill is for in-app symbol/glyph imagesets.
- Non-Xcode icon needs (web / Android assets, raw SVG export).
- SF Symbols rendering off macOS — `generate_icons.swift` needs macOS; use the Iconify path instead.

## Output

An Xcode `.imageset` written into the target asset catalog: `@1x` / `@2x` / `@3x`
PNGs plus a `Contents.json`, named to match the project's existing glyph naming.

## Verification

- [ ] Searched the source for an on-style match before generating.
- [ ] `.imageset` contains `@1x`, `@2x`, `@3x` PNGs and a valid `Contents.json`.
- [ ] Read the generated `@2x` PNG visually before committing (no unseen icons).
- [ ] Color / weight / dimensions match the catalog's existing icons.
