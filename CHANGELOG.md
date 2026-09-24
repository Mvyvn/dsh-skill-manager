# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.3] - 2026-09-24

### Fixed

- **设置页永远停在「正在加载技能列表…」、分组列表空白**（配置其实完好）。DSH 0.1.7 只挂载**一个**
  浏览器通道 `/api`：自定义 `rpc.handle('/skillmg', …)` 通道会登记但**不会产生可路由的端点**
  （实测 `POST /skillmg/get-config` → 405，而 `/api` 正常应答），而 `/api` 共享通道的唯一
  interceptor 槽位已被 `dsh-api-gateway` 占用。改用官方支持的形态：在 `/api` 下注册**精确 Fetch
  路由** `POST /api/skillmg`（与 `/api/file`、上传路由同一约定），请求体 `{ method, payload }`；
  客户端优先走它，遇到 404/405 再回退旧版 per-channel 信封。`get-config` 现在回报 `rpc` 模式，
  host 启动日志打印 `rpc=api-fetch-route`。
- **指南技能在 scope 引擎下被分组隐藏**：引擎新增 `alwaysVisibleNames` 豁免，`skill-grouping`
  在任何分组（含 `__all_off__`）下都保持可见——与 rename 引擎的豁免保持一致。

验证：RPC harness 端到端跑通（`apply()` 注册 `/api/skillmg [POST]`、不注册 legacy 通道；
`get-config`/`scan`/未知方法/畸形请求体全部 200 并有可读结果），客户端与 host 双份同步修改。
## [1.3.2] - 2026-09-24

### Fixed

- **启动即崩：`dshHome` 初始化触发时间死区（TDZ）**。`const dshHome = … || joinPath(homedir(), '.dsh')`
  这个初始化表达式会调用 `joinPath()` → `sep()` → 读 `dshHome`，而此刻它还在 TDZ 中，于是抛
  `ReferenceError: Cannot access 'dshHome' before initialization`。只要 `dshHomePath` 服务不可用且
  宿主进程环境里没有 `DSH_HOME` 就会走这条回退分支（0.1.7 web profile 不提供 `dshHomePath`，
  所以这是常规路径）。修复：初始化改为内联推导分隔符，不再经由 `joinPath`/`sep`；并打印实际来源
  （`dshHomePath` / `DSH_HOME` / `homedir`）便于排查。
  为什么只在"用户启动的进程"复现：工具子进程由 `dsh-shell-env` 注入 `DSH_HOME`，而从工具 shell
  启动的实例继承了它，于是走了另一分支、绕开了 TDZ。
- 同源的 inject 问题（1.3.1）：未声明 `skills` 导致 `apply()` 在属性访问时抛错。
## [1.3.1] - 2026-09-24

### Fixed

- **0.1.7 下插件完全无法激活**：Cordis 对"未在 `inject` 中声明的服务"在**属性访问**时抛错
  （`cannot get property "register" without inject`）。1.3.0 新增的引擎在 `apply()` 尾部打印
  engine 时调用 `scopeMode()` → `optimistic()` → 访问 `skills.register`，而插件只 inject 了
  `['connection','tools']`，于是 `apply()` 在注册工具/RPC **之前**抛错，整行激活失败：
  `skillmg_*` 工具消失、配置不再写入、磁盘不做一次性规范化。同一原因也让
  `skillmg_debug_catalog` 一直返回 `snapshotError`（那里有 try/catch，所以只是静默失败）。
  修复：`inject` 增加 `'skills'`（插件确实需要技能注册表），并给能力探测加 try/catch ——
  服务不可访问时只降级为 rename 引擎，绝不导致激活失败。
  用隔离 harness 复现并验证（抛错型 service Proxy → 修复前 apply 抛错、修复后正常降级；
  正常 mock 服务 → `engine=scope` 且三个监听注册成功）。
## [1.3.0] - 2026-09-24

### Added

- **按会话的可见性引擎（scope engine）—— 不再需要自定义预设，也不再动磁盘**。
  DSH ≥ 0.1.7 的技能注册表是按 scope 分层的：一次读取合并"全局层 + 观察者 scope 链"，
  **跨层同名由更近的层直接胜出**，而一个会话（agent）本身就是 scope key、父级是所属预设层。
  于是插件在 `agent/created` 里通过 `agent.ctx.get('skills')` 把"要隐藏的技能"以同名 +
  `invocation.modelInvocable = false` 的运行时条目注册进**该会话自己的层**：只影响这一个会话、
  下一步生效、磁盘一个字节都不改。两个会话可同时使用不同分组，互不干扰。
  实机验证（0.1.7-rc.1、`standard` 预设、未作者化）：全局层 0 个技能 / 会话层 71 个；
  全局层注册遮蔽**无效**（控制实验），会话层注册遮蔽**有效且可逆**；第二会话不受第一会话遮蔽影响。
- **能力探测与自动回退**：首个会话上注册一个不可见探针并读回该会话视图来验证机制；
  失败、或 DSH 无分层能力（< 0.1.7）、或配置 `engine: "rename"` 时，自动退回原有 rename 引擎。
  `skillmg_get_config` / `get-config` 新增 `engine` 与 `scopeEngine` 诊断字段。
- **一次性磁盘规范化**：scope 引擎需要从官方 provider 取到真实定义才能遮蔽，因此首次启用时把
  历史 `SKILL.md.disable` 改回 `SKILL.md`（`state.scopeNormalized` 记录），此后切组不再触碰磁盘。
- 用户手册技能的版本标记（`<!-- skill-manager-guide: v2 -->`）：旧文案会被自动刷新，无需手动删文件。

### Fixed

- **同步性能：O(N²) → 线性**。注册表对读取有缓存而每次 `register` 都会使其失效，
  原先"抓一个定义就注册一个遮蔽"导致每次抓取都重新收集整个技能目录；实测 69 个遮蔽耗时
  **18.2 秒**，而这段同步发生在 `agent/created` 内（推迟会话开始）。改为**先批量抓定义、再批量注册**。
- 诊断噪声：无法取到定义的技能若本来就不可发现，不再逐条告警（只报告"仍然可见但无法遮蔽"的名字）。

### Changed

- 分组语义（scope 引擎下）：选择器与默认组**不再重排磁盘**；`disabled` 在磁盘上恒为空，
  UI 的"已停用数量"改为按当前分组动态计算出的隐藏数量。`lastActive` 仅作历史展示。

## [1.2.1] - 2026-09-24

### Fixed

- **单根预设（skill-only）下插件自带的指南技能不可见** —— `skill-grouping` 原先只写入
  `sourceDirs[0]`（默认 `~/.agents/skills`），而导入目标里那一份会被分组同步改名停用；
  skill-only 预设只发现导入目标，于是模型在会话里看不到 `skillmg_*` 工具的唯一说明，
  也就无法自主管理技能。现在改为**同时写入导入目标**（`importTarget`）与来源目录，并把
  指南加入分组同步的**豁免名单**：任何分组（含 `__all_off__`）都不会把它改名为
  `SKILL.md.disable`，`state.disabled` 里也会清除它的记录。代价是每个会话多约 4KB。

## [1.2.0] - 2026-09-24

### Added

- **`scripts/apply-skill-only-preset.mjs`** —— 一键把 `skill-only` 预设写进 profile
  组合（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）并设为默认，写前自动备份；
  `--refresh` 在 DSH 升级后重新对齐官方插件表，`--dry-run` 只看不写，重复运行幂等。
  预设的**能力表从本机已安装的** `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`
  复制（只替换 `skill-filesystem` 一行为 `includeDefaultRoots: false` +
  `customSkillDirs: [导入目标]`，根目录取自 `skill-mgmt.json` 的 `importTarget`），
  因此不会再出现"仓库里的模板快照与当前 DSH 漂移"的问题。
- **`presets/README.md`** —— 记录生成物形状、为何不再附带完整模板，以及 0.1.6 → 0.1.7
  的预设机制对照。

### Fixed

- **DSH 0.1.7 下 `skillmg_*` 工具全部失效** —— 0.1.7 的工具层开始校验工具返回值是否
  符合声明的输出 schema，而 12 个工具都声明了 `{ type: 'string' }` 却返回对象/数组，
  于是每次调用都报 `tool "skillmg_..." returned invalid output: "value" must be a
  string`。现按官方 author DSL 改声明为 `{ type: 'json' }`（即"任意 JSON 值"，与
  `@deepseek-ai/dsh-tool-cordis` 的做法一致）。用官方 `validateJsonSchemaValue` 实测：
  旧声明对对象/数组/空数组一律 REJECTED，新声明一律 ACCEPTED。
- **DSH 0.1.7 下会话恢复失败 `Unknown agent preset: skill-only`** —— 0.1.7 起
  `dsh-agent-preset-registry` 不再扫描 `$DSH_HOME/.agent-presets/<id>/`，预设改为
  profile 组合里的 `@deepseek-ai/dsh-agent-preset` 声明行，默认值来自
  `agent-preset-registry` 行的 `config.default`；`settings.yaml` 也被导入为
  `settings.yaml.imported` 后不再读取。旧的目录式预设因此既不报错也不生效，只让
  绑定了它的会话恢复失败。现由上面的脚本重新声明，官方 `dsh --dump-config` 实测
  组合结果为 `preset-skill-only` + `agent-preset-registry.config.default: skill-only`。
- `textOf()` 对 `undefined` 做保护（`JSON.stringify(undefined)` 会得到 `undefined`，
  渲染层要求 `text` 必须是字符串）。

### Removed

- `presets/skill-only/agent.cordis.yml` —— 0.1.1 时代的目录式预设模板（携带当时的
  `standard` 副本）。0.1.7 不再读取该形式，留着只会造成"以为改了其实没生效"的误导；
  迁移方式见 `presets/README.md` 与 `scripts/apply-skill-only-preset.mjs`。

## [1.1.1] - 2026-08-18

### Fixed

- **「跟随默认」误判成全部启用（P0）** — 清掉会话 override 时，host 把 `null`
  传给 `syncActiveGroup(null)`，而 `null !== undefined` 是真，导致 activeId 变成
  `null` → 磁盘被重排成「全部启用」，而不是回落到默认组。现在清 override 时显式
  传 `state.defaultGroup`（或无参回落），默认组是受限组时不会再错误地全量放开技能。
- **任何分组/导入/删除操作都会冲掉已生效的会话 override（P1）** —
  `afterGroupChange()` 原先无条件按 `defaultGroup` 重排磁盘，用户刚切好的会话组会被
  静默重置回默认组。现引入持久化的 `state.lastActive`（最近一次生效的盘上组）：
  管理操作（import/delete/改分组/删组/改默认组）都沿用 `lastActive` 而不是回退默认，
  只有主动选组/设默认组/删除该组时才更新它。UI 选中的组与实际模型目录保持一致。
- **每次启用都读改写整份 `SKILL.md`（P2）** — `enableSkill` 在改名后还会全文搜索
  `disable-model-invocation` 标记并重写；改名方案根本不需要该标记存在，逐次读改写
  既慢又有写坏 UTF-8 的风险。现在改为仅在启动时统一清理一次残留标记
  （`cleanupLegacyMarkers()`），启停只做原子改名。

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
- **输入栏切组立即生效（方案 A）** — `set-session-group` RPC and
  `skillmg_set_session_group` now call `syncActiveGroup()` after recording the
  override, re-shaping the on-disk `SKILL.md`/`SKILL.md.disable` set to the
  picked group so the current session's skill injection changes right away
  (the on-disk names are global, so other sessions switch too — the documented
  trade-off of the disk-rename scheme).

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
