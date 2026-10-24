Add an optional receipt-status filter to `src/cli.js`. Support
`node src/cli.js --status paid` and `node src/cli.js --status open`.
Without `--status`, preserve the existing output exactly. Reject any other
status with a nonzero exit status and an error that identifies the valid
statuses. Change only `src/cli.js`.

Run the Node.js verifier provided outside this project when the feature is
ready.
