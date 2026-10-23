'use strict';

const fs = require('node:fs');
const path = require('node:path');
const receipts = JSON.parse(fs.readFileSync(path.join(__dirname, 'receipts.json'), 'utf8'));

for (const receipt of receipts) {
  process.stdout.write(`${receipt.id} ${receipt.status} ${receipt.amountCents}\n`);
}
