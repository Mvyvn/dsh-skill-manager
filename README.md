# DSH Skill Manager

为 [DSH](https://github.com/deepseek-ai/dsh) 打造的技能管理器插件，随 `dsh web` 启动自动加载（无需审批）。

- **扫描 / 导入 / 上传**：列出来源目录（`~/.agents/skills`、`$DSH_HOME/skills`）的全部技能，一键复制进 `$DSH_HOME/skills`，或浏览器上传 `.zip` / 文件夹
- **分组启停**：建组、加技能、组内停用；停用即把 `SKILL.md` 原子改名为 `SKILL.md.disable`（零内容写入、并发安全）
- **默认组**：控制所有会话的模型技能目录；保留 id `__all_off__` = 全部禁用
- **会话级选择器**：聊天输入栏左侧下拉，为当前会话单独指定分组
- **全中文 UI**，官方 DSH 主题 token；`skillmg_*` 模型工具让 AI 可自主完成全部管理

## 截图

| 技能导入 | 分组管理 | 会话级选择器 |
| :---: | :---: | :---: |
| ![ui-import](screenshots/ui-import.png) | ![ui-groups](screenshots/ui-groups.png) | ![ui-picker](screenshots/ui-picker.png) |

## 安装

前置条件：已启动过一次 `dsh web`（需已生成 web profile）。

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

脚本把插件装入 `$DSH_HOME/profiles/web/node_modules/dsh-skill-manager/`（`$DSH_HOME` 默认 `~/.dsh`），然后**完全重启 `dsh web`**（结束进程重开，不是刷新页面）。也可手动复制 `lib/`、`cordis.patch.yml`、`package.json` 到同目录。

验证：设置里出现「Skill 管理」侧栏；聊天输入栏左侧出现「技能组：」下拉。

## 快速上手

1. 设置 → **Skill 管理 → 技能导入**：勾选技能，点「导入所选」；
2. 切到 **分组管理**：新建分组，把技能加入；
3. 点「设为默认」→ 所有会话的技能目录立即切换为该分组；
4. 想让 AI 自己管？直接对它说「把 xxx 技能分到 xxx 组」即可。

## ⚠️ 让分组启停真正生效（skill-only 预设）

DSH 默认从多个根合并加载技能（如 `~/.agents/skills`）。分组启停只作用于导入目标那一份，若 DSH 从其他根发现同名技能，切换分组就不会生效。解决：让 DSH 只从 `$DSH_HOME/skills` 一个根发现技能——仓库提供了现成的 `presets/skill-only` 预设模板，按模板头注释复制并设为本机默认预设（`settings.yaml` 加 `agent-presets: { default: skill-only }`），重启 `dsh web` 即生效。原理见 [docs/how-it-works.md](docs/how-it-works.md#5-多根加载问题与-skill-only-预设)。

## 配置

全部保存在 `$DSH_HOME/skill-mgmt.json`（写入受跨进程锁保护）：

| 字段 | 说明 |
| --- | --- |
| `sourceDirs` | 技能来源目录，默认 `~/.agents/skills`、`$DSH_HOME/skills` |
| `importTarget` | 导入目标，默认 `$DSH_HOME/skills` |
| `groups` | 分组数组：`{id, name, skills: [{name, enabled}]}` |
| `defaultGroup` | 默认分组 id；`null` = 全部启用；`__all_off__` = 全部禁用 |
| `perSessionGroups` | 会话级分组覆盖（当前仅记录，模型目录仍由默认组决定） |
| `disabled` | 当前禁用技能集合（dirName → true） |

## AI 自主管理（`skillmg_*` 工具）

| 工具 | 作用 |
| --- | --- |
| `skillmg_get_config` / `skillmg_scan` | 查看配置、列出技能 |
| `skillmg_import` | 导入技能（`overwrite` 可覆盖） |
| `skillmg_create_group` / `skillmg_update_group` / `skillmg_delete_group` | 分组管理 |
| `skillmg_set_default_group` | 设置默认组（空串=全部启用，`__all_off__`=全部禁用） |
| `skillmg_set_session_group` / `skillmg_get_session` | 会话级分组覆盖 |
| `skillmg_debug_catalog` | 运行时技能目录快照（诊断） |

## 项目结构

```
dsh-skill-manager/
├── lib/          # 宿主端 index.js + 浏览器端 client.js
├── presets/      # skill-only 预设模板（让分组启停生效）
├── skills/       # 自动维护的 companion 技能 skill-grouping
├── scripts/      # 安装脚本 install.ps1 / install.sh
├── docs/         # 架构、原理、上手文档
├── screenshots/
├── cordis.patch.yml
└── package.json
```

## 工作机制与限制

- 停用 = `SKILL.md` 原子改名 `SKILL.md.disable`，技能从模型目录消失；启用 = 改回。依赖 DSH（rc 系列）「只识别精确文件名 `SKILL.md`」的语义；若官方改变此规则需回退 `disable-model-invocation` 字段方案（代码已兼容并会清理旧标记）。
- 多根加载会绕过分组启停——按上文启用 **skill-only 预设**即可解决。
- 会话级覆盖（`perSessionGroups`）当前仅记录，模型目录仍由默认组决定。
- 主要在 Windows 开发测试；macOS/Linux 路径使用 `~` 与 `$DSH_HOME` 语义，欢迎反馈。
- 浏览器上传仅支持文本文件（SKILL.md 场景），单文件 ≤ 2MB，总内容 ≤ 16MB。

## 许可证

[MIT](LICENSE) © 2026 沐云 (Mvyvn)
