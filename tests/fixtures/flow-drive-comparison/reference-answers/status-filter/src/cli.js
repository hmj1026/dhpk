'use strict';

const fs = require('node:fs');
const path = require('node:path');
const receipts = JSON.parse(fs.readFileSync(path.join(__dirname, 'receipts.json'), 'utf8'));
const args = process.argv.slice(2);
let status;

if (args.length > 0) {
  if (args.length !== 2 || args[0] !== '--status' || !['paid', 'open'].includes(args[1])) {
    process.stderr.write('Usage: node src/cli.js [--status paid|open]\n');
    process.exitCode = 2;
    return;
  }
  status = args[1];
}

for (const receipt of receipts) {
  if (!status || receipt.status === status) {
    process.stdout.write(`${receipt.id} ${receipt.status} ${receipt.amountCents}\n`);
  }
}
