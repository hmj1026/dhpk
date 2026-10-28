#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { createCiPlan, validateCiPlan, verifyCiResults, loadClassification } = require('../lib/ci-plan');

function value(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0) { if (required) throw new Error(`${name} is required`); return null; }
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function hasValidateOnlyOptions(args) {
  return args.some((arg) => ['--surface', '--surfaces', '--require-clean'].includes(arg)
    || arg.startsWith('--surface=') || arg.startsWith('--surfaces=') || arg.startsWith('--require-clean='));
}

function parseValidateOnlyOptions(args) {
  const surfaces = [];
  let surfacesProvided = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const equalsOption = argument.match(/^(--surfaces?)=(.*)$/);
    const option = argument === '--surface' || argument === '--surfaces'
      ? argument
      : equalsOption && equalsOption[1];
    if (!option) continue;
    surfacesProvided = true;
    const rawValue = equalsOption ? equalsOption[2] : args[index + 1];
    if (!rawValue || (!equalsOption && rawValue.startsWith('--'))) throw new Error(`${option} requires a value`);
    if (!equalsOption) index += 1;
    surfaces.push(...rawValue.split(',').map((surface) => surface.trim()));
  }
  if (args.some((arg) => arg.startsWith('--require-clean='))) {
    throw new Error('--require-clean does not accept a value');
  }
  return {
    surfaces: surfacesProvided ? surfaces : null,
    requireClean: args.includes('--require-clean'),
  };
}

function preflightErrors(plan, { surfaces, requireClean }) {
  const errors = [];
  if (surfaces !== null) {
    const { resolveSurfaceSelection } = require('./verify-platform-packages');
    const plannedSurfaces = Array.isArray(plan && plan.packageSurfaces) ? plan.packageSurfaces : null;
    const planned = plannedSurfaces === null
      ? { ok: false, error: 'plan package surfaces are missing' }
      : plannedSurfaces.length === 0
        ? { ok: true, resolved: [] }
        : resolveSurfaceSelection(plannedSurfaces);
    const selected = resolveSurfaceSelection(surfaces);
    if (!planned.ok) errors.push(`plan package surfaces are invalid: ${planned.error}`);
    if (!selected.ok) errors.push(selected.error);
    if (planned.ok && selected.ok && planned.resolved.some((surface) => !selected.resolved.includes(surface))) {
      errors.push('selected package surfaces do not match the plan');
    }
  }
  if (requireClean) {
    const { assertCleanSourceCheckout } = require('../lib/platform-provenance');
    try { assertCleanSourceCheckout(process.cwd()); }
    catch (error) { errors.push(error.message); }
  }
  return errors;
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'plan';
  if (command !== 'validate' && hasValidateOnlyOptions(argv)) {
    throw new Error('--surface, --surfaces, and --require-clean are only supported by validate');
  }
  const classification = loadClassification({ classificationFile: value(argv, '--classification-file', false) });
  if (command === 'plan') {
    const outputPath = value(argv, '--out', false);
    const githubOutputPath = value(argv, '--github-output', false);
    if (githubOutputPath && !outputPath) {
      throw new Error('--github-output requires --out so full plan data stays in a file');
    }
    const plan = createCiPlan({
      root: process.cwd(), baseSha: value(argv, '--base-sha'), headSha: value(argv, '--head-sha'),
      checkoutSha: value(argv, '--checkout-sha'), baseRef: value(argv, '--base-ref'),
      ...classification,
    });
    const serializedPlan = `${JSON.stringify(plan)}\n`;
    if (outputPath) {
      fs.writeFileSync(outputPath, serializedPlan);
      if (githubOutputPath) {
        const shards = Array.from({ length: plan.shardCount || 0 }, (_, index) => index);
        const macos = plan.requiredJobs.includes('macos-installer');
        const surfaces = plan.packageSurfaces || [];
        fs.appendFileSync(githubOutputPath, [
          `mode=${plan.mode}`,
          `shards=${JSON.stringify(shards)}`,
          `macos=${macos}`,
          `surfaces=${JSON.stringify(surfaces)}`,
          '',
        ].join('\n'));
      }
    } else {
      process.stdout.write(serializedPlan);
    }
    return 0;
  }
  if (command === 'validate') {
    const preflightOptions = parseValidateOnlyOptions(argv);
    const plan = JSON.parse(fs.readFileSync(value(argv, '--plan'), 'utf8'));
    const result = validateCiPlan(plan, {
      root: process.cwd(), baseSha: value(argv, '--base-sha'), headSha: value(argv, '--head-sha'),
      checkoutSha: value(argv, '--checkout-sha'), baseRef: value(argv, '--base-ref'),
      ...classification,
    });
    const errors = [...result.errors, ...preflightErrors(plan, preflightOptions)];
    if (errors.length > 0) errors.forEach((error) => process.stderr.write(`FAIL: ${error}\n`));
    else process.stdout.write('PASS: CI plan is valid\n');
    return errors.length === 0 ? 0 : 1;
  }
  if (command === 'aggregate') {
    const plan = JSON.parse(fs.readFileSync(value(argv, '--plan'), 'utf8'));
    const results = JSON.parse(fs.readFileSync(value(argv, '--results'), 'utf8'));
    const result = verifyCiResults(plan, results, {
      root: process.cwd(), baseSha: value(argv, '--base-sha'), headSha: value(argv, '--head-sha'),
      checkoutSha: value(argv, '--checkout-sha'), baseRef: value(argv, '--base-ref'),
      ...classification,
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
