'use strict';

// Shared WARN/ERROR reporter for dhpk CI validators (zero-dep).
//
// Two severities:
//   err(msg)  — structural / always-fatal findings (missing file, broken
//               reference). Always counts as an error.
//   warn(msg) — style / frontmatter findings. Non-blocking by default;
//               promoted to errors when `--strict` is passed or CI_STRICT=1.
//
// done(okMsg) prints the summary and exits non-zero if any errors accumulated.

function createReporter(label, opts = {}) {
  const strict =
    opts.strict != null
      ? opts.strict
      : process.argv.includes('--strict') || process.env.CI_STRICT === '1';

  let errors = 0;
  let warnings = 0;

  return {
    strict,
    err(msg) {
      console.error(`ERROR [${label}]: ${msg}`);
      errors += 1;
    },
    warn(msg) {
      if (strict) {
        console.error(`ERROR [${label}]: ${msg}`);
        errors += 1;
      } else {
        console.warn(`WARN [${label}]: ${msg}`);
        warnings += 1;
      }
    },
    done(okMsg) {
      if (errors > 0) {
        console.error(
          `FAIL [${label}]: ${errors} error(s)` +
            (warnings ? `, ${warnings} warning(s)` : '')
        );
        process.exit(1);
      }
      const suffix = warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : '';
      console.log(`PASS [${label}]: ${okMsg}${suffix}`);
    },
  };
}

module.exports = { createReporter };
