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

**Tautological tests**: Expected values restate the implementation, so the
test passes by construction.

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
