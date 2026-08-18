# 工作原理：SKILL.md 原子改名机制

这是本插件最核心的设计决策。本文回答三个问题：DSH 如何发现技能、插件如何让技能"消失"、以及为什么最终选择了原子改名。

## 1. DSH 如何发现技能

DSH 的技能发现由官方包 `@deepseek-ai/dsh-skill-filesystem` 实现。关键语义（rc 系列源码）：

- **目录型技能**：`<root>/<name>/SKILL.md` —— **只识别精确文件名 `SKILL.md`**；
- **扁平技能**：`<root>/<name>.md`；
- 嵌套目录下的 `**/SKILL.md` 会被排除；
- frontmatter 解析：`name`、`description` 为必需字段；`disable-model-invocation: true` 会标记该技能为「模型不可调用」（`invocation.modelInvocable = false`）。

模型加载器（`dsh-tool-skill`）在组装技能快照时执行 `snapshot.skills.filter(isModelInvocable)`，因此**只有 `modelInvocable === true` 的技能才会进入模型目录**。

## 2. 两种"关掉一个技能"的方式

| 方式 | 做法 | 代价 |
| --- | --- | --- |
| A. 插标记 | 往 `SKILL.md` frontmatter 写入 `disable-model-invocation: true` | 修改文件内容：要解析 frontmatter、写回、可能破坏格式；需要逐文件读写 |
| B. **原子改名（本插件采用）** | 把 `SKILL.md` 改名为 `SKILL.md.disable` | **零内容写入**，1~2 次原生 `fs.rename`，原子且快 |

改名后，目录里不再存在精确文件名 `SKILL.md`，技能从**发现层**直接消失，`modelInvocable` 过滤自然也不会命中——效果等价于（甚至更强于）插标记：技能彻底不可见。

`SKILL.md.disable` 不是 `.md` 结尾，永远不会被当作扁平技能误发现；扫描逻辑会读它来展示摘要，因此禁用技能仍能出现在列表里并可重新启用。

## 3. 为什么不用别的方案

开发过程中评估过以下替代方案，全部被否决：

| 方案 | 否决原因 |
| --- | --- |
| **影子目录**（`customSkillDirs` 指向镜像目录） | `customSkillDirs` 是**追加**语义（"additional roots"），不是替换默认目录；无法用官方配置点实现"只加载镜像" |
| **Provider 接管**（注册同名 provider 覆盖官方） | DSH rc.6 的 `SkillRegistry` 无运行时移除官方 provider 的 API；分层合并是"就近层获胜"，宿主层 provider 无法覆盖 preset 层；唯一可行路径是复制 preset + 切换默认 preset，这违反"扩展点"原则且不可分发 |
| **改数据库 / 内存标记** | DSH 没有暴露"禁用某技能"的内存 API；只有让 `SKILL.md` 不可发现或标记它两条路 |

**原子改名是唯一同时满足**：

- ✅ 使用官方发现语义（`SKILL.md` 精确文件名）——不是 hack，是官方行为本身；
- ✅ 不修改任何官方文件/预设/默认配置——可 GitHub 分发；
- ✅ 多会话安全：rename 原子 + 配置跨进程锁，无内容竞态；
- ✅ 性能：每技能 1~2 次原生 fs 操作（对比早期"复制整树"方案约 8000 次调用）。

## 4. 细节与边界

- **双根处理**：同一技能同时存在于来源目录与导入目标时，两个 `SKILL.md` 都会被改名/改回；导入目标状态优先。
- **旧标记清理**：启用时如果 `SKILL.md` 里残留历史 `disable-model-invocation` 行（旧方案产物），会顺带移除，保证文件干净。
- **扫描顺序**：导入目标排在最后扫描，同技能名去重时以导入目标状态为准。
- **`.disable` 文件**：`SKILL.md.disable` 的 frontmatter 与 `SKILL.md` 一致，`readSummaryFile` 可还原技能摘要。
- **兼容性**：若未来官方改变文件名发现规则，插件可平滑回退到"插标记"方案（`enableSkill` 的清理逻辑已证明具备该能力）。

## 5. 配置与锁

- 配置存于 `$DSH_HOME/skill-mgmt.json`；
- 写入前先 `open(LOCK_PATH, 'wx')` 原子创建 `skill-mgmt.json.lock`（`EEXIST` = 他进程持锁，轮询等待最多 10s）；
- 锁可重入（`lockDepth`），嵌套的 persist/sync 不会死锁；`finally` 中释放并删除锁文件。

## 6. 术语对照

| 本插件 | DSH 官方概念 |
| --- | --- |
| `SKILL.md.disable` | 被改名隐藏的技能目录 |
| `disabled` 集合 | 插件维护的禁用清单（dirName → true） |
| 默认组 | 决定所有会话模型目录的分组 |
| `__all_off__` | 保留 id：全部禁用（空技能目录） |
