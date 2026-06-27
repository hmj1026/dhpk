---
name: xcode-build-tooling
description: Xcode / SwiftLint / xcodebuild / Swift Package Manager tooling — SwiftLint rule-tier strategy and per-package .swiftlint.yml, xcodebuild -scheme/-destination build & test vs swift build / swift test for SPM packages, and scheme / code-signing notes for a no-iCloud capability set. Use when configuring SwiftLint, deciding how to build/test an iOS app or SPM package from the CLI, interpreting the module's post-edit SwiftLint hook or pre-commit build gate, or setting up CI build commands. Requires the swift module; wires post-edit-swiftlint.sh and pre-commit-swift-build.sh.
---

# Xcode build & lint tooling

Load references on demand:

- `references/swiftlint-config.md` — SwiftLint rule tiers, per-package config.
- `references/xcodebuild-spm.md` — `xcodebuild` vs `swift build/test`, destinations.
- `references/scheme-signing.md` — schemes, capabilities, signing for no-iCloud.

---

## What this module wires (hooks)

- **`hooks/post-edit-swiftlint.sh`** — PostToolUse (Edit/Write). On a `.swift`
  edit, runs SwiftLint on that file and surfaces warnings to stderr. Backgrounded
  by the dispatcher, always exits 0, **self-skips when `swiftlint` is absent** —
  no noise on machines without it.
- **`hooks/pre-commit-swift-build.sh`** — PreToolUse (Bash). On `git commit*` with
  staged `.swift`, runs a build (and tests unless skipped). **Exit 2 blocks the
  commit** on failure; **self-skips when `xcodebuild`/`swift` is absent**; honors a
  `[skip-swift-build]` commit-message sentinel for emergencies.

## userConfig (overridable)

| Key | Default | Used by |
|-----|---------|---------|
| `swiftlint_bin` | `swiftlint` | post-edit hook (path/wrapper to SwiftLint) |
| `xcode_scheme` | `""` (auto-detect / skip test gate) | pre-commit hook |
| `xcode_destination` | `""` (test step auto-picks first available simulator; build always uses generic) | pre-commit hook |
| `swift_build_skip_tests` | `false` | pre-commit hook (build only, no tests) |

## Core rules

1. **Lint locally is advisory, commit gate is blocking.** The post-edit hook
   informs; the pre-commit hook is the gate. Both fail-soft when tools are absent
   so the harness never breaks a machine that hasn't installed them.
2. **Build the right unit.** App target → `xcodebuild -scheme`. Pure SPM package
   → `swift build`/`swift test` (faster, no simulator). See `xcodebuild-spm.md`.
3. **Keep SwiftLint config close to the code** — a root `.swiftlint.yml` plus
   per-package overrides; treat new violations as a work list, not a flag day.

## babylon

`xcode_scheme: babylon`, simulator destination iPhone 17 (Xcode 26.5 ships only
the iPhone 17 family). Once SPM packages
(`RxScan*`) exist, package tests run via `swift test` for speed; the app builds
via `xcodebuild`.
