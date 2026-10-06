'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { validateOpenaiListingAssets } = require('../scripts/lib/openai-submission-assets');

const ASSET_PATH = './skills/flow-guide/assets/dhpk-icon.svg';
const SAFE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">',
  '  <rect x="0" y="0" width="48" height="48" fill="#ffffff"/>',
  '</svg>',
  '',
].join('\n');

function listing(overrides = {}) {
  return {
    displayName: 'DHPK',
    shortDescription: 'Developer workflow skills',
    longDescription: 'A portable collection of developer workflow skills.',
    developerName: 'DHPK Project',
    category: 'Developer Tools',
    ...overrides,
  };
}

function assetFiles(svg = SAFE_SVG) {
  return new Map([[ASSET_PATH.slice(2), Buffer.from(svg, 'utf8')]]);
}

function errorText(errors) {
  return Array.isArray(errors) ? errors.join('\n') : String(errors);
}

test('listing assets remain optional for portable fixtures', () => {
  assert.deepStrictEqual(validateOpenaiListingAssets(listing(), new Map()), []);
});

test('contained passive SVG can back both listing icon fields', () => {
  assert.deepStrictEqual(validateOpenaiListingAssets(
    listing({ composerIcon: ASSET_PATH, logo: ASSET_PATH }),
    assetFiles(),
  ), []);
});

test('contained passive SVG can back both dark listing icon fields', () => {
  assert.deepStrictEqual(validateOpenaiListingAssets(
    listing({ composerIconDark: ASSET_PATH, logoDark: ASSET_PATH }),
    assetFiles(),
  ), []);
});

test('supplied dark listing icon fields must resolve to included SVG assets', () => {
  for (const field of ['composerIconDark', 'logoDark']) {
    const errors = validateOpenaiListingAssets(listing({ [field]: ASSET_PATH }), new Map());
    assert.match(errorText(errors), new RegExp(field));
    assert.match(errorText(errors), /missing|not found|contained/i);
  }
});

test('dark listing icon fields reject escaping package paths', () => {
  for (const field of ['composerIconDark', 'logoDark']) {
    const errors = validateOpenaiListingAssets(
      listing({ [field]: './skills/flow-guide/assets/../../../../outside.svg' }),
      assetFiles(),
    );
    assert.notStrictEqual(errors.length, 0, field);
  }
});

test('dark listing icon fields reject active SVG content', () => {
  const activeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><script>alert(1)</script></svg>';
  for (const field of ['composerIconDark', 'logoDark']) {
    const errors = validateOpenaiListingAssets(listing({ [field]: ASSET_PATH }), assetFiles(activeSvg));
    assert.match(errorText(errors), new RegExp(field));
  }
});

test('listing icon references require canonical contained relative paths', () => {
  const unsafePaths = [
    'skills/flow-guide/assets/dhpk-icon.svg',
    '/skills/flow-guide/assets/dhpk-icon.svg',
    '../outside.svg',
    './skills/flow-guide/assets/../dhpk-icon.svg',
    './skills/flow-guide/assets/%2e%2e/dhpk-icon.svg',
    './skills/flow-guide/assets/dhpk-icon.svg?size=large',
    './skills/flow-guide/assets/dhpk-icon.svg#preview',
    './skills/flow-guide/assets/dhpk-icon.svg\\alias',
    'https://example.test/dhpk-icon.svg',
    './skills/flow-guide/assets/dhpk-icon.svg\u0001',
  ];
  for (const unsafePath of unsafePaths) {
    const errors = validateOpenaiListingAssets(listing({ composerIcon: unsafePath }), assetFiles());
    assert.notStrictEqual(errors.length, 0, unsafePath);
  }
});

test('listing icon references must resolve to an included package file', () => {
  const errors = validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), new Map());
  assert.match(errorText(errors), /logo|missing|not found|contained/i);
});

test('listing icon fields reject non-SVG package bytes', () => {
  const errors = validateOpenaiListingAssets(listing({ composerIcon: ASSET_PATH }), assetFiles('not an image'));
  assert.match(errorText(errors), /SVG|XML|image/i);
});

test('listing icon SVG bytes must be valid UTF-8 and no larger than five MiB', () => {
  const invalidUtf8 = Buffer.concat([Buffer.from(SAFE_SVG, 'utf8'), Buffer.from([0xff])]);
  const invalidEncoding = validateOpenaiListingAssets(
    listing({ composerIcon: ASSET_PATH }),
    new Map([[ASSET_PATH.slice(2), invalidUtf8]]),
  );
  assert.match(errorText(invalidEncoding), /UTF-8|encoding/i);

  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0x20);
  const overLimit = validateOpenaiListingAssets(
    listing({ composerIcon: ASSET_PATH }),
    new Map([[ASSET_PATH.slice(2), oversized]]),
  );
  assert.match(errorText(overLimit), /5\s?MiB|5242880|size|large/i);
});

test('listing icon SVG requires a square viewport with at least 48 pixels', () => {
  const tooSmall = '<svg xmlns="http://www.w3.org/2000/svg" width="47" height="47"><rect width="47" height="47"/></svg>';
  const nonsquare = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48"/></svg>';
  const invalidViewport = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><rect width="64" height="48"/></svg>';
  for (const svg of [tooSmall, nonsquare, invalidViewport]) {
    const errors = validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), assetFiles(svg));
    assert.match(errorText(errors), /square|48|dimension|viewBox|viewport/i);
  }

  const viewBoxOnly = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/></svg>';
  assert.deepStrictEqual(validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), assetFiles(viewBoxOnly)), []);
});

test('listing icon SVG rejects active content and external resource loading', () => {
  const hostileSvgs = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" onload="alert(1)"/>',
    '<!DOCTYPE svg [<!ENTITY x "unsafe">]><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"/>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><foreignObject/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><handler type="application/ecmascript">evil()</handler></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><image href="https://example.test/a.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><style>@import url(https://example.test/a.css);</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><style><g>@import "https://example.invalid/x.css";</g></style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect style="fill:url(https://example.test/a.svg#paint)"/></svg>',
  ];
  for (const svg of hostileSvgs) {
    const errors = validateOpenaiListingAssets(listing({ composerIcon: ASSET_PATH }), assetFiles(svg));
    assert.notStrictEqual(errors.length, 0, svg);
  }
});

test('listing icon SVG rejects malformed XML, duplicate attributes, and multiple roots', () => {
  const malformedSvgs = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" width="48" height="48"/>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"/><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"/>',
  ];
  for (const svg of malformedSvgs) {
    const errors = validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), assetFiles(svg));
    assert.match(errorText(errors), /XML|root|well.?formed|duplicate|attribute/i);
  }
});

test('listing icon SVG rejects comments ending in a hyphen', () => {
  const malformedComment = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><!--x---><rect width="48" height="48"/></svg>';
  const errors = validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), assetFiles(malformedComment));
  assert.match(errorText(errors), /XML|comment/i);
});

test('listing icon SVG rejects uppercase X in hexadecimal character references', () => {
  const uppercaseHexEntity = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><title>&#X41;</title></svg>';
  const errors = validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), assetFiles(uppercaseHexEntity));
  assert.match(errorText(errors), /XML|entity|reference/i);
});

test('listing icon SVG rejects a literal non-breaking space before the root', () => {
  const errors = validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), assetFiles(`\u00a0${SAFE_SVG}`));
  assert.match(errorText(errors), /XML|outside|character|text/i);
});

test('listing icon SVG rejects a literal non-breaking space after the root', () => {
  const errors = validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), assetFiles(`${SAFE_SVG}\u00a0`));
  assert.match(errorText(errors), /XML|outside|character|text/i);
});

test('listing icon SVG rejects a character reference outside the root', () => {
  const errors = validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), assetFiles(`&#x20;${SAFE_SVG}`));
  assert.match(errorText(errors), /XML|outside|character|text/i);
});

test('listing icon SVG preserves the four XML whitespace characters outside the root', () => {
  for (const whitespace of [' ', '\t', '\r', '\n']) {
    assert.deepStrictEqual(
      validateOpenaiListingAssets(listing({ logo: ASSET_PATH }), assetFiles(`${whitespace}${SAFE_SVG}${whitespace}`)),
      [],
      `XML whitespace ${JSON.stringify(whitespace)} should remain valid around the root`,
    );
  }
});

test('skills-only listing rejects supplied screenshots', () => {
  const errors = validateOpenaiListingAssets(
    listing({ screenshots: ['./skills/flow-guide/assets/preview.png'] }),
    assetFiles(),
  );
  assert.match(errorText(errors), /screenshot|skills.only|unsupported/i);
});

run('openai-submission-assets');
