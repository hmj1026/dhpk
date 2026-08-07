# e2e-runner — Playwright traps

Apply on every dispatch — Playwright is this agent's sole testing stack, so this sheet is not gated behind stack detection.

| Trap | Symptom | Fix |
|---|---|---|
| `boundingBox()` has no `.top` | `boundingBox()` returns `{x, y, width, height}` — there is no `.top` property (unlike the DOM's native `getBoundingClientRect()`, which does have one). `boundingBox()?.top` is always `undefined`, and a `?? 0` fallback silently masks this — you read `0` and never notice. | Use `.y` for the top offset. |
| Double-counted iframe offset | For an element inside an `iframe`, Playwright's `boundingBox()` coordinates are already relative to the main viewport — the frame offset is already included. Adding the frame offset again double-counts it. | Use the coordinates as returned; do not add the frame's own offset a second time. |
| Auto-scroll pollutes "before click" measurements | Playwright's click-actionability checks include an auto-scroll that can move the page before the click executes. A "before click" `scrollY` measurement taken without accounting for this auto-scroll is polluted — the page already scrolled. | Capture `scrollY` after any auto-scroll settles (e.g. after the locator resolves as actionable), or scroll explicitly and measure from that known state. |
| Native dialog blocks until handled | A native `window.confirm()` / `alert()` / `prompt()` (common on destructive actions — delete / clear / discard / void) blocks Playwright: the click that raises it never resolves, and the journey stalls **silently with no error and no assertion failure**. If a step that should complete just hangs, an unhandled native dialog is the first suspect. | Register a dialog handler **before** clicking the control that raises it: `page.once('dialog', d => d.accept())` (or `d.dismiss()` per intent), or the `playwright-cli` skill's `dialog-accept` / `dialog-dismiss`. Register per-click (`once`) so a later unrelated dialog is not auto-accepted. |

## Worked examples

```typescript
// BAD — .top does not exist on boundingBox(); reads undefined, masked by ?? 0
const box = await locator.boundingBox();
const top = box?.top ?? 0;   // always 0 — never the real value

// GOOD — use .y for the top offset
const box = await locator.boundingBox();
const top = box?.y ?? 0;
```

```typescript
// BAD — element is inside an iframe; box.y already includes the frame offset
const frame = page.frameLocator('iframe#widget');
const box = await frame.locator('.target').boundingBox();
const frameEl = await page.locator('iframe#widget').boundingBox();
const absoluteY = box.y + (frameEl?.y ?? 0);   // double-counts the frame offset

// GOOD — boundingBox() coordinates are already relative to the main viewport
const box = await frame.locator('.target').boundingBox();
const absoluteY = box.y;
```

```typescript
// BAD — measures scrollY right before click(), but click-actionability auto-scroll
// may have already moved the page during the preceding actionability checks
const before = await page.evaluate(() => window.scrollY);
await locator.click();

// GOOD — rule out auto-scroll's effect before treating the measurement as meaningful;
// wait for actionability to settle, or measure explicitly after a controlled scroll
await locator.scrollIntoViewIfNeeded();
const before = await page.evaluate(() => window.scrollY);
await locator.click();
```

```typescript
// BAD — clicking a control that raises a native confirm() with no handler registered;
// the click never resolves and the test hangs silently until timeout
await page.getByRole('button', { name: 'Clear settlement' }).click();  // stalls on confirm()

// GOOD — register a per-click dialog handler BEFORE the click that raises it
page.once('dialog', d => d.accept());   // or d.dismiss() to cancel
await page.getByRole('button', { name: 'Clear settlement' }).click();
```

## Diagnostic ordering

When a measurement looks anomalous — an unexpected scroll position, timing, or coordinate value — first rule out the test harness's own effects (Playwright auto-scroll, auto-wait, retry) before hypothesizing that the anomaly reflects browser-internal or application behavior. The harness's own actionability machinery is a more likely and cheaper explanation than a genuine app bug, and ruling it out first avoids chasing a phantom root cause.
