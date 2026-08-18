# DSH Skill Manager

A skill-manager plugin for [DSH](https://github.com/deepseek-ai/dsh). Loads automatically with every `dsh web` start — no approval needed.

- **Scan / import / upload** — list skills under the source roots (`~/.agents/skills`, `$DSH_HOME/skills`), copy them into `$DSH_HOME/skills` with one click, or upload a `.zip` / folder from the browser
- **Group enable & disable** — create groups, assign skills, toggle per-skill enablement; disabling means atomically renaming `SKILL.md` → `SKILL.md.disable` (no content writes, concurrency-safe)
- **Default group** — shapes every session's catalog; reserved id `__all_off__` = all disabled
- **Per-session picker** — a dropdown at the left of the input bar for per-session overrides
- **All-Chinese UI** with official DSH theme tokens; `skillmg_*` model tools let the AI manage everything on its own

## Screenshots

| Skill import | Group management | Per-session picker |
| :---: | :---: | :---: |
| ![ui-import](screenshots/ui-import.png) | ![ui-groups](screenshots/ui-groups.png) | ![ui-picker](screenshots/ui-picker.png) |

## Installation

Prerequisite: `dsh web` started at least once (a web profile must exist).

```powershell
# Windows
git clone https://github.com/Mvyvn/dsh-skill-manager.git
cd dsh-skill-manager
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

```bash
# macOS / Linux
git clone https://github.com/Mvyvn/dsh-skill-manager.git
cd dsh-skill-manager
bash scripts/install.sh
```

The script installs the plugin into `$DSH_HOME/profiles/web/node_modules/dsh-skill-manager/` (`$DSH_HOME` defaults to `~/.dsh`), then **fully restart `dsh web`** (stop and start the process — a page refresh is not enough). You can also copy `lib/`, `cordis.patch.yml` and `package.json` into that directory manually.

Verify: a "Skill 管理" section appears in Settings; a "技能组：" dropdown appears at the left of the input bar.

## Quick start

1. Settings → **Skill 管理 → 技能导入**: check the skills you want and click 导入所选;
2. Switch to **分组管理**: create a group and assign skills to it;
3. Click 设为默认 — every session's catalog switches immediately;
4. Want the AI to manage it? Just ask "把 xxx 技能分到 xxx 组".

## ⚠️ Make group switching actually work (the skill-only preset)

DSH loads skills from multiple roots by default (e.g. `~/.agents/skills`). Group enable/disable only touches the import-target copy — if DSH finds the same skill in another root, switching groups has no visible effect. The fix is to make DSH discover skills from `$DSH_HOME/skills` only: this repo ships a ready-made `presets/skill-only` preset template. Copy it and make it your default preset (`settings.yaml` → `agent-presets: { default: skill-only }`), then fully restart `dsh web`. Details: [docs/how-it-works.md](docs/how-it-works.md#5-多根加载问题与-skill-only-预设).

## Configuration

Everything lives in `$DSH_HOME/skill-mgmt.json` (writes guarded by a cross-process lock):

| Field | Meaning |
| --- | --- |
| `sourceDirs` | Skill source directories (default `~/.agents/skills`, `$DSH_HOME/skills`) |
| `importTarget` | Import target (default `$DSH_HOME/skills`) |
| `groups` | Group array: `{id, name, skills: [{name, enabled}]}` |
| `defaultGroup` | Default group id; `null` = all enabled; `__all_off__` = all disabled |
| `perSessionGroups` | Per-session overrides (recorded only; the catalog is still shaped by the default group) |
| `disabled` | Currently disabled skills (dirName → true) |

## AI-driven management (`skillmg_*` tools)

| Tool | Purpose |
| --- | --- |
| `skillmg_get_config` / `skillmg_scan` | Show config, list skills |
| `skillmg_import` | Import skills (`overwrite` supported) |
| `skillmg_create_group` / `skillmg_update_group` / `skillmg_delete_group` | Group management |
| `skillmg_set_default_group` | Set the default group (empty = all enabled, `__all_off__` = all disabled) |
| `skillmg_set_session_group` / `skillmg_get_session` | Per-session group override |
| `skillmg_debug_catalog` | Runtime catalog snapshot (diagnostics) |

## Project layout

```
dsh-skill-manager/
├── lib/          # host index.js + browser client.js
├── presets/      # skill-only preset template (makes grouping effective)
├── skills/       # auto-maintained companion skill skill-grouping
├── scripts/      # install.ps1 / install.sh
├── docs/         # architecture, how-it-works, getting-started
├── screenshots/
├── cordis.patch.yml
└── package.json
```

## How it works & limitations

- Disable = atomically rename `SKILL.md` → `SKILL.md.disable`, and the skill vanishes from the catalog; enable = rename back. Relies on DSH (rc series) discovering only the exact filename `SKILL.md`; if that changes upstream, fall back to the `disable-model-invocation` field scheme (the code is compatible and cleans up legacy markers).
- Multi-root loading bypasses group switching — enable the **skill-only preset** above to fix it.
- Per-session overrides (`perSessionGroups`) are recorded only; the catalog is still shaped by the default group.
- Developed and tested mainly on Windows; macOS/Linux paths use `~` / `$DSH_HOME` semantics — feedback welcome.
- Browser upload supports text files only (the SKILL.md scenario), ≤2MB per file, ≤16MB total.

## License

[MIT](LICENSE) © 2026 沐云 (Mvyvn)
