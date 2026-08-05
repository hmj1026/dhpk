# When to Mock

Mock at system boundaries only:

- External APIs such as payment, email, or third-party services
- Databases when a real test database is impractical
- Time and randomness
- File systems when a real isolated filesystem is impractical

Do not mock application classes, internal collaborators, or anything the test
can use safely in-process. Test through the public seam.

## Designing for Mockability

Use dependency injection so external dependencies can be replaced without
reaching into production internals:

```typescript
// Easy to test: the boundary is explicit
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to test: the boundary is constructed inside the behavior
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

Prefer specific SDK-like interfaces over generic fetchers:

```typescript
// Each operation has one explicit shape
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch("/orders", { method: "POST", body: data }),
};
```

Specific boundaries keep test setup honest: each mock returns one known shape,
conditional mock logic is avoided, and the test makes its external dependency
visible.
