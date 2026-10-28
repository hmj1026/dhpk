Repair the receipt total in `src/receipt.js`. A line total must multiply its
quantity by its unit price in integer cents, then sum every line. Preserve the
existing CommonJS function interface and change only `src/receipt.js`.

The worked receipt has 2 items at 500 cents and 1 item at 200 cents, so the
total is 1200 cents. An empty receipt totals 0 cents. Run the Node.js verifier
provided outside this project when your repair is ready.
