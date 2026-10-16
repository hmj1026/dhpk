---
name: swift
description: 'Swift and iOS development, SwiftUI architecture, async tests, SDK privacy, Xcode/SPM builds, and asset-catalog icons. Use for Swift/iOS tasks or test, build, icon actions. Not for web/Android assets or general raster editing. Output: target-compatible implementation or review, verification evidence, or an imageset.'
metadata:
  dhpk-capability-id: dhpk.skill.swift
  dhpk-name-style: portable-family
  dhpk-invocation-class: implicit-eligible
---

# Swift

Use `$swift <task>`; optional `test`, `build`, and `icon` actions select the
same internal task paths. Complete the requested task with the smallest local
reference set; specialist references are procedures, not independent skills.

## Resolve the target before loading

1. Establish the target package, Xcode project/scheme, or asset catalog from the
   request and project evidence. Ask and wait when a monorepo has several
   plausible targets. An intentional explicit target/version override wins;
   report the override separately from the observed configuration.
2. For version-sensitive work read the target's `SWIFT_VERSION`,
   `SWIFT_STRICT_CONCURRENCY`, deployment target, and applicable Package.swift
   tools version. The installed `swift --version` is execution-environment
   evidence, not target compatibility. Preserve the precision of the evidence.
3. Missing, conflicting, or broad incompatible constraints require a question
   and an answer before version-specific references or dependent actions. A
   migration needs an explicit destination version. For several destinations,
   group resources, changes, and verification by target.

## Select only the task's resources

| Task | Local procedure | Load additional references when needed |
| --- | --- | --- |
| Swift language/concurrency/errors | [language](references/language.md) | concurrency, value/reference, error handling; approachable-concurrency only for resolved Swift 6.2+ |
| SwiftUI state/navigation/interop | [UI](references/ui.md) | observation-state, navigation, mvvm-coordinator, interop |
| Test authoring and strategy (`test`) | [testing](references/testing.md) | swift-testing-api, xctest-bridging, xcuitest, snapshot-testing, test-taxonomy, protocol-di-host-testing |
| iOS SDK persistence/privacy/crypto/OCR | [platform](references/platform.md) | matching SDK reference only |
| Xcode/SPM/lint/CI (`build`) | [build](references/build.md) | swiftlint-config, xcodebuild-spm, scheme-signing |
| In-app symbol imageset (`icon`) | [icon](references/icon.md) | local icon scripts below |

Language rules also apply to code produced by another path; load the relevant
language reference only if its compatibility or concurrency rules are needed.
Read local references from this skill directory. Project source/configuration
and external tools are explicit task inputs; a missing bundled resource is
`BLOCKED`, not a reason to search an installed peer or repository module.

## Actions and authority

Implementation requests authorize scoped source/tests/configuration edits;
review and build/check requests stay read-only apart from explicit build outputs.
Run the project's test-first workflow for business behavior. Retain separate
local build, simulator/device, SDK/provider, and visual evidence. Missing tools
produce `NOT_RUN` or `UNAVAILABLE`, never a successful verification.

For icons, agree on the requested catalog, name, source, color, and dimensions;
search and preview before generating. Run `scripts/iconify_gen.sh` for Iconify
(network + curl + a rasterizer) or `scripts/generate_icons.swift` for SF Symbols
(macOS). Resolve paths from this skill directory and pass the explicit consumer
catalog using `--output`. Verify 1x/2x/3x PNGs and Contents.json, then inspect the
2x PNG visually. These scripts generate in-app `.imageset` glyphs; an AppIcon
request needs its own size matrix. Generation grants no commit or publication
permission. Preserve external capability failures as non-pass evidence.

## Completion

Report the resolved target/version and selected specialty; the resulting code,
review findings, build commands/configuration, three-layer test plan, or imageset
path; checks actually run and their verdicts; and unresolved compatibility,
privacy, device, or visual gaps. Each specialist procedure retains its output
and verification contract. A focused test result is separate from device or
Host acceptance.
