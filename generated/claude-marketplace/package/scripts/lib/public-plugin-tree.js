'use strict';

// The Public Plugin tree: the one skills-only, hook-free tree behind both the
// OpenAI submission ZIP and the Codex native package (ADR-0040). Its skill set
// is the public catalog: every public entry plus the children each entry
// bundles, and no Host-only skill. Both builders take their skill bytes and
// manifests from this module, so the two outputs cannot drift apart.

const { normalizePortableFrontmatter, stableStringify } = require('./agent-plugin-package');
const { compileMarketplaceSkillContent } = require('./marketplace-skill-content');

const OPENAI_MANIFEST_PATH = 'plugin.json';
const CODEX_MANIFEST_PATH = '.codex-plugin/plugin.json';

// Public Plugin SKILL.md bytes: portable frontmatter only. Returns
// { ok, bytes, errors }; files other than a SKILL.md pass through unchanged.
function normalizePublicSkillFile(file, inventoryById) {
  const isSkillMarkdown = file.path.startsWith('skills/') && file.path.endsWith('/SKILL.md');
  if (!isSkillMarkdown) return { ok: true, bytes: Buffer.from(file.bytes), errors: [] };
  const parsed = normalizePortableFrontmatter(Buffer.from(file.bytes).toString('utf8'));
  if (!parsed.ok) return { ok: false, bytes: null, errors: parsed.errors.map((error) => `${file.skillId} ${error}`) };
  const skill = inventoryById.get(file.skillId);
  if (skill && parsed.name !== skill.name) {
    return {
      ok: false,
      bytes: null,
      errors: [`${file.skillId} SKILL.md name '${parsed.name}' does not match catalog name '${skill.name}'`],
    };
  }
  return { ok: true, bytes: Buffer.from(parsed.output, 'utf8'), errors: [] };
}

// Codex manifest of the Public Plugin, derived from the OpenAI manifest so the
// two cannot disagree on name, version, or description.
function renderCodexPluginManifest(openaiManifest) {
  return {
    description: openaiManifest.description,
    name: openaiManifest.name,
    version: openaiManifest.version,
    skills: './skills/',
  };
}

function manifestFile(manifestPath, manifest) {
  return { path: manifestPath, bytes: Buffer.from(`${stableStringify(manifest)}\n`, 'utf8'), mode: 0o644 };
}

// Both manifests of the Public Plugin as tree files.
function publicPluginManifestFiles(openaiManifest) {
  return [
    manifestFile(OPENAI_MANIFEST_PATH, openaiManifest),
    manifestFile(CODEX_MANIFEST_PATH, renderCodexPluginManifest(openaiManifest)),
  ];
}

// Public Plugin tree files for a publication view: normalized skills plus both
// manifests, sorted by path. Fails closed on any content or collision error.
function compilePublicPluginTree({ root, inventory, publicationView, manifest, sourceFileAllowlist } = {}) {
  const content = compileMarketplaceSkillContent({ root, inventory, publicationView, sourceFileAllowlist });
  if (!content.ok) return { ok: false, errors: content.errors, files: [], content: null };

  const inventoryById = new Map(inventory.skills.map((skill) => [skill.id, skill]));
  const errors = [];
  const files = [];
  for (const sourceFile of content.files) {
    const normalized = normalizePublicSkillFile(sourceFile, inventoryById);
    if (!normalized.ok) {
      errors.push(...normalized.errors);
      continue;
    }
    files.push({ path: sourceFile.path, bytes: normalized.bytes, mode: sourceFile.mode & 0o111 ? 0o755 : 0o644 });
  }
  if (errors.length > 0) return { ok: false, errors, files: [], content: null };

  const manifests = publicPluginManifestFiles(manifest);
  for (const file of manifests) {
    if (files.some((existing) => existing.path === file.path)) {
      return { ok: false, errors: [`package path collision at ${file.path}`], files: [], content: null };
    }
  }
  files.push(...manifests);
  files.sort((left, right) => (left.path < right.path ? -1 : (left.path > right.path ? 1 : 0)));
  return { ok: true, errors: [], files, content };
}

// Files the Codex native generator adds beside the Public Plugin tree: its
// receipt and its readmes. They are not part of the tree the ZIP carries.
const NATIVE_RECEIPT_FILES = Object.freeze(['provenance.json', 'fingerprints.json', 'README.md', 'README.zh-TW.md']);

// Differences between the tree the builders produce and a committed package
// directory (a Map of path to Buffer, receipt files excluded by the caller).
function publicPluginTreeDrift(expected, actual) {
  const errors = [];
  for (const [file, bytes] of expected) {
    if (!actual.has(file)) errors.push(`committed Public Plugin is missing ${file}`);
    else if (!bytes.equals(actual.get(file))) errors.push(`committed Public Plugin differs from the built tree at ${file}`);
  }
  for (const file of actual.keys()) {
    if (!expected.has(file)) errors.push(`committed Public Plugin has unexpected file ${file}`);
  }
  return errors;
}

module.exports = {
  NATIVE_RECEIPT_FILES,
  publicPluginTreeDrift,
  OPENAI_MANIFEST_PATH,
  CODEX_MANIFEST_PATH,
  normalizePublicSkillFile,
  renderCodexPluginManifest,
  publicPluginManifestFiles,
  compilePublicPluginTree,
};
