'use strict';

// Parity harness for js-projection-journal stage 3 (task 3.1): runs the
// Python installer and the JS Codex adapter on identical fixtures and reports
// every difference in exit status, output, project tree, and receipt.
//
// Each engine runs on its own fresh fixture, so run-specific values are
// normalized before comparison: the project and plugin paths, backup-run
// stamps, process ids, random names, and receipt transaction ids.

const fs = require('node:fs');
const path = require('node:path');
const { runInstaller } = require('./install-codex-skills-fixtures');

const ENGINES = Object.freeze(['python', 'js']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replaces run-specific tokens in any text: paths first (longest first), then
// stamps and random identifiers.
function normalizer(roots) {
  const replacements = roots
    .filter(Boolean)
    .flatMap(([value, token]) => [[value, token], [fs.realpathSync(value), token]])
    .sort((left, right) => right[0].length - left[0].length);
  return (text) => {
    let out = String(text);
    for (const [value, token] of replacements) out = out.replace(new RegExp(escapeRegExp(value), 'g'), token);
    return out
      .replace(/\d{8}T\d{6}Z-\d+/g, '<RUN>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, '<TIME>')
      .replace(/\.dhpk-(adopt|remove|quarantine|stage|publish)-[0-9a-f]{32}/g, '.dhpk-$1-<ID>')
      .replace(/\.(transaction|snapshot|recovery)\.json\.[0-9a-f]{32}|\.json\.(snapshot|recovery)\.[0-9a-f]{32}/g, '.<TMP>')
      .replace(/"pid": \d+/g, '"pid": <PID>')
      .replace(/\b(pid|process)[ =:]+\d+/gi, '$1 <PID>');
  };
}

// Transaction bookkeeping differs by design (ADR-0036): the Python keeps a
// Host journal and a flock file per Host, the JS one Projection Journal and
// one project lock. Parity compares the state users see, not the bookkeeping.
const BOOKKEEPING = [
  /^\.\/\.(codex|cursor)\/\.dhpk-transaction-<RUN>\.json$/,
  /^\.\/\.(codex|cursor)\/\.dhpk-install\.lock$/,
  /^\.\/\.agents\/\.dhpk-projection-journal\.json$/,
  /^\.\/\.agents\/\.dhpk-install\.lock$/,
];

function walk(root, normalize) {
  const lines = [];
  if (!fs.existsSync(root)) return lines;
  const visit = (current, relative) => {
    const stat = fs.lstatSync(current);
    const name = normalize(relative);
    if (BOOKKEEPING.some((pattern) => pattern.test(name))) return;
    if (stat.isSymbolicLink()) lines.push(`link:${name}:${normalize(fs.readlinkSync(current))}`);
    else if (stat.isDirectory()) {
      lines.push(`dir:${name}`);
      for (const child of fs.readdirSync(current).sort()) visit(path.join(current, child), `${relative}/${child}`);
    } else {
      // Journals and receipts are compared as normalized text; other files by bytes.
      const content = /\.json$/.test(current) ? normalize(fs.readFileSync(current, 'utf8')) : fs.readFileSync(current).toString('base64');
      lines.push(`file:${name}:${(stat.mode & 0o777).toString(8)}:${content}`);
    }
  };
  visit(root, '.');
  return lines;
}

// `prepare(engine)` builds a fresh fixture; setup steps it runs use the same
// engine as the step under comparison.
function runEngine(engine, prepare, args, envOverrides = {}) {
  const fixture = prepare(engine);
  const normalize = normalizer([
    [fixture.project, '<PROJECT>'],
    [fixture.pluginRoot, '<PLUGIN>'],
  ]);
  const result = runInstaller(fixture.project, args, fixture.pluginRoot, {
    ...(fixture.env || {}),
    ...envOverrides,
    DHPK_INSTALLER_ENGINE: engine,
  });
  const observed = {
    status: result.status,
    signal: result.signal,
    stdout: normalize(result.stdout),
    stderr: normalize(result.stderr),
    tree: walk(fixture.project, normalize),
  };
  if (fixture.cleanup) fixture.cleanup();
  return observed;
}

// First difference between two observations, as a readable report; null when equal.
function difference(left, right, labels = ENGINES) {
  for (const key of ['status', 'signal', 'stdout', 'stderr']) {
    if (left[key] !== right[key]) {
      return `${key} differs\n--- ${labels[0]}\n${left[key]}\n--- ${labels[1]}\n${right[key]}`;
    }
  }
  const length = Math.max(left.tree.length, right.tree.length);
  for (let index = 0; index < length; index += 1) {
    if (left.tree[index] !== right.tree[index]) {
      const clip = (value) => (value === undefined ? '<missing>' : value.slice(0, 2000));
      return `tree differs at entry ${index}\n--- ${labels[0]}\n${clip(left.tree[index])}\n--- ${labels[1]}\n${clip(right.tree[index])}`;
    }
  }
  return null;
}

// Runs one scenario under both engines (or the same engine twice, which
// checks that normalization removes every run-specific value).
function compareEngines(prepare, args, { engines = ENGINES, env = {} } = {}) {
  const [left, right] = engines.map((engine) => runEngine(engine, prepare, args, env));
  return { left, right, difference: difference(left, right, engines) };
}

module.exports = { ENGINES, compareEngines, runEngine, normalizer, difference };
