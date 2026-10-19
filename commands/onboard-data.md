---
name: onboard-data
description: Review and onboard warehouse tables, then resume, inspect status or retry selected imports
argument-hint: "[optional goal | resume <run-id> | status <run-id> | retry <run-id> [table-ids] | resolve <run-id> <table-id> | include <run-id> <table-ids> | replace <run-id> <table-id> | refresh <run-id>]"
---

All instructions are maintained in `skills/onboard-data/SKILL.md` to prevent divergence.

**Before doing anything else**, locate and read the installed skill's canonical file, not a path relative to the user's working directory. In Claude Code, read `${CLAUDE_PLUGIN_ROOT}/skills/onboard-data/SKILL.md`. In other hosts, use the absolute installed skill directory supplied by that host's skill metadata. If the host cannot resolve the installed location, ask for it instead of reading an unrelated project's `skills/onboard-data/SKILL.md`.

Follow the skill's instructions to handle this command. Resolve its referenced files relative to that installed skill directory.
