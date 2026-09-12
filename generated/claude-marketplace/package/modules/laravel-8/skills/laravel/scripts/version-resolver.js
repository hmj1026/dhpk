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

function selectorsFromConstraint(value, allowMix) {
  const text = textValue(value);
  if (!text) return [];

  if (allowMix && /(?:^|[^a-z])(?:laravel[- ]?)?mix(?:[^a-z]|$)/.test(text)) {
    return ['mix'];
  }

  const candidates = [];
  const add = (selector) => {
    if (!candidates.includes(selector)) candidates.push(selector);
  };

  const versionPattern = /(?:^|[^0-9])v?(\d+)(?:\.(\d+|x|\*))?/g;
  let match;
  while ((match = versionPattern.exec(text)) !== null) {
    const major = match[1];
    const minor = match[2];
    if (major === '5') {
      if (minor === '4') add('5.4');
      else if (minor && minor !== 'x' && minor !== '*') add(`unsupported-5-${minor}`);
    } else if (['6', '7', '8', '9', '10', '11'].includes(major)) {
      add(major);
    }
  }

  return candidates.filter((candidate) => SUPPORTED_SELECTORS.includes(candidate));
}

function selectorFromConstraint(value, allowMix) {
  const candidates = selectorsFromConstraint(value, allowMix);
  if (candidates.length !== 1) return null;
  return candidates[0];
}

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
      selector: selectorFromConstraint(frameworkVersions[0], false),
      source: 'composer.lock',
    };
  }

  const mixVersions = lockedPackageVersions(parsed.value, 'laravel-mix');
  if (mixVersions.length > 0) {
    return { found: true, selector: 'mix', source: 'composer.lock' };
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
      selector: selectorFromConstraint(frameworkConstraint, false),
      source: 'composer.json',
    };
  }

  const mixConstraint = dependencyConstraint(parsed.value, 'laravel-mix');
  if (mixConstraint !== undefined) {
    return { found: true, selector: 'mix', source: 'composer.json' };
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
          selector: selectorFromConstraint(constraint, true) || 'mix',
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
