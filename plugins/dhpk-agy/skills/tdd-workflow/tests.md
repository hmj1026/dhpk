# Good and Bad Tests

## Good Tests

**Integration-style**: Test through real interfaces, not mocks of internal
parts.

```typescript
// GOOD: Tests observable behavior
test("user can checkout with valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

Characteristics:

- Tests behavior users/callers care about
- Uses public API only
- Survives internal refactors
- Describes WHAT, not HOW
- Has one logical assertion or one cohesive observable outcome

## Bad Tests

**Implementation-detail tests**: Coupled to internal structure.

```typescript
// BAD: Implementation details are not the public contract
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});
```

Red flags:

- Mocking internal collaborators
- Testing private methods
- Asserting call counts or call order when not user-visible behavior
- A refactor breaks the test without changing behavior
- The test name describes HOW rather than WHAT
- Verification bypasses the interface and inspects storage directly

```typescript
// BAD: Bypasses the interface to verify persistence
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});

// GOOD: Verifies the caller-visible contract
test("createUser makes the user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

**Tautological tests considered harmful**: Expected values restate the
implementation, so the test passes by construction. The same smell appears
when both sides use the same helper, or when a mock is configured to return the
value that the test immediately asserts without checking caller-visible
behavior.

```typescript
// BAD: Recomputes the production algorithm for the expectation
test("calculateTotal sums line items", () => {
  const items = [{ price: 10 }, { price: 5 }];
  const expected = items.reduce((sum, item) => sum + item.price, 0);
  expect(calculateTotal(items)).toBe(expected);
});

// GOOD: Uses an independently checked literal
test("calculateTotal sums line items", () => {
  expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15);
});
```

## Independent Oracles

An oracle is the source of a test's expected value. Acceptance compares
mutually independent observables or sources, or derives an invariant through a
different relation. Reject an assertion that restates a fixture field, even
when it passes. Derive a summary or selection list from the source data, then
compare it with another contract.

```typescript
// BAD: The fixture never passes through the code under test
test("invoice keeps its number", () => {
  const fixture = { number: "INV-7" };
  expect(fixture.number).toBe("INV-7");
});

// GOOD: The expected set comes from source data; the actual set comes from a
// report that a separate code path generated
test("report lists every overdue invoice", () => {
  const overdue = invoices.filter((invoice) => invoice.overdue).map((invoice) => invoice.id);
  expect(readReport().invoiceIds).toEqual(overdue);
});
```

A relation is an independent oracle only when it does not reuse the
production selector or algorithm; the `calculateTotal` example above fails
this test.

Write every fixture identifier, hash, commit, version, path, and count as an
independent literal. Deriving an expected value from the constants of the
module under test repeats its defect.

## Discriminating Tests

A test is evidence only when a plausible wrong implementation makes it fail.

- Prove discrimination once with a controlled mutation: break the behavior,
  observe the expected RED, restore the source, and observe GREEN.
- Cover each decision family in the changed behavior: selection, ordering,
  error precedence, and facade wiring each need an assertion that a wrong
  choice, order, precedence, or delegate would fail.
- Assert the fail-closed negative path for a wrong identifier, input, or
  output. The expected result is an explicit failure or rejection; a skip,
  default value, or swallowed error is a defect.

## One Contract, One Owner

- Name the caller-visible contract in the test name.
- Before adding a test, find the existing owner of the contract. Extend it, or
  assert only the part that it leaves unprotected.
- Assert behavior rather than the existence or type of an export or file.

## Setup Cost

Run expensive setup once per suite and share it between assertions when the
shared state is read-only or reset before each test.

## Rejection Checklist

Reject or rewrite a test when any of these holds:

- The expected value comes from the implementation's helper, algorithm, or
  constants.
- The assertion restates a fixture literal that never passed through the code
  under test.
- The asserted value is the value a mock was configured to return.
- It checks only existence or type, not behavior.
- It asserts private structure or incidental call counts.
- The fail-closed negative path is missing.
- A plausible wrong implementation still passes.
- Another test already fully asserts the same contract.
