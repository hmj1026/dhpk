'use strict';

// The Public Plugin tree: the one skills-only, hook-free tree behind both the
// OpenAI submission ZIP and the Codex native package (ADR-0040). Its skill set
// is the public catalog: every public entry plus the children each entry
// bundles, and no Host-only skill. Both builders take their skill bytes and
// manifests from this module, so the two outputs cannot drift apart.

const { normalizePortableFrontmatter, stableStringify } = require('./agent-plugin-package');
const { extractMetadata } = require('../ci/_lib/frontmatter');
const { compileMarketplaceSkillContent } = require('./marketplace-skill-content');
const { layoutPublicPlugin, remapBundleProvenance } = require('./public-plugin-layout');

const OPENAI_MANIFEST_PATH = 'plugin.json';
const CODEX_MANIFEST_PATH = '.codex-plugin/plugin.json';

// Portable frontmatter without metadata: dhpk-* keys are internal bookkeeping.
const PUBLIC_FRONTMATTER_ALLOWLIST = Object.freeze(['name', 'description', 'license', 'compatibility']);

// Runtime-consumed dhpk-* keys: the flow-guide next-action runtime reads these
// three from peer frontmatter. The Public Plugin frontmatter carries none, so
// the build moves them into one shipped data file the runtime loads instead.
const RUNTIME_DATA_PATH = 'skills/flow-guide/references/skill-next-map.json';
const RUNTIME_DATA_KEYS = Object.freeze({
  'dhpk-next': 'next',
  'dhpk-modes': 'modes',
  'dhpk-invocation-class': 'invocationClass',
});

// Next-edge data of every public skill, taken from the source frontmatter and
// keyed by skill name; null when flow-guide is not part of the tree. Sorted, so
// the bytes are deterministic. It holds routing data only, no build facts.
function buildRuntimeDataFile(sourceFiles, options = {}) {
  const outputPath = options.path || RUNTIME_DATA_PATH;
  const requireRuntimeSkill = options.requireRuntimeSkill !== false;
  const hasRuntime = sourceFiles.some((file) => file.path === 'skills/flow-guide/SKILL.md');
  if (requireRuntimeSkill && !hasRuntime) return null;
  const skills = {};
  for (const file of sourceFiles) {
    if (!/^skills\/[^/]+\/SKILL\.md$/.test(file.path)) continue;
    const text = Buffer.from(file.bytes).toString('utf8');
    const name = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(text.split(/\r?\n---/)[0]);
    if (!name) continue;
    const { values } = extractMetadata(text);
    const entry = {};
    for (const [key, field] of Object.entries(RUNTIME_DATA_KEYS)) {
      if (values[key] !== undefined) entry[field] = values[key];
    }
    if (Object.keys(entry).length > 0) skills[name[1]] = entry;
  }
  const sorted = Object.fromEntries(Object.keys(skills).sort().map((key) => [key, skills[key]]));
  return {
    path: outputPath,
    bytes: Buffer.from(`${stableStringify({ schema: 'dhpk.skill-next-map.v1', skills: sorted })}\n`, 'utf8'),
    mode: 0o644,
  };
}

// Public Plugin SKILL.md bytes: portable frontmatter only. Returns
// { ok, bytes, errors }; files other than a SKILL.md pass through unchanged.
function normalizePublicSkillFile(file, inventoryById) {
  const isSkillMarkdown = file.path.startsWith('skills/') && file.path.endsWith('/SKILL.md');
  if (!isSkillMarkdown) return { ok: true, bytes: Buffer.from(file.bytes), errors: [] };
  const parsed = normalizePortableFrontmatter(Buffer.from(file.bytes).toString('utf8'), {
    allowlist: PUBLIC_FRONTMATTER_ALLOWLIST,
  });
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

// Normalizes every content file, then lays the plugin out for review: the
// shared step of the ZIP and the Codex native package. Returns
// { ok, errors, files, assetFiles, manifest, bundleProvenance }; files keep their content shape
// (sourcePath, ownerId, ...) with final path and bytes.
function preparePublicPlugin({ content, inventory, publicationView, manifest }) {
  const inventoryById = new Map(inventory.skills.map((skill) => [skill.id, skill]));
  const errors = [];
  const normalizedFiles = [];
  for (const sourceFile of content.files) {
    const normalized = normalizePublicSkillFile(sourceFile, inventoryById);
    if (!normalized.ok) errors.push(...normalized.errors);
    else normalizedFiles.push({ ...sourceFile, bytes: normalized.bytes });
  }
  if (errors.length > 0) return { ok: false, errors, files: [], assetFiles: [], manifest };
  const laidOut = layoutPublicPlugin({
    files: normalizedFiles,
    manifest,
    counts: {
      workflowCount: publicationView.publicEntries.length,
      referenceCount: content.bundleProvenance.childIds.length,
    },
  });
  if (!laidOut.ok) return laidOut;
  return {
    ...laidOut,
    runtimeData: buildRuntimeDataFile(content.files),
    bundleProvenance: remapBundleProvenance(content.bundleProvenance, laidOut.pathMap),
  };
}

// Public Plugin tree files for a publication view: normalized skills plus both
// manifests, sorted by path. Fails closed on any content or collision error.
function compilePublicPluginTree({ root, inventory, publicationView, manifest, sourceFileAllowlist } = {}) {
  const content = compileMarketplaceSkillContent({ root, inventory, publicationView, sourceFileAllowlist });
  if (!content.ok) return { ok: false, errors: content.errors, files: [], content: null };

  const prepared = preparePublicPlugin({ content, inventory, publicationView, manifest });
  if (!prepared.ok) return { ok: false, errors: prepared.errors, files: [], content: null };

  const files = [...prepared.files, ...prepared.assetFiles]
    .map((file) => ({ path: file.path, bytes: Buffer.from(file.bytes), mode: file.mode & 0o111 ? 0o755 : 0o644 }));
  const manifests = publicPluginManifestFiles(prepared.manifest);
  for (const file of manifests) {
    if (files.some((existing) => existing.path === file.path)) {
      return { ok: false, errors: [`package path collision at ${file.path}`], files: [], content: null };
    }
  }
  files.push(...manifests);
  const runtimeData = prepared.runtimeData;
  if (runtimeData) {
    if (files.some((existing) => existing.path === runtimeData.path)) {
      return { ok: false, errors: [`package path collision at ${runtimeData.path}`], files: [], content: null };
    }
    files.push(runtimeData);
  }
  files.sort((left, right) => (left.path < right.path ? -1 : (left.path > right.path ? 1 : 0)));
  return { ok: true, errors: [], files, content, manifest: prepared.manifest, bundleProvenance: prepared.bundleProvenance };
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
  buildRuntimeDataFile,
  RUNTIME_DATA_PATH,
  renderCodexPluginManifest,
  publicPluginManifestFiles,
  preparePublicPlugin,
  compilePublicPluginTree,
};
