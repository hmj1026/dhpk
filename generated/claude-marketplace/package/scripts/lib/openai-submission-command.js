'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { assertCleanSourceCheckout } = require('./platform-provenance');
const { compileMarketplacePublicationView } = require('./marketplace-selection');

const RECEIPT_SCHEMA = 'dhpk.openai-submission-artifact.v1';
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function physicalPath(target) {
  const absolute = path.resolve(target);
  let cursor = path.parse(absolute).root;
  for (const segment of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`symlink path is forbidden: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return absolute;
}

function readJson(file, maxBytes = 4 * 1024 * 1024) {
  physicalPath(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error(`JSON input must be a regular file: ${file}`);
  if (stat.size > maxBytes) throw new Error(`JSON input exceeds the ${maxBytes}-byte limit: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readArtifact(output, selectedSkillNames) {
  const { validateOpenaiSubmissionZip } = require('./openai-submission-zip');
  physicalPath(output);
  if (!fs.lstatSync(output).isDirectory()) throw new Error('artifact output must be a physical directory');
  const names = [];
  const directory = fs.opendirSync(output);
  try {
    let entry;
    while ((entry = directory.readSync()) !== null) {
      names.push(entry.name);
      if (names.length > 2) throw new Error('foreign output: artifact contains unowned files');
    }
  } finally { directory.closeSync(); }
  names.sort();
  if (names.join(',') !== 'package.zip,provenance.json') throw new Error('foreign output: artifact must contain only its owned ZIP and receipt');
  const receipt = readJson(path.join(output, 'provenance.json'), 8 * 1024 * 1024);
  const archive = path.join(output, 'package.zip');
  physicalPath(archive);
  if (!fs.lstatSync(archive).isFile()) throw new Error('artifact ZIP must be a regular file');
  const checked = validateOpenaiSubmissionZip(archive, { selectedSkillNames });
  if (!checked.ok) throw new Error(`artifact ZIP validation failed: ${checked.errors.join('; ')}`);
  if (receipt.schema !== RECEIPT_SCHEMA || receipt.surface !== 'openai-submission'
    || receipt.archiveDigest !== checked.archiveDigest) {
    throw new Error('foreign output: invalid owner receipt or archive digest');
  }
  if (JSON.stringify(receipt.extractedFiles) !== JSON.stringify(checked.extractedFiles)) {
    throw new Error('artifact receipt does not match extracted file fingerprints');
  }
  const provenance = receipt.provenance;
  const identity = provenance && provenance.sourceIdentity;
  const sha256 = /^[a-f0-9]{64}$/;
  const gitObject = /^[a-f0-9]{40}$/;
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!provenance || provenance.schema !== 'dhpk.openai-submission-provenance.v1'
    || !identity || !gitObject.test(identity.commit) || !gitObject.test(identity.tree)
    || !version.test(identity.version) || provenance.version !== identity.version
    || !provenance.generator || provenance.generator.id !== 'openai-submission-package'
    || provenance.generator.version !== '1'
    || !sha256.test(provenance.inventoryDigest) || !sha256.test(provenance.selectionDigest)
    || provenance.selectionDigest !== receipt.sourceSelectionDigest
    || !sha256.test(receipt.manifestDigest)
    || !provenance.bundleProvenance || provenance.bundleProvenance.selectionDigest !== provenance.selectionDigest) {
    throw new Error('artifact receipt has malformed or inconsistent source provenance');
  }
  const fingerprints = provenance.fileFingerprints;
  if (!fingerprints || typeof fingerprints !== 'object' || Array.isArray(fingerprints)
    || Object.keys(fingerprints).length !== checked.extractedFiles.length
    || checked.extractedFiles.some((file) => fingerprints[file.path] !== file.sha256)) {
    throw new Error('artifact nested provenance does not match extracted file fingerprints');
  }
  return { receipt, checked };
}

function publish(output, bytes, receipt, selectedSkillNames, previousDigest) {
  physicalPath(output);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  physicalPath(parent);
  const stage = fs.mkdtempSync(path.join(parent, '.openai-submission-'));
  const backup = path.join(stage, 'previous');
  const next = path.join(stage, 'next');
  fs.mkdirSync(next);
  let moved = false;
  let preserveStage = false;
  try {
    fs.writeFileSync(path.join(next, 'package.zip'), bytes, { flag: 'wx', mode: 0o644 });
    fs.writeFileSync(path.join(next, 'provenance.json'), json(receipt), { flag: 'wx', mode: 0o644 });
    if (fs.existsSync(output)) {
      const current = readArtifact(output, selectedSkillNames);
      if (!previousDigest || current.receipt.archiveDigest !== previousDigest) {
        throw new Error('artifact output changed during generation; preserving it');
      }
      fs.renameSync(output, backup);
      moved = true;
    } else if (previousDigest) {
      throw new Error('artifact output disappeared during generation');
    }
    try { fs.renameSync(next, output); }
    catch (error) {
      if (moved) {
        try { fs.renameSync(backup, output); }
        catch (rollbackError) {
          preserveStage = true;
          throw new Error(`publication failed; previous artifact retained at ${backup}: ${rollbackError.message}`);
        }
      }
      throw error;
    }
  } finally { if (!preserveStage) fs.rmSync(stage, { recursive: true, force: true }); }
}

function executeOpenaiSubmission(request, sourceRoot) {
  const root = physicalPath(sourceRoot);
  const output = physicalPath(path.resolve(root, request.options.output || 'generated/openai-submission'));
  if (output === root || root.startsWith(`${output}${path.sep}`)
    || output === path.join(root, 'skills') || output.startsWith(`${path.join(root, 'skills')}${path.sep}`)
    || output === path.join(root, 'manifests') || output.startsWith(`${path.join(root, 'manifests')}${path.sep}`)) {
    throw new Error('artifact output must not replace source inputs');
  }
  const inventory = readJson(path.join(root, 'manifests/distribution-inventory.json'));
  const selection = readJson(path.join(root, 'manifests/marketplace-selection.json'));
  const view = compileMarketplacePublicationView({ inventory, selection });
  if (view.errors.length) throw new Error(view.errors.join('; '));
  const selectedSkillNames = view.publicEntries.map((entry) => entry.name);
  let details;
  if (request.operation === 'generate') {
    assertCleanSourceCheckout(root);
    const previousDigest = fs.existsSync(output) ? readArtifact(output, selectedSkillNames).receipt.archiveDigest : null;
    const manifest = readJson(physicalPath(path.resolve(root, request.options.manifest)), 64 * 1024);
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
    const objectFormat = execFileSync('git', ['rev-parse', '--show-object-format'], { cwd: root, encoding: 'utf8' }).trim();
    if (objectFormat !== 'sha1') throw new Error(`unsupported source object format: ${objectFormat}`);
    const trackedSources = new Map(execFileSync('git', ['ls-tree', '-r', '-z', sourceCommit, '--'], {
      cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    }).split('\0').filter(Boolean).map((entry) => {
      const separator = entry.indexOf('\t');
      const metadata = entry.slice(0, separator).split(' ');
      return [entry.slice(separator + 1), { blobDigest: metadata[2], mode: metadata[0] }];
    }));
    const version = request.options.version || readJson(path.join(root, '.claude-plugin/plugin.json')).version;
    const { compileOpenaiSubmissionPackage } = require('./openai-submission-package');
    const { encodeOpenaiSubmissionZip, validateOpenaiSubmissionBytes } = require('./openai-submission-zip');
    const compiled = compileOpenaiSubmissionPackage({
      root, inventory, selection, manifest,
      sourceIdentity: { version, commit: sourceCommit, tree: sourceTree },
      sourceFileAllowlist: new Set(trackedSources.keys()),
    });
    if (!compiled.ok) throw new Error(compiled.errors.join('; '));
    const committedModes = new Map();
    for (const record of compiled.provenance.bundleProvenance.sourceToDestination) {
      const tracked = trackedSources.get(record.source);
      if (!tracked || tracked.blobDigest !== record.originalGitBlobDigest) {
        throw new Error(`source file differs from the captured Git tree: ${record.source}`);
      }
      if (!['100644', '100755'].includes(tracked.mode)) {
        throw new Error(`unsupported source file mode in captured Git tree: ${record.source}`);
      }
      committedModes.set(record.destination, tracked.mode === '100755' ? 0o755 : 0o644);
    }
    assertCleanSourceCheckout(root);
    if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== sourceCommit) {
      throw new Error('source commit changed during generation');
    }
    const bytes = encodeOpenaiSubmissionZip(compiled.files.map((file) => ({
      ...file, mode: committedModes.get(file.path) || file.mode,
    })));
    const checked = validateOpenaiSubmissionBytes(bytes, { selectedSkillNames });
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const receipt = {
      schema: RECEIPT_SCHEMA, surface: 'openai-submission',
      provenance: compiled.provenance,
      sourceSelectionDigest: view.selectionDigest,
      manifestDigest: digest(Buffer.from(json(manifest))),
      archiveDigest: checked.archiveDigest, extractedFiles: checked.extractedFiles,
    };
    publish(output, bytes, receipt, selectedSkillNames, previousDigest);
    details = { ...checked, provenance: receipt };
  } else {
    const artifact = readArtifact(output, selectedSkillNames);
    if (artifact.receipt.sourceSelectionDigest !== view.selectionDigest) {
      throw new Error('artifact selection provenance differs from the canonical selection');
    }
    details = { ...artifact.checked, provenance: artifact.receipt };
  }
  return {
    ok: details.ok, status: details.ok ? 0 : 1,
    payload: {
      surface: 'openai-submission', operation: request.operation,
      verdict: details.ok ? 'PASS' : 'FAIL', output,
      evidence: { stage: 'structural', runtime: 'NOT_RUN', reason: 'Consumer execution and directory submission are separate evidence states.' },
      ...details,
    },
  };
}

module.exports = { executeOpenaiSubmission };
