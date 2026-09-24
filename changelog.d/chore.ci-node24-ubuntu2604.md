scope: ci-workflows
note: Move the pinned GitHub Actions to their Node 24 majors (upload-artifact v7.0.1, download-artifact v8.0.1, setup-node v7.0.0, markdownlint-cli2-action v24.2.0), pin every Linux job in CI and Release to ubuntu-26.04 ahead of the ubuntu-latest migration, and make the workflow policy reject any other Linux runner label so CI and Release cannot drift onto different images.
