'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CHECKS = Object.freeze({
  'receipt-quantity': Object.freeze({
    entry: 'src/receipt.js',
    script: [
      'const calculateTotalCents = require(process.argv[1]);',
      'const inputs = JSON.parse(process.argv[2]);',
      'process.stdout.write(JSON.stringify(inputs.map((lines) => calculateTotalCents(lines))));',
    ].join('\n'),
    inputs: [
      [{ quantity: 2, unitPriceCents: 500 }, { quantity: 1, unitPriceCents: 200 }],
      [],
    ],
    expected: [1200, 0],
    checkIds: ['quantity-is-multiplied', 'empty-receipt-is-zero'],
  }),
  'discount-diagnosis': Object.freeze({
    kind: 'module',
    entry: 'src/discount.js',
    script: [
      'const priceAfterDiscount = require(process.argv[1]);',
      'const inputs = JSON.parse(process.argv[2]);',
      'process.stdout.write(JSON.stringify(inputs.map((input) => priceAfterDiscount(input.priceCents, input.discountCents))));',
    ].join('\n'),
    inputs: [{ priceCents: 1000, discountCents: 0 }, { priceCents: 1000 }],
    expected: [1000, 900],
    checkIds: ['explicit-zero-preserves-price', 'omitted-discount-uses-default'],
  }),
  'status-filter': Object.freeze({
    kind: 'command',
    entry: 'src/cli.js',
    cases: [
      { id: 'paid-status-filter', args: ['--status', 'paid'], status: 0, stdout: 'R-101 paid 1200\nR-103 paid 250\n' },
      { id: 'open-status-filter', args: ['--status', 'open'], status: 0, stdout: 'R-102 open 800\nR-104 open 600\n' },
      { id: 'no-filter-keeps-existing-output', args: [], status: 0,
        stdout: 'R-101 paid 1200\nR-102 open 800\nR-103 paid 250\nR-104 open 600\n' },
      { id: 'invalid-status-is-an-error', args: ['--status', 'pending'], status: 'nonzero',
        stdout: '', stderrIncludes: ['paid', 'open'] },
    ],
  }),
});

function projectEntry(projectDir, relative) {
  const root = path.resolve(projectDir);
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || fs.realpathSync(root) !== root) {
    throw new Error('candidate project must be a physical directory');
  }
  const entry = path.join(root, relative);
  const stat = fs.lstatSync(entry);
  if (stat.isSymbolicLink() || !stat.isFile() || fs.realpathSync(entry) !== entry) {
    throw new Error(`candidate entry must be a physical file: ${relative}`);
  }
  return entry;
}

function evaluate(task, projectDir) {
  const contract = CHECKS[task];
  if (!contract) throw new Error(`unknown comparison task: ${task}`);
  if (contract.kind === 'command') {
    const entry = projectEntry(projectDir, contract.entry);
    const cases = contract.cases.map((scenario) => {
      const child = spawnSync(process.execPath, [entry, ...scenario.args], {
        cwd: path.resolve(projectDir),
        encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH || '' },
      });
      return {
        id: scenario.id,
        status: child.status,
        stdout: child.stdout || '',
        stderr: child.stderr || '',
        error: child.error ? child.error.message : null,
      };
    });
    return { cases, error: null };
  }
  let child;
  try {
    child = spawnSync(process.execPath, [
      '-e', contract.script, projectEntry(projectDir, contract.entry), JSON.stringify(contract.inputs),
    ], { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH || '' } });
  } catch (error) {
    return { outputs: null, error: error.message };
  }
  if (child.error || child.status !== 0) {
    return {
      outputs: null,
      error: child.error ? child.error.message : (child.stderr.trim() || `candidate exited ${child.status}`),
    };
  }
  try {
    const outputs = JSON.parse(child.stdout);
    if (!Array.isArray(outputs) || outputs.length !== contract.expected.length) {
      return { outputs: null, error: 'candidate returned an unexpected output shape' };
    }
    return { outputs, error: null };
  } catch {
    return { outputs: null, error: 'candidate did not return valid JSON' };
  }
}

function verify(task, projectDir) {
  const contract = CHECKS[task];
  if (!contract) throw new Error(`unknown comparison task: ${task}`);
  const result = evaluate(task, projectDir);
  if (contract.kind === 'command') {
    const checks = contract.cases.map((scenario, index) => {
      const actual = result.cases[index];
      const exitMatches = scenario.status === 'nonzero'
        ? Number.isInteger(actual.status) && actual.status !== 0
        : actual.status === scenario.status;
      const stdoutMatches = actual.stdout === scenario.stdout;
      const stderrMatches = !scenario.stderrIncludes
        || scenario.stderrIncludes.every((fragment) => actual.stderr.includes(fragment));
      const passed = !actual.error && exitMatches && stdoutMatches && stderrMatches;
      return {
        id: scenario.id,
        expected: { status: scenario.status, stdout: scenario.stdout,
          ...(scenario.stderrIncludes ? { stderrIncludes: scenario.stderrIncludes } : {}) },
        actual: { status: actual.status, stdout: actual.stdout, stderr: actual.stderr, error: actual.error },
        status: passed ? 'PASS' : 'FAIL',
      };
    });
    return { task, status: checks.some((check) => check.status === 'FAIL') ? 'FAIL' : 'PASS', checks };
  }
  const checks = contract.checkIds.map((id, index) => ({
    id,
    expected: contract.expected[index],
    actual: result.outputs ? result.outputs[index] : null,
    status: result.outputs && result.outputs[index] === contract.expected[index] ? 'PASS' : 'FAIL',
  }));
  return {
    task,
    status: result.error || checks.some((check) => check.status === 'FAIL') ? 'FAIL' : 'PASS',
    checks,
    ...(result.error ? { error: result.error } : {}),
  };
}

if (require.main === module) {
  const [task, projectDir] = process.argv.slice(2);
  if (!task || !projectDir) {
    process.stderr.write('Usage: node oracle.js <task-id> <candidate-project-dir>\n');
    process.exitCode = 64;
  } else {
    try {
      const report = verify(task, projectDir);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === 'PASS' ? 0 : 1;
    } catch (error) {
      process.stderr.write(`comparison oracle: ${error.message}\n`);
      process.exitCode = 64;
    }
  }
}

module.exports = { verify };
