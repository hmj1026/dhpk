# Vision OCR — text recognition

## API selection by floor

| iOS | API | Notes |
|-----|-----|-------|
| 18+ | `RecognizeTextRequest` (new Swift Vision API, `async`) | preferred when available |
| 17 (floor) | `VNRecognizeTextRequest` + `VNImageRequestHandler` | fallback |

Gate with `if #available(iOS 18, *)` and keep both paths behind one protocol so
the rest of the app is version-agnostic.

## Hard limitations (design-critical)

- **Handwriting:** Vision is built for **printed / clear text**. Handwritten
  text recognition is effectively limited to a Latin/English subset and is
  unreliable for **handwritten Chinese**. babylon must therefore treat OCR as
  best-effort and **always provide a manual-correction exit** (`rawDrugName` free
  entry). This is Strategy 3 in the spec and is architecturally mandatory, not a
  nice-to-have.
- Accuracy depends on capture quality — drive a **pre-capture QA** step
  (focus, glare, distance) before running recognition.

## Configuration

```swift
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate            // not .fast for prescriptions
request.recognitionLanguages = ["zh-Hant", "en"]
request.usesLanguageCorrection = true
request.revision = VNRecognizeTextRequestRevision3
```

- Set `recognitionLanguages` explicitly (`zh-Hant`, `en`); don't rely on default.
- `.accurate` over `.fast` for medical text; measure against the NFR budget
  (Strategy 1 < ~2s).
- Run recognition off the main actor; deliver results back on `@MainActor`.

## Pipeline shape (babylon)

1. Capture (AVFoundation) → pre-capture QA gate.
2. OCR (Vision) → candidate text + confidence.
3. **Fast path:** rule-based NER maps candidates → drug records (FTS5 match in
   the drug DB). High-confidence auto-fill.
4. **Guided manual fallback:** low confidence or handwriting → user confirms /
   types `rawDrugName`. Never dead-end.
5. Persist as a `ScanAttempt` (track success/fallback for later tuning).

Core ML / BERT NER (Strategy 2) is **Post-MVP** — highest data/time risk; do not
block MVP on a self-trained model.

## Privacy

- The captured image is PHI — encrypt it (see `cryptokit-keychain.md`) before
  persisting; never send it off-device for recognition (Vision is on-device).
