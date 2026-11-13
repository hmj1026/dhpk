scope: agents-skills
note: Reserved-name matching for `.agents/skills` now case-folds (NFC then lowercase) on every Host, so a case-variant unmanaged entry such as `Code-Trace/` is refused with OWNERSHIP_REFUSED instead of depending on the filesystem (#1353).
