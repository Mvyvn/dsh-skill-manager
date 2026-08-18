---
name: skill-grouping
description: DSH Skill Manager 插件使用指南：讲解插件如何扫描来源目录、导入与上传技能、按分组启停技能（SKILL.md 原子改名机制）、设置默认组与全部禁用模式，指导 AI 使用 skillmg_* 工具自主完成技能管理。
---

# DSH Skill Manager 插件使用指南

本技能由 DSH Skill Manager 插件在启动时自动维护（缺失即重建）。内容讲解插件的工作原理与全部操作方式，使 AI 无需用户手动操作即可自主完成技能的分组、导入、启停与默认组设置。

## 一、插件管理什么

- 来源目录（sourceDirs）：扫描技能的目录，默认 `~/.agents/skills`（即 `$HOME/.agents/skills`）。配置缺失时启动会自动填入 `~/.agents/skills` 与 `$DSH_HOME/skills`。
- 导入目标（importTarget）：`$DSH_HOME/skills`。「导入」= 把来源技能完整复制到这里；DSH 按此目录加载技能，优先级高于 `~/.agents/skills`。
- 分组（groups）：每个分组有 id、显示名、成员列表（`{name, enabled}` 数组）。`enabled=false` 表示组内停用。id `__all_off__` 为保留字。
- 默认组（defaultGroup）：决定所有会话的模型技能目录；为空（未设置）时全部启用。
- 会话覆盖（perSessionGroups）：按会话 id 记录的单会话分组，当前版本模型目录仍由默认组决定。
- 配置文件：`$DSH_HOME/skill-mgmt.json`，插件改动即时写入；写入受跨进程锁保护，多会话并发安全。

## 二、启停机制

- 停用一个技能 = 把该技能的 `SKILL.md` 原子改名为 `SKILL.md.disable`（在源目录与导入目录都存在时两者都处理）。DSH 的技能发现只识别精确文件名 `SKILL.md`，改名后技能从模型目录消失。
- 启用 = 把 `SKILL.md.disable` 原子改回 `SKILL.md`（并清理历史遗留的 `disable-model-invocation` 标记行）。
- 改名是零内容、原子的文件系统操作，比插标记更快、更安全。
- 只有已导入（存在于导入目标）的技能才受启停控制；未导入技能只在扫描列表出现，不影响模型目录。
- 修改默认组或分组后插件会重扫并按组同步启停。
- 全部禁用：默认组设为保留 id `__all_off__`，所有技能目录被清空；改回具体分组或清空默认组即恢复。

## 三、可用工具

- `skillmg_get_config`：来源目录、导入目标、默认组、分组列表、禁用数量。
- `skillmg_scan`：全部可用技能（名称、描述、来源目录、是否已导入、是否被禁用）；描述来自 SKILL.md frontmatter。
- `skillmg_import`：导入指定技能（`overwrite: true` 覆盖已导入项）。
- `skillmg_create_group` / `skillmg_delete_group`：创建 / 删除分组。删除当前默认组后默认组自动清空，等价于「全部启用」。
- `skillmg_update_group`：设置分组成员 `[{name, enabled}]`；列表外的技能不属于该分组。
- `skillmg_set_default_group`：设置默认组；空字符串 = 全部启用，`__all_off__` = 全部禁用。
- `skillmg_set_session_group` / `skillmg_get_session`：记录 / 查询当前会话的分组覆盖。
- `skillmg_debug_catalog`：查看运行时技能目录快照与本插件标记的禁用项。

## 四、AI 自主操作流程

1. 先 `skillmg_get_config` 查看当前分组、默认组与禁用数量。
2. 建组：`skillmg_scan` 查看全部技能及描述 → `skillmg_create_group` 建组 → `skillmg_update_group` 加入场景匹配的技能（一个技能可属于多个分组）。
3. 让所有会话使用某组：`skillmg_set_default_group` 指定分组 id；全部放行用空字符串；清空模型目录用 `__all_off__`。
4. 用户想用的技能若未导入：`skillmg_import` 导入后再归组。
5. 默认组可以删除；删除后恢复「全部启用」，无需特别保护。

## 五、注意

- 修改分组成员或默认组后模型目录立即重建生效；默认组为空 = 全部启用。
- 本技能自身也在来源目录中；若它被停用，说明当前默认组未包含它，将其加回即可。
