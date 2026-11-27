'use strict';

// Dual-layer Duplicate Discovery for Codex and Claude (#1583).
// The baseline is a filesystem, receipt, and enabled-plugin scan. The live
// layer is whatever the Host CLI just printed. Neither verdict is copied
// onto the other: an offline or unreachable Host stays NOT_RUN or
// UNAVAILABLE even when the baseline is PASS.

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'dhpk.duplicate-discovery.v1';
const RECEIPT_LIMIT_BYTES = 1024 * 1024;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROBE_ARGS = Object.freeze({
  codex: Object.freeze(['debug', 'prompt-input']),
  claude: Object.freeze(['plugin', 'list', '--json']),
});

function familyOf(id) {
  if (id === 'dhpk@dhpk') return 'full';
  if (id === 'dhpk-lite' || (typeof id === 'string' && id.startsWith('dhpk-lite@'))) return 'lite';
  return null;
}

function readJsonCapped(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (_) {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > RECEIPT_LIMIT_BYTES) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function addName(names, value) {
  if (typeof value === 'string' && SKILL_NAME.test(value)) names.add(value);
}

function addRelativeSkill(names, relative) {
  if (typeof relative !== 'string' || relative.includes('..')) return;
  const parts = relative.split('/');
  if (parts[parts.length - 1] === 'SKILL.md' && parts.length >= 2) addName(names, parts[parts.length - 2]);
  else if (parts[0] === 'skills') addName(names, parts[1]);
}

function namesFromReceipt(document) {
  const names = new Set();
  if (!document || typeof document !== 'object' || Array.isArray(document)) return names;
  const skills = document.managed_entries && document.managed_entries.skills;
  if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
    for (const [name, entry] of Object.entries(skills)) {
      addName(names, name);
      if (entry && typeof entry === 'object') addRelativeSkill(names, entry.destination);
    }
  }
  if (Array.isArray(document.entries)) {
    for (const entry of document.entries) {
      if (!entry || typeof entry !== 'object') continue;
      addName(names, entry.name);
      addName(names, entry.id);
      addName(names, entry.stableId);
    }
  }
  if (Array.isArray(document.managedPaths)) {
    for (const relative of document.managedPaths) addRelativeSkill(names, relative);
  }
  if (Array.isArray(document.selectedIds)) {
    for (const id of document.selectedIds) addName(names, id);
  }
  return names;
}

function receiptNames(file) {
  return namesFromReceipt(readJsonCapped(file));
}

function unionNames(files) {
  const names = new Set();
  for (const file of files) {
    for (const name of receiptNames(file)) names.add(name);
  }
  return names;
}

function ownershipClass(name, { plugin, receiptNames: owned, inventoryNames }) {
  if (plugin) return 'plugin';
  if (owned.has(name)) return 'receipt-owned';
  if (!inventoryNames.has(name)) return 'third-party';
  return 'unmanaged';
}

function skillEntries(rootDir, { scope, discoverySource, plugin, pluginId, owned, inventoryNames }) {
  let names;
  try {
    names = fs.readdirSync(rootDir);
  } catch (_) {
    return [];
  }
  const entries = [];
  for (const name of names) {
    if (!SKILL_NAME.test(name)) continue;
    const skillDir = path.join(rootDir, name);
    let dirStat;
    try {
      dirStat = fs.lstatSync(skillDir);
    } catch (_) {
      continue;
    }
    if (!dirStat.isDirectory() && !dirStat.isSymbolicLink()) continue;
    let fileStat;
    try {
      fileStat = fs.lstatSync(path.join(skillDir, 'SKILL.md'));
    } catch (_) {
      continue;
    }
    if (!fileStat.isFile() && !fileStat.isSymbolicLink()) continue;
    entries.push({
      skillIdentity: name,
      path: skillDir,
      scope,
      discoverySource,
      ownershipClass: ownershipClass(name, { plugin, receiptNames: owned, inventoryNames }),
      pluginId: pluginId || null,
    });
  }
  return entries;
}

function appliesToProject(record, projectRoot) {
  const scope = record.scope || 'user';
  if (scope === 'user' || scope === 'managed') return true;
  if (scope !== 'project' && scope !== 'local') return false;
  if (typeof record.projectPath !== 'string' || !path.isAbsolute(record.projectPath)) return false;
  const root = path.resolve(record.projectPath);
  const project = path.resolve(projectRoot);
  const relative = path.relative(root, project);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function enabledFlag(id, maps) {
  let value;
  for (const map of maps) {
    if (map && Object.prototype.hasOwnProperty.call(map, id) && typeof map[id] === 'boolean') value = map[id];
  }
  return value;
}

function enabledMap(file) {
  const document = readJsonCapped(file);
  if (!document || !document.enabledPlugins || typeof document.enabledPlugins !== 'object' || Array.isArray(document.enabledPlugins)) {
    return null;
  }
  return document.enabledPlugins;
}

function claudePluginRoots(home, projectRoot) {
  const document = readJsonCapped(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  if (!document || !document.plugins || typeof document.plugins !== 'object' || Array.isArray(document.plugins)) return [];
  const maps = [
    enabledMap(path.join(home, '.claude', 'settings.json')),
    enabledMap(path.join(projectRoot, '.claude', 'settings.json')),
    enabledMap(path.join(projectRoot, '.claude', 'settings.local.json')),
  ];
  const roots = [];
  for (const [id, records] of Object.entries(document.plugins)) {
    if (!familyOf(id)) continue;
    const explicit = enabledFlag(id, maps);
    for (const record of Array.isArray(records) ? records : [records]) {
      if (!record || typeof record !== 'object' || !appliesToProject(record, projectRoot)) continue;
      const enabled = explicit !== undefined ? explicit : (typeof record.enabled === 'boolean' ? record.enabled : true);
      if (!enabled || typeof record.installPath !== 'string' || !path.isAbsolute(record.installPath)) continue;
      const scope = record.scope === 'project' || record.scope === 'local' ? 'project' : 'user';
      roots.push({ pluginId: id, installPath: path.resolve(record.installPath), scope });
    }
  }
  return roots;
}

function codexPluginRoots(codexHome) {
  const document = readJsonCapped(path.join(codexHome, 'plugins', 'installed_plugins.json'));
  if (!document || !Array.isArray(document.installed)) return [];
  const roots = [];
  for (const record of document.installed) {
    if (!record || record.pluginId !== 'dhpk@dhpk' || record.enabled === false) continue;
    if (typeof record.installPath !== 'string' || !path.isAbsolute(record.installPath)) continue;
    const scope = record.scope === 'project' || record.scope === 'local' ? 'project' : 'user';
    roots.push({ pluginId: record.pluginId, installPath: path.resolve(record.installPath), scope });
  }
  return roots;
}

function addEntries(entries, seen, batch) {
  for (const entry of batch) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    entries.push(entry);
  }
}

function scanRoots(entries, seen, roots, options) {
  for (const root of roots) addEntries(entries, seen, skillEntries(root.dir, { ...options, ...root }));
}

function scanHost({ host, projectRoot, home, codexHome, inventoryNames }) {
  const entries = [];
  const seen = new Set();
  const projectAgents = unionNames([
    path.join(projectRoot, '.agents', '.dhpk-installed.json'),
    path.join(projectRoot, '.agents', 'skills', '.dhpk-projection.json'),
  ]);
  const userAgents = unionNames([
    path.join(home, '.agents', '.dhpk-installed.json'),
    path.join(home, '.agents', 'skills', '.dhpk-projection.json'),
  ]);
  if (host === 'codex') {
    scanRoots(entries, seen, [
      { dir: path.join(projectRoot, '.agents', 'skills'), scope: 'project', discoverySource: 'shared-projection', owned: projectAgents },
      { dir: path.join(projectRoot, '.codex', 'skills'), scope: 'project', discoverySource: 'codex-project-skills', owned: receiptNames(path.join(projectRoot, '.codex', '.dhpk-installed.json')) },
      { dir: path.join(codexHome, 'skills'), scope: 'user', discoverySource: 'codex-user-skills', owned: receiptNames(path.join(codexHome, '.dhpk-installed.json')) },
      { dir: path.join(home, '.agents', 'skills'), scope: 'user', discoverySource: 'user-agents-skills', owned: userAgents },
    ], { plugin: false, pluginId: null, inventoryNames });
    for (const plugin of codexPluginRoots(codexHome)) {
      addEntries(entries, seen, skillEntries(path.join(plugin.installPath, 'skills'), {
        scope: plugin.scope,
        discoverySource: 'plugin',
        plugin: true,
        pluginId: plugin.pluginId,
        owned: new Set(),
        inventoryNames,
      }));
    }
  } else {
    const claudeProject = new Set([
      ...projectAgents,
      ...receiptNames(path.join(projectRoot, '.claude', '.dhpk-installed.json')),
    ]);
    const claudeUser = new Set([
      ...receiptNames(path.join(home, '.claude', '.dhpk-installed.json')),
      ...userAgents,
    ]);
    scanRoots(entries, seen, [
      { dir: path.join(projectRoot, '.claude', 'skills'), scope: 'project', discoverySource: 'claude-project-skills', owned: claudeProject },
      { dir: path.join(projectRoot, '.agents', 'skills'), scope: 'project', discoverySource: 'shared-projection', owned: projectAgents },
      { dir: path.join(projectRoot, '.agents', 'claude-skills'), scope: 'project', discoverySource: 'claude-managed-skills', owned: claudeProject },
      { dir: path.join(home, '.claude', 'skills'), scope: 'user', discoverySource: 'claude-user-skills', owned: claudeUser },
      { dir: path.join(home, '.agents', 'skills'), scope: 'user', discoverySource: 'user-agents-skills', owned: userAgents },
    ], { plugin: false, pluginId: null, inventoryNames });
    for (const plugin of claudePluginRoots(home, projectRoot)) {
      addEntries(entries, seen, skillEntries(path.join(plugin.installPath, 'skills'), {
        scope: plugin.scope,
        discoverySource: 'plugin',
        plugin: true,
        pluginId: plugin.pluginId,
        owned: new Set(),
        inventoryNames,
      }));
    }
  }
  return baselineFrom(entries);
}

function publicEntry(entry) {
  return {
    path: entry.path,
    scope: entry.scope,
    discoverySource: entry.discoverySource,
    ownershipClass: entry.ownershipClass,
    pluginId: entry.pluginId,
  };
}

function baselineFrom(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.skillIdentity) || [];
    group.push(entry);
    groups.set(entry.skillIdentity, group);
  }
  const duplicates = [];
  const preserved = [];
  for (const skillIdentity of [...groups.keys()].sort()) {
    const grouped = groups.get(skillIdentity).slice().sort((left, right) => left.path.localeCompare(right.path));
    if (grouped.length > 1) {
      duplicates.push({ skillIdentity, entries: grouped.map(publicEntry) });
    } else if (grouped[0].ownershipClass === 'third-party') {
      preserved.push({ skillIdentity, ...publicEntry(grouped[0]) });
    }
  }
  return {
    verdict: duplicates.length > 0 ? 'DUPLICATE' : 'PASS',
    duplicates,
    preserved,
  };
}

function collectStrings(value, out, depth) {
  if (depth > 8 || out.length > 32) return;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out, depth + 1);
  }
}

function parseCodexSkillListing(stdout) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || ''));
  } catch (_) {
    return { ok: false, reason: 'host-cli-unparseable' };
  }
  const texts = [];
  collectStrings(payload, texts, 0);
  const block = texts.find((text) => text.includes('<skills_instructions>') && text.includes('### Skill roots'));
  if (!block) return { ok: false, reason: 'host-cli-unparseable' };
  const roots = new Map();
  for (const match of block.matchAll(/^- `(r\d+)` = `([^`]+)`/gm)) roots.set(match[1], match[2]);
  const skills = [];
  for (const match of block.matchAll(/^- ([^:\n]+):.*\(file: (r\d+)\/(\S+?)\)\s*$/gm)) {
    const root = roots.get(match[2]);
    if (!root) continue;
    const relative = match[3].replace(/\/SKILL\.md$/, '');
    skills.push({ name: match[1].trim(), path: path.resolve(root, relative) });
  }
  return { ok: true, skills };
}

function listedPluginRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (Array.isArray(payload.plugins)) return payload.plugins;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.installed)) return payload.installed;
  return null;
}

function parseClaudePluginListing(stdout) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || ''));
  } catch (_) {
    return { ok: false, reason: 'host-cli-unparseable' };
  }
  const records = listedPluginRecords(payload);
  if (!records) return { ok: false, reason: 'host-cli-unparseable' };
  const enabled = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, reason: 'host-cli-unparseable' };
    if (!familyOf(record.id) || record.enabled !== true) continue;
    enabled.push(record);
  }
  return { ok: true, enabled };
}

function codexLiveDuplicates(skills) {
  const pathsByName = new Map();
  for (const skill of skills) {
    if (!SKILL_NAME.test(skill.name)) continue;
    const paths = pathsByName.get(skill.name) || new Set();
    paths.add(skill.path);
    pathsByName.set(skill.name, paths);
  }
  const duplicates = [];
  for (const skillIdentity of [...pathsByName.keys()].sort()) {
    const paths = pathsByName.get(skillIdentity);
    if (paths.size < 2) continue;
    duplicates.push({
      skillIdentity,
      entries: [...paths].sort().map((skillPath) => ({
        path: skillPath,
        scope: null,
        discoverySource: 'host-skill-list',
        ownershipClass: null,
        pluginId: null,
      })),
    });
  }
  return duplicates;
}

function claudeLiveDuplicates(records) {
  const families = new Set(records.map((record) => familyOf(record.id)));
  if (!families.has('full') || !families.has('lite')) return [];
  return [{
    skillIdentity: 'dhpk',
    entries: records.map((record) => ({
      path: typeof record.installPath === 'string' ? record.installPath : null,
      scope: record.scope === 'project' || record.scope === 'local' ? 'project' : 'user',
      discoverySource: 'host-plugin-list',
      ownershipClass: 'plugin',
      pluginId: record.id,
    })).sort((left, right) => String(left.pluginId).localeCompare(String(right.pluginId))),
  }];
}

function probeView(probe) {
  return {
    command: probe.command,
    args: PROBE_ARGS[probe.host] || [],
    exitCode: probe.exitCode,
    signal: probe.signal,
    timedOut: Boolean(probe.timedOut),
    durationMs: probe.durationMs,
    stdoutTail: probe.stdoutTail,
    stderrTail: probe.stderrTail,
  };
}

function liveLayer(host, { offline, probes }) {
  if (offline) return { verdict: 'NOT_RUN', reason: 'offline', duplicates: [], probe: null };
  const probe = probes && probes[host];
  if (!probe) return { verdict: 'UNAVAILABLE', reason: 'host-cli-missing', duplicates: [], probe: null };
  const view = probeView({ ...probe, host });
  if (probe.errorCode === 'ENOENT') return { verdict: 'UNAVAILABLE', reason: 'host-cli-missing', duplicates: [], probe: view };
  if (probe.timedOut) return { verdict: 'UNAVAILABLE', reason: 'host-cli-timeout', duplicates: [], probe: view };
  if (probe.outputLimited || probe.errorCode || probe.exitCode !== 0) {
    return { verdict: 'UNAVAILABLE', reason: 'host-cli-failed', duplicates: [], probe: view };
  }
  const parsed = host === 'codex' ? parseCodexSkillListing(probe.stdout) : parseClaudePluginListing(probe.stdout);
  if (!parsed.ok) return { verdict: 'UNAVAILABLE', reason: parsed.reason, duplicates: [], probe: view };
  const duplicates = host === 'codex' ? codexLiveDuplicates(parsed.skills) : claudeLiveDuplicates(parsed.enabled);
  return {
    verdict: duplicates.length > 0 ? 'DUPLICATE' : 'PASS',
    reason: null,
    duplicates,
    probe: view,
  };
}

function createDuplicateDiscoveryReport({
  projectRoot,
  home,
  codexHome,
  hosts,
  offline,
  inventoryNames,
  probes,
}) {
  const reportHosts = {};
  for (const host of hosts) {
    reportHosts[host] = {
      baseline: scanHost({ host, projectRoot, home, codexHome, inventoryNames }),
      live: liveLayer(host, { offline, probes }),
    };
  }
  return {
    schema: SCHEMA,
    projectRoot,
    home,
    codexHome,
    offline: Boolean(offline),
    hosts: reportHosts,
  };
}

function reportExitCode(report) {
  for (const host of Object.values(report.hosts)) {
    if (host.baseline.verdict === 'DUPLICATE' || host.live.verdict === 'DUPLICATE') return 1;
  }
  return 0;
}

module.exports = {
  SCHEMA,
  createDuplicateDiscoveryReport,
  parseClaudePluginListing,
  parseCodexSkillListing,
  reportExitCode,
};
