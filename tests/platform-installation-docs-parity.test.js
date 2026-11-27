'use strict';

// Documentation parity and lifecycle-contract alignment test (#1589).
// Verifies that English and Traditional Chinese installation & migration guides,
// plus harness-setup references, stay synchronized and accurately reflect the
// Spec #1580 contracts (ADR-0038, ADR-0042, #1582-#1588).

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.resolve(__dirname, '..');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function readDoc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function extractAnchorIds(markdown) {
  const ids = new Set();
  for (const match of markdown.matchAll(/<a\s+id=["']([^"']+)["']\s*><\/a>/gi)) {
    ids.add(match[1]);
  }
  return ids;
}

function extractMatrixRows(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sectionRe = new RegExp(`^##\\s+${escaped}\\s*$`, 'm');
  const start = sectionRe.exec(markdown);
  if (!start) return [];
  const rest = markdown.slice(start.index + start[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const lines = section.split(/\r?\n/);
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!line.startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    if (/^\|[\s-:|]+\|$/.test(line)) continue;
    rows.push(line);
  }
  // Exclude header row
  return rows.length > 0 ? rows.slice(1) : [];
}

function assertLocalLinksResolve(relPath, markdown) {
  const dir = path.dirname(path.join(ROOT, relPath));
  const stripped = markdown.replace(/```[\s\S]*?```/g, '');
  const broken = [];
  for (const match of stripped.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    const rawTarget = match[1];
    if (/^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
    const [filePart, anchorPart] = rawTarget.split('#');
    if (!filePart) continue;
    const resolved = path.resolve(dir, filePart);
    if (!fs.existsSync(resolved)) {
      broken.push(`${rawTarget} -> missing ${path.relative(ROOT, resolved)}`);
      continue;
    }
    if (anchorPart && resolved.endsWith('.md')) {
      const targetText = fs.readFileSync(resolved, 'utf8');
      const ids = extractAnchorIds(targetText);
      const headingSlugs = new Set(
        [...targetText.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
          m[1]
            .trim()
            .toLowerCase()
            .replace(/[`*_~]/g, '')
            .replace(/[^\p{L}\p{N}\s-]/gu, '')
            .replace(/\s+/g, '-')),
      );
      if (!ids.has(anchorPart) && !headingSlugs.has(anchorPart.toLowerCase())) {
        broken.push(`${rawTarget} -> missing anchor #${anchorPart}`);
      }
    }
  }
  assert.deepStrictEqual(broken, [], `${relPath} has broken local links:\n${broken.join('\n')}`);
}

const REQUIRED_SSOT_ANCHORS = [
  'surface-matrix',
  'cross-host-installation-matrix',
  'dhpk-installer-root-contract',
  'unified-lifecycle-cli',
  'dhpk-install-status',
  'plan-json-boundary-remediation',
  'claude-asset-installer',
  'install-history',
  'duplicate-discovery-diagnostics',
  'cross-version-release-rehearsal',
];

const REQUIRED_SSOT_CONTRACTS = [
  ['DHPK_INSTALLER_ROOT', /DHPK_INSTALLER_ROOT/],
  ['ADR-0038 explicit non-use of CLAUDE_PLUGIN_ROOT for Codex/Cursor installer data', /CLAUDE_PLUGIN_ROOT/],
  ['ADR-0042 Codex direct .agents/skills discovery', /0042-codex-direct-shared-projection-discovery\.md/],
  ['COMPATIBILITY_PROJECTION_STALE', /COMPATIBILITY_PROJECTION_STALE/],
  ['dhpk-install status --all', /dhpk-install status --all/],
  ['--strict', /--strict/],
  ['--offline', /--offline/],
  ['bare codex rejection exit 64', /codex.*64|64.*codex/i],
  ['VERSION_DRIFT and SOURCE_MISMATCH', /VERSION_DRIFT[\s\S]*SOURCE_MISMATCH|SOURCE_MISMATCH[\s\S]*VERSION_DRIFT/],
  ['dhpk.install-status.v1', /dhpk\.install-status\.v1/],
  ['structured --plan --json boundary remediation', /CHANGES_PENDING/],
  ['0.69.x transition version', /0\.69\.x/],
  ['0.74.x transition version', /0\.74\.x/],
  ['standalone Asset Receipt', /\.dhpk-asset-receipt\.json/],
  ['dhpk.asset-receipt.v1', /dhpk\.asset-receipt\.v1/],
  ['dhpk.asset-plan.v1', /dhpk\.asset-plan\.v1/],
  ['timestamped backup directory', /\.dhpk-asset-backups/],
  ['dual-layer Duplicate Discovery CLI', /check-duplicate-discovery\.js/],
  ['dhpk.duplicate-discovery.v1', /dhpk\.duplicate-discovery\.v1/],
  ['Install History JSONL schema', /dhpk\.install-history\.v1/],
  ['DHPK_INSTALL_HISTORY_FILE', /DHPK_INSTALL_HISTORY_FILE/],
  ['DHPK_NO_INSTALL_HISTORY', /DHPK_NO_INSTALL_HISTORY/],
  ['install-history.jsonl XDG default', /install-history\.jsonl/],
  ['release-rehearsal CLI', /release-rehearsal\.js/],
  ['dhpk.release-rehearsal.v1', /dhpk\.release-rehearsal\.v1/],
];

test('EN and zh-TW platform-installation SSOT share matrix rows, anchors, pins, and contracts', () => {
  const en = readDoc('docs/platform-installation.md');
  const zh = readDoc('docs/platform-installation.zh-TW.md');

  assertLocalLinksResolve('docs/platform-installation.md', en);
  assertLocalLinksResolve('docs/platform-installation.zh-TW.md', zh);

  const enSurfaceRows = extractMatrixRows(en, 'Surface matrix');
  const zhSurfaceRows = extractMatrixRows(zh, 'Surface matrix');
  assert.strictEqual(enSurfaceRows.length, 12, 'EN Surface matrix should cover all 12 rows including dhpk-lite');
  assert.strictEqual(zhSurfaceRows.length, enSurfaceRows.length, 'zh-TW Surface matrix row count must match EN');

  const enHostRows = extractMatrixRows(en, 'Cross-Host installation and verification matrix');
  const zhHostRows = extractMatrixRows(zh, 'Cross-Host installation and verification matrix');
  assert.ok(enHostRows.length >= 8, 'EN cross-Host matrix should cover all Host entrypoints');
  assert.strictEqual(zhHostRows.length, enHostRows.length, 'zh-TW cross-Host matrix row count must match EN');

  const enAnchors = extractAnchorIds(en);
  const zhAnchors = extractAnchorIds(zh);
  for (const anchor of REQUIRED_SSOT_ANCHORS) {
    assert.ok(enAnchors.has(anchor), `EN platform-installation.md missing <a id="${anchor}"></a>`);
    assert.ok(zhAnchors.has(anchor), `zh-TW platform-installation.zh-TW.md missing <a id="${anchor}"></a>`);
  }

  for (const [label, pattern] of REQUIRED_SSOT_CONTRACTS) {
    assert.match(en, pattern, `EN platform-installation.md missing ${label}`);
    assert.match(zh, pattern, `zh-TW platform-installation.zh-TW.md missing ${label}`);
  }

  const expectedAgyPin = `bin/dhpk distribution build agy-plugin --version=${PKG_VERSION} --json`;
  assert.ok(en.includes(expectedAgyPin), `EN missing AGY generator pin ${expectedAgyPin}`);
  assert.ok(zh.includes(expectedAgyPin), `zh-TW missing AGY generator pin ${expectedAgyPin}`);
});

test('EN and zh-TW skill-platform-migration guides align with platform-installation SSOT and 1580 contracts', () => {
  const en = readDoc('docs/skill-platform-migration.md');
  const zh = readDoc('docs/skill-platform-migration.zh-TW.md');

  assertLocalLinksResolve('docs/skill-platform-migration.md', en);
  assertLocalLinksResolve('docs/skill-platform-migration.zh-TW.md', zh);

  for (const [label, pattern] of [
    ['SSOT link', /platform-installation(?:\.zh-TW)?\.md/],
    ['DHPK_INSTALLER_ROOT', /DHPK_INSTALLER_ROOT/],
    ['ADR-0042 direct .agents/skills discovery', /\.agents\/skills/],
    ['dhpk-install status', /dhpk-install status/],
    ['--plan --json', /--plan --json/],
    ['Asset Receipt', /\.dhpk-asset-receipt\.json/],
    ['Install History env var', /DHPK_INSTALL_HISTORY_FILE/],
    ['Duplicate Discovery check', /check-duplicate-discovery\.js/],
    ['Release rehearsal', /release-rehearsal\.js/],
  ]) {
    assert.match(en, pattern, `EN skill-platform-migration.md missing ${label}`);
    assert.match(zh, pattern, `zh-TW skill-platform-migration.zh-TW.md missing ${label}`);
  }
});

test('harness-setup references align with Asset Receipt, DHPK_INSTALLER_ROOT, ADR-0042, and SSOT', () => {
  const claude = readDoc('skills/harness-setup/references/claude-setup.md');
  const codex = readDoc('skills/harness-setup/references/codex-setup.md');
  const manual = readDoc('skills/harness-setup/references/manual-procedure.md');

  assert.match(claude, /\.dhpk-asset-receipt\.json/);
  assert.match(claude, /\.dhpk-asset-backups/);
  assert.match(claude, /DHPK_INSTALLER_ROOT/);
  assert.match(claude, /https:\/\/github\.com\/hmj1026\/dhpk\/blob\/main\/docs\/platform-installation\.md/);
  assert.doesNotMatch(claude, /differing files are conflicts unless the operator explicitly supplied `--force`/);

  assert.match(codex, /DHPK_INSTALLER_ROOT/);
  assert.match(codex, /CLAUDE_PLUGIN_ROOT/);
  assert.match(codex, /\.agents\/skills/);
  assert.match(codex, /https:\/\/github\.com\/hmj1026\/dhpk\/blob\/main\/docs\/platform-installation\.md/);

  assert.match(manual, /\.dhpk-asset-receipt\.json/);
  assert.match(manual, /\.dhpk-asset-backups/);
});

run('platform-installation-docs-parity');
