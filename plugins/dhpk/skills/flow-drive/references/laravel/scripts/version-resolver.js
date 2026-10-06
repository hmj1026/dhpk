'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REFERENCE_BY_SELECTOR = Object.freeze({
  '5.4': 'references/5-4.md',
  '6': 'references/6.md',
  '7': 'references/7.md',
  '8': 'references/8.md',
  '9': 'references/9.md',
  '10': 'references/10.md',
  '11': 'references/11.md',
  mix: 'references/mix.md',
});

const SUPPORTED_SELECTORS = Object.freeze(Object.keys(REFERENCE_BY_SELECTOR));

const EXPLICIT_ALIASES = Object.freeze({
  '5.4': '5.4',
  '5-4': '5.4',
  '5_4': '5.4',
  '5.4.x': '5.4',
  '5-4.x': '5.4',
  'laravel-5.4': '5.4',
  'laravel-5-4': '5.4',
  laravel54: '5.4',
  'laravel 5.4': '5.4',
  'laravel-mix': 'mix',
  'laravel mix': 'mix',
  'mix-5': 'mix',
  'mix 5': 'mix',
  mix: 'mix',
});

function ask(question) {
  return {
    status: 'ask',
    selector: null,
    reference: null,
    loadedReferences: [],
    question,
  };
}

function textValue(value) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeExplicit(value) {
  const text = textValue(value);
  if (!text) return null;
  if (Object.prototype.hasOwnProperty.call(EXPLICIT_ALIASES, text)) {
    return EXPLICIT_ALIASES[text];
  }

  const withoutPrefix = text.replace(/^v/, '');
  if (/^5[.-]4(?:[.-]\d+)?$/.test(withoutPrefix)) return '5.4';
  for (const major of ['6', '7', '8', '9', '10', '11']) {
    if (new RegExp(`^${major}(?:\\.\\d+){0,2}$`).test(withoutPrefix)) {
      return major;
    }
  }
  return null;
}

// A complete version atom: optional "v", a numeric major, up to three numeric
// or wildcard segments, then an optional pre-release, build, or stability
// suffix. Anything else in a term (for example "banana11.0") is unconsumed
// text, and the whole constraint is treated as unresolvable.
const VERSION_ATOM = /^v?(\d+)((?:\.(?:\d+|x|\*)){0,3})(?:-[0-9a-z.]+)?(?:\+[0-9a-z.]+)?(?:@[a-z]+)?$/;
const PINNED_OPERATORS = Object.freeze(['', '=', '==', '^', '~']);
const LOWER_OPERATORS = Object.freeze(['>=', '>']);
const UPPER_OPERATORS = Object.freeze(['<=', '<']);

function parseAtom(text) {
  const match = VERSION_ATOM.exec(text);
  if (!match) return null;
  const rest = match[2] ? match[2].slice(1).split('.') : [];
  return [Number(match[1]), ...rest.map((part) => (part === 'x' || part === '*' ? '*' : Number(part)))];
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

// One "||" alternative identifies a selector only as a single pinned term
// (exact, ^, ~, or wildcard) or as a lower bound plus an upper bound that
// stays inside that selector. Open-ended or upper-only ranges are ambiguous.
function alternativeSelector(terms, family) {
  if (terms.length === 1 && PINNED_OPERATORS.includes(terms[0].operator)) {
    const { operator, atom } = terms[0];
    const selector = family.atomSelector(atom);
    if (!selector) return null;
    if (operator === '^' || operator === '~') {
      const upper = operator === '~' && atom.length >= 3 && atom[1] !== '*'
        ? [atom[0], atom[1] + 1]
        : [atom[0] + 1];
      if (compareAtoms(upper, family.boundary(selector)) > 0) return null;
    }
    return selector;
  }
  if (terms.length !== 2) return null;
  const lower = terms.find((term) => LOWER_OPERATORS.includes(term.operator));
  const upper = terms.find((term) => UPPER_OPERATORS.includes(term.operator));
  if (!lower || !upper || [lower, upper].some((term) => term.atom.includes('*'))) return null;
  const selector = family.atomSelector(lower.atom);
  if (!selector || compareAtoms(upper.atom, lower.atom) <= 0) return null;
  if (family.atomSelector(upper.atom) === selector) return selector;
  const atBoundary = upper.operator === '<' && compareAtoms(upper.atom, family.boundary(selector)) === 0;
  return atBoundary ? selector : null;
}

function constraintSelector(value, family) {
  const text = textValue(value).replace(/(\^|~|>=|<=|>|<|==|=)\s+/g, '$1');
  if (!text) return null;
  const selectors = text.split(/\s*\|\|?\s*/).map((alternative) => {
    const terms = alternative.split(/\s*,\s*|\s+/).filter(Boolean).map(parseTerm);
    if (terms.length === 0 || terms.includes(null)) return null;
    return alternativeSelector(terms, family);
  });
  if (selectors.includes(null)) return null;
  const unique = [...new Set(selectors)];
  return unique.length === 1 ? unique[0] : null;
}

const FRAMEWORK_VERSIONS = Object.freeze({
  atomSelector(atom) {
    if (atom[0] === 5) return atom[1] === 4 ? '5.4' : null;
    const selector = String(atom[0]);
    return ['6', '7', '8', '9', '10', '11'].includes(selector) ? selector : null;
  },
  boundary(selector) {
    return selector === '5.4' ? [5, 5] : [Number(selector) + 1];
  },
});

// Only Laravel Mix 5 has a reference; any other Mix major is unresolvable.
const MIX_VERSIONS = Object.freeze({
  atomSelector(atom) {
    return atom[0] === 5 ? 'mix' : null;
  },
  boundary() {
    return [6];
  },
});

function readJsonFile(file) {
  try {
    return {
      present: true,
      valid: true,
      value: JSON.parse(fs.readFileSync(file, 'utf8')),
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { present: false, valid: false, value: null };
    return { present: true, valid: false, value: null };
  }
}

function dependencyConstraint(document, packageName) {
  if (!document || typeof document !== 'object') return undefined;
  for (const section of ['require', 'require-dev']) {
    const dependencies = document[section];
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
    for (const [name, constraint] of Object.entries(dependencies)) {
      if (name.toLowerCase() === packageName) return constraint;
    }
  }
  return undefined;
}

function lockedPackageVersions(document, packageName) {
  if (!document || typeof document !== 'object') return [];
  const packages = [
    ...(Array.isArray(document.packages) ? document.packages : []),
    ...(Array.isArray(document['packages-dev']) ? document['packages-dev'] : []),
  ];
  return packages
    .filter((item) => item && typeof item === 'object' && String(item.name || '').toLowerCase() === packageName)
    .map((item) => item.version || item.pretty_version || item.prettyVersion)
    .filter((version) => typeof version === 'string' && version.trim() !== '');
}

function detectFromComposerLock(cwd) {
  const file = path.join(cwd, 'composer.lock');
  const parsed = readJsonFile(file);
  if (!parsed.valid) return null;

  const frameworkVersions = lockedPackageVersions(parsed.value, 'laravel/framework');
  if (frameworkVersions.length > 0) {
    return {
      found: true,
      selector: constraintSelector(frameworkVersions[0], FRAMEWORK_VERSIONS),
      source: 'composer.lock',
    };
  }

  const mixVersions = lockedPackageVersions(parsed.value, 'laravel-mix');
  if (mixVersions.length > 0) {
    return { found: true, selector: constraintSelector(mixVersions[0], MIX_VERSIONS), source: 'composer.lock' };
  }
  return null;
}

function detectFromComposerJson(cwd) {
  const file = path.join(cwd, 'composer.json');
  const parsed = readJsonFile(file);
  if (!parsed.valid) return null;

  const frameworkConstraint = dependencyConstraint(parsed.value, 'laravel/framework');
  if (frameworkConstraint !== undefined) {
    return {
      found: true,
      selector: constraintSelector(frameworkConstraint, FRAMEWORK_VERSIONS),
      source: 'composer.json',
    };
  }

  const mixConstraint = dependencyConstraint(parsed.value, 'laravel-mix');
  if (mixConstraint !== undefined) {
    return { found: true, selector: constraintSelector(mixConstraint, MIX_VERSIONS), source: 'composer.json' };
  }
  return null;
}

function detectFromPackageJson(cwd) {
  const file = path.join(cwd, 'package.json');
  const parsed = readJsonFile(file);
  if (!parsed.valid) return null;
  const document = parsed.value;
  if (!document || typeof document !== 'object') return null;

  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const dependencies = document[section];
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
    for (const [name, constraint] of Object.entries(dependencies)) {
      if (name.toLowerCase() === 'laravel-mix') {
        return {
          found: true,
          selector: constraintSelector(constraint, MIX_VERSIONS),
          source: 'package.json',
        };
      }
    }
  }
  return null;
}

function selectedVersion(options) {
  if (typeof options === 'string' || typeof options === 'number') {
    return { supplied: true, value: options };
  }
  if (!options || typeof options !== 'object') return { supplied: false, value: null };
  if (options.version !== undefined && options.version !== null && textValue(options.version) !== '') {
    return { supplied: true, value: options.version };
  }
  if (options.selector !== undefined && options.selector !== null && textValue(options.selector) !== '') {
    return { supplied: true, value: options.selector };
  }
  return { supplied: false, value: null };
}

function referenceGuidance(selector) {
  const reference = REFERENCE_BY_SELECTOR[selector];
  if (!reference) return null;
  try {
    return fs.readFileSync(path.join(__dirname, '..', reference), 'utf8');
  } catch (error) {
    return null;
  }
}

function resolved(selector, source) {
  const reference = REFERENCE_BY_SELECTOR[selector];
  const guidance = referenceGuidance(selector);
  if (!reference || guidance === null) return null;
  return {
    status: 'resolved',
    family: 'laravel',
    selector,
    source,
    reference,
    loadedReferences: [reference],
    guidance,
  };
}

function resolveVersion(options) {
  const supplied = selectedVersion(options);
  if (supplied.supplied) {
    const selector = normalizeExplicit(supplied.value);
    const result = selector ? resolved(selector, 'explicit') : null;
    if (result) return result;
    return ask(
      `Which Laravel version should be used? Supported selectors: ${SUPPORTED_SELECTORS.join(', ')}. ` +
      'Pass an explicit selector or provide a resolvable project dependency.',
    );
  }

  const cwd = options && typeof options === 'object' && typeof options.cwd === 'string'
    ? path.resolve(options.cwd)
    : process.cwd();
  const detected = detectFromComposerLock(cwd)
    || detectFromComposerJson(cwd)
    || detectFromPackageJson(cwd);
  if (detected && detected.selector) {
    const result = resolved(detected.selector, detected.source);
    if (result) return result;
  }

  return ask(
    'Which Laravel version applies? Choose 5.4, 6, 7, 8, 9, 10, 11, or mix; ' +
    'the family resolver could not map composer.json, composer.lock, or package.json.',
  );
}

module.exports = {
  resolveVersion,
};
