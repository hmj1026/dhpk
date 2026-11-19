scope: projection-journal
note: Batch project-agent projection journal effects per publish phase to cut fsync overhead during installs and updates while preserving per-step crash recovery; recovery never deletes a user file at a publish target the crashed run had not reached.
