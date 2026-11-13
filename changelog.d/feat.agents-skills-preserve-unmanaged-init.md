scope: agents-skills
note: Added an opt-in `--preserve-unmanaged` to `gen-agents-skills.js` and `npm run sync:local-skills` that creates the first `.agents/skills` projection beside non-colliding third-party entries (such as GitNexus skills) without a receipt, keeping their bytes and modes and leaving them unowned; the default still refuses with NO_OWNER_RECEIPT (#1344).
