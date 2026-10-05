# JavaScript Review Traps

Apply a check when its trigger is present in the changed path. For Vue-specific reactivity or template behavior, use [the Vue review traps](vue.md). Generic JavaScript and TypeScript boundary, async, and request-path findings belong here.

For prompt-construction or instruction-trust questions, route to the shared [prompt-defense owner](../_common/prompt-defense.md).

## Runtime boundaries

**Trigger → evidence/action:** A changed value comes from an HTTP response, parsed JSON, storage, a message, environment, file, or plugin boundary, and the code relies on `any`, a type assertion, a non-null assertion, or an unchecked property access. Trace the value to its first trust-sensitive use; verify a runtime schema or guard before relying on its shape, and exercise invalid input. TypeScript assertions do not add runtime checks; see [TypeScript type erasure](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch.html#erased-types) and [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).

**Do not apply when:** The value is produced and constrained inside the same typed path, or a runtime validator already establishes the claimed invariant. An assertion by itself is a review clue, not a defect.

## Promise completion and errors

**Trigger → evidence/action:** A changed handler, callback, task, or public function starts asynchronous work. Follow the promise to its owner and verify it is returned or awaited, rejection reaches the documented error boundary, and partial completion or cancellation follows the caller’s contract. Test both fulfillment and rejection where both are possible. See [Using promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises).

**Do not apply when:** A caller intentionally owns the returned promise and demonstrably handles its rejection, or a rejection is deliberately converted to a documented result at the correct boundary.

## Request-path blocking

**Trigger → evidence/action:** Work runs on a server request path or interactive browser path and processes variable-sized input, performs synchronous I/O or expensive computation, or repeats work per row or render. Identify the caller and representative workload, then profile or bound the work and preserve the result contract while moving, limiting, or reducing it. Node’s [event-loop guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) explains why long callbacks delay other requests.

**Do not apply when:** The work is a short bounded operation, startup-only task, or background job with no interactive completion requirement. Do not infer a defect from a loop or synchronous call without evidence that its workload affects the relevant path.
