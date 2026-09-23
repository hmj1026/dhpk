'use strict';

// Repository-only synchronizer for shared resources used by canonical Skills.
// The copy map and ledger are authoring metadata.  A consumer receives the
// resulting physical Skill files and never needs to run this module.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveSkillIdentity } = require('./distribution-inventory');
const { createTraversalBudget } = require('./bounded-filesystem');

const MAP_SCHEMA = 'dhpk.skill-resources.v1';
const LEDGER_SCHEMA = 'dhpk.skill-resource-copies.v1';
const INVENTORY_SCHEMA = 'dhpk.distribution-inventory.v2';
const MAP_RELATIVE = 'manifests/skill-resources.json';
const LEDGER_RELATIVE = 'manifests/skill-resource-copies.json';
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAP_KEYS = ['schema', 'skills'];
const LEDGER_KEYS = ['schema', 'files'];
const MAPPING_KEYS = ['source', 'destination'];
const LEDGER_ENTRY_KEYS = ['skill_id', 'source', 'sha256', 'mode'];
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MODE_PATTERN = /^[0-7]{4}$/;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(message) {
  throw new Error(`skill-resource-sync: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  const allowed = new Set(expected);
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) fail(`${label} has unsupported field '${key}'`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(`${label} requires field '${key}'`);
    }
  }
}

function normalizeRoot(root) {
  const candidate = path.resolve(root || process.cwd());
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    fail(`repository root is not accessible: ${candidate} (${error.message})`);
  }
  if (!stat.isDirectory()) fail(`repository root is not a directory: ${candidate}`);
  return candidate;
}

function statIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
}

function sameIdentity(left, right) {
  return Boolean(left && right)
    && String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino);
}

function statType(stat) {
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  if (stat.isSymbolicLink()) return 'symlink';
  return 'other';
}

function physicalRealpath(file) {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  return realpath.call(fs, file);
}

function captureRootPin(root) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`repository root must be a real directory: ${root}`);
  }
  return {
    path: root,
    identity: statIdentity(stat),
    realpath: physicalRealpath(root),
  };
}

function verifyRootPin(rootPin) {
  let stat;
  try {
    stat = fs.lstatSync(rootPin.path);
  } catch (error) {
    fail(`repository root changed: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()
    || !sameIdentity(stat, rootPin.identity)
    || physicalRealpath(rootPin.path) !== rootPin.realpath) {
    fail(`repository root changed: ${rootPin.path}`);
  }
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty relative path`);
  }
  if (value.includes('\0')) fail(`${label} contains NUL`);
  if (value.includes('\\')) fail(`${label} must use POSIX separators`);
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    fail(`${label} must be repository-relative`);
  }
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    fail(`${label} contains an unsafe path component: ${value}`);
  }
  if (path.posix.normalize(value) !== value) {
    fail(`${label} is not normalized: ${value}`);
  }
  return value;
}

function ignoredComponent(component) {
  return component === '__pycache__'
    || component.endsWith('.pyc')
    || component === 'node_modules'
    || component === '.git';
}

function rejectIgnored(relative, label) {
  if (relative.split('/').some(ignoredComponent)) {
    fail(`${label} uses a distribution-ignored component: ${relative}`);
  }
}

function safeRepositoryPath(relative, label) {
  const value = safeRelative(relative, label);
  rejectIgnored(value, label);
  return value;
}

function pathOverlaps(first, second) {
  return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`);
}

function absolutePath(root, relative) {
  const target = path.resolve(root, ...relative.split('/'));
  const rootWithSeparator = `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootWithSeparator)) {
    fail(`resolved path escapes repository root: ${relative}`);
  }
  return target;
}

function capturePathPin(root, relative, {
  rootPin = captureRootPin(root),
  allowMissing = false,
  label = relative || root,
} = {}) {
  verifyRootPin(rootPin);
  const components = [];
  let current = root;
  const parts = relative ? relative.split('/') : [];
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) {
        return {
          root: rootPin,
          relative,
          components,
          missingIndex: index,
          exists: false,
        };
      }
      if (error.code === 'ENOENT') fail(`${label} does not exist: ${relative}`);
      fail(`${label} cannot be inspected: ${error.message}`);
    }
    if (stat.isSymbolicLink()) fail(`${label} contains a symlink: ${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) {
      fail(`${label} parent is not a directory: ${relative}`);
    }
    components.push({
      path: current,
      identity: statIdentity(stat),
      type: statType(stat),
    });
  }
  return {
    root: rootPin,
    relative,
    components,
    missingIndex: null,
    exists: true,
  };
}

function verifyPathPin(root, pin, label = pin.relative || root, { allowMissing = false } = {}) {
  verifyRootPin(pin.root);
  for (const component of pin.components) {
    let stat;
    try {
      stat = fs.lstatSync(component.path);
    } catch (error) {
      fail(`${label} changed: ${error.message}`);
    }
    if (stat.isSymbolicLink()
      || statType(stat) !== component.type
      || !sameIdentity(stat, component.identity)) {
      fail(`${label} changed: ${pin.relative}`);
    }
  }
  if (pin.missingIndex !== null) {
    if (!allowMissing) fail(`${label} is missing: ${pin.relative}`);
    const current = path.join(pin.root.path, ...pin.relative.split('/').slice(0, pin.missingIndex + 1));
    try {
      fs.lstatSync(current);
      fail(`${label} changed: ${pin.relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT') fail(`${label} changed: ${error.message}`);
    }
  }
}

function assertNoSymlinkComponents(root, relative, label) {
  capturePathPin(root, relative, { allowMissing: true, label });
}

function pinIdentity(pin) {
  if (!pin || pin.components.length === 0) return null;
  return pin.components[pin.components.length - 1].identity;
}

function samePin(left, right) {
  if (!left || !right || left.relative !== right.relative || left.missingIndex !== right.missingIndex) return false;
  if (!sameIdentity(left.root.identity, right.root.identity) || left.root.realpath !== right.root.realpath) return false;
  if (left.components.length !== right.components.length) return false;
  return left.components.every((component, index) => {
    const other = right.components[index];
    return component.path === other.path
      && component.type === other.type
      && sameIdentity(component.identity, other.identity);
  });
}

function parentRelative(relative) {
  const parent = path.posix.dirname(relative);
  return parent === '.' ? '' : parent;
}

function modeString(mode) {
  return (mode & 0o777).toString(8).padStart(4, '0');
}

function digest(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function boundedRead(file, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') fail(`${label} does not exist: ${file}`);
    fail(`${label} cannot be inspected: ${error.message}`);
  }
  if (stat.isSymbolicLink()) fail(`${label} must not be a symlink: ${file}`);
  if (!stat.isFile()) fail(`${label} must be a regular file: ${file}`);
  if (stat.size > MAX_FILE_BYTES) fail(`${label} exceeds the bounded read limit: ${file}`);
  let bytes;
  try {
    const budget = createTraversalBudget({ maxBytes: MAX_FILE_BYTES, maxFiles: 1, maxEntries: 1 });
    bytes = budget.readFile(file, stat, label);
  } catch (error) {
    fail(`${label} cannot be read: ${error.message}`);
  }
  let finalStat;
  try {
    finalStat = fs.lstatSync(file);
  } catch (error) {
    fail(`${label} changed while reading: ${error.message}`);
  }
  if (finalStat.isSymbolicLink() || !finalStat.isFile()
    || !sameIdentity(stat, finalStat)
    || Number(finalStat.size) !== Number(stat.size)
    || modeString(finalStat.mode) !== modeString(stat.mode)) {
    fail(`${label} changed while reading: ${file}`);
  }
  return {
    bytes,
    mode: modeString(finalStat.mode),
    size: Number(finalStat.size),
    identity: statIdentity(finalStat),
  };
}

function readPinnedFile(root, relative, label, rootPin, pin = null) {
  const pathPin = pin || capturePathPin(root, relative, { rootPin, label });
  if (pathPin.missingIndex !== null) fail(`${label} does not exist: ${relative}`);
  verifyPathPin(root, pathPin, label);
  const file = absolutePath(root, relative);
  const content = boundedRead(file, label);
  verifyPathPin(root, pathPin, label);
  if (!sameIdentity(content.identity, pinIdentity(pathPin))) {
    fail(`${label} changed while reading: ${relative}`);
  }
  return { ...content, pin: pathPin };
}

function optionalFileState(root, relative, label, rootPin, pin = null) {
  const file = absolutePath(root, relative);
  const pathPin = pin || capturePathPin(root, relative, {
    rootPin,
    allowMissing: true,
    label,
  });
  if (pathPin.missingIndex !== null) return { state: null, pin: pathPin };
  const content = readPinnedFile(root, relative, label, rootPin, pathPin);
  return {
    state: {
      sha256: digest(content.bytes),
      mode: content.mode,
      size: content.size,
      identity: content.identity,
      pin: content.pin,
    },
    pin: content.pin,
  };
}

function readJson(root, relative, label, rootPin) {
  const snapshot = readPinnedFile(root, relative, label, rootPin);
  try {
    return { value: JSON.parse(snapshot.bytes.toString('utf8')), snapshot };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function loadInputs(root) {
  const rootPin = captureRootPin(root);
  const inventory = readJson(root, 'manifests/distribution-inventory.json', 'distribution inventory', rootPin);
  const map = readJson(root, MAP_RELATIVE, 'skill resource map', rootPin);
  const ledger = readJson(root, LEDGER_RELATIVE, 'skill resource ledger', rootPin);
  return {
    rootPin,
    inventory: inventory.value,
    map: map.value,
    ledger: ledger.value,
    metadataSnapshots: {
      inventory: inventory.snapshot,
      map: map.snapshot,
      ledger: ledger.snapshot,
    },
  };
}

function activeSkillRows(inventory) {
  if (!isPlainObject(inventory) || inventory.schema !== INVENTORY_SCHEMA) {
    fail(`inventory must use schema ${INVENTORY_SCHEMA}`);
  }
  if (!Array.isArray(inventory.skills)) fail('inventory.skills must be an array');
  const rows = new Map();
  for (const row of inventory.skills) {
    if (!isPlainObject(row) || typeof row.id !== 'string' || row.id.length === 0) {
      fail('inventory contains a skill without a stable ID');
    }
    if (rows.has(row.id)) fail(`inventory contains duplicate skill ID: ${row.id}`);
    if (typeof row.path !== 'string') fail(`inventory skill ${row.id} has no canonical path`);
    safeRepositoryPath(row.path, `inventory skill ${row.id} path`);
    rows.set(row.id, row);
  }
  return rows;
}

function assertStableInventoryId(inventory, rows, identifier, label) {
  if (typeof identifier !== 'string' || identifier.length === 0) {
    fail(`${label} must be a stable inventory ID`);
  }
  let resolution;
  try {
    resolution = resolveSkillIdentity({ inventory, identifier });
  } catch (error) {
    fail(`${label} cannot resolve inventory identity: ${error.message}`);
  }
  if (!resolution || resolution.state !== 'active' || resolution.stableId !== identifier || !rows.has(identifier)) {
    fail(`${label} must be an active stable inventory ID: ${identifier}`);
  }
  return rows.get(identifier);
}

function validateLedger({ root, rootPin, inventory, rows, ledger }) {
  exactKeys(ledger, LEDGER_KEYS, 'skill resource ledger');
  if (ledger.schema !== LEDGER_SCHEMA) fail(`skill resource ledger schema must be ${LEDGER_SCHEMA}`);
  if (!isPlainObject(ledger.files)) fail('skill resource ledger.files must be an object');

  const destinations = Object.keys(ledger.files).sort();
  for (const destination of destinations) {
    const label = `ledger file ${destination}`;
    safeRepositoryPath(destination, `${label} destination`);
    const entry = ledger.files[destination];
    exactKeys(entry, LEDGER_ENTRY_KEYS, label);
    const skill = assertStableInventoryId(inventory, rows, entry.skill_id, `${label}.skill_id`);
    safeRepositoryPath(entry.source, `${label}.source`);
    const skillPrefix = `${skill.path}/`;
    if (!destination.startsWith(skillPrefix)) {
      fail(`${label} destination is outside its Skill directory: ${destination}`);
    }
    rejectIgnored(entry.source, `${label}.source`);
    if (!HASH_PATTERN.test(entry.sha256)) fail(`${label}.sha256 must be a sha256-prefixed digest`);
    if (!MODE_PATTERN.test(entry.mode)) fail(`${label}.mode must contain four octal digits`);
    optionalFileState(root, destination, label, rootPin);
    const sourcePin = capturePathPin(root, entry.source, {
      rootPin,
      allowMissing: true,
      label: `${label}.source`,
    });
    if (sourcePin.missingIndex === null) {
      readPinnedFile(root, entry.source, `${label}.source`, rootPin, sourcePin);
    }
  }
  for (let index = 0; index < destinations.length; index += 1) {
    for (let next = index + 1; next < destinations.length; next += 1) {
      if (pathOverlaps(destinations[index], destinations[next])) {
        fail(`ledger destinations collide: ${destinations[index]} and ${destinations[next]}`);
      }
    }
  }
}

function validateMap({ root, rootPin, inventory, rows, map }) {
  exactKeys(map, MAP_KEYS, 'skill resource map');
  if (map.schema !== MAP_SCHEMA) fail(`skill resource map schema must be ${MAP_SCHEMA}`);
  if (!isPlainObject(map.skills)) fail('skill resource map.skills must be an object');

  const operations = [];
  const destinations = [];
  for (const skillId of Object.keys(map.skills).sort()) {
    const skill = assertStableInventoryId(inventory, rows, skillId, 'skill resource map key');
    const mappings = map.skills[skillId];
    if (!Array.isArray(mappings)) fail(`skill resource map entry ${skillId} must be an array`);
    for (let index = 0; index < mappings.length; index += 1) {
      const mappingLabel = `skill resource map ${skillId}[${index}]`;
      exactKeys(mappings[index], MAPPING_KEYS, mappingLabel);
      const source = safeRepositoryPath(mappings[index].source, `${mappingLabel}.source`);
      const destinationRelative = safeRelative(mappings[index].destination, `${mappingLabel}.destination`);
      rejectIgnored(destinationRelative, `${mappingLabel}.destination`);
      const destination = safeRepositoryPath(
        path.posix.join(skill.path, destinationRelative),
        `${mappingLabel}.destination`,
      );
      rejectIgnored(destination, `${mappingLabel}.destination`);
      if (destinations.some((existing) => pathOverlaps(existing, destination))) {
        fail(`skill resource destinations collide at ${destination}`);
      }
      destinations.push(destination);
      const sourceSnapshot = readPinnedFile(root, source, `${mappingLabel}.source`, rootPin);
      const destinationState = optionalFileState(root, destination, `${mappingLabel}.destination`, rootPin);
      operations.push({
        skillId,
        skillPath: skill.path,
        source,
        destination,
        sourceSnapshot,
        destinationState,
      });
    }
  }

  for (let index = 0; index < operations.length; index += 1) {
    for (let next = 0; next < operations.length; next += 1) {
      if (pathOverlaps(operations[index].source, operations[next].destination)) {
        fail(`source and destination paths overlap: ${operations[index].source} and ${operations[next].destination}`);
      }
    }
  }
  return operations;
}

function validateSkillResourceMap({ root, inventory, map, ledger } = {}) {
  const repository = normalizeRoot(root);
  const loaded = (inventory === undefined || map === undefined || ledger === undefined)
    ? loadInputs(repository)
    : null;
  const rootPin = loaded ? loaded.rootPin : captureRootPin(repository);
  const inputs = {
    inventory: inventory === undefined ? loaded.inventory : inventory,
    map: map === undefined ? loaded.map : map,
    ledger: ledger === undefined ? loaded.ledger : ledger,
  };
  const rows = activeSkillRows(inputs.inventory);
  validateLedger({ root: repository, rootPin, inventory: inputs.inventory, rows, ledger: inputs.ledger });
  const operations = validateMap({ root: repository, rootPin, inventory: inputs.inventory, rows, map: inputs.map });
  return {
    ok: true,
    changes: [],
    errors: [],
    root: repository,
    rootPin,
    inventory: inputs.inventory,
    map: inputs.map,
    ledger: inputs.ledger,
    rows,
    operations,
    metadataSnapshots: loaded ? loaded.metadataSnapshots : null,
  };
}

function ledgerRecord(operation, sourceState) {
  return {
    skill_id: operation.skillId,
    source: operation.source,
    sha256: sourceState.sha256,
    mode: sourceState.mode,
  };
}

function serializeLedger(files) {
  const sorted = {};
  for (const destination of Object.keys(files).sort()) sorted[destination] = files[destination];
  return `${JSON.stringify({ schema: LEDGER_SCHEMA, files: sorted }, null, 2)}\n`;
}

function sameRecord(left, right) {
  return Boolean(left && right
    && left.sha256 === right.sha256
    && left.mode === right.mode);
}

function sameState(left, right) {
  if (left === null || right === null) return left === right;
  return Boolean(left && right
    && left.sha256 === right.sha256
    && left.mode === right.mode
    && left.size === right.size
    && sameIdentity(left.identity, right.identity)
    && samePin(left.pin, right.pin));
}

function sameContentState(left, right) {
  return Boolean(left && right
    && left.sha256 === right.sha256
    && left.mode === right.mode
    && left.size === right.size);
}

function stateFromSnapshot(snapshot) {
  return {
    bytes: snapshot.bytes,
    sha256: digest(snapshot.bytes),
    mode: snapshot.mode,
    size: snapshot.size,
    identity: snapshot.identity,
    pin: snapshot.pin,
  };
}

function planSkillResourceSync(args = {}) {
  const validated = validateSkillResourceMap(args);
  const { root, rootPin, ledger, operations } = validated;
  const desiredRecords = {};
  const desiredByDestination = new Map();
  const sourceStates = new Map();
  for (const operation of operations) {
    const sourceSnapshot = readPinnedFile(
      root,
      operation.source,
      `resource source ${operation.source}`,
      rootPin,
      operation.sourceSnapshot.pin,
    );
    const sourceState = stateFromSnapshot(sourceSnapshot);
    const record = ledgerRecord(operation, {
      sha256: digest(sourceState.bytes),
      mode: sourceState.mode,
    });
    desiredRecords[operation.destination] = record;
    desiredByDestination.set(operation.destination, operation);
    sourceStates.set(operation.destination, {
      bytes: sourceState.bytes,
      sha256: record.sha256,
      mode: record.mode,
      size: sourceState.size,
      identity: sourceState.identity,
      pin: sourceState.pin,
    });
  }

  const changes = [];
  const errors = [];
  const observedTargets = {};
  const observedParentPins = {};
  for (const destination of Object.keys(desiredRecords).sort()) {
    const currentResult = optionalFileState(root, destination, `resource destination ${destination}`, rootPin);
    const current = currentResult.state;
    const recorded = ledger.files[destination];
    observedTargets[destination] = current;
    observedParentPins[destination] = capturePathPin(root, parentRelative(destination), {
      rootPin,
      allowMissing: true,
      label: `resource destination parent ${destination}`,
    });
    if (current && !recorded) {
      errors.push(`unowned destination would be overwritten: ${destination}`);
      continue;
    }
    if (current && recorded && !sameRecord(current, recorded)) {
      errors.push(`edited managed destination cannot be adopted: ${destination}`);
      continue;
    }
    if (!current) {
      changes.push({ type: 'copy', destination });
    } else if (!sameRecord(current, desiredRecords[destination])) {
      changes.push({ type: 'copy', destination });
    }
    if (JSON.stringify(recorded || null) !== JSON.stringify(desiredRecords[destination])) {
      changes.push({ type: 'ledger', destination });
    }
  }

  const orphanDestinations = Object.keys(ledger.files)
    .filter((destination) => !desiredByDestination.has(destination))
    .sort();
  for (const destination of orphanDestinations) {
    const currentResult = optionalFileState(root, destination, `orphan resource destination ${destination}`, rootPin);
    const current = currentResult.state;
    observedTargets[destination] = current;
    observedParentPins[destination] = capturePathPin(root, parentRelative(destination), {
      rootPin,
      allowMissing: true,
      label: `orphan resource destination parent ${destination}`,
    });
    const recorded = ledger.files[destination];
    if (current && !sameRecord(current, recorded)) {
      errors.push(`edited orphan cannot be removed: ${destination}`);
      continue;
    }
    changes.push({ type: 'orphan', destination });
  }

  const ledgerPath = absolutePath(root, LEDGER_RELATIVE);
  const ledgerSnapshot = validated.metadataSnapshots
    ? validated.metadataSnapshots.ledger
    : readPinnedFile(root, LEDGER_RELATIVE, 'skill resource ledger', rootPin);
  const ledgerState = stateFromSnapshot(ledgerSnapshot);
  const expectedLedger = serializeLedger(desiredRecords);
  if (ledgerState.bytes.toString('utf8') !== expectedLedger) {
    changes.push({ type: 'ledger', destination: LEDGER_RELATIVE });
  }

  return {
    ...validated,
    ok: errors.length === 0 && changes.length === 0,
    changes,
    errors: [...new Set(errors)].sort(),
    desiredRecords,
    desiredByDestination,
    sourceStates,
    orphanDestinations,
    observedTargets,
    observedParentPins,
    observedLedger: ledgerState,
    expectedLedger,
    ledgerPath,
  };
}

function checkSkillResources({ root } = {}) {
  return planSkillResourceSync({ root });
}

function reconcileCreatedParentPin(pin, ownedDirectories) {
  if (pin.missingIndex === null) return pin;
  const components = [...pin.components];
  const parts = pin.relative.split('/');
  let missingIndex = pin.missingIndex;
  while (missingIndex < parts.length) {
    const current = path.join(pin.root.path, ...parts.slice(0, missingIndex + 1));
    const owned = ownedDirectories.get(current);
    if (!owned) break;
    components.push(owned);
    missingIndex += 1;
  }
  const exists = missingIndex === parts.length;
  return { ...pin, components, missingIndex: exists ? null : missingIndex, exists };
}

function ensureDirectory(root, rootPin, relative, expectedPin, createdDirectories, ownedDirectories) {
  const safe = relative ? safeRepositoryPath(relative, 'destination parent') : '';
  if (expectedPin) verifyPathPin(root, expectedPin, `destination parent ${relative}`, { allowMissing: true });
  const originalComponents = new Map((expectedPin?.components || []).map((component) => [component.path, component]));
  const components = [];
  let current = root;
  if (!safe) return capturePathPin(root, '', { rootPin, label: 'destination parent' });
  for (const component of safe.split('/')) {
    current = path.join(current, component);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code !== 'ENOENT') fail(`destination parent cannot be inspected: ${error.message}`);
      if (originalComponents.has(current) || ownedDirectories.has(current)) {
        fail(`destination parent changed before creation: ${relative}`);
      }
      fs.mkdirSync(current, { mode: 0o755 });
      createdDirectories.push(current);
      stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        fail(`created destination parent is not a real directory: ${relative}`);
      }
      ownedDirectories.set(current, { path: current, identity: statIdentity(stat), type: 'directory' });
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(`destination parent is not a real directory: ${relative}`);
    }
    const expected = originalComponents.get(current) || ownedDirectories.get(current);
    if (!expected || !sameIdentity(stat, expected.identity)) {
      fail(`destination parent changed before creation: ${relative}`);
    }
    components.push(expected);
  }
  const parentPin = { root: rootPin, relative: safe, components, missingIndex: null, exists: true };
  verifyPathPin(root, parentPin, `destination parent ${relative}`);
  return parentPin;
}

function stagePath(stagingRoot, relative) {
  const safe = safeRepositoryPath(relative, 'staged path');
  const target = path.resolve(stagingRoot, ...safe.split('/'));
  const prefix = `${stagingRoot}${path.sep}`;
  if (!target.startsWith(prefix)) fail(`staged path escapes staging root: ${relative}`);
  return target;
}

function writeStageFile(stagingRoot, relative, bytes, mode) {
  const target = stagePath(stagingRoot, relative);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o755 });
  fs.writeFileSync(target, bytes, { mode: Number.parseInt(mode, 8), flag: 'wx' });
  fs.chmodSync(target, Number.parseInt(mode, 8));
}

function listStageFiles(stagingRoot, stageRootPin) {
  verifyRootPin(stageRootPin);
  const files = [];
  function visit(directory, relative) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) fail(`staging contains a symlink: ${child}`);
      if (stat.isDirectory()) visit(absolute, child);
      else if (stat.isFile()) files.push(child);
      else fail(`staging contains a non-regular file: ${child}`);
    }
  }
  visit(stagingRoot, '');
  return files.sort();
}

function verifyStage({ stagingRoot, stageRootPin, operations, sourceStates, expectedLedger }) {
  const expectedFiles = new Set([LEDGER_RELATIVE, ...operations.map((operation) => operation.destination)]);
  const actualFiles = listStageFiles(stagingRoot, stageRootPin);
  if (actualFiles.length !== expectedFiles.size || actualFiles.some((file) => !expectedFiles.has(file))) {
    fail('staging contains an unexpected or missing resource file');
  }
  const states = new Map();
  for (const operation of operations) {
    const relative = operation.destination;
    const state = stateFromSnapshot(readPinnedFile(
      stagingRoot,
      relative,
      `staged resource ${relative}`,
      stageRootPin,
    ));
    const expected = sourceStates.get(relative);
    if (!sameContentState(state, expected)) {
      fail(`staged resource changed after source verification: ${relative}`);
    }
    states.set(relative, state);
  }
  const ledger = stateFromSnapshot(readPinnedFile(
    stagingRoot,
    LEDGER_RELATIVE,
    'staged resource ledger',
    stageRootPin,
  ));
  if (ledger.mode !== '0644' || ledger.bytes.toString('utf8') !== expectedLedger) {
    fail('staged resource ledger changed after verification');
  }
  states.set(LEDGER_RELATIVE, ledger);
  return { stageRootPin, states };
}

function verifySources({ root, operations, sourceStates }) {
  for (const operation of operations) {
    const expected = sourceStates.get(operation.destination);
    const source = stateFromSnapshot(readPinnedFile(
      root,
      operation.source,
      `resource source ${operation.source}`,
      expected.pin.root,
      expected.pin,
    ));
    if (!sameState(source, expected)) {
      fail(`resource source changed after staging: ${operation.source}`);
    }
  }
}

function verifyMetadataSnapshots({
  root,
  rootPin,
  metadataSnapshots,
  expectedLedger = null,
  verifyLedger = true,
}) {
  if (!metadataSnapshots) return;
  for (const name of ['inventory', 'map']) {
    const expected = metadataSnapshots[name];
    const actual = readPinnedFile(root, expected.pin.relative, `skill resource ${name}`, rootPin, expected.pin);
    if (!sameState(stateFromSnapshot(actual), stateFromSnapshot(expected))) {
      fail(`skill resource ${name} changed during synchronization`);
    }
  }
  if (!verifyLedger) return;
  const ledgerExpected = expectedLedger || metadataSnapshots.ledger;
  const actualLedger = readPinnedFile(
    root,
    metadataSnapshots.ledger.pin.relative,
    'skill resource ledger',
    rootPin,
    metadataSnapshots.ledger.pin,
  );
  if (!sameState(stateFromSnapshot(actualLedger), stateFromSnapshot(ledgerExpected))) {
    fail('skill resource ledger changed during synchronization');
  }
}

function verifyObservedState({ root, plan }) {
  for (const [destination, expected] of Object.entries(plan.observedTargets)) {
    const actual = optionalFileState(root, destination, `resource destination ${destination}`, plan.rootPin).state;
    if (!sameState(actual, expected)) fail(`resource destination changed during planning: ${destination}`);
  }
  verifyMetadataSnapshots({
    root,
    rootPin: plan.rootPin,
    metadataSnapshots: plan.metadataSnapshots,
    expectedLedger: plan.observedLedger,
  });
}

function readAbsoluteState(file, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    fail(`${label} cannot be inspected: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { foreign: true };
  const content = boundedRead(file, label);
  return {
    bytes: content.bytes,
    sha256: digest(content.bytes),
    mode: content.mode,
    size: content.size,
    identity: content.identity,
  };
}

function removePublished(entry) {
  verifyPathPin(entry.root, entry.parentPin, `rollback parent ${entry.relative}`);
  const current = readAbsoluteState(entry.target, `rollback target ${entry.relative}`);
  if (current === null) return;
  if (current.foreign || !sameIdentity(current.identity, entry.candidateIdentity)) {
    fail(`rollback found a foreign target and preserved it: ${entry.target}`);
  }
  fs.unlinkSync(entry.target);
  if (readAbsoluteState(entry.target, `rollback target ${entry.relative}`) !== null) {
    fail(`rollback could not remove its candidate: ${entry.target}`);
  }
}

function verifyBackup(entry) {
  const backup = readAbsoluteState(entry.backup, `rollback backup ${entry.relative}`);
  if (backup === null || backup.foreign
    || !sameIdentity(backup.identity, entry.observedState.identity)
    || !sameContentState(backup, entry.observedState)) {
    fail(`rollback backup is no longer the accepted file: ${entry.backup}`);
  }
}

function restoreBackupExclusive(entry) {
  verifyPathPin(entry.root, entry.parentPin, `rollback parent ${entry.relative}`);
  let backup;
  try {
    fs.lstatSync(entry.backup);
    backup = true;
  } catch (error) {
    if (error.code !== 'ENOENT') fail(`rollback backup cannot be inspected: ${error.message}`);
    backup = false;
  }
  if (!backup) {
    const current = readAbsoluteState(entry.target, `rollback target ${entry.relative}`);
    if (current && !current.foreign && sameIdentity(current.identity, entry.observedState.identity)
      && sameContentState(current, entry.observedState)) return;
    fail(`rollback backup is missing: ${entry.backup}`);
  }
  verifyBackup(entry);
  let targetExists = false;
  try {
    fs.lstatSync(entry.target);
    targetExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') fail(`rollback target cannot be inspected: ${error.message}`);
  }
  if (targetExists) fail(`rollback refused to overwrite a concurrent target: ${entry.target}`);
  try {
    fs.linkSync(entry.backup, entry.target);
  } catch (error) {
    fail(`rollback could not restore exclusively: ${error.message}`);
  }
  const restored = readAbsoluteState(entry.target, `restored target ${entry.relative}`);
  if (!restored || restored.foreign
    || !sameIdentity(restored.identity, entry.observedState.identity)
    || !sameContentState(restored, entry.observedState)) {
    fail(`rollback restored an unexpected target: ${entry.target}`);
  }
  fs.unlinkSync(entry.backup);
}

function rollbackPublication(entries, createdDirectories) {
  const failures = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    try {
      if (entry.promotionAttempted) removePublished(entry);
      if (entry.hadExisting && entry.backupMoveAttempted) restoreBackupExclusive(entry);
    } catch (error) {
      failures.push(error.message);
    }
  }
  for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
    try {
      if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
    } catch (error) {
      failures.push(error.message);
    }
  }
  return failures;
}

function verifyPromotedTarget({ root, rootPin, entry }) {
  verifyPathPin(root, entry.parentPin, `published parent ${entry.relative}`);
  const state = stateFromSnapshot(readPinnedFile(
    root,
    entry.relative,
    `published resource ${entry.relative}`,
    rootPin,
  ));
  if (!sameIdentity(state.identity, entry.candidateIdentity)
    || !sameContentState(state, entry.stagedState)) {
    fail(`published resource changed during promotion: ${entry.relative}`);
  }
  return state;
}

function verifyDestinationParents(root, entries) {
  for (const entry of entries) {
    if (entry.parentPin) verifyPathPin(root, entry.parentPin, `destination parent ${entry.relative}`);
  }
}

function verifyCompletePublication({ root, rootPin, entries }) {
  for (const entry of entries) {
    verifyPathPin(root, entry.parentPin, `published parent ${entry.relative}`);
    if (entry.kind === 'resource' || entry.kind === 'ledger') {
      const current = verifyPromotedTarget({ root, rootPin, entry });
      if (!sameIdentity(current.identity, entry.candidateIdentity)) {
        fail(`published resource identity changed: ${entry.relative}`);
      }
    } else {
      const current = readAbsoluteState(entry.target, `orphan target ${entry.relative}`);
      if (current !== null) fail(`orphan resource remains published: ${entry.relative}`);
    }
  }
}

function writeSkillResources({ root, hooks } = {}) {
  const plan = planSkillResourceSync({ root });
  if (plan.errors.length > 0) fail(plan.errors.join('; '));
  if (plan.changes.length === 0) return { ...plan, ok: true };
  if (hooks !== undefined && (!isPlainObject(hooks) || (hooks.beforeCommit !== undefined && typeof hooks.beforeCommit !== 'function'))) {
    fail('hooks.beforeCommit must be a function when provided');
  }

  const stagingRoot = fs.mkdtempSync(path.join(plan.root, '.skill-resource-sync-stage-'));
  const backupRoot = fs.mkdtempSync(path.join(plan.root, '.skill-resource-sync-backup-'));
  const stageRootPin = captureRootPin(stagingRoot);
  const sourceStates = new Map();
  const entries = [];
  const createdDirectories = [];
  let keepBackup = false;
  try {
    for (const operation of plan.operations) {
      const planned = plan.sourceStates.get(operation.destination);
      const source = stateFromSnapshot(readPinnedFile(
        plan.root,
        operation.source,
        `resource source ${operation.source}`,
        plan.rootPin,
        planned.pin,
      ));
      if (!sameState(source, planned)) fail(`resource source changed before staging: ${operation.source}`);
      sourceStates.set(operation.destination, source);
      writeStageFile(stagingRoot, operation.destination, source.bytes, source.mode);
    }
    writeStageFile(stagingRoot, LEDGER_RELATIVE, Buffer.from(plan.expectedLedger, 'utf8'), '0644');
    verifySources({ root: plan.root, operations: plan.operations, sourceStates });
    verifyStage({
      stagingRoot,
      stageRootPin,
      operations: plan.operations,
      sourceStates,
      expectedLedger: plan.expectedLedger,
    });

    if (hooks && typeof hooks.beforeCommit === 'function') hooks.beforeCommit({ stagingRoot });

    verifySources({ root: plan.root, operations: plan.operations, sourceStates });
    const staged = verifyStage({
      stagingRoot,
      stageRootPin,
      operations: plan.operations,
      sourceStates,
      expectedLedger: plan.expectedLedger,
    });
    verifyObservedState({ root: plan.root, plan });

    const affected = new Set([...plan.operations.map((operation) => operation.destination), ...plan.orphanDestinations]);
    const affectedDestinations = [...affected].sort();
    const ownedDirectories = new Map();
    for (const destination of affectedDestinations) {
      const target = absolutePath(plan.root, destination);
      const existing = plan.observedTargets[destination];
      const current = optionalFileState(plan.root, destination, `resource destination ${destination}`, plan.rootPin).state;
      if (!sameState(current, existing)) fail(`resource destination changed before promotion: ${destination}`);
      const expectedParentPin = reconcileCreatedParentPin(plan.observedParentPins[destination], ownedDirectories);
      verifyPathPin(plan.root, expectedParentPin, `resource destination parent ${destination}`, { allowMissing: true });
      const operation = plan.desiredByDestination.get(destination);
      const backup = path.join(backupRoot, String(entries.length));
      const entry = {
        kind: operation ? 'resource' : 'orphan',
        relative: destination,
        target,
        backup,
        hadExisting: Boolean(existing),
        backupMoveAttempted: false,
        promotionAttempted: false,
        observedState: existing,
        stagedState: operation ? staged.states.get(destination) : null,
        candidateIdentity: operation ? staged.states.get(destination).identity : null,
        parentPin: null,
      };
      entries.push(entry);
      if (entry.hadExisting) {
        entry.backupMoveAttempted = true;
        fs.renameSync(target, backup);
        verifyBackup(entry);
      }
      if (operation) {
        entry.parentPin = ensureDirectory(
          plan.root,
          plan.rootPin,
          path.posix.dirname(destination),
          expectedParentPin,
          createdDirectories,
          ownedDirectories,
        );
        verifyRootPin(stageRootPin);
        verifyPathPin(stagingRoot, entry.stagedState.pin, `staged resource ${destination}`);
        entry.promotionAttempted = true;
        fs.renameSync(stagePath(stagingRoot, destination), target);
        verifyPromotedTarget({ root: plan.root, rootPin: plan.rootPin, entry });
      } else {
        entry.parentPin = expectedParentPin;
        verifyPathPin(plan.root, entry.parentPin, `orphan resource parent ${destination}`);
        if (readAbsoluteState(target, `orphan target ${destination}`) !== null) {
          fail(`orphan resource remains published: ${destination}`);
        }
      }
    }

    const ledgerEntry = {
      kind: 'ledger',
      relative: LEDGER_RELATIVE,
      target: plan.ledgerPath,
      backup: path.join(backupRoot, 'ledger'),
      hadExisting: Boolean(plan.observedLedger),
      backupMoveAttempted: false,
      promotionAttempted: false,
      observedState: plan.observedLedger,
      stagedState: staged.states.get(LEDGER_RELATIVE),
      candidateIdentity: staged.states.get(LEDGER_RELATIVE).identity,
      parentPin: capturePathPin(plan.root, parentRelative(LEDGER_RELATIVE), {
        rootPin: plan.rootPin,
        label: 'skill resource ledger parent',
      }),
    };
    entries.push(ledgerEntry);
    verifyMetadataSnapshots({
      root: plan.root,
      rootPin: plan.rootPin,
      metadataSnapshots: plan.metadataSnapshots,
      expectedLedger: plan.observedLedger,
    });
    verifyRootPin(stageRootPin);
    verifyPathPin(stagingRoot, ledgerEntry.stagedState.pin, 'staged resource ledger');
    verifyPathPin(plan.root, ledgerEntry.parentPin, 'skill resource ledger parent');
    if (ledgerEntry.hadExisting) {
      ledgerEntry.backupMoveAttempted = true;
      fs.renameSync(plan.ledgerPath, ledgerEntry.backup);
      verifyBackup(ledgerEntry);
    }
    ledgerEntry.promotionAttempted = true;
    fs.renameSync(stagePath(stagingRoot, LEDGER_RELATIVE), plan.ledgerPath);
    verifyPromotedTarget({ root: plan.root, rootPin: plan.rootPin, entry: ledgerEntry });
    verifyCompletePublication({ root: plan.root, rootPin: plan.rootPin, entries });
    verifySources({ root: plan.root, operations: plan.operations, sourceStates });
    verifyDestinationParents(plan.root, entries);
    verifyMetadataSnapshots({
      root: plan.root,
      rootPin: plan.rootPin,
      metadataSnapshots: plan.metadataSnapshots,
      expectedLedger: ledgerEntry.stagedState,
      verifyLedger: false,
    });
    verifyRootPin(stageRootPin);
    return { ...plan, ok: true, changes: plan.changes, errors: [] };
  } catch (error) {
    const rollbackFailures = rollbackPublication(entries, createdDirectories);
    if (rollbackFailures.length > 0) {
      keepBackup = true;
      error.message = `${error.message}; rollback incomplete; recovery backup retained at ${backupRoot}: ${rollbackFailures.join('; ')}`;
    }
    throw error;
  } finally {
    if (!keepBackup) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
      fs.rmSync(backupRoot, { recursive: true, force: true });
    }
  }
}

module.exports = {
  validateSkillResourceMap,
  planSkillResourceSync,
  checkSkillResources,
  writeSkillResources,
};
