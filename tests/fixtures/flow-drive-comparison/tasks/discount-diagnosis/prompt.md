Diagnose and repair the discount bug in `src/discount.js`. Passing an explicit
`discountCents: 0` currently applies the default discount. An explicit zero
must leave the original price unchanged; omitting `discountCents` must continue
to apply the existing 100-cent default. Preserve the existing CommonJS function
interface and change only `src/discount.js`.

The observable examples are `priceAfterDiscount(1000, 0) === 1000` and
`priceAfterDiscount(1000) === 900`. Run the Node.js verifier provided outside
this project when your repair is ready.
