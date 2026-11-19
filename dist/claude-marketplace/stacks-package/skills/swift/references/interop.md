# Interop — Combine & UIKit in SwiftUI

## UIKit → SwiftUI

Wrap UIKit views/controllers that SwiftUI has no native equivalent for.

```swift
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView { … }
    func updateUIView(_ view: PreviewView, context: Context) { … }
    // Coordinator (UIKit-delegate sense) bridges delegate callbacks back.
    func makeCoordinator() -> Coordinator { Coordinator(self) }
}
```

- `UIViewRepresentable` for a view (camera preview layer); `UIViewControllerRepresentable`
  for a controller (`VNDocumentCameraViewController`, `PHPickerViewController`).
- `UIHostingController` to embed SwiftUI inside a UIKit flow.
- The representable's nested `Coordinator` (note: different concept from the app
  navigation Coordinator) holds delegate callbacks; forward them to the view model
  via a closure or async stream.

## babylon: background-blur / privacy masking

To prevent PHI showing in the app switcher snapshot, mask the UI when the scene
resigns active. Observe scene phase and overlay a blur, or use a UIKit
`UIVisualEffectView` via a representable. Combine with the lock gate so a
returning app requires re-auth.

```swift
@Environment(\.scenePhase) private var scenePhase
// .overlay { if scenePhase != .active { PrivacyMask() } }
```

## Combine → SwiftUI / async

- Bridge a `Publisher` into `@Observable` state by subscribing in the view model
  (store the `AnyCancellable`; capture `[weak self]`).
- Prefer converting one-shot callbacks to `async` via
  `withCheckedThrowingContinuation` rather than threading a `PassthroughSubject`
  through the UI.
- `LAContext` biometric callbacks and `UNUserNotificationCenter` auth callbacks
  are the common bridges — wrap each in an `actor`/service exposing an `async`
  method; the view model `await`s it.

## Rules

- Keep representables tiny — no business logic; they translate, nothing more.
- Don't subscribe to Combine publishers inside `body`; do it once when the view
  model is created.
- Tear down observers in the view model's lifecycle, not in the view.
