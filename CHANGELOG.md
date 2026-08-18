# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-18

### Added

- **skill-only preset template** (`presets/skill-only/agent.cordis.yml`) — make DSH
  discover skills from `$DSH_HOME/skills` only (`includeDefaultRoots: false` +
  `customSkillDirs`), so `~/.agents/skills` no longer bypasses group switching.
  Docs: README「重要」section + `docs/how-it-works.md` §5.
- **`skillmg_delete` model tool + `/skillmg/delete` RPC endpoint** — delete an
  imported skill from `$DSH_HOME/skills` (import-target copy only; the source
  directory is untouched); the skill is removed from every group and the active
  group policy is re-applied.
- **`get-session` RPC endpoint** — the input-bar group picker now queries the
  current session's override through the RPC channel (previously only a model
  tool existed, so the picker always reset to the default group).

### Fixed

- **Delete was a no-op** — `rm()` received an fs-service token object instead of
  a native path string (`resolve()` returns a token, not a path); now passes the
  real `joinPath(importTarget, name)` path.
- **Group picker snapped back to the default group** — the client called a
  `get-session` endpoint the RPC handler did not serve; the endpoint now exists
  and returns the per-session override when present.
- **Uploading a parent folder created a nested `skills/` layer** — browser
  `webkitRelativePath` is relative to the *selected* folder, so picking an
  ancestor carried intermediate directories. Upload grouping now rebases every
  file to the detected skill's own directory: scanning
  `...\skills\ui-ux-pro-max\SKILL.md` imports exactly
  `<importTarget>/ui-ux-pro-max/...` regardless of which ancestor was selected
  (verified for parent / grandparent / skill-folder / sibling selections).
- **Zip upload path race** — a `var` closure captured the wrong loop entry for
  large uploads; switched to block-scoped capture.

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
