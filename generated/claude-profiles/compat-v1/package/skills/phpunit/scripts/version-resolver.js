'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FAMILY = 'phpunit';
const PACKAGE_NAME = 'phpunit/phpunit';
const REFERENCES = Object.freeze({
  '9': 'references/9.md',
  '10': 'references/10.md',
  '11': 'references/11.md',
});
const SUPPORTED = new Set(Object.keys(REFERENCES));

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeSelector(value) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return null;

  const text = value.trim().replace(/^v/i, '');
  if (SUPPORTED.has(text)) return text;

  const match = text.match(/^(\d+)(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?(?:[-+].*)?$/i);
  if (!match || !SUPPORTED.has(match[1])) return null;
  return match[1];
}

function constraintSelector(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeSelector(value);
  if (typeof value !== 'string' || value.trim() === '') return null;

  const text = value.trim();
  const matches = [];
  const expression = /([~^<>=]{0,2})\s*v?(\d+)(?:\.(\d+|x|\*))?/gi;
  let match;
  while ((match = expression.exec(text)) !== null) {
    const operator = match[1] || '';
    const major = match[2];
    const minor = match[3] || '';
    if (operator === '!=' || operator === '<>') return null;
    matches.push({
      operator,
      major,
      minor,
      upper: operator === '<' || operator === '<=',
    });
  }

  if (matches.length === 0 || /(?:^|[\s|,])(?:dev-|self\.version|[*xX])/.test(text)) return null;

  const lower = matches.filter((candidate) => !candidate.upper);
  const upper = matches.filter((candidate) => candidate.upper);
  const lowerMajors = [...new Set(lower.map((candidate) => candidate.major))];
  const upperMajors = [...new Set(upper.map((candidate) => candidate.major))];

  if (lowerMajors.length !== 1) return null;
  const selector = lowerMajors[0];
  if (!SUPPORTED.has(selector)) return null;

  // A bounded interval such as >=9.6 <10.0 still identifies 9. A wider
  // interval can contain another supported family member, so ask instead.
  if (upperMajors.length > 0) {
    const lowerMajor = Number(selector);
    const wider = upperMajors.some((major) => Number(major) > lowerMajor + 1);
    const contradictory = upperMajors.some((major) => Number(major) <= lowerMajor);
    if (wider || contradictory) return null;
  }

  return selector;
}

function readJson(cwd, filename) {
  try {
    const file = path.join(cwd, filename);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function packageEntries(document) {
  if (!document || typeof document !== 'object') return [];
  return []
    .concat(Array.isArray(document.packages) ? document.packages : [])
    .concat(Array.isArray(document['packages-dev']) ? document['packages-dev'] : []);
}

function detectFromLock(cwd) {
  const document = readJson(cwd, 'composer.lock');
  if (!document) return { found: false, selector: null };

  const entries = packageEntries(document).filter((entry) => (
    entry && typeof entry === 'object' && entry.name === PACKAGE_NAME
  ));
  if (entries.length === 0) return { found: false, selector: null };

  const selectors = [...new Set(entries
    .map((entry) => normalizeSelector(entry.version || entry.version_normalized))
    .filter((selector) => selector !== null))];
  return {
    found: true,
    selector: selectors.length === 1 ? selectors[0] : null,
  };
}

function composerRequirements(document) {
  if (!document || typeof document !== 'object') return [];
  const sections = [document.require, document['require-dev']];
  return sections
    .filter((section) => section && typeof section === 'object' && !Array.isArray(section))
    .map((section) => section[PACKAGE_NAME])
    .filter((constraint) => constraint !== undefined);
}

function detectFromJson(cwd) {
  const document = readJson(cwd, 'composer.json');
  if (!document) return { found: false, selector: null };

  const requirements = composerRequirements(document);
  if (requirements.length === 0) return { found: false, selector: null };
  const selectors = [...new Set(requirements.map(constraintSelector).filter((selector) => selector !== null))];
  return {
    found: true,
    selector: selectors.length === 1 ? selectors[0] : null,
  };
}

function ask(question) {
  return {
    status: 'ask',
    family: FAMILY,
    selector: null,
    source: null,
    reference: null,
    loadedReferences: [],
    guidance: null,
    question: question || 'Which supported PHPUnit version applies? Provide 9, 10, or 11, or a resolvable phpunit/phpunit entry in composer.json or composer.lock.',
  };
}

function resolved(selector, source) {
  const reference = REFERENCES[selector];
  const file = path.join(__dirname, '..', reference);
  let guidance;
  try {
    guidance = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return ask('PHPUnit ' + selector + ' was selected, but its reference ' + reference + ' is unavailable. Choose 9, 10, or 11 after restoring the family reference.');
  }

  return {
    status: 'resolved',
    family: FAMILY,
    selector,
    source,
    reference,
    loadedReferences: [reference],
    guidance,
  };
}

function resolveVersion(options = {}) {
  const input = options && typeof options === 'object' ? options : {};
  const hasExplicit = hasOwn(input, 'version') && input.version !== undefined && input.version !== null;
  if (hasExplicit) {
    const selector = normalizeSelector(input.version);
    if (!selector) {
      return ask('PHPUnit version ' + String(input.version) + ' is unsupported or ambiguous. Choose one supported selector: 9, 10, or 11.');
    }
    return resolved(selector, 'explicit');
  }

  const cwdValue = input.cwd || input.projectRoot || process.cwd();
  let cwd;
  try {
    cwd = path.resolve(String(cwdValue));
  } catch (_) {
    return ask('Which PHPUnit version applies? Provide 9, 10, or 11; the project directory could not be inspected.');
  }

  const lock = detectFromLock(cwd);
  if (lock.found) {
    if (lock.selector) return resolved(lock.selector, 'composer.lock');
    return ask('composer.lock contains an unsupported or ambiguous phpunit/phpunit version. Choose one supported selector: 9, 10, or 11.');
  }

  const composer = detectFromJson(cwd);
  if (composer.found && composer.selector) return resolved(composer.selector, 'composer.json');
  return ask('Which PHPUnit version applies? Provide 9, 10, or 11, or a resolvable phpunit/phpunit entry in composer.json or composer.lock.');
}

module.exports = { resolveVersion };
