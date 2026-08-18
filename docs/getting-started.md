# 入门指南

## 前置条件

- 已安装 DSH（rc 系列），且**至少启动过一次 `dsh web`**（确保 `$DSH_HOME/profiles/web/` 已生成）；
- Node.js ≥ 18（仅用于 `npm run check` 语法校验，插件运行时用的是 DSH 自带的 Node）。

## 安装

### 一键脚本

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

脚本做两件事：

1. 把 `lib/`、`cordis.patch.yml`、`package.json` 复制到 `$DSH_HOME/profiles/web/node_modules/dsh-skill-manager/`；
2. 提示你完全重启 `dsh web`。

### 手动安装

```bash
# 假设 $DSH_HOME = ~/.dsh
mkdir -p ~/.dsh/profiles/web/node_modules/dsh-skill-manager
cp -r lib cordis.patch.yml package.json ~/.dsh/profiles/web/node_modules/dsh-skill-manager/
```

## 重启（重要）

**必须完全停止再启动 `dsh web`**（Ctrl+C 结束进程后重新运行），刷新浏览器页面是不够的——插件是随 profile 组合启动时挂载的。

## 验证清单

1. 打开设置，侧栏出现 **「Skill 管理」**；
2. 进入后技能列表正常加载（不卡在「正在加载技能列表…」）；
3. 聊天输入栏左侧出现 **「技能组：全部启用」** 下拉；
4. 新建一个分组，点「设为默认」——几秒内完成（按钮会短暂显示「处理中…」）；
5. 磁盘上出现 `$DSH_HOME/skills/<技能名>/SKILL.md.disable` 文件（被停用的技能）；
6. 重启后配置与启停状态保持（`$DSH_HOME/skill-mgmt.json`）。

## 常见问题

### 技能列表一直「正在加载」

- 检查宿主日志是否有 `[dsh-skill-manager]` 前缀的错误；
- 确认 `dsh web` 是完整重启而非刷新页面；
- 确认插件目录确实在 `$DSH_HOME/profiles/web/node_modules/dsh-skill-manager/`。

### 启停后技能没有消失/没有回来

- 只影响**已导入**（存在于 `$DSH_HOME/skills`）的技能；未导入技能只在列表出现；
- 检查对应目录里 `SKILL.md` / `SKILL.md.disable` 的实际状态。

### 报 `config lock timeout`

- 有另一个 dsh 进程正持锁超过 10 秒；等它完成后重试即可（锁是临时文件，异常退出也会在下次 `open('wx')` 竞争时被释放语义处理——如果残留了 `.lock` 文件且确认没有其他进程在写，可以手动删除）。

### 插件没有生效

- 确认没有把插件同时手动添加进 profile 的 `cordis.patch.yml`（会重复挂载）；
- 确认没有动过 DSH 自带的 `config/agent-presets`（那是官方预设，升级会被覆盖）。
