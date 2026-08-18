# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-XX-XX

### Added

- **Scan & import** — scans official skill roots (`~/.agents/skills`, `$DSH_HOME/skills`)
  and imports skills into the DSH skills folder with one click; supports uploading
  a `.zip` archive or a whole folder from the browser (text files only, junk/hidden
  paths skipped automatically).
- **Group enable / disable** — create groups, add skills, per-skill enable toggle,
  delete groups. Enabling/disabling is an **atomic rename** of `SKILL.md` ↔
  `SKILL.md.disable` (zero content writes, 1-2 native fs ops per skill).
- **Default group** — pick the group that shapes every session's model skill
  catalog; `全部启用` (all enabled) and `全部禁用` (empty catalog, reserved id
  `__all_off__`) special modes.
- **Per-session picker** — a session-scoped group picker in the conversation
  input bar.
- **Cross-process config lock** — all writes to `$DSH_HOME/skill-mgmt.json` are
  guarded by an exclusive lock file, safe with concurrent dsh sessions.
- **`skillmg_*` model tools** — the AI can manage skills on its own:
  `skillmg_get_config`, `skillmg_scan`, `skillmg_import`, `skillmg_list_groups`,
  `skillmg_create_group`, `skillmg_delete_group`, `skillmg_update_group`,
  `skillmg_set_default_group`, `skillmg_set_session_group`, `skillmg_get_session`,
  `skillmg_debug_catalog`.
- **Auto-maintained guide skill** — the `skill-grouping` companion skill is
  recreated on boot if missing, teaching the AI the whole workflow.
- **All-Chinese web UI** — Settings → "Skill 管理", official DSH theme tokens.
