#!/usr/bin/env node
'use strict';

// Validate the narrow, quoted agents/openai.yaml contract used by every
// canonical skill and verify the Codex projection does not drift from it.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectInventory, relativePosix } = require('../lib/asset-inventory');
const { extract, isEmpty, extractInvocationClass } = require('./_lib/frontmatter');
const { createReporter } = require('./_lib/report');

// Physical mirrors are inventory-owned.  The four current entries allow
// Codex-specific body/reference transforms, but their metadata and runtime
// contract still have to match the canonical source.  Keeping the allowed
// transform paths explicit makes intentional differences auditable instead of
// silently accepting manual drift.
const PROJECTION_RULES = Object.freeze({
  'legacy-code-characterization': Object.freeze(['SKILL.md']),
  'php56-yii-dev': Object.freeze(['SKILL.md']),
  'php-pro': Object.freeze(['SKILL.md', 'references/agent-extracts']),
  'yii1-security-audit': Object.freeze(['SKILL.md']),
});

// Body-level transforms are intentionally different for the four physical
// mirrors.  These markers are the semantic output contract that must survive
// a Codex adaptation; unknown physical projections must remain byte-normalized
// at the output-contract level.
const OUTPUT_CONTRACT_RULES = Object.freeze({
  'legacy-code-characterization': Object.freeze(['tests/integration', 'tests/unit', '覆蓋率']),
  'php56-yii-dev': Object.freeze(['Task classification', 'Context7 basis', 'Verification', 'Risks / assumptions']),
  'php-pro': Object.freeze(['Detected runtime', 'References loaded', 'Testing layer']),
  'yii1-security-audit': Object.freeze(['AccessControl', 'RBAC', 'CSRF', 'XSS', 'SQL', 'MassAssignment', 'File', 'Session']),
});

function derivePhysicalSources(root) {
  const manifestPath = path.join(root, 'manifests', 'distribution-inventory.json');
  if (!fs.existsSync(manifestPath)) return {};
  try {
    const inventory = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sources = {};
    for (const entry of inventory.skills || []) {
      const surfaces = Array.isArray(entry.surfaces) ? entry.surfaces : [];
      if (entry && entry.id && entry.path && surfaces.includes('codex-sync')) {
        sources[entry.id] = entry.path;
      }
    }
    return sources;
  } catch (_) {
    return {};
  }
}

function fingerprintDirectory(root, ignored = []) {
  const digest = crypto.createHash('sha256');
  const ignoredPaths = ignored.map((entry) => entry.replace(/\\/g, '/').replace(/\/$/, ''));
  const isIgnored = (relative) => ignoredPaths.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
  const walk = (current, relative) => {
    if (isIgnored(relative)) return;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(current);
      const targetStat = fs.statSync(target);
      if (targetStat.isDirectory()) {
        for (const name of fs.readdirSync(target).sort()) {
          const childRel = relative ? `${relative}/${name}` : name;
          walk(path.join(target, name), childRel);
        }
      } else {
        digest.update(relative);
        digest.update('\0');
        digest.update(fs.readFileSync(target));
        digest.update('\0');
      }
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) {
        const childRel = relative ? `${relative}/${name}` : name;
        walk(path.join(current, name), childRel);
      }
      return;
    }
    digest.update(relative);
    digest.update('\0');
    digest.update(fs.readFileSync(current));
    digest.update('\0');
  };
  walk(root, '');
  return digest.digest('hex');
}

function referenceContract(skillDir) {
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) return { invocationClass: null, references: [] };
  const content = fs.readFileSync(skillFile, 'utf8');
  const parsed = extractInvocationClass(content);
  const references = [...content.matchAll(/(?:references|docs\/contracts)\/[A-Za-z0-9_./-]+/g)]
    .map((match) => match[0])
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  const outputMatch = content.match(/^##\s+(Output(?: Contract)?|輸出(?:目錄|完整性檢查)?)[ \t]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  const outputContract = outputMatch && outputMatch[2].trim()
    ? {
      heading: outputMatch[1],
      body: outputMatch[2].trim(),
      normalized: outputMatch[2].replace(/\s+/g, ' ').trim().toLowerCase(),
    }
    : null;
  return {
    invocationClass: parsed.present && !parsed.unknownValue ? parsed.value : null,
    references,
    outputContract,
  };
}

const REQUIRED_INTERFACE_KEYS = new Set([
  'display_name',
  'short_description',
  'default_prompt',
]);

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function decodeQuotedScalar(raw) {
  if (!/^"(?:\\.|[^"\\])*"$/.test(raw)) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function frontmatterName(skillFile, reporter) {
  const parsed = extract(fs.readFileSync(skillFile, 'utf8'));
  const rel = path.dirname(skillFile);
  if (!parsed.present) {
    reporter.err(`${rel} — SKILL.md frontmatter is missing`);
    return null;
  }
  if (parsed.duplicates.includes('name')) {
    reporter.err(`${rel} — SKILL.md frontmatter has duplicate name`);
  }
  const rawName = parsed.values.name;
  if (isEmpty(rawName)) {
    reporter.err(`${rel} — SKILL.md frontmatter name is missing or empty`);
    return null;
  }
  return rawName.replace(/^("|')(.*)\1$/, '$2').trim();
}

function parseOpenaiYaml(metadataFile, reporter) {
  const rel = path.dirname(metadataFile);
  const lines = fs.readFileSync(metadataFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines[0] !== 'interface:') {
    reporter.err(`${rel} — openai.yaml must start with interface:`);
    return null;
  }

  const values = Object.create(null);
  let policy = null;
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (line === 'policy:') break; // second top-level block — handled below
    const match = line.match(/^  ([A-Za-z0-9_]+): ("(?:\\.|[^"\\])*")$/);
    if (!match) {
      reporter.err(`${rel} — malformed interface scalar at line ${index + 1}`);
      continue;
    }
    const [, key, rawValue] = match;
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      reporter.err(`${rel} — duplicate interface.${key}`);
      continue;
    }
    if (!['display_name', 'short_description', 'default_prompt'].includes(key)) {
      reporter.err(`${rel} — unsupported interface.${key}; keep metadata minimal`);
      continue;
    }
    const value = decodeQuotedScalar(rawValue);
    if (value == null) {
      reporter.err(`${rel} — interface.${key} is not a valid quoted scalar`);
      continue;
    }
    values[key] = value;
  }

  for (const key of REQUIRED_INTERFACE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      reporter.err(`${rel} — missing interface.${key}`);
    }
  }

  // Optional `policy:` block — the sole supported key is a bare boolean
  // allow_implicit_invocation (Codex's explicit-only projection). Absence
  // means implicit invocation is permitted (no restriction).
  if (lines[index] === 'policy:') {
    policy = Object.create(null);
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === '') continue;
      const match = line.match(/^  (allow_implicit_invocation): (true|false)$/);
      if (!match) {
        reporter.err(`${rel} — malformed policy scalar at line ${index + 1}`);
        continue;
      }
      const [, key, rawValue] = match;
      if (Object.prototype.hasOwnProperty.call(policy, key)) {
        reporter.err(`${rel} — duplicate policy.${key}`);
        continue;
      }
      policy[key] = rawValue === 'true';
    }
    if (!Object.prototype.hasOwnProperty.call(policy, 'allow_implicit_invocation')) {
      reporter.err(`${rel} — policy: block present but missing policy.allow_implicit_invocation`);
    }
  }

  return { values, policy };
}

function validateMetadata(skillDir, skillName, reporter) {
  const metadataFile = path.join(skillDir, 'agents', 'openai.yaml');
  if (!fs.existsSync(metadataFile)) {
    reporter.err(`${skillDir} — missing agents/openai.yaml`);
    return { valid: false, policy: null };
  }
  if (!fs.statSync(metadataFile).isFile()) {
    reporter.err(`${skillDir} — agents/openai.yaml is not a file`);
    return { valid: false, policy: null };
  }

  const parsed = parseOpenaiYaml(metadataFile, reporter);
  if (!parsed) return { valid: false, policy: null };
  const metadata = parsed.values;
  let valid = true;
  if (isEmpty(metadata.display_name)) {
    reporter.err(`${skillDir} — interface.display_name is empty`);
    valid = false;
  }
  if (typeof metadata.short_description !== 'string' || metadata.short_description.length < 25 || metadata.short_description.length > 64) {
    reporter.err(`${skillDir} — interface.short_description must be 25-64 characters`);
    valid = false;
  }
  if (typeof metadata.default_prompt !== 'string' || !metadata.default_prompt.includes(`$${skillName}`)) {
    reporter.err(`${skillDir} — interface.default_prompt must invoke $${skillName}`);
    valid = false;
  }
  return { valid, policy: parsed.policy };
}

function validateProjection(root, canonicalByName, reporter, physicalSources = derivePhysicalSources(root)) {
  const codexDir = path.join(root, 'codex', 'skills');
  if (!fs.existsSync(codexDir)) {
    reporter.err('codex/skills — projection directory is missing');
    return { entries: 0, symlinks: 0, physical: 0, fingerprints: {} };
  }

  let symlinks = 0;
  let physical = 0;
  const fingerprints = {};
  const entries = fs.readdirSync(codexDir).sort();

  for (const name of entries) {
    const entry = path.join(codexDir, name);
    const stat = fs.lstatSync(entry);
    if (stat.isSymbolicLink()) {
      symlinks += 1;
      let actual;
      try {
        actual = fs.realpathSync(entry);
      } catch (_) {
        reporter.err(`${relativePosix(root, entry)} — dangling Codex symlink`);
        continue;
      }
      const canonical = canonicalByName.get(name);
      if (!canonical) {
        reporter.err(`${relativePosix(root, entry)} — symlink has no root canonical skill`);
        continue;
      }
      if (actual !== fs.realpathSync(canonical)) {
        reporter.err(`${relativePosix(root, entry)} — symlink target is not the canonical root skill`);
      }
      continue;
    }

    if (!stat.isDirectory()) {
      reporter.err(`${relativePosix(root, entry)} — unexpected non-directory Codex entry`);
      continue;
    }
    physical += 1;
    if (!Object.prototype.hasOwnProperty.call(physicalSources, name)) {
      reporter.err(`${relativePosix(root, entry)} — unexpected physical Codex skill`);
      continue;
    }

    const sourceRelative = physicalSources[name];
    const source = path.join(root, sourceRelative);
    if (!fs.existsSync(source)) {
      reporter.err(`${relativePosix(root, entry)} — canonical module source is missing: ${sourceRelative}`);
      continue;
    }
    const sourceMetadata = path.join(source, 'agents', 'openai.yaml');
    const mirrorMetadata = path.join(entry, 'agents', 'openai.yaml');
    if (!fs.existsSync(mirrorMetadata)) {
      reporter.err(`${relativePosix(root, entry)} — physical mirror metadata is missing`);
      continue;
    }
    try {
      if (fs.lstatSync(mirrorMetadata).isSymbolicLink()) {
        if (fs.realpathSync(mirrorMetadata) !== fs.realpathSync(sourceMetadata)) {
          reporter.err(`${relativePosix(root, mirrorMetadata)} — metadata symlink does not target the canonical module metadata`);
        }
      } else if (fs.readFileSync(mirrorMetadata, 'utf8') !== fs.readFileSync(sourceMetadata, 'utf8')) {
        const canonicalMetadata = parseOpenaiYaml(sourceMetadata, { err: () => {} });
        const mirrorParsed = parseOpenaiYaml(mirrorMetadata, { err: () => {} });
        for (const key of REQUIRED_INTERFACE_KEYS) {
          if (!mirrorParsed || !Object.prototype.hasOwnProperty.call(mirrorParsed.values || {}, key)) {
            reporter.err(`${relativePosix(root, mirrorMetadata)} — physical mirror metadata missing field interface.${key}`);
          } else if (canonicalMetadata && mirrorParsed.values[key] !== canonicalMetadata.values[key]) {
            reporter.err(`${relativePosix(root, mirrorMetadata)} — physical mirror metadata field interface.${key} differs from canonical metadata`);
          }
        }
        reporter.err(`${relativePosix(root, mirrorMetadata)} — physical mirror metadata differs from canonical metadata`);
      }
    } catch (error) {
      reporter.err(`${relativePosix(root, mirrorMetadata)} — cannot compare physical mirror metadata: ${error.message}`);
    }

    const canonicalContract = referenceContract(source);
    const mirrorContract = referenceContract(entry);
    if (canonicalContract.invocationClass !== mirrorContract.invocationClass) {
      reporter.err(`${relativePosix(root, entry)} — physical mirror invocation metadata differs from canonical source`);
    }
    for (const reference of canonicalContract.references) {
      if (!mirrorContract.references.includes(reference)) {
        reporter.err(`${relativePosix(root, entry)} — physical mirror is missing required reference ${reference}`);
      }
    }
    if (canonicalContract.outputContract && !mirrorContract.outputContract) {
      reporter.err(`${relativePosix(root, entry)} — physical mirror is missing the canonical output contract`);
    } else if (canonicalContract.outputContract && mirrorContract.outputContract) {
      const requiredOutputMarkers = OUTPUT_CONTRACT_RULES[name];
      if (requiredOutputMarkers) {
        for (const marker of requiredOutputMarkers) {
          if (!mirrorContract.outputContract.body.includes(marker)) {
            reporter.err(`${relativePosix(root, entry)} — physical mirror output contract is missing required marker '${marker}'`);
          }
        }
      } else if (canonicalContract.outputContract.normalized !== mirrorContract.outputContract.normalized) {
        reporter.err(`${relativePosix(root, entry)} — physical mirror output contract differs from canonical output contract`);
      }
    }

    const ignored = PROJECTION_RULES[name] || [];
    const canonicalFingerprint = fingerprintDirectory(source, ignored);
    const mirrorFingerprint = fingerprintDirectory(entry, ignored);
    if (canonicalFingerprint !== mirrorFingerprint) {
      reporter.err(`${relativePosix(root, entry)} — mirror fingerprint differs from canonical source (${canonicalFingerprint} != ${mirrorFingerprint}); add an explicit projection rule for intentional differences`);
    }
    fingerprints[name] = {
      canonical: canonicalFingerprint,
      mirror: mirrorFingerprint,
      source: sourceRelative,
      allowedTransforms: ignored,
    };
  }

  return { entries: entries.length, symlinks, physical, fingerprints };
}

function main() {
  const root = path.resolve(argValue('--root', process.cwd()));
  const reporter = createReporter('openai-metadata');
  const result = validateRepository(root);
  for (const error of result.errors) reporter.err(error);
  const fingerprintEvidence = Object.entries(result.projection.fingerprints)
    .map(([name, value]) => `${name}:${value.canonical}/${value.mirror}`)
    .join(',');
  reporter.done(
    `canonical=${result.canonical} metadata=${result.metadata} ` +
    `codex=${result.projection.entries} symlinks=${result.projection.symlinks} ` +
    `physical=${result.projection.physical}` +
    (fingerprintEvidence ? ` fingerprints=${fingerprintEvidence}` : '')
  );
}

// Cross-harness invocation-class parity (openspec/changes/
// clarify-dhpk-skill-invocation-policy): explicit-only SHALL produce
// Claude disable-model-invocation:true + Codex policy.allow_implicit_invocation:false;
// implicit-eligible SHALL retain neither restrictive flag.
function checkInvocationParity(skillFile, policy, reporter) {
  const rel = path.dirname(skillFile);
  const content = fs.readFileSync(skillFile, 'utf8');
  const fm = extract(content);
  const ic = extractInvocationClass(content);
  if (!ic.present || ic.unknownValue) return; // validate-invocation-policy.js owns this failure
  const claudeDisabled = fm.values['disable-model-invocation'] === 'true';

  if (ic.value === 'explicit-only') {
    if (!claudeDisabled) {
      reporter.err(`${rel} — explicit-only but Claude frontmatter is missing disable-model-invocation: true`);
    }
    if (!policy || policy.allow_implicit_invocation !== false) {
      reporter.err(`${rel}/agents/openai.yaml — explicit-only but missing policy.allow_implicit_invocation: false`);
    }
  } else if (ic.value === 'implicit-eligible') {
    if (claudeDisabled) {
      reporter.err(`${rel} — implicit-eligible but still carries disable-model-invocation: true (stale restriction)`);
    }
    if (policy) {
      reporter.err(`${rel}/agents/openai.yaml — implicit-eligible but retains a policy: block (stale restriction)`);
    }
  }
}

function validateRepository(root) {
  const errors = [];
  const reporter = { err: (message) => errors.push(message) };
  const inventory = collectInventory(root);
  const canonicalByName = new Map();
  const duplicateNames = new Set();
  let metadataCount = 0;

  for (const skillFile of inventory.paths.skills) {
    const skillDir = path.dirname(skillFile);
    const skillName = frontmatterName(skillFile, reporter);
    if (!skillName) continue;
    if (canonicalByName.has(skillName)) duplicateNames.add(skillName);
    else canonicalByName.set(skillName, skillDir);
    const { valid, policy } = validateMetadata(skillDir, skillName, reporter);
    if (valid) metadataCount += 1;
    checkInvocationParity(skillFile, policy, reporter);
  }

  for (const name of duplicateNames) {
    reporter.err(`duplicate canonical skill name: ${name}`);
  }

  const projection = validateProjection(root, canonicalByName, reporter, derivePhysicalSources(root));
  return {
    errors,
    canonical: inventory.paths.skills.length,
    metadata: metadataCount,
    projection,
  };
}

if (require.main === module) main();

module.exports = { validateRepository, derivePhysicalSources, fingerprintDirectory, referenceContract };
