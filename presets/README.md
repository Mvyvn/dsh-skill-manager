# presets/

这里解释 **skill-only 预设** 长什么样、由谁生成，以及为什么不再随仓库附一份完整模板。

## 怎么用

不需要手动编辑本目录 —— 直接运行：

```bash
node scripts/apply-skill-only-preset.mjs             # 写入并设为默认
node scripts/apply-skill-only-preset.mjs --refresh   # DSH 升级后重新对齐
node scripts/apply-skill-only-preset.mjs --dry-run   # 只看会写入什么
```

脚本把预设追加到 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（写前备份），
然后**完全重启 `dsh web`**。

## 生成物的形状（DSH ≥ 0.1.7）

```yaml
- insert:
    - id: preset-skill-only
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: skill-only
        name: 技能管理
        order: 0
        plugins:
          # …… 从本机 @deepseek-ai/dsh-web-app/presets/standard.patch.yml
          #      原样复制的完整插件表（约 140 行），仅下面一行不同：
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              includeDefaultRoots: false
              customSkillDirs:
                - '<导入目标，默认 $DSH_HOME/skills>'

- id: agent-preset-registry
  config:
    default: skill-only
```

## 为什么不附完整模板文件

1. **能力表会随 DSH 升级变化。** 预设必须声明完整插件表（含 `persona`、工具、
   `planning`/`compaction`/`delegation` 等 isolate 组），而这张表每个 DSH 版本都可能
   变。仓库里放一份快照，就会变成"升级后能力悄悄缺失"的陷阱——脚本改为每次从**你
   本机已安装的** standard 预设复制，天然不会漂移。
2. **路径与本机相关。** `customSkillDirs` 指向导入目标（脚本会读
   `$DSH_HOME/skill-mgmt.json` 的 `importTarget`），写死在仓库里没有意义。

## DSH ≤ 0.1.6（旧目录形式，已废弃）

老版本把预设放在 `$DSH_HOME/.agent-presets/<id>/`（`preset.yml` + `agent.cordis.yml`），
默认预设写在 `settings.yaml`：

```yaml
agent-presets:
  default: skill-only
```

**0.1.7 起该机制已被完全移除**：`dsh-agent-preset-registry` 不再扫描任何预设目录，
`settings.yaml` 也只剩 `settings.yaml.imported`。留在旧目录里的预设不会报错、也不会
生效，只会在会话恢复时报 `Unknown agent preset: <id> (gateway/internal)`。
迁移就是用上面的脚本重写一遍（官方 `standard` 预设本身也已经变成声明式行）。
