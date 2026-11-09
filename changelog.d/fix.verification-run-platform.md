scope: maintainer
note: `verification-run.js start` now explains why it refuses to launch a command without Linux process identity: it prints the platform or `/proc` failure and records `unknownReason`; behavior is unchanged (exit 2, no child) (#1257).
