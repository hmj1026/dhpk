#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { createCiPlan, validateCiPlan, verifyCiResults } = require('../lib/ci-plan');

function value(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0) { if (required) throw new Error(`${name} is required`); return null; }
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'plan';
  if (command === 'plan') {
    const plan = createCiPlan({
      root: process.cwd(), baseSha: value(argv, '--base-sha'), headSha: value(argv, '--head-sha'),
      checkoutSha: value(argv, '--checkout-sha'), baseRef: value(argv, '--base-ref'),
    });
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return 0;
  }
  if (command === 'validate') {
    const plan = JSON.parse(fs.readFileSync(value(argv, '--plan'), 'utf8'));
    const result = validateCiPlan(plan, {
      root: process.cwd(), baseSha: value(argv, '--base-sha'), headSha: value(argv, '--head-sha'),
      checkoutSha: value(argv, '--checkout-sha'), baseRef: value(argv, '--base-ref'),
    });
    if (!result.ok) result.errors.forEach((error) => process.stderr.write(`FAIL: ${error}\n`));
    else process.stdout.write('PASS: CI plan is valid\n');
    return result.ok ? 0 : 1;
  }
  if (command === 'aggregate') {
    const plan = JSON.parse(fs.readFileSync(value(argv, '--plan'), 'utf8'));
    const results = JSON.parse(fs.readFileSync(value(argv, '--results'), 'utf8'));
    const result = verifyCiResults(plan, results, {
      root: process.cwd(), baseSha: value(argv, '--base-sha'), headSha: value(argv, '--head-sha'),
      checkoutSha: value(argv, '--checkout-sha'), baseRef: value(argv, '--base-ref'),
    });
    if (!result.ok) result.errors.forEach((error) => process.stderr.write(`FAIL: ${error}\n`));
    else process.stdout.write('PASS: CI plan aggregate is valid\n');
    return result.ok ? 0 : 1;
  }
  throw new Error(`unknown command: ${command}`);
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(`ci-plan: ${error.message}\n`); process.exitCode = 2; }
}

module.exports = { main };
