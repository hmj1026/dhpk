# Storage, Project Detection & Configuration

Reference for where data lives, how the current project is detected, the observer
configuration knobs, and the on-disk file layout. Read when setting up storage,
debugging project hashing, tuning the background observer, or locating instinct files.

## Project Detection

The system automatically detects your current project:

1. **`CLAUDE_PROJECT_DIR` env var** (highest priority)
2. **`git remote get-url origin`** — hashed to create a portable project ID (same
   repo on different machines gets the same ID)
3. **`git rev-parse --show-toplevel`** — fallback using repo path (machine-specific)
4. **Global fallback** — if no project is detected, instincts go to global scope

Each project gets a 12-character hash ID (e.g., `a1b2c3d4e5f6`). A registry file at
`${XDG_DATA_HOME:-~/.local/share}/dhpk-homunculus/projects.json` maps IDs to
human-readable names.

## Data Directory

Continuous-learning-v2 stores observer data outside `~/.claude` so Claude Code's
sensitive-path guard does not block background instinct writes:

1. `CLV2_HOMUNCULUS_DIR` when set to an absolute path
2. `$XDG_DATA_HOME/dhpk-homunculus`
3. `$HOME/.local/share/dhpk-homunculus`

Existing users with data at `~/.claude/homunculus` (or the interim
`ecc-homunculus` location) can migrate once:

```bash
bash skills/continuous-learning-v2/scripts/migrate-homunculus.sh
```

## Configuration

Edit `config.json` to control the background observer:

```json
{
  "version": "2.1",
  "observer": {
    "enabled": false,
    "run_interval_minutes": 5,
    "min_observations_to_analyze": 20
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `observer.enabled` | `false` | Enable the background observer agent |
| `observer.run_interval_minutes` | `5` | How often the observer analyzes observations |
| `observer.min_observations_to_analyze` | `20` | Minimum observations before analysis runs |

Other behavior (observation capture, instinct thresholds, project scoping, promotion
criteria) is configured via code defaults in `instinct-cli.py` and `observe.sh`.

## File Structure

```
${XDG_DATA_HOME:-~/.local/share}/dhpk-homunculus/
+-- identity.json           # Your profile, technical level
+-- projects.json           # Registry: project hash -> name/path/remote
+-- observations.jsonl      # Global observations (fallback)
+-- instincts/
|   +-- personal/           # Global auto-learned instincts
|   +-- inherited/          # Global imported instincts
+-- evolved/
|   +-- agents/             # Global generated agents
|   +-- skills/             # Global generated skills
|   +-- commands/           # Global generated commands
+-- projects/
    +-- a1b2c3d4e5f6/       # Project hash (from git remote URL)
    |   +-- project.json    # Per-project metadata mirror (id/name/root/remote)
    |   +-- observations.jsonl
    |   +-- observations.archive/
    |   +-- instincts/
    |   |   +-- personal/   # Project-specific auto-learned
    |   |   +-- inherited/  # Project-specific imported
    |   +-- evolved/
    |       +-- skills/
    |       +-- commands/
    |       +-- agents/
    +-- f6e5d4c3b2a1/       # Another project
        +-- ...
```
