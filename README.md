<div align="center">

# DSH Skill Manager

**为 DeepSeek Harness (DSH) 打造的技能管理器插件**

扫描官方技能根目录 · 一键导入 / 上传 · 分组启停（`SKILL.md` 原子改名）· 默认组 + 会话级选择器 · 全中文 Web UI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/github/v/release/Mvyvn/dsh-skill-manager)](https://github.com/Mvyvn/dsh-skill-manager/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D6)]()

</div>

---

## 这是什么

DSH Skill Manager 是一个**真实安装的 web-profile 插件**（不是临时动态插件）：随 `dsh web` 启动自动加载、无需审批。它把 DSH 的模型技能目录变成可管理的状态——

- **扫描**：列出 `~/.agents/skills`、`$DSH_HOME/skills` 等来源目录里的全部技能（名称、描述、是否已导入、是否被禁用）；
- **导入 / 上传**：一键把来源技能复制进 `$DSH_HOME/skills`（DSH 加载优先级高于 `~/.agents/skills`），也可以直接在浏览器里上传 `.zip` 压缩包或整个文件夹；
- **分组启停**：创建分组、把技能加入分组、组内单独停用；切换分组即实时重建所有会话的模型技能目录；
- **默认组**：设置某个分组为默认，所有会话的技能目录都按它渲染；支持「全部启用」与「全部禁用」；
- **会话级选择器**：聊天输入栏左侧的技能组下拉，可为当前会话单独选择分组。

> 启停不再是「修改文件内容」，而是把 `SKILL.md` **原子改名为** `SKILL.md.disable`——零内容写入、每技能仅 1~2 次原生文件操作，多会话并发安全。详见 [docs/how-it-works.md](docs/how-it-works.md)。

## 截图

> ⚠️ 图片为占位，后续填充。

| 设置页 · Skill 管理（导入） | 分组管理（默认组） | 输入栏技能组选择器 |
| :---: | :---: | :---: |
| ![ui-import](screenshots/ui-import.png) | ![ui-groups](screenshots/ui-groups.png) | ![ui-picker](screenshots/ui-picker.png) |

## 特性

- ✅ 扫描官方技能根目录，去重合并（导入目标状态优先）
- ✅ 一键导入 / 浏览器上传 zip / 文件夹（自动跳过隐藏与系统文件，`>500` 文件或 `>16MB` 内容自动拦截）
- ✅ 分组：建组、加技能、组内停用、删组；删除默认组自动回到「全部启用」
- ✅ 默认组控制所有会话的模型目录；保留 id `__all_off__` = 全部禁用
- ✅ 输入栏会话级技能组选择器（跟随默认 / 指定分组）
- ✅ **原子改名启停**：`SKILL.md` ↔ `SKILL.md.disable`，不写文件内容
- ✅ **跨进程配置锁**：`skill-mgmt.json.lock`，多 dsh 会话并发安全
- ✅ `skillmg_*` 模型工具：AI 可自主完成全部管理操作
- ✅ 自动维护 companion 技能 `skill-grouping`（缺失即重建，指导 AI 使用）
- ✅ 全中文 UI，官方 DSH 主题 token
- ✅ 真实插件安装：随 `dsh web` 每次启动自动加载，无需审批

## 安装

前置条件：已安装 DSH 并至少启动过一次 `dsh web`（需要已生成 web profile）。

### 方式一：一键脚本（推荐）

```powershell
# Windows（PowerShell）
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

脚本会把插件安装到 `$DSH_HOME/profiles/web/node_modules/dsh-skill-manager/`（`$DSH_HOME` 默认 `~/.dsh`），然后**完全重启 `dsh web`**（结束进程重新启动，不是刷新页面）。

### 方式二：手动安装

1. 把本仓库的 `lib/`、`cordis.patch.yml`、`package.json` 复制到 `$DSH_HOME/profiles/web/node_modules/dsh-skill-manager/`；
2. 完全重启 `dsh web`。

### 验证

- 设置 → 出现「Skill 管理」侧栏项，技能列表正常加载；
- 聊天输入栏左侧出现「技能组：」下拉；
- 完整检查清单见 [docs/getting-started.md](docs/getting-started.md)。

## 快速上手

1. 打开 **设置 → Skill 管理 → 技能导入**：勾选需要的技能，点「导入所选」；
2. 切到 **分组管理**：新建分组（如「嵌入式开发」），展开分组卡片把技能加入；
3. 点「设为默认」→ 所有会话的模型技能目录立即切换为该分组；
4. 输入栏左侧下拉可为当前会话单独指定分组（跟随默认 / 指定分组）；
5. 想让 AI 自己管理？直接对它说「把 xxx 技能分到 xxx 组」——它通过 `skillmg_*` 工具完成。

## 配置

所有配置保存在 `$DSH_HOME/skill-mgmt.json`（写入受跨进程锁保护）：

| 字段 | 说明 |
| --- | --- |
| `sourceDirs` | 扫描的技能来源目录，默认 `~/.agents/skills`、`$DSH_HOME/skills` |
| `importTarget` | 导入目标，默认 `$DSH_HOME/skills`（DSH 加载优先级高于 `~/.agents/skills`） |
| `groups` | 分组数组：`{id, name, skills: [{name, enabled}]}` |
| `defaultGroup` | 默认分组 id；`null` = 全部启用；`__all_off__` = 全部禁用 |
| `perSessionGroups` | 会话级分组覆盖（当前版本仅记录，模型目录仍由默认组决定） |
| `disabled` | 当前被禁用技能集合（dirName → true） |

## AI 自主管理（`skillmg_*` 工具）

| 工具 | 作用 |
| --- | --- |
| `skillmg_get_config` | 查看来源目录、导入目标、默认组、分组、禁用数量 |
| `skillmg_scan` | 列出全部可用技能及状态 |
| `skillmg_import` | 导入指定技能（`overwrite` 可覆盖） |
| `skillmg_list_groups` / `skillmg_create_group` / `skillmg_delete_group` | 分组管理 |
| `skillmg_update_group` | 设置分组成员与启用状态 |
| `skillmg_set_default_group` | 设置默认组（空串=全部启用，`__all_off__`=全部禁用） |
| `skillmg_set_session_group` / `skillmg_get_session` | 会话级分组覆盖 |
| `skillmg_debug_catalog` | 运行时技能目录快照（诊断用） |

## 项目结构

```
dsh-skill-manager/
├── lib/
│   ├── index.js          # 宿主端：RPC 通道 /skillmg + skillmg_* 工具 + 启停同步
│   └── client.js         # 浏览器端：__ModuleLoader__ 手写 bundle（无构建步骤）
├── skills/
│   └── skill-grouping/   # 自动维护的 companion 技能（指导 AI 使用）
├── scripts/
│   ├── install.ps1       # Windows 安装脚本
│   └── install.sh        # macOS/Linux 安装脚本
├── docs/                 # 文档（架构、原理、上手）
├── screenshots/          # 截图（占位）
├── cordis.patch.yml      # web-profile 插件挂载补丁
└── package.json
```

## 工作原理

1. DSH 的技能发现（`dsh-skill-filesystem`）**只识别精确文件名 `SKILL.md`**；
2. 停用 = 把 `SKILL.md` 原子改名为 `SKILL.md.disable`，技能从模型目录消失；启用 = 改回（并清理历史遗留的 `disable-model-invocation` 标记）；
3. 所有配置写入持跨进程排他锁，多会话并发安全。

详见 [docs/how-it-works.md](docs/how-it-works.md) 与 [docs/architecture.md](docs/architecture.md)。

## 兼容性与已知限制

- 依赖 DSH（rc 系列）的「只识别精确文件名 `SKILL.md`」发现语义；若官方改变该规则，需回退到 `disable-model-invocation` 字段方案（代码已兼容并会在启用时清理旧标记）。
- 会话级分组覆盖（`perSessionGroups`）当前版本仅记录，模型目录仍由默认组决定。
- 主要在 Windows 上开发测试；macOS/Linux 路径使用 `~` 与 `$DSH_HOME` 语义，欢迎反馈。
- 浏览器上传仅支持文本文件（SKILL.md 场景），单个文件 ≤ 2MB，总内容 ≤ 16MB。

## 许可证

[MIT](LICENSE) © 2025 沐云 (Mvyvn)

---

<div align="center">Made with ❤️ for the DSH community</div>
