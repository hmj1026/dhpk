scope: hooks
note: Fix pre-edit-guard (and other hooks) failing open under pipefail when an early-exiting grep -q ended a pipe, which let a multi-line .env path through under load.
