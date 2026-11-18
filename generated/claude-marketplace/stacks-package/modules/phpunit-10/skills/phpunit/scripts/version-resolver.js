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

// A complete version atom: optional "v", a numeric major, up to three numeric
// or wildcard segments, then an optional pre-release, build, or stability
// suffix. Anything else in a term (for example "banana10.0") is unconsumed
// text, and the whole constraint is treated as unresolvable.
const VERSION_ATOM = /^v?(\d+)((?:\.(?:\d+|x|\*)){0,3})(?:-[0-9a-z.]+)?(?:\+[0-9a-z.]+)?(?:@[a-z]+)?$/;
const PINNED_OPERATORS = ['', '=', '==', '^', '~'];
const LOWER_OPERATORS = ['>=', '>'];
const UPPER_OPERATORS = ['<=', '<'];

function parseAtom(text) {
  const match = VERSION_ATOM.exec(text);
  if (!match) return null;
  const rest = match[2] ? match[2].slice(1).split('.') : [];
  return [Number(match[1])].concat(rest.map((part) => (part === 'x' || part === '*' ? '*' : Number(part))));
}

function parseTerm(text) {
  const match = /^(\^|~|>=|<=|>|<|==|=)?(.+)$/.exec(text);
  if (!match) return null;
  const atom = parseAtom(match[2]);
  return atom ? { operator: match[1] || '', atom } : null;
}

function compareAtoms(left, right) {
  for (let index = 0; index < 4; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function atomSelector(atom) {
  const selector = String(atom[0]);
  return SUPPORTED.has(selector) ? selector : null;
}

// One "||" alternative identifies a selector only as a single pinned term
// (exact, ^, ~, or wildcard) or as a lower bound plus an upper bound that
// stays inside that major, such as >=9.6 <10.0. Open-ended or upper-only
// ranges can contain another supported family member, so they ask instead.
function alternativeSelector(terms) {
  if (terms.length === 1 && PINNED_OPERATORS.includes(terms[0].operator)) {
    return atomSelector(terms[0].atom);
  }
  if (terms.length !== 2) return null;
  const lower = terms.find((term) => LOWER_OPERATORS.includes(term.operator));
  const upper = terms.find((term) => UPPER_OPERATORS.includes(term.operator));
  if (!lower || !upper || [lower, upper].some((term) => term.atom.includes('*'))) return null;
  const selector = atomSelector(lower.atom);
  if (!selector || compareAtoms(upper.atom, lower.atom) <= 0) return null;
  if (atomSelector(upper.atom) === selector) return selector;
  const atBoundary = upper.operator === '<' && compareAtoms(upper.atom, [Number(selector) + 1]) === 0;
  return atBoundary ? selector : null;
}

function constraintSelector(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeSelector(value);
  if (typeof value !== 'string' || value.trim() === '') return null;

  const text = value.trim().toLowerCase().replace(/(\^|~|>=|<=|>|<|==|=)\s+/g, '$1');
  const selectors = text.split(/\s*\|\|?\s*/).map((alternative) => {
    const terms = alternative.split(/\s*,\s*|\s+/).filter(Boolean).map(parseTerm);
    if (terms.length === 0 || terms.includes(null)) return null;
    return alternativeSelector(terms);
  });
  if (selectors.includes(null)) return null;
  const unique = [...new Set(selectors)];
  return unique.length === 1 ? unique[0] : null;
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
