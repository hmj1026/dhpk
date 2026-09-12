'use strict';

// One redaction boundary for consumer/release diagnostics. Redact before
// truncating so a secret at the retained tail cannot leak through evidence.

const AUTH_HEADER = /\b(authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+[^\r\n,;]+/gi;
const SENSITIVE_ASSIGNMENT = /(["']?)(authorization|proxy-authorization|token|access[_-]?token|refresh[_-]?token|oauth[_-]?token|id[_-]?token|session[_-]?token|password|secret|api[_-]?key|credential)\1\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi;
const URL_CREDENTIALS = /\b((?:https?|postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?):\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_AUTH = /\b(bearer|basic)\s+[^\s,;\r\n]+/gi;
const KNOWN_TOKEN = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b/gi;

function redactSensitiveText(value, { maxLength = 800 } = {}) {
  if (value === undefined || value === null) return null;
  let text = String(value);
  text = text.replace(URL_CREDENTIALS, '$1<redacted>@');
  text = text.replace(AUTH_HEADER, (match, key) => `${key}: <redacted>`);
  text = text.replace(BEARER_AUTH, (match) => `${match.split(/\s+/, 1)[0]} <redacted>`);
  text = text.replace(SENSITIVE_ASSIGNMENT, (match, quote, key) => `${key}: <redacted>`);
  text = text.replace(KNOWN_TOKEN, '<redacted-token>');
  return text.slice(-maxLength);
}

module.exports = { redactSensitiveText };
