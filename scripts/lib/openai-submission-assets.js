'use strict';

const { TextDecoder } = require('node:util');

const MAX_SVG_BYTES = 5 * 1024 * 1024;
const MAX_XML_DEPTH = 256;
const MAX_XML_ELEMENTS = 100000;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const XML_NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
const CSS_REFERENCE = /(?:url\s*\(|@import\b|@namespace\b|@font-face\b|expression\s*\(|behavior\s*:|-moz-binding|\\)/i;
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'style',
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path',
  'text', 'tspan', 'textPath', 'symbol', 'use',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker',
]);
const ALLOWED_STYLE_PROPERTIES = new Set([
  'color', 'display', 'fill', 'fill-opacity', 'fill-rule', 'font-family', 'font-size',
  'font-style', 'font-weight', 'letter-spacing', 'opacity', 'overflow', 'shape-rendering',
  'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'stop-color', 'stop-opacity',
  'text-anchor', 'text-decoration', 'text-rendering', 'visibility', 'word-spacing',
]);

function error(field, message) {
  return `OpenAI listing ${field} ${message}`;
}

function xmlCodePointAllowed(codePoint) {
  return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}

function hasInvalidXmlCharacters(value) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value);
}

function decodeXmlEntities(value) {
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current !== '&') {
      decoded += current;
      continue;
    }

    const end = value.indexOf(';', index + 1);
    if (end === -1) throw new Error('contains an unterminated XML entity reference');
    const name = value.slice(index + 1, end);
    const predefined = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      quot: '"',
    };
    if (Object.prototype.hasOwnProperty.call(predefined, name)) {
      decoded += predefined[name];
    } else if (/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name)) {
      const codePoint = name[1].toLowerCase() === 'x'
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
      if (!Number.isSafeInteger(codePoint) || !xmlCodePointAllowed(codePoint)) {
        throw new Error('contains an invalid XML character reference');
      }
      decoded += String.fromCodePoint(codePoint);
    } else {
      throw new Error('contains a custom or unsupported XML entity reference');
    }
    index = end;
  }
  if (hasInvalidXmlCharacters(decoded)) throw new Error('contains an invalid XML character');
  return decoded;
}

function xmlNameAt(source, offset) {
  XML_NAME.lastIndex = offset;
  const match = XML_NAME.exec(source);
  return match ? { name: match[0], end: XML_NAME.lastIndex } : null;
}

function isXmlWhitespace(character) {
  return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function hasUnsafeCss(value) {
  const withoutComments = value.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutComments.includes('/*') || CSS_REFERENCE.test(withoutComments);
}

function cssLength(value) {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|pt|pc|mm|cm|in|em|ex|rem|%)?$/i.test(value);
}

function cssColor(value) {
  return /^(?:none|transparent|currentcolor|inherit|initial|unset|revert|#[0-9a-f]{3,4}|#[0-9a-f]{6}(?:[0-9a-f]{2})?|[a-z]{1,24}|(?:rgb|rgba|hsl|hsla)\([0-9.,%+\-\s]+\))$/i.test(value);
}

function cssValueAllowed(property, rawValue) {
  const value = rawValue.trim().replace(/\s+/g, ' ');
  if (value === '') return false;
  if (['color', 'fill', 'stroke', 'stop-color'].includes(property)) return cssColor(value);
  if (['display'].includes(property)) return /^(?:inline|none|inherit|initial|unset|revert)$/i.test(value);
  if (['visibility', 'overflow'].includes(property)) return /^(?:visible|hidden|collapse|inherit|initial|unset|revert)$/i.test(value);
  if (['fill-rule'].includes(property)) return /^(?:nonzero|evenodd|inherit|initial|unset|revert)$/i.test(value);
  if (['stroke-linecap'].includes(property)) return /^(?:butt|round|square|inherit|initial|unset|revert)$/i.test(value);
  if (['stroke-linejoin'].includes(property)) return /^(?:arcs|bevel|miter|miter-clip|round|inherit|initial|unset|revert)$/i.test(value);
  if (['font-style'].includes(property)) return /^(?:normal|italic|oblique|inherit|initial|unset|revert)$/i.test(value);
  if (['font-weight'].includes(property)) return /^(?:normal|bold|bolder|lighter|[1-9]00|inherit|initial|unset|revert)$/i.test(value);
  if (['text-anchor'].includes(property)) return /^(?:start|middle|end|inherit|initial|unset|revert)$/i.test(value);
  if (['text-decoration'].includes(property)) return /^(?:none|underline|overline|line-through|inherit|initial|unset|revert)$/i.test(value);
  if (['shape-rendering', 'text-rendering'].includes(property)) {
    return /^(?:auto|optimizeSpeed|crispEdges|geometricPrecision|optimizeLegibility|optimizeQuality|inherit|initial|unset|revert)$/i.test(value);
  }
  if (['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity'].includes(property)) {
    return /^(?:0|1|0?\.\d+|100%|\d{1,2}(?:\.\d+)?%)$/i.test(value);
  }
  if (property === 'stroke-miterlimit') return /^(?:\d+(?:\.\d*)?|\.\d+)$/i.test(value);
  if (property === 'stroke-dasharray') {
    if (/^(?:none|inherit|initial|unset|revert)$/i.test(value)) return true;
    return value.split(/[\s,]+/).every((part) => part.length > 0 && cssLength(part));
  }
  if (['stroke-width', 'stroke-dashoffset', 'letter-spacing', 'word-spacing', 'font-size'].includes(property)) {
    if (property === 'font-size' && /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i.test(value)) return true;
    return cssLength(value);
  }
  if (property === 'font-family') {
    return /^(?:[A-Za-z0-9_-]+|"[A-Za-z0-9 _-]+"|'[A-Za-z0-9 _-]+')(?:\s*,\s*(?:[A-Za-z0-9_-]+|"[A-Za-z0-9 _-]+"|'[A-Za-z0-9 _-]+'))*$/.test(value);
  }
  return false;
}

function validateCssDeclarations(source) {
  if (hasUnsafeCss(source)) return false;
  const declarations = source.split(';').map((part) => part.trim()).filter(Boolean);
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator <= 0) return false;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!ALLOWED_STYLE_PROPERTIES.has(property) || !cssValueAllowed(property, value)) return false;
  }
  return true;
}

function validateCssStylesheet(source) {
  if (hasUnsafeCss(source)) return false;
  const stylesheet = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const allowedNames = ALLOWED_ELEMENTS;
  const selectorAllowed = (selector) => selector === '*'
    || allowedNames.has(selector)
    || /^[.#][A-Za-z_][A-Za-z0-9_-]*$/.test(selector);
  let cursor = 0;
  while (cursor < stylesheet.length) {
    while (cursor < stylesheet.length && /\s/.test(stylesheet[cursor])) cursor += 1;
    if (cursor === stylesheet.length) return true;
    const open = stylesheet.indexOf('{', cursor);
    if (open === -1) return false;
    const selectors = stylesheet.slice(cursor, open).split(',').map((item) => item.trim());
    if (selectors.length === 0 || selectors.some((selector) => !selectorAllowed(selector))) return false;
    const close = stylesheet.indexOf('}', open + 1);
    if (close === -1 || stylesheet.slice(open + 1, close).includes('{')) return false;
    if (!validateCssDeclarations(stylesheet.slice(open + 1, close))) return false;
    cursor = close + 1;
  }
  return true;
}

function parseXmlDeclaration(source, offset) {
  if (!source.startsWith('<?xml', offset)) return offset;
  const end = source.indexOf('?>', offset + 5);
  if (end === -1) throw new Error('has an unterminated XML declaration');
  const declaration = source.slice(offset, end + 2);
  const validDeclaration = /^<\?xml\s+version\s*=\s*(["'])1\.[01]\1(?:\s+encoding\s*=\s*(["'])(?:UTF-8|utf-8)\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>$/;
  if (!validDeclaration.test(declaration)) throw new Error('has an unsupported XML declaration');
  return end + 2;
}

function readXmlTag(source, offset) {
  const opening = xmlNameAt(source, offset + 1);
  if (!opening) throw new Error('contains a malformed XML element name');
  const tagName = opening.name;
  let cursor = opening.end;
  let selfClosing = false;
  const attributes = new Map();

  while (cursor < source.length) {
    const beforeWhitespace = cursor;
    while (cursor < source.length && isXmlWhitespace(source[cursor])) cursor += 1;
    const separated = cursor > beforeWhitespace;
    if (source[cursor] === '>') return { tagName, attributes, end: cursor + 1, selfClosing };
    if (source[cursor] === '/' && source[cursor + 1] === '>') {
      selfClosing = true;
      return { tagName, attributes, end: cursor + 2, selfClosing };
    }
    if (!separated) throw new Error('contains XML attributes without required whitespace');

    const parsedName = xmlNameAt(source, cursor);
    if (!parsedName) throw new Error('contains a malformed XML attribute name');
    const attributeName = parsedName.name;
    if (attributes.has(attributeName)) throw new Error(`contains duplicate XML attribute '${attributeName}'`);
    cursor = parsedName.end;
    while (cursor < source.length && isXmlWhitespace(source[cursor])) cursor += 1;
    if (source[cursor] !== '=') throw new Error(`XML attribute '${attributeName}' has no value`);
    cursor += 1;
    while (cursor < source.length && isXmlWhitespace(source[cursor])) cursor += 1;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") throw new Error(`XML attribute '${attributeName}' is not quoted`);
    cursor += 1;
    const valueEnd = source.indexOf(quote, cursor);
    if (valueEnd === -1) throw new Error(`XML attribute '${attributeName}' is unterminated`);
    const rawValue = source.slice(cursor, valueEnd);
    if (rawValue.includes('<')) throw new Error(`XML attribute '${attributeName}' contains an unescaped '<'`);
    if (hasInvalidXmlCharacters(rawValue)) throw new Error(`XML attribute '${attributeName}' contains an invalid XML character`);
    attributes.set(attributeName, decodeXmlEntities(rawValue));
    cursor = valueEnd + 1;
  }
  throw new Error('contains an unterminated XML start tag');
}

function parseXmlEndTag(source, offset) {
  const parsedName = xmlNameAt(source, offset + 2);
  if (!parsedName) throw new Error('contains a malformed XML closing tag');
  let cursor = parsedName.end;
  while (cursor < source.length && isXmlWhitespace(source[cursor])) cursor += 1;
  if (source[cursor] !== '>') throw new Error('contains a malformed XML closing tag');
  return { name: parsedName.name, end: cursor + 1 };
}

function parseSvgRootAndDimensions(source) {
  if (hasInvalidXmlCharacters(source)) throw new Error('contains an invalid XML character');
  let cursor = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  cursor = parseXmlDeclaration(source, cursor);
  const stack = [];
  let rootSeen = false;
  let rootClosed = false;
  let rootAttributes = null;
  let elementCount = 0;

  while (cursor < source.length) {
    if (source[cursor] !== '<') {
      const nextTag = source.indexOf('<', cursor);
      const end = nextTag === -1 ? source.length : nextTag;
      const rawText = source.slice(cursor, end);
      if (stack.length === 0 && /[^ \t\r\n]/.test(rawText)) {
        throw new Error('contains text outside its SVG root element');
      }
      const text = decodeXmlEntities(rawText);
      if (stack.length > 0 && stack[stack.length - 1].name === 'style' && !validateCssStylesheet(text)) {
        throw new Error('contains unsupported or unsafe CSS in a style element');
      }
      if (stack.length > 0 && text.includes(']]>')) throw new Error('contains an invalid XML CDATA terminator');
      cursor = end;
      continue;
    }

    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4);
      if (end === -1) throw new Error('contains an unterminated XML comment');
      const comment = source.slice(cursor + 4, end);
      if (comment.includes('--') || comment.endsWith('-')) throw new Error('contains an invalid XML comment');
      cursor = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', cursor)) {
      if (stack.length === 0) throw new Error('contains CDATA outside its SVG root element');
      const end = source.indexOf(']]>', cursor + 9);
      if (end === -1) throw new Error('contains an unterminated XML CDATA section');
      const cdata = source.slice(cursor + 9, end);
      if (stack[stack.length - 1].name === 'style' && !validateCssStylesheet(cdata)) {
        throw new Error('contains unsupported or unsafe CSS in a style element');
      }
      cursor = end + 3;
      continue;
    }
    if (source.startsWith('<?', cursor)) throw new Error('contains an unsupported XML processing instruction');
    if (source.startsWith('<!', cursor)) throw new Error('contains a forbidden XML declaration, DTD, or entity definition');

    if (source.startsWith('</', cursor)) {
      const closing = parseXmlEndTag(source, cursor);
      const current = stack.pop();
      if (!current || current.name !== closing.name) throw new Error(`contains a mismatched XML closing tag '${closing.name}'`);
      cursor = closing.end;
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    if (stack.some((element) => element.name === 'style')) {
      throw new Error('style elements must contain CSS text only');
    }
    if (rootClosed) throw new Error('contains more than one XML root element');
    elementCount += 1;
    if (elementCount > MAX_XML_ELEMENTS) throw new Error('contains too many XML elements');
    const tag = readXmlTag(source, cursor);
    if (!ALLOWED_ELEMENTS.has(tag.tagName)) throw new Error(`contains unsupported SVG element '${tag.tagName}'`);
    if (tag.tagName.includes(':')) throw new Error(`contains an unsupported namespaced SVG element '${tag.tagName}'`);

    const atRoot = stack.length === 0;
    if (atRoot) {
      if (rootSeen || tag.tagName !== 'svg') throw new Error('must have exactly one <svg> root element');
      if (tag.attributes.get('xmlns') !== SVG_NAMESPACE) throw new Error('root element must declare the SVG XML namespace');
      rootSeen = true;
      rootAttributes = tag.attributes;
    }

    const inheritedXlink = stack.length > 0 && stack[stack.length - 1].xlinkDeclared;
    const declaresXlink = tag.attributes.get('xmlns:xlink') === XLINK_NAMESPACE;
    const hasXlink = inheritedXlink || declaresXlink;
    for (const [attributeName, value] of tag.attributes) {
      const lowerAttributeName = attributeName.toLowerCase();
      if (lowerAttributeName.startsWith('on')) throw new Error(`contains an event-handler attribute '${attributeName}'`);
      if (lowerAttributeName === 'xml:base') throw new Error('contains xml:base, which can change resource resolution');
      if (attributeName.startsWith('xmlns:')
        && attributeName !== 'xmlns:xlink'
        && !(attributeName === 'xmlns:xml' && value === 'http://www.w3.org/XML/1998/namespace')) {
        throw new Error(`contains an unsupported XML namespace declaration '${attributeName}'`);
      }
      if (attributeName.startsWith('xlink:') && (attributeName !== 'xlink:href' || !hasXlink)) {
        throw new Error(`contains an unsupported or undeclared XLink attribute '${attributeName}'`);
      }
      if (attributeName.startsWith('xml:') && !['xml:lang', 'xml:space', 'xml:base'].includes(attributeName)) {
        throw new Error(`contains an unsupported XML attribute '${attributeName}'`);
      }
      if (attributeName.includes(':') && !['xmlns', 'xmlns:xlink', 'xmlns:xml', 'xlink:href', 'xml:lang', 'xml:space', 'xml:base'].includes(attributeName)) {
        throw new Error(`contains an unsupported namespaced attribute '${attributeName}'`);
      }
      if (attributeName === 'xmlns' && value !== SVG_NAMESPACE) {
        throw new Error('contains a non-SVG XML namespace declaration');
      }
      if (attributeName === 'xmlns:xlink' && value !== XLINK_NAMESPACE) {
        throw new Error('contains an invalid XLink XML namespace declaration');
      }
      if (lowerAttributeName === 'href' || lowerAttributeName === 'xlink:href') {
        if (value !== '' && !/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value)) {
          throw new Error(`contains an external or non-local resource reference in '${attributeName}'`);
        }
      } else if (lowerAttributeName === 'src' && value !== '') {
        throw new Error('contains an external resource reference in src');
      }
      if (lowerAttributeName === 'style' && !validateCssDeclarations(value)) {
        throw new Error('contains unsupported or unsafe CSS in a style attribute');
      }
      if (lowerAttributeName !== 'style' && hasUnsafeCss(value)) {
        throw new Error(`contains a CSS URL or escaped reference in '${attributeName}'`);
      }
    }

    if (!tag.selfClosing) {
      if (stack.length >= MAX_XML_DEPTH) throw new Error('exceeds the supported XML nesting depth');
      stack.push({ name: tag.tagName, xlinkDeclared: hasXlink });
    } else if (atRoot) {
      rootClosed = true;
    }
    cursor = tag.end;
  }

  if (!rootSeen || !rootClosed || stack.length !== 0) throw new Error('is not a well-formed single-root SVG XML document');
  return rootAttributes;
}

function parseDimension(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^((?:\d+(?:\.\d*)?|\.\d+))(?:px)?$/i);
  if (!match) return null;
  const dimension = Number(match[1]);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
}

function parseViewBox(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4 || parts.some((part) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(part))) return null;
  const dimensions = parts.map(Number);
  if (!dimensions.every(Number.isFinite) || dimensions[2] <= 0 || dimensions[3] <= 0) return null;
  return { width: dimensions[2], height: dimensions[3] };
}

function validateSvgBytes(field, bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    return error(field, 'asset must be included as UTF-8 SVG bytes');
  }
  if (bytes.byteLength === 0) return error(field, 'SVG asset is empty');
  if (bytes.byteLength > MAX_SVG_BYTES) return error(field, 'SVG asset exceeds the 5 MiB size limit');

  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return error(field, 'SVG asset is not valid UTF-8');
  }

  let rootAttributes;
  try {
    rootAttributes = parseSvgRootAndDimensions(source);
  } catch (failure) {
    return error(field, `SVG ${failure && failure.message ? failure.message : 'is invalid'}`);
  }

  const widthValue = rootAttributes.get('width');
  const heightValue = rootAttributes.get('height');
  const viewBoxValue = rootAttributes.get('viewBox');
  const viewBox = viewBoxValue === undefined ? null : parseViewBox(viewBoxValue);
  if (viewBoxValue !== undefined && !viewBox) return error(field, 'SVG viewBox must contain four finite numbers and a positive viewport');

  if ((widthValue === undefined) !== (heightValue === undefined)) {
    return error(field, 'SVG width and height must be provided together');
  }
  const explicit = widthValue === undefined
    ? null
    : { width: parseDimension(widthValue), height: parseDimension(heightValue) };
  if (explicit && (explicit.width === null || explicit.height === null)) {
    return error(field, 'SVG width and height must use positive pixel dimensions');
  }

  const dimensions = explicit || viewBox;
  if (!dimensions) return error(field, 'SVG must declare width and height or a square viewBox');
  const isLargeSquare = dimensions.width >= 48
    && dimensions.height >= 48
    && Math.abs(dimensions.width - dimensions.height) <= 0.000001;
  if (!isLargeSquare) return error(field, 'SVG viewport must be square and at least 48 pixels in each dimension');
  if (viewBox && (viewBox.width < 48 || viewBox.height < 48
    || Math.abs(viewBox.width - viewBox.height) > 0.000001)) {
    return error(field, 'SVG viewBox must be square and at least 48 pixels in each dimension');
  }
  return null;
}

function resolveAssetPath(field, value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { error: error(field, 'must be a non-empty relative SVG path') };
  }
  if (!value.startsWith('./skills/') || value.includes('\\') || /[\u0000-\u0020\u007f?#%:]/u.test(value)) {
    return { error: error(field, 'must use a canonical contained ./skills/<owner>/... SVG path') };
  }
  const segments = value.slice(2).split('/');
  if (segments.length < 3 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { error: error(field, 'must resolve to an asset owned by a packaged skill') };
  }
  if (!/^skills\/[^/]+\//.test(value.slice(2))) {
    return { error: error(field, 'must resolve to an asset owned by a packaged skill') };
  }
  if (!/\.svg$/i.test(value)) {
    return { error: error(field, 'must reference an SVG asset for the current submission profile') };
  }
  return { path: value.slice(2) };
}

function validateOpenaiListingAssets(listing, filesMap) {
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return [];
  const errors = [];
  if (Object.prototype.hasOwnProperty.call(listing, 'screenshots')) {
    if (!Array.isArray(listing.screenshots)) {
      errors.push(error('screenshots', 'must be omitted for the skills-only submission profile'));
    } else if (listing.screenshots.length > 0) {
      errors.push(error('screenshots', 'are unsupported for the current skills-only submission profile'));
    }
  }

  for (const field of ['composerIcon', 'logo', 'composerIconDark', 'logoDark']) {
    if (!Object.prototype.hasOwnProperty.call(listing, field)) continue;
    const resolved = resolveAssetPath(field, listing[field]);
    if (resolved.error) {
      errors.push(resolved.error);
      continue;
    }
    const bytes = filesMap instanceof Map ? filesMap.get(resolved.path) : undefined;
    if (bytes === undefined) {
      errors.push(error(field, `asset '${listing[field]}' is missing from the submission package`));
      continue;
    }
    const svgError = validateSvgBytes(field, bytes);
    if (svgError) errors.push(svgError);
  }
  return errors;
}

module.exports = { validateOpenaiListingAssets };
