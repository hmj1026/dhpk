#!/usr/bin/env node
'use strict';

// Shared encoder/parser seam for run-codex.sh timeout evidence. The wrapper
// invokes this file before its EXIT trap removes the temporary capture files;
// callers and tests can import the same functions without duplicating framing
// or redaction rules.

const fs = require('node:fs');

const SCHEMA = 'dhpk.codex.timeout.v1';
const MAX_DIAGNOSTIC_BYTES = 8192;
const MAX_DIAGNOSTIC_SCAN_BYTES = MAX_DIAGNOSTIC_BYTES * 2;
const MAX_REPORT_BYTES = 262144;
const REPORT_OVERFLOW_MARKER = '[TRUNCATED_REPORT_OMITTED]';
const DIAGNOSTIC_OVERFLOW_MARKER = '[TRUNCATED_DIAGNOSTIC_OMITTED]';
const MAX_ENVELOPE_BYTES = 512 * 1024;
const MAX_REPORT_B64_BYTES = Math.ceil(MAX_REPORT_BYTES / 3) * 4 + 4;
const MAX_DIAGNOSTIC_B64_BYTES = Math.ceil(MAX_DIAGNOSTIC_BYTES / 3) * 4 + 4;
const STABLE_KEYS = [
  'schema', 'status', 'verified_wrapper_timeout', 'exit_code', 'budget_secs',
  'elapsed_secs', 'report_present', 'report_encoding', 'report_b64',
  'stderr_tail_encoding', 'stderr_tail_b64', 'stdout_tail_encoding',
  'stdout_tail_b64', 'redaction',
];

function readFile(file, maxBytes, overflowMarker) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const limit = Number.isFinite(maxBytes) ? Math.max(0, maxBytes) : size;
      // Never tail a truncated capture before redaction: a credential label can
      // fall just before the cut and leave its value in the retained suffix.
      // Emit only a marker so bounded salvage is fail-closed at every boundary.
      if (size > limit) return overflowMarker || '[TRUNCATED_CAPTURE_OMITTED]';
      const length = Math.min(size, limit);
      const bytes = Buffer.alloc(length);
      fs.readSync(fd, bytes, 0, length, 0);
      return bytes.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_error) {
    return '';
  }
}

function boundedTail(value) {
  const bytes = Buffer.from(String(value || ''), 'utf8');
  return (bytes.length > MAX_DIAGNOSTIC_BYTES
    ? bytes.subarray(bytes.length - MAX_DIAGNOSTIC_BYTES)
    : bytes).toString('utf8');
}

function boundedReport(value) {
  const bytes = Buffer.from(String(value || ''), 'utf8');
  if (bytes.length <= MAX_REPORT_BYTES) return bytes.toString('utf8');
  const marker = Buffer.from('[TRUNCATED]\n', 'utf8');
  const tailBytes = Math.max(0, MAX_REPORT_BYTES - marker.length);
  return `${marker.toString('utf8')}${bytes.subarray(bytes.length - tailBytes).toString('utf8')}`;
}

function redactText(value, hiddenPaths = []) {
  let text = String(value || '');
  for (const hiddenPath of hiddenPaths) {
    if (hiddenPath) text = text.split(String(hiddenPath)).join('[TEMP_PATH]');
  }
  // Remove private-key blocks and whole-line credential headers before token
  // matching; these formats otherwise carry secrets without a key/value label.
  text = text.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, '[REDACTED_PEM]');
  text = text.replace(/\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\b\s*[:=][^\r\n]*/gi, '$1: [REDACTED]');
  // Redact bearer/basic credentials before generic key/value matching so the
  // token following the scheme cannot remain after the label is replaced.
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  text = text.replace(/\bBasic\s+[A-Za-z0-9+/=]{4,}/gi, 'Basic [REDACTED]');
  text = text.replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
  text = text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]*:[^/\s@]+@/gi, '$1[REDACTED]@');
  text = text.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,}|npm_[A-Za-z0-9]{20,})\b/g, '[REDACTED]');
  // Common credential-bearing labels. Unquoted values consume the rest of the
  // line so whitespace-bearing passphrases cannot leak after the first token;
  // quoted values retain their delimiters and escaped characters.
  text = text.replace(
    /(["']?(?:api[_ -]?key|access[_ -]?token|access[_ -]?key|auth(?:entication)?|client[_ -]?secret|secret[_ -]?key|secret|token|password|passwd|passphrase|pwd|session[_ -]?id|csrf|xsrf)\b["']?\s*[:=]\s*)(?!["'])[^\r\n]*/gi,
    (_match, prefix) => `${prefix}[REDACTED]`,
  );
  text = text.replace(
    /(["']?(?:api[_ -]?key|access[_ -]?token|access[_ -]?key|auth(?:entication)?|client[_ -]?secret|secret[_ -]?key|secret|token|password|passwd|passphrase|pwd|session[_ -]?id|csrf|xsrf)\b["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi,
    (_match, prefix, value) => {
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
      return `${prefix}${quote}[REDACTED]${quote}`;
    },
  );
  // The wrapper's temporary capture paths are implementation details and are
  // never useful to a caller. Remove the known run-codex temp shape if a
  // backend echoed it into stdout/stderr.
  text = text.replace(/(?:\/tmp|\/var\/tmp)\/run-codex\.[A-Za-z0-9]+(?:\/[^\s"'`]+)?/g, '[TEMP_PATH]');
  return text;
}

function encodeDiagnostic(value, hiddenPaths) {
  return Buffer.from(sanitizeDiagnostic(value, hiddenPaths), 'utf8').toString('base64');
}

function sanitizeDiagnostic(value, hiddenPaths = []) {
  return boundedTail(redactText(value, hiddenPaths));
}

function decodePayload(value) {
  return Buffer.from(String(value || ''), 'base64').toString('utf8');
}

function asInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function readStdinBounded(maxBytes) {
  const chunks = [];
  let total = 0;
  while (total <= maxBytes) {
    const length = Math.min(65536, maxBytes + 1 - total);
    const chunk = Buffer.alloc(length);
    const count = fs.readSync(0, chunk, 0, length, null);
    if (count === 0) break;
    chunks.push(chunk.subarray(0, count));
    total += count;
    if (total > maxBytes) return null;
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function buildTimeoutEnvelope({ budgetSecs, elapsedSecs, reportFile, stderrFile, stdoutFile, tempDir }) {
  const report = readFile(reportFile, MAX_REPORT_BYTES, REPORT_OVERFLOW_MARKER);
  const stderrLog = readFile(stderrFile, MAX_DIAGNOSTIC_SCAN_BYTES, DIAGNOSTIC_OVERFLOW_MARKER);
  const stdoutLog = readFile(stdoutFile, MAX_DIAGNOSTIC_SCAN_BYTES, DIAGNOSTIC_OVERFLOW_MARKER);
  const hiddenPaths = [tempDir, reportFile, stderrFile, stdoutFile].filter(Boolean);
  return {
    schema: SCHEMA,
    status: 'TIMEOUT',
    verified_wrapper_timeout: true,
    exit_code: 124,
    budget_secs: asInteger(budgetSecs),
    elapsed_secs: asInteger(elapsedSecs),
    report_present: report.length > 0,
    report_encoding: 'base64',
    report_b64: report.length > 0 ? Buffer.from(boundedReport(redactText(report, hiddenPaths)), 'utf8').toString('base64') : '',
    stderr_tail_encoding: 'base64',
    stderr_tail_b64: encodeDiagnostic(stderrLog, hiddenPaths),
    stdout_tail_encoding: 'base64',
    stdout_tail_b64: encodeDiagnostic(stdoutLog, hiddenPaths),
    redaction: 'applied',
  };
}

function parseTimeoutEnvelope(raw) {
  try {
    return parseTimeoutEnvelopeUnsafe(raw);
  } catch (_error) {
    return null;
  }
}

function parseTimeoutEnvelopeUnsafe(raw) {
  if (typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') > MAX_ENVELOPE_BYTES) return null;
  let value;
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_error) {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...STABLE_KEYS].sort())) return null;
  if (value.schema !== SCHEMA || value.status !== 'TIMEOUT'
      || value.verified_wrapper_timeout !== true || value.exit_code !== 124) return null;
  if (value.report_encoding !== 'base64' || value.stderr_tail_encoding !== 'base64'
      || value.stdout_tail_encoding !== 'base64'
      || !['applied', 'unavailable'].includes(value.redaction)) return null;
  if (typeof value.report_present !== 'boolean'
      || typeof value.report_b64 !== 'string'
      || typeof value.stderr_tail_b64 !== 'string'
      || typeof value.stdout_tail_b64 !== 'string') return null;
  if (value.report_b64.length > MAX_REPORT_B64_BYTES
      || value.stderr_tail_b64.length > MAX_DIAGNOSTIC_B64_BYTES
      || value.stdout_tail_b64.length > MAX_DIAGNOSTIC_B64_BYTES) return null;
  if (!value.report_present && value.report_b64 !== '') return null;
  if (value.report_present && value.report_b64 === '') return null;
  if (value.redaction === 'unavailable'
      && (value.report_present || value.report_b64 !== ''
        || value.stderr_tail_b64 !== '' || value.stdout_tail_b64 !== '')) return null;
  if (!Number.isInteger(value.budget_secs) || value.budget_secs < 0
      || !Number.isInteger(value.elapsed_secs) || value.elapsed_secs < 0) return null;
  const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (![value.report_b64, value.stderr_tail_b64, value.stdout_tail_b64].every((payload) => base64.test(payload))) return null;
  return value;
}

function main(argv) {
  if (argv[0] === '--parse') {
    let parsed;
    try {
      const input = readStdinBounded(MAX_ENVELOPE_BYTES);
      parsed = input === null ? null : parseTimeoutEnvelope(input);
    } catch (_error) {
      parsed = null;
    }
    if (!parsed) {
      process.stderr.write('codex-timeout-envelope: invalid envelope\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write(JSON.stringify(parsed));
    return;
  }
  if (argv[0] === '--diagnostic-text') {
    const [, file, tempDir] = argv;
    process.stdout.write(sanitizeDiagnostic(readFile(file, MAX_DIAGNOSTIC_SCAN_BYTES, DIAGNOSTIC_OVERFLOW_MARKER), [tempDir, file]));
    return;
  }
  if (argv[0] === '--diagnostic') {
    const [, file, tempDir] = argv;
    process.stdout.write(encodeDiagnostic(readFile(file, MAX_DIAGNOSTIC_SCAN_BYTES, DIAGNOSTIC_OVERFLOW_MARKER), [tempDir, file]));
    return;
  }
  const [reportFile, stderrFile, stdoutFile, budgetSecs, elapsedSecs, tempDir] = argv;
  if (!reportFile || !stderrFile || !stdoutFile) {
    process.stderr.write('codex-timeout-envelope: expected report, stderr, stdout, budget, and elapsed paths\n');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(JSON.stringify(buildTimeoutEnvelope({
    reportFile,
    stderrFile,
    stdoutFile,
    budgetSecs,
    elapsedSecs,
    tempDir,
  })));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_SCAN_BYTES,
  MAX_REPORT_BYTES,
  MAX_ENVELOPE_BYTES,
  MAX_REPORT_B64_BYTES,
  MAX_DIAGNOSTIC_B64_BYTES,
  REPORT_OVERFLOW_MARKER,
  DIAGNOSTIC_OVERFLOW_MARKER,
  SCHEMA,
  STABLE_KEYS,
  buildTimeoutEnvelope,
  decodePayload,
  boundedTail,
  parseTimeoutEnvelope,
  redactText,
  sanitizeDiagnostic,
};
