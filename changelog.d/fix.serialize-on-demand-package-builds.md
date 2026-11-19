scope: distribution
note: Serialize concurrent on-demand package builds, and validation of the same package directory (default or custom `--output`), and write release archives atomically so parallel test and package-verification runs do not race on dist/on-demand outputs. Validation of a package in a read-only directory still works without a lock.
