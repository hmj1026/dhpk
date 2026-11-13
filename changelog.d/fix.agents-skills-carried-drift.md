scope: agents-skills
note: `npm run sync:local-skills` now refuses with `OWNERSHIP_REFUSED` when a deselected (carried) or legacy-released skill file changes between planning and activation, or when a carried file no longer matches its receipt fingerprint, instead of silently overwriting it (#1343).
