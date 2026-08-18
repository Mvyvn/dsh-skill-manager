# 架构说明

## 插件如何被加载

DSH 的 web profile 是"补丁组合"结构：`dsh-base` → `dsh-web-app` → 用户 profile 的 `cordis.patch.yml` → 各 preset 组合。web-profile 插件（如本插件、`dsh-better-sidebar`）以目录形式放在 `$DSH_HOME/profiles/web/node_modules/<name>/`，其 `cordis.patch.yml` 声明一个 `insert` 插件行，`package.json` 的 `dsh.bundle.patch` / `dsh.client` 字段让加载器：

- 宿主端：把 `lib/index.js` 作为一行插件挂进 profile 组合（因此随每次 `dsh web` 启动自动加载，无审批）；
- 客户端：`dsh.client` 清单被 client-modules 扫描，把 `exports["./client"]` 以 `window.__ModuleLoader__.load({id, factory})` 包装后经 `/plugins/<id>/client.js` 提供给浏览器。

## 宿主端（lib/index.js）

| 职责 | 实现 |
| --- | --- |
| RPC 通道 | `ctx.connection.rpc.handle('/skillmg', handler, { authority: 'loopback' })`，端点：get-config / scan / import / create-group / delete-group / update-group / set-default-group / set-session-group / upload |
| 模型工具 | `ctx.tools.register(defineTool(...))` 注册 12 个 `skillmg_*` 工具 |
| 文件操作 | `ctx.fs`（resolve/stat/readText/writeText/listDir）+ `node:fs`（rename/access/open/unlink——`ctx.fs` 无 rename） |
| 状态 | `$DSH_HOME/skill-mgmt.json`；`disabled` 集合；跨进程锁 `skill-mgmt.json.lock` |
| 同步 | `syncActiveGroup()`：按默认组计算启用集合 → 逐技能 rename 对齐 → 持锁持久化；内部互斥防重入风暴 |
| companion | 启动时若 `skill-grouping/SKILL.md` 缺失则重建（指导 AI 使用工具） |

### 关键细节

- `{ authority: 'loopback' }` 是 `rpc.handle` 的必需选项（rc.6 的注册代码读取 `options.authority` 无 undefined 保护，缺了会崩）；
- `serial()` 互斥队列保证同一进程内 RPC 操作不交错；
- `syncActiveGroup` 的 `syncing/syncQueued` 标志：同步进行中的再次触发只排队一次；
- 扫描排序：导入目标**最后**扫描，同名技能去重时导入目标状态优先（它是权威状态持有者）。

## 客户端（lib/client.js）

手写 `__ModuleLoader__` bundle（无 TypeScript/JSX/打包器），React 用 `createElement` 编写：

- `rpcCall(channel, endpoint, payload)`：POST 到 `/skillmg/<endpoint>`，校验 `server-response` 信封与 `rpcId`；
- **设置页**（`slots.inject('settings.section')`，id `skill-manager`，order 30，label "Skill 管理"）：
  - 导入 Tab：扫描列表（卡片多选 / 全选 / 覆盖已导入）、上传 zip（浏览器端 `DecompressionStream` 解 deflate-raw）/ 上传文件夹（`webkitdirectory`）、结果报告；
  - 分组 Tab：全部启用 / 全部禁用卡片、新建分组、分组卡片（展开编辑成员 + 组内停用、设为默认、删除）、busy 状态「处理中…」；
- **输入栏选择器**（`slots.inject('conversation.input.left')`，id `skill-manager-input-group`）：官方 Menu 风格下拉，跟随默认 / 指定分组，会话级 `set-session-group`；
- 样式全部使用官方主题 token（`--dsw-alias-*`），样式注入带 `ctx.effect` 清理。

## 工具注册（skillmg_*）

模型侧工具与 RPC 端点共用同一批内部函数（`importSkills`、分组 CRUD、`afterGroupChange` 等），保证 UI 与 AI 行为一致。

## 目录结构

```
$DSH_HOME/profiles/web/node_modules/dsh-skill-manager/
├── package.json        # dsh.bundle.patch / dsh.client 清单 + exports
├── cordis.patch.yml    # insert 插件行 (id: skill-manager)
└── lib/
    ├── index.js        # 宿主
    └── client.js       # 浏览器 bundle
```
