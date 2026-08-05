# Manual hook setup

Manual installs may add this block to `~/.claude/settings.json` after explicit
opt-in (`config.json` → `observer.enabled: true`):

```json
{
  "hooks": {
    "PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "~/.claude/skills/dhpk-continuous-learning-v2/hooks/observe.sh"}]}],
    "PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "~/.claude/skills/dhpk-continuous-learning-v2/hooks/observe.sh"}]}]
  }
}
```

Plugin installs should use the plugin's managed `hooks/hooks.json` instead; do
not duplicate the observer in consumer settings.
