'use strict';

// The Agent, Cursor and AGY packages are built on demand and never committed,
// so tests that need one build it once per process from the real sources into a
// scratch directory and copy it into their fixture roots at the on-demand path.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { materializeAgentPluginPackage } = require('../../scripts/lib/agent-plugin-package');
const { materializeCursorPackage } = require('../../scripts/lib/cursor-plugin-package');
const { materializeAgyPluginPackage } = require('../../scripts/lib/agy-plugin-package');
const { onDemandPackageName, onDemandRelativeDir } = require('../../scripts/lib/on-demand-packages');

const ROOT = path.join(__dirname, '..', '..');
const built = new Map();
let scratch = null;

function readJson(...segments) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...segments), 'utf8'));
}

// The generators resolve the source commit in the checkout, so use its HEAD.
function sourceCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function scratchRoot() {
  if (scratch) return scratch;
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-fixture-')));
  process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
  return scratch;
}

function buildInto(surface, outDir) {
  const inventory = readJson('manifests', 'distribution-inventory.json');
  const version = readJson('.claude-plugin', 'plugin.json').version;
  const common = { inventory, root: ROOT, outDir, version, sourceCommit: sourceCommit() };
  if (surface === 'agent-plugin') materializeAgentPluginPackage({ ...common, name: 'dhpk' });
  else if (surface === 'cursor-plugin') materializeCursorPackage(common);
  else if (surface === 'agy-plugin') materializeAgyPluginPackage({ ...common, sourceVersion: version });
  else throw new Error(`'${surface}' is not an on-demand surface`);
  return outDir;
}

// Path of a freshly built package, cached for the life of the process.
function builtPackage(surface) {
  if (!built.has(surface)) {
    built.set(surface, buildInto(surface, path.join(scratchRoot(), onDemandPackageName(surface))));
  }
  return built.get(surface);
}

// Copies the built package to <root>/dist/on-demand/<name>.
function installBuiltPackage(root, surface) {
  const destination = path.join(root, ...onDemandRelativeDir(surface).split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(builtPackage(surface), destination, { recursive: true });
  return destination;
}

module.exports = { buildInto, builtPackage, installBuiltPackage };
