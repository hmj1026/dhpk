# Manual hook setup

Manual installs may add this block to `~/.claude/settings.json` after explicit
opt-in (`config.json` → `observer.enabled: true`). The config flag is only the
runtime gate; it does not register a hook by itself:

```json
{
  "hooks": {
    "PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "~/.claude/skills/dhpk-continuous-learning-v2/hooks/observe.sh"}]}],
    "PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "~/.claude/skills/dhpk-continuous-learning-v2/hooks/observe.sh"}]}]
  }
}
```

For a plugin install, the current root `hooks/hooks.json` does not include this
optional observer. If you opt in, add equivalent entries to consumer settings
with the installed plugin's absolute `observe.sh` path. `${CLAUDE_PLUGIN_ROOT}`
is available only inside plugin-managed hook entries, so do not assume it works
in arbitrary settings. Remove any manual entries if a future plugin release
registers the observer itself to avoid duplicate capture.
