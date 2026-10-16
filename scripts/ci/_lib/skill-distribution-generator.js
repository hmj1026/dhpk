'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { serialize, compileSkillMap, skillMapDrift } = require('../../lib/skill-distribution-compile');
const { writeInventoryAtomically } = require('../../lib/distribution-inventory');

function runGenerator(kind, options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const root = options.root || path.resolve(__dirname, '../../..');
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const write = argv.includes('--write');
  if (write === argv.includes('--check') || argv.some(arg => !['--write', '--check'].includes(arg))) {
    stderr.write(`Usage: gen-${kind}.js --write|--check\n`);
    return { status: 2 };
  }
  const key = kind === 'skill-directory-coverage' ? 'coverage' : 'resource_copies';
  const file = path.join(root, 'manifests', `${kind}.json`);
  try {
    const actual = fs.readFileSync(file, 'utf8');
    const existing = JSON.parse(actual);
    const generated = compileSkillMap(root, existing, key);
    const drift = skillMapDrift(existing, generated, key);
    const expected = serialize(generated);
    if (!write && (drift.length || expected !== actual)) {
      for (const item of drift) stderr.write(`FAIL [${kind}]: ${item}\n`);
      if (!drift.length) stderr.write(`FAIL [${kind}]: ${path.relative(root, file)} byte drift\n`);
      return { status: 1 };
    }
    if (write) writeInventoryAtomically(file, expected);
    stdout.write(`PASS [${kind}]: ${write ? 'wrote' : 'checked'} ${Object.keys(generated.skills).length} Skill rows\n`);
    return { status: 0 };
  } catch (error) { stderr.write(`FAIL [${kind}]: ${error.message}\n`); return { status: 1 }; }
}
module.exports = { runGenerator };
