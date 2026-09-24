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
- **旧标记清理**：插件启动时统一扫一遍所有候选 `SKILL.md` / `SKILL.md.disable`，移除历史方案残留的 `disable-model-invocation` 行（`cleanupLegacyMarkers()`）；启停本身只做原子改名，完全不读写文件内容。
- **扫描顺序**：导入目标排在最后扫描，同技能名去重时以导入目标状态为准。
- **`.disable` 文件**：`SKILL.md.disable` 的 frontmatter 与 `SKILL.md` 一致，`readSummaryFile` 可还原技能摘要。
- **兼容性**：若未来官方改变文件名发现规则，插件可回退到"插标记"方案（启动清理逻辑同样适用于读取+改回标记）。

## 5. 多根加载问题与 skill-only 预设

> ⚠️ 这是「切组不生效」的最常见根因，务必阅读。

### 问题

DSH 的技能发现（`dsh-skill-filesystem` 的 `roots()`）默认从**多个根**合并：

| 根 | 路径 | 优先级 |
| --- | --- | --- |
| 项目根 | `<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills` | 高 |
| 自定义根 | `customSkillDirs` | 中 |
| 用户根 | `$DSH_HOME/skills`（本插件导入目标）、`~/.agents/skills`（user-agents） | 低 |
| bundled | 安装自带 | 最低 |

同名技能按根优先级仲裁，**但所有根里发现的技能都会进入合并目录**。
本插件的原子改名**只作用于 `$DSH_HOME/skills`（导入目标）**那一份——若同一技能
在 `~/.agents/skills`（或项目根）里仍是未改名的 `SKILL.md`，DSH 照样发现它，
分组启停就对它无效。这就是为什么装了插件后切组看起来"没反应"。

### 解决方案：skill-only 预设

让 DSH **只从 `$DSH_HOME/skills` 一个根**发现技能。做法是给 DSH 提供一份
基于 `standard` 复制的 agent preset，其 `skill-filesystem` 行配置：

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    includeDefaultRoots: false   # 关闭 $DSH_HOME/skills、~/.agents/skills 等默认根
    customSkillDirs:
      - "C:\\Users\\<你>\\.dsh\\skills"   # 只保留导入目标这一个根
```

- `includeDefaultRoots: false` 让 `~/.agents/skills`、项目根等**全部退出**发现；
- `customSkillDirs` 明确只扫导入目标；
- 分组启停因此变成**唯一权威**：改名哪个根就影响哪个，切组立即全局生效。

启用方式（**DSH ≥ 0.1.7**）：

```bash
node scripts/apply-skill-only-preset.mjs             # 追加预设 + 设为默认
node scripts/apply-skill-only-preset.mjs --refresh    # DSH 升级后重新对齐 standard 插件表
```

脚本会从本机已安装的 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`
复制完整插件表（因此升级 DSH 后不会与官方预设漂移），只替换 `skill-filesystem`
这一行，并把 `agent-preset-registry` 的 `config.default` 指向 `skill-only`。
`presets/README.md` 记录了生成物的形状，便于手工核对。

### 0.1.7 的预设机制变更（从旧版迁移）

| | DSH ≤ 0.1.6 | DSH ≥ 0.1.7 |
| --- | --- | --- |
| 预设定义 | 目录 `$DSH_HOME/.agent-presets/<id>/`（`preset.yml` + `agent.cordis.yml`） | profile 组合里的声明式行 `@deepseek-ai/dsh-agent-preset`（官方自带的在 `@deepseek-ai/dsh-web-app/presets/*.patch.yml`） |
| 默认预设 | `settings.yaml` → `agent-presets.default` | `agent-preset-registry` 行的 `config.default` |
| 用户配置文件 | `settings.yaml` | `$DSH_HOME/profiles/<name>/cordis.patch.yml`（`settings.yaml` 被导入为 `settings.yaml.imported` 后不再读取） |
| 自定预设丢失时 | — | 会话恢复报 `Unknown agent preset: <id> (gateway/internal)` |

0.1.7 的 `dsh-agent-preset-registry` **不再扫描任何预设目录**：它只从 Loader 树里
读声明行（`agentPresets.register(definition)`，`definition` 必须含 `id` 与 `plugins`）。
所以旧目录里的 preset 不会报错、也不会生效，只会在会话恢复时找不到 id。

> 为什么不直接改 `skill-filesystem` 默认配置？
> 因为 web 模式下技能发现由各 **agent preset** 自己的 `skill-filesystem` 行负责
> （全局行被 `dsh-web-app` 显式 `disabled: true`），而 shipped preset 属于部署自带、不可修改。
> 新建 user preset 是官方支持的扩展方式，升级不受影响。

## 6. 配置与锁

- 配置存于 `$DSH_HOME/skill-mgmt.json`；
- 写入前先 `open(LOCK_PATH, 'wx')` 原子创建 `skill-mgmt.json.lock`（`EEXIST` = 他进程持锁，轮询等待最多 10s）；
- 锁可重入（`lockDepth`），嵌套的 persist/sync 不会死锁；`finally` 中释放并删除锁文件。

## 7. 术语对照

| 本插件 | DSH 官方概念 |
| --- | --- |
| `SKILL.md.disable` | 被改名隐藏的技能目录（仅 rename 引擎使用） |
| `disabled` 集合 | 插件维护的磁盘禁用清单（dirName → true；scope 引擎下为空） |
| 默认组 | 未单独选组的会话所用的分组 |
| `__all_off__` | 保留 id：全部禁用（空技能目录） |

## 8. 按会话的可见性引擎（scope engine）

> 适用 DSH ≥ 0.1.7；探测失败时自动回退到第 5 节的 rename + skill-only 预设方案。

### 为什么改名不再是唯一办法

DSH 的技能注册表是**按 scope 分层**的（`@deepseek-ai/dsh-scope` + `dsh-skill`）：

- 一次读取 = 全局层 + 观察者 scope 链上的各层合并；
- **跨层同名由"更近的层"直接胜出，rank 只在同一层内比**；
- 一个会话（agent）本身就是一个 scope key，它的父级是所属预设的那一层。

实测（0.1.7-rc.1，`standard` 预设会话）：本会话 71 个技能**全部来自预设层**，全局层 0 个；
把同名条目（`invocation.modelInvocable = false`）注册进**全局层**，技能仍然可见；
注册进**该会话自己的层**（`agent.ctx.get('skills')`），技能立刻消失，dispose 后立刻恢复。

所以"哪一个会话看到哪些技能"可以在内存里按会话决定，**不需要动磁盘、也不需要自定义预设**。

### 实现要点

| 环节 | 做法 |
| --- | --- |
| 挂载点 | `agent/created`（serial，先于该会话第一步）建立会话状态；`agent/pre-step` 做增量校准 |
| 取句柄 | `agent.ctx.get('skills')`（必须用 `get`，直接 `agent.ctx.skills` 在未声明 inject 时会抛错） |
| 能力探测 | 首个会话上注册一个不可见探针条目 → 读该会话视图 → 看到即证明可用；随后立即移除 |
| 抓定义 | 遮蔽前用官方 provider 取回真实定义（`content`/`path`/`resourceBase`/`source`），保证资源路径不丢 |
| 遮蔽 | 同名注册 + `modelInvocable: false` + 极短占位正文（省内存；真被加载时显示"当前分组已停用"） |
| 磁盘 | 一次性把历史 `.disable` 改回 `SKILL.md`（否则定义取不到），此后不再改 |
| 释放 | 双 owner：注册的 disposer 存在插件 `dispose` 里，插件卸载或会话销毁都会撤销 |

### 性能：必须是"先全抓、再全注册"

注册表对**读取**有缓存（键含 revision），而每次 `register` 都会让该缓存失效。
因此"抓一个、注册一个"会让每次抓取都重新收集整个目录 → **O(N²)**。
实测 69 个遮蔽：交错执行 **18.2s**；改成先批量抓定义、再批量注册后降到线性量级。
这一次同步发生在 `agent/created` 内（会推迟会话开始），所以这个顺序是硬要求。

### 仍未解决/需权衡

- 依赖"`agent.ctx` 是会话层载体 + `skills.register` 语义"两条已文档化事实的**组合**，官方没有一句话直接承诺；故保留 rename 引擎自动回退。
- 会话开始后若有人手改 `SKILL.md`，已抓取的遮蔽定义仍是旧的（下次配置变更/新会话才刷新）。
- 分组政策是"以插件扫描到的技能为全集做白名单"：项目本地与 bundled 技能不在全集内，不受分组影响。
- 子代理是独立 agent，会各自建立自己的可见集合。
