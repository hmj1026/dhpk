#!/usr/bin/env node
'use strict';

// Bounded, launch-scoped Cursor CLI probe. This wrapper is the documented
// operator route; it never installs or edits a Cursor package.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertPhysicalPackageRoot, runCursorConsumerProbe } = require('../lib/cursor-plugin-package');
const { redactSensitiveText } = require('../lib/redaction');

const DEFAULT_PROMPT = 'Read only. Return exactly: dhpk skills commands agents rules loaded. CURSOR_SMOKE_OK. Do not call tools or edit files.';

function usage() {
  return 'usage: cursor-agent-probe.js --agent-package <dir> --cursor-package <dir> [--timeout-ms <n>] [--max-output-bytes <n>] [--prompt <text>]';
}

function parseArgs(argv) {
  const result = { prompt: DEFAULT_PROMPT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) throw new Error(`missing value for ${arg}`);
      index += 1;
      return argv[index];
    };
    if (arg === '--agent-package') result.agentPackage = next();
    else if (arg === '--cursor-package') result.cursorPackage = next();
    else if (arg === '--timeout-ms') result.timeoutMs = next();
    else if (arg === '--max-output-bytes') result.maxOutputBytes = next();
    else if (arg === '--prompt') result.prompt = next();
    else if (arg === '--help') { console.log(usage()); process.exit(0); }
    else throw new Error(`unknown argument '${arg}'`);
  }
  if (!result.agentPackage || !result.cursorPackage) throw new Error(usage());
  return result;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`cursor-agent-probe: ${redactSensitiveText(String(error && error.message ? error.message : error), { maxLength: 800 })}`);
    process.exit(2);
  }
  const agentPackage = path.resolve(args.agentPackage);
  const cursorPackage = path.resolve(args.cursorPackage);
  // os.tmpdir() can return a path through an OS-level alias (e.g. macOS's
  // /var -> /private/var symlink). Resolve it once so both the staging root
  // created below and every containment comparison land on the canonical
  // spelling — otherwise a legitimate package under the same physical
  // directory is misclassified as outside tempRoot, or the staged copy is
  // misclassified as having a symlinked ancestor (issue #436).
  const tempRoot = fs.realpathSync(path.resolve(os.tmpdir()));
  const privateTempPath = (value) => {
    let resolved;
    try {
      resolved = fs.realpathSync(path.resolve(value));
    } catch (_) {
      return false;
    }
    return resolved === tempRoot || resolved.startsWith(`${tempRoot}${path.sep}`);
  };
  let stagingRoot = null;
  let probeAgentPackage = agentPackage;
  let probeCursorPackage = cursorPackage;
  let result;
  try {
    // CLI package arguments may be documented symlink aliases (for example
    // ~/.cursor/plugins/local/dhpk-agent). Validate the canonical targets so
    // the package-root safety checks cover the physical package rather than
    // rejecting the operator's symlink entrypoint (issues #479/#481).
    const physicalAgentPackage = fs.realpathSync(agentPackage);
    const physicalCursorPackage = fs.realpathSync(cursorPackage);
    assertPhysicalPackageRoot(physicalAgentPackage, 'Agent package');
    assertPhysicalPackageRoot(physicalCursorPackage, 'Cursor package');
    probeAgentPackage = physicalAgentPackage;
    probeCursorPackage = physicalCursorPackage;
    if (!privateTempPath(physicalAgentPackage) || !privateTempPath(physicalCursorPackage)) {
      stagingRoot = fs.mkdtempSync(path.join(tempRoot, 'dhpk-cursor-cli-stage-'));
      probeAgentPackage = path.join(stagingRoot, 'agent-package');
      probeCursorPackage = path.join(stagingRoot, 'cursor-package');
      fs.cpSync(physicalAgentPackage, probeAgentPackage, { recursive: true, dereference: false });
      fs.cpSync(physicalCursorPackage, probeCursorPackage, { recursive: true, dereference: false });
      assertPhysicalPackageRoot(probeAgentPackage, 'staged Agent package');
      assertPhysicalPackageRoot(probeCursorPackage, 'staged Cursor package');
    }
    result = runCursorConsumerProbe({
      packageRoot: probeAgentPackage,
      timeoutMs: args.timeoutMs === undefined ? undefined : Number(args.timeoutMs),
      maxOutputBytes: args.maxOutputBytes === undefined ? undefined : Number(args.maxOutputBytes),
      requireOutput: true,
      requireJson: true,
      requireDiscovery: true,
      networkMode: 'shared',
      args: [
        '--plugin-dir', probeAgentPackage,
        '--plugin-dir', probeCursorPackage,
        '--mode', 'ask',
        '--trust',
        '-p', args.prompt,
        '--output-format', 'stream-json',
        '--stream-partial-output',
      ],
    });
    result = { ...result, packageRoot: agentPackage };
  } catch (error) {
    result = {
      status: 'BLOCKED',
      reason_code: 'PACKAGE_INVALID',
      reasonCode: 'PACKAGE_INVALID',
      reason: redactSensitiveText(String(error && error.message ? error.message : 'unknown probe setup error'), { maxLength: 800 }),
      packageRoot: agentPackage,
      timed_out: false,
    };
  } finally {
    if (stagingRoot) fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  console.log(JSON.stringify({
    ...result,
    surface: 'cursor-cli',
    action: 'launch-scoped-probe',
    agent_package: agentPackage,
    cursor_package: cursorPackage,
  }, null, 2));
  if (['FAIL', 'BLOCKED', 'SKIP_INCOMPATIBLE'].includes(result.status)) process.exit(1);
}

main();
