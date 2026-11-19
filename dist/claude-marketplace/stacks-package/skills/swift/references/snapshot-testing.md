# Snapshot testing (swift-snapshot-testing)

Snapshot tests guard SwiftUI view rendering against unintended visual change.
Useful for the design-system components and accessibility (large Dynamic Type)
states babylon needs for elderly users.

## Usage

```swift
import SnapshotTesting
import SwiftUI

@Test func consentScreen_largeText() {
    let view = ConsentView(model: .preview)
        .environment(\.sizeCategory, .accessibilityExtraLarge)
    assertSnapshot(of: UIHostingController(rootView: view),
                   as: .image(on: .iPhone15))
}
```

## Record / verify discipline

- First run in **record mode** writes the reference image; subsequent runs
  **compare**. **Never commit with record mode left on** — a recording run always
  passes and silently overwrites the baseline, defeating the test.
- Re-record intentionally when a design change is approved; review the image diff
  in the PR like any other change.
- Pin the **device/trait config** (`.iPhone15`, locale, `sizeCategory`) — an
  unpinned snapshot is non-deterministic across machines/simulators.

## What to snapshot

- Stable design-system components and key screens in representative states
  (default, large Dynamic Type, dark mode, empty/error).
- **Not** rapidly-changing screens or anything with live time/random content
  (freeze those inputs first).
- **Never** snapshot a screen showing real PHI — use preview/fixture data only.

## Rules

- Keep reference images in the test target; they're part of the test, reviewed in
  diffs.
- Combine with accessibility checks (VoiceOver labels, Dynamic Type) — snapshots
  catch layout regressions but not semantics.
- If snapshots are too noisy across Xcode/simulator versions, scope them to a
  pinned simulator in CI rather than abandoning them.
