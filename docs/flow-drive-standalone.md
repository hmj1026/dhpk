# Standalone Flow Drive for Codex

This guide installs only the canonical Flow Drive skill into Codex. It does
not require a dhpk build, sibling skills, a projection receipt, or edits to
project instruction files. The pinned source is the complete canonical
[`skills/flow-drive/`](https://github.com/hmj1026/dhpk/tree/c2f5477c2ac9148fa2022508da93cc3ec3ef7f34/skills/flow-drive)
directory at commit `c2f5477c2ac9148fa2022508da93cc3ec3ef7f34`.
The full dhpk installation remains a separate option in the [platform
installation guide](./platform-installation.md).

The copy command needs Git with sparse-checkout support and a POSIX-compatible
shell with `mktemp`, `cp`, `diff`, and `mkdir`.

The directory contains `SKILL.md`, `agents/openai.yaml`, `distribution.yaml`,
and `references/migration.md`. Copy the whole directory so its relative
references stay together. The copy is the current task-only Flow Drive; users
who need its retired runner or selectors should follow the [migration guide](../skills/flow-drive/references/migration.md)
and pin the legacy revision there.

## Install in the current project

Run from the consumer project root. This route uses Codex's project skill
discovery under `.agents/skills/` and does not install other dhpk content.
Codex also discovers account skills under `~/.agents/skills/`; see its
[skills guide](https://learn.chatgpt.com/docs/build-skills).

```sh
set -eu

ref=c2f5477c2ac9148fa2022508da93cc3ec3ef7f34
project_root=$(pwd -P)
tmp_root=$(mktemp -d)
trap 'rm -rf "$tmp_root"' EXIT

git clone --filter=blob:none --no-checkout \
  https://github.com/hmj1026/dhpk.git "$tmp_root/dhpk"
git -C "$tmp_root/dhpk" sparse-checkout init --cone
git -C "$tmp_root/dhpk" sparse-checkout set skills/flow-drive
git -C "$tmp_root/dhpk" checkout --detach "$ref"

source="$tmp_root/dhpk/skills/flow-drive"
destination="$project_root/.agents/skills/flow-drive"

# Keep the project-local destination physically inside this project.
if [ -L "$project_root/.agents" ] || [ -L "$project_root/.agents/skills" ]; then
  printf '%s\n' 'A project skill parent is a symlink; inspect its owner and target first.' >&2
  exit 1
fi
mkdir -p "$project_root/.agents/skills"

# Check both ordinary paths and dangling symlinks. mkdir below repeats the
# absence check atomically before this run claims the destination.
if [ -e "$destination" ] || [ -L "$destination" ]; then
  printf '%s\n' "Preserving existing destination: $destination" >&2
  exit 1
fi

cp -R "$source" "$tmp_root/flow-drive-staged"
diff -qr "$source" "$tmp_root/flow-drive-staged"

# mkdir fails if a file, directory, or symlink appeared at this path.
if ! mkdir "$destination"; then
  printf '%s\n' "Preserving a destination created by another writer: $destination" >&2
  exit 1
fi
cp -R "$tmp_root/flow-drive-staged/." "$destination/"
diff -qr "$source" "$destination"
```

The `mkdir` is the exclusive collision check: an existing directory, file, or
dangling symlink is left untouched. If copying or the final comparison fails,
stop and inspect the newly claimed destination against the pinned source;
preserve it until you confirm which files this attempt created. Do not turn a
partial copy into an update or remove it blindly.

For an explicit account-wide install, use the same source and staging steps,
with this destination setup instead of the project-local one:

```sh
account_skills="$HOME/.agents/skills"
if [ -L "$HOME/.agents" ] || [ -L "$account_skills" ]; then
  printf '%s\n' 'An account skill parent is a symlink; inspect its owner and target first.' >&2
  exit 1
fi
mkdir -p "$account_skills"
destination="$account_skills/flow-drive"
```

Then use the same collision check, complete-directory copy, and comparison
steps. This copy is available in every project for the account. Do not install
both the project and account copies unless you have a reason to manage
duplicate discovery. The project-local path remains the default.

Start a fresh Codex session in the project and confirm that exactly one
`flow-drive` entry is discovered. Only then invoke `$flow-drive --help` or a
bounded task. A copied directory or a static package check alone is not runtime
evidence; record runtime as `NOT_RUN` until a fresh session observes the skill
and its behavior.

## Update this standalone copy

Choose and record a full commit before updating. Fetch that revision into a
temporary checkout and compare its complete `skills/flow-drive/` tree with the
installed directory. If you recorded the previous pin, also compare the
installed tree with the previous pinned source to identify local changes. If
the old pin is unknown or any file differs from its old source, preserve the
current directory and manually reconcile those changes before switching.

After review, move the selected user-owned directory to a unique backup path
outside `.agents/skills/`, then install and compare the new pinned directory
using the procedure above. Keep the backup until a fresh session discovers one
copy and any local edits have been reconciled. If installation fails and the
destination is still absent, restore the backup to its original path. Never
replace an existing same-name destination, merge automatically, or update a
managed receipt-owned tree through this standalone procedure.

## Remove this standalone copy

Confirm that the selected physical directory is the user-owned
`.agents/skills/flow-drive` copy and inspect it for local changes. Move that
directory to a unique backup path outside `.agents/skills/`; this removes it
from project discovery while preserving every file. After confirming that no
changes need recovery, remove only that backup. Do not remove a symlink target,
the `.agents/skills/` parent, another skill, a dhpk receipt, or another Host's
binding. Start a fresh session and confirm that the standalone copy is gone.

## Switch from a managed dhpk installation

Use this recipe only for a receipt-owned **project-local** Flow Drive source.
First inspect Codex's discovered entries and the relevant installation receipt
to identify every active source and alias. Confirm that the selected source is
owned by this project, that its resolved `SKILL.md` path remains inside this
project, and that no other project shares that resolved target. A matching
directory name alone does not establish ownership. If the source is global,
plugin-owned, shared with another project, or its owner/target is unclear, stop
and preserve it. Disabling a shared target from Codex's user config can hide it
from other projects too.

Keep the managed directory and its receipt intact. In Codex's active user
configuration file (normally `~/.codex/config.toml`), add a path-specific
disable entry for the managed source's absolute `SKILL.md` path. If
`CODEX_HOME` is set, use that Codex home instead of assuming `~/.codex`:

```toml
[[skills.config]]
path = "/absolute/project/path/to/managed-flow-drive/SKILL.md"
enabled = false
```

Codex documents this per-path setting in its [skills guide](https://learn.chatgpt.com/docs/build-skills).
This is an account-level setting: it can affect other projects that resolve
the same `SKILL.md` target. Edit only the exact matching entry in the active
user config and preserve all other settings. The project `.codex/config.toml`
route was not confirmed to disable discovery, so do not rely on it for this
switch. Do not modify the managed tree or receipt.

Then install the complete standalone copy at the distinct
`.agents/skills/flow-drive-standalone/` path, keeping the public skill identity
unchanged. For this destination, use the same pinned copy procedure but set
`destination` to that path. Restart Codex and confirm in a fresh session that
exactly one intended `flow-drive` is active. If the source inventory is
ambiguous or the fresh session shows zero or multiple active copies, stop and
undo only the standalone copy and the exact config entry you added or changed.

To reverse a successful switch, move the standalone user-owned directory
outside `.agents/skills/`, then restore only the prior value of the managed
source's config entry (or remove the entry if this procedure added it). Restart
Codex and confirm that the original managed source is discovered. Preserve its
receipt and all other Host bindings throughout.
