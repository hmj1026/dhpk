'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  AGENT_PLUGIN_SCHEMA,
  normalizePortableFrontmatter,
  stableStringify,
  validatePortableManifest,
} = require('./agent-plugin-package');
const { compileMarketplacePublicationView } = require('./marketplace-selection');
const { compileMarketplaceSkillContent } = require('./marketplace-skill-content');

const OPENAI_CATEGORIES = Object.freeze([
  'Productivity',
  'Creativity',
  'Developer Tools',
  'Business & Operations',
  'Data & Analytics',
  'Communication',
  'Education & Research',
  'Security',
  'Finance',
  'Healthcare',
  'Travel',
  'Entertainment',
  'Other',
]);

const GENERATOR = Object.freeze({ id: 'openai-submission-package', version: '1' });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function failure(errors) {
  return { ok: false, errors, files: [], provenance: null };
}

function validateSubmissionManifest(manifest, sourceIdentity) {
  const errors = [];
  const portable = validatePortableManifest(manifest);
  errors.push(...portable.errors);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return errors;
  if (manifest.name !== 'dhpk') errors.push("plugin.json name must be 'dhpk'");
  if (!sourceIdentity || typeof sourceIdentity !== 'object' || Array.isArray(sourceIdentity)) {
    errors.push('sourceIdentity must be an object');
  } else {
    if (typeof sourceIdentity.version !== 'string' || sourceIdentity.version.length === 0) {
      errors.push('sourceIdentity.version must be a non-empty string');
    }
    if (typeof sourceIdentity.commit !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sourceIdentity.commit)) {
      errors.push('sourceIdentity.commit must be a lowercase Git object ID');
    }
    if (sourceIdentity.tree !== undefined
      && (typeof sourceIdentity.tree !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sourceIdentity.tree))) {
      errors.push('sourceIdentity.tree must be a lowercase Git object ID when provided');
    }
  }
  if (typeof manifest.version !== 'string'
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    errors.push('plugin.json version must be SemVer');
  } else if (sourceIdentity && manifest.version !== sourceIdentity.version) {
    errors.push('plugin.json version must match sourceIdentity.version');
  }
  if (typeof manifest.description !== 'string' || manifest.description.length === 0) {
    errors.push('plugin.json description must be a non-empty string');
  }
  const extensions = manifest.extensions;
  if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) {
    errors.push('plugin.json extensions must contain the OpenAI listing interface');
    return errors;
  }
  if (Object.keys(extensions).length !== 1 || !Object.prototype.hasOwnProperty.call(extensions, 'com.openai')) {
    errors.push("plugin.json extensions must contain only 'com.openai'");
    return errors;
  }
  const openai = extensions['com.openai'];
  if (!openai || typeof openai !== 'object' || Array.isArray(openai)
    || Object.keys(openai).length !== 1 || !Object.prototype.hasOwnProperty.call(openai, 'interface')) {
    errors.push("plugin.json extensions['com.openai'] must contain only the listing interface");
    return errors;
  }
  const listing = openai.interface;
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) {
    errors.push("plugin.json extensions['com.openai'].interface must be an object");
    return errors;
  }
  const limits = {
    displayName: 30,
    shortDescription: 30,
    longDescription: 4000,
    developerName: 80,
  };
  for (const [field, limit] of Object.entries(limits)) {
    const value = listing[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`OpenAI interface ${field} must be a non-empty string`);
    } else if (Array.from(value).length > limit) {
      errors.push(`OpenAI interface ${field} exceeds the ${limit}-character final-submission limit`);
    } else if (field !== 'longDescription' && /[\r\n]/.test(value)) {
      errors.push(`OpenAI interface ${field} must be a single line`);
    }
  }
  if (typeof listing.category !== 'string' || !OPENAI_CATEGORIES.includes(listing.category)) {
    errors.push(`OpenAI interface category must be one of: ${OPENAI_CATEGORIES.join(', ')}`);
  }
  return errors;
}

function compileOpenaiSubmissionPackage({ root, inventory, selection, manifest, sourceIdentity, aliases = [], sourceFileAllowlist } = {}) {
  const manifestErrors = validateSubmissionManifest(manifest, sourceIdentity);
  if (manifestErrors.length > 0) return failure(manifestErrors);

  const publicationView = compileMarketplacePublicationView({ inventory, selection, aliases });
  if (publicationView.errors.length > 0) return failure(publicationView.errors.map((error) => `marketplace selection: ${error}`));
  const content = compileMarketplaceSkillContent({ root, inventory, publicationView, sourceFileAllowlist });
  if (!content.ok) return failure(content.errors);

  const inventoryById = new Map(inventory.skills.map((skill) => [skill.id, skill]));
  const fileErrors = [];
  const files = [];
  for (const sourceFile of content.files) {
    let bytes = Buffer.from(sourceFile.bytes);
    const skill = inventoryById.get(sourceFile.skillId);
    const isSkillEntrypoint = sourceFile.kind !== 'dependency'
      && skill
      && sourceFile.sourcePath === path.posix.join(skill.path, 'SKILL.md');
    if (isSkillEntrypoint) {
      const parsed = normalizePortableFrontmatter(bytes.toString('utf8'));
      if (!parsed.ok) {
        fileErrors.push(...parsed.errors.map((error) => `${sourceFile.skillId} ${error}`));
        continue;
      }
      if (parsed.name !== skill.name) {
        fileErrors.push(`${sourceFile.skillId} SKILL.md name '${parsed.name}' does not match catalog name '${skill.name}'`);
        continue;
      }
      if (sourceFile.kind === 'entry') bytes = Buffer.from(parsed.output, 'utf8');
    }
    files.push({ path: sourceFile.path, bytes, mode: sourceFile.mode & 0o111 ? 0o755 : 0o644 });
  }
  if (fileErrors.length > 0) return failure(fileErrors);

  const manifestBytes = Buffer.from(`${stableStringify(manifest)}\n`, 'utf8');
  if (files.some((file) => file.path === 'plugin.json')) return failure(['package path collision at plugin.json']);
  files.push({ path: 'plugin.json', bytes: manifestBytes, mode: 0o644 });
  files.sort((left, right) => left.path < right.path ? -1 : (left.path > right.path ? 1 : 0));

  const fileFingerprints = Object.fromEntries(files.map((file) => [file.path, sha256(file.bytes)]));
  const selectedStableIds = [...new Set([
    ...content.bundleProvenance.entryIds,
    ...content.bundleProvenance.childIds,
  ])].sort();
  const identity = {
    version: sourceIdentity.version,
    commit: sourceIdentity.commit,
  };
  if (sourceIdentity.tree !== undefined) identity.tree = sourceIdentity.tree;
  const provenance = {
    schema: 'dhpk.openai-submission-provenance.v1',
    generator: GENERATOR,
    sourceIdentity: identity,
    version: sourceIdentity.version,
    selectionDigest: publicationView.selectionDigest,
    inventoryDigest: sha256(stableStringify(inventory)),
    selectedStableIds,
    fileFingerprints,
    bundleProvenance: content.bundleProvenance,
  };
  return { ok: true, errors: [], files, provenance };
}

module.exports = { compileOpenaiSubmissionPackage };
