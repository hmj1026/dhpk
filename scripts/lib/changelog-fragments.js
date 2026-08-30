'use strict';

// Release-note fragment schema (openspec/changes/harden-dhpk-release-contracts):
//   changelog.d/<category>.<slug>.md   user-visible change; content is
//                                      "scope: <token>\nnote: <text>\n"
//   changelog.d/<slug>.none            internal-only change; no fragment needed
//   changelog.d/TEMPLATE.md            contributor template, never validated
//
// Fragments are promoted (write mode) into CHANGELOG.md's existing
// "## X.Y.Z — YYYY-MM-DD — summary" + bullet format and deleted so nothing
// selected for a release remains pending afterward.

const fs = require('fs');
const path = require('path');

const CATEGORIES = ['feat', 'fix', 'refactor', 'docs', 'test', 'chore', 'perf', 'ci', 'BREAKING'];

// Render order: breaking changes and features lead, chores/ci trail.
const CATEGORY_RANK = ['BREAKING', 'feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'chore', 'ci'];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRAGMENT_NAME_PATTERN = /^([^.]+)\.([^.]+(?:-[^.]+)*)\.md$/;
const IGNORED_NAMES = new Set(['TEMPLATE.md', '.gitkeep']);

function parseFragmentFile(dir, name) {
  const match = FRAGMENT_NAME_PATTERN.exec(name);
  const raw = fs.readFileSync(path.join(dir, name), 'utf8');
  const scopeMatch = /^scope:[ \t]*(.*)$/m.exec(raw);
  const noteMatch = /^note:[ \t]*([\s\S]*)$/m.exec(raw);
  return {
    file: name,
    category: match ? match[1] : null,
    slug: match ? match[2] : name.replace(/\.md$/, ''),
    scope: scopeMatch ? scopeMatch[1].trim() : '',
    note: noteMatch ? noteMatch[1].trim() : '',
  };
}

function readFragments(dir) {
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const fragments = [];
  const markers = [];
  for (const name of entries.sort()) {
    if (IGNORED_NAMES.has(name)) continue;
    if (name.endsWith('.none')) {
      markers.push(name.slice(0, -'.none'.length));
    } else if (name.endsWith('.md')) {
      fragments.push(parseFragmentFile(dir, name));
    }
  }
  return { fragments, markers };
}

function validateFragments(fragments, markers = []) {
  const errors = [];
  const seenSlugs = new Map();

  for (const frag of fragments) {
    if (!frag.category || !CATEGORIES.includes(frag.category)) {
      errors.push(`${frag.file}: invalid category '${frag.category}' (expected one of ${CATEGORIES.join(', ')})`);
    }
    if (!SLUG_PATTERN.test(frag.slug)) {
      errors.push(`${frag.file}: slug '${frag.slug}' must be kebab-case (${SLUG_PATTERN})`);
    }
    if (!frag.scope) {
      errors.push(`${frag.file}: missing or empty 'scope:' line`);
    }
    if (!frag.note) {
      errors.push(`${frag.file}: missing or empty 'note:' line`);
    }
    if (seenSlugs.has(frag.slug)) {
      errors.push(`duplicate slug '${frag.slug}': ${seenSlugs.get(frag.slug)} and ${frag.file}`);
    } else {
      seenSlugs.set(frag.slug, frag.file);
    }
  }

  for (const slug of markers) {
    if (seenSlugs.has(slug)) {
      errors.push(`duplicate slug '${slug}': ${seenSlugs.get(slug)} and ${slug}.none`);
    } else {
      seenSlugs.set(slug, `${slug}.none`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function sortFragments(fragments) {
  return [...fragments].sort((a, b) => {
    const rankDiff = CATEGORY_RANK.indexOf(a.category) - CATEGORY_RANK.indexOf(b.category);
    if (rankDiff !== 0) return rankDiff;
    return a.slug.localeCompare(b.slug);
  });
}

function renderSection({ version, date, summary, fragments }) {
  const headingSuffix = summary ? ` — ${summary}` : '';
  const lines = [`## ${version} — ${date}${headingSuffix}`, ''];

  if (fragments.length === 0) {
    lines.push('No user-visible changes in this release.', '');
    return lines.join('\n');
  }

  for (const frag of sortFragments(fragments)) {
    lines.push(`**${frag.category}(${frag.scope})** — ${frag.note}`);
  }
  lines.push('');
  return lines.join('\n');
}

function promote({ fragmentDir, changelogPath, version, date, summary }) {
  const { fragments, markers } = readFragments(fragmentDir);
  const validation = validateFragments(fragments, markers);
  if (!validation.ok) {
    throw new Error(`changelog-fragments: cannot promote invalid fragments:\n${validation.errors.join('\n')}`);
  }

  const section = renderSection({ version, date, summary, fragments });
  const original = fs.readFileSync(changelogPath, 'utf8');
  const unreleasedHeading = '## [Unreleased]';
  const idx = original.indexOf(unreleasedHeading);
  if (idx === -1) {
    throw new Error(`changelog-fragments: ${changelogPath} has no '${unreleasedHeading}' heading`);
  }
  const afterHeadingIdx = idx + unreleasedHeading.length;
  const rest = original.slice(afterHeadingIdx).replace(/^\n+/, '\n');
  const updated = `${original.slice(0, afterHeadingIdx)}\n\n${section}\n${rest.replace(/^\n/, '')}`;

  fs.writeFileSync(changelogPath, updated);

  const consumed = [];
  for (const frag of fragments) {
    fs.unlinkSync(path.join(fragmentDir, frag.file));
    consumed.push(frag.file);
  }
  for (const slug of markers) {
    fs.unlinkSync(path.join(fragmentDir, `${slug}.none`));
    consumed.push(`${slug}.none`);
  }

  return { consumed, section };
}

// Test-only diffs and a short list of routine repo-hygiene files are exempt
// from carrying a fragment or .none marker. Everything else (source,
// scripts, docs, workflows, manifests) is treated as potentially
// user-visible; false positives are resolved with a cheap .none marker
// rather than a smarter (and less testable) classifier.
const HYGIENE_FILES = new Set(['.gitignore', 'LICENSE', 'package-lock.json']);

function isInternalOnlyPath(filePath) {
  // A deleted .none marker is itself the record that the prior internal-only
  // change was already accounted for; requiring a second marker would make
  // marker cleanup impossible. Source/docs changes in the same diff remain
  // uncovered because only the marker path receives this exemption.
  return filePath.startsWith('tests/')
    || filePath.startsWith('changelog.d/') && filePath.endsWith('.none')
    || HYGIENE_FILES.has(filePath);
}

// `releaseSectionAdded` marks a release-PR-shaped diff (develop -> main): the
// release preparation already promoted every pending fragment into a new
// CHANGELOG.md "## X.Y.Z — ..." section and deleted it, so changelog.d/ is
// empty by construction. Coverage for those files was enforced on the feature
// PRs that introduced them; the promoted section is the standing evidence.
// Re-demanding a pending fragment here would make every release PR unmergeable.
function checkCoverage({ changedFiles, fragments, markers, releaseSectionAdded = false }) {
  const userVisible = changedFiles.filter((f) => !isInternalOnlyPath(f));
  if (userVisible.length === 0) {
    return { ok: true, uncovered: [] };
  }
  if (fragments.length > 0 || markers.length > 0) {
    return { ok: true, uncovered: [] };
  }
  if (releaseSectionAdded) {
    return { ok: true, uncovered: [] };
  }
  return { ok: false, uncovered: userVisible };
}

module.exports = {
  CATEGORIES,
  CATEGORY_RANK,
  readFragments,
  validateFragments,
  renderSection,
  promote,
  checkCoverage,
};
