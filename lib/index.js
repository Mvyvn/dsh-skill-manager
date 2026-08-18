// dsh-skill-manager — DSH Skill Manager
//
// A real web-profile plugin for DSH (DeepSeek Harness) that manages the model
// skill catalog: scan official skill roots, one-click import / upload, group
// skills with per-skill enable/disable, pick a default group for every session
// plus a per-session override from the input bar — all in an all-Chinese web UI.
//
// Enable / disable mechanism
// --------------------------
// DSH skill discovery (dsh-skill-filesystem) only recognizes the exact
// filename `SKILL.md` inside a skill directory. Disabling a skill therefore
// atomically renames `SKILL.md` -> `SKILL.md.disable` in every root where it
// exists (source dir + import target); enabling renames it back and strips any
// legacy `disable-model-invocation` marker line. This is zero-content, atomic,
// multi-session-safe and fast (1-2 native fs ops per skill, no content copy).
//
// Multi-session safety
// --------------------
// Every write to $DSH_HOME/skill-mgmt.json is guarded by a cross-process
// exclusive lock file (skill-mgmt.json.lock, created with open('wx')), which is
// re-entrant within one process, so concurrent dsh sessions cannot interleave
// configuration writes.
//
// Transport
// ---------
// Host half: mounted as a plugin row in the web profile composition
// (cordis.patch.yml), serves an RPC channel /skillmg via
// ctx.connection.rpc.handle (authority: 'loopback') and the skillmg_* model
// tools via ctx.tools.register. Client half: a hand-written __ModuleLoader__
// bundle speaking the same client-request / server-response RPC protocol.
//
// License: MIT. Author: 沐云 (Mvyvn) <mvyvn@qq.com>
// Repository: https://github.com/Mvyvn/dsh-skill-manager
import { defineTool } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { access, open, rename, rm, unlink } from 'node:fs/promises'

export const name = 'dsh-skill-manager'
export const inject = ['connection', 'tools']

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ALL_OFF = '__all_off__'
const DISABLE_MARKER = 'disable-model-invocation: true'
const DISABLED_SUFFIX = '.disable'
const GUIDE_NAME = 'skill-grouping'

// Guide skill auto-maintained by the plugin (recreated when missing). It teaches
// the AI how to operate the manager with the skillmg_* tools on its own.
const GUIDE_SKILL_MD = [
  '---',
  'name: skill-grouping',
  'description: DSH Skill Manager 插件使用指南：讲解插件如何扫描来源目录、导入与上传技能、按分组启停技能（SKILL.md 原子改名机制）、设置默认组与全部禁用模式，指导 AI 使用 skillmg_* 工具自主完成技能管理。',
  '---',
  '',
  '# DSH Skill Manager 插件使用指南',
  '',
  '本技能由 DSH Skill Manager 插件在启动时自动维护（缺失即重建）。内容讲解插件的工作原理与全部操作方式，使 AI 无需用户手动操作即可自主完成技能的分组、导入、启停与默认组设置。',
  '',
  '## 一、插件管理什么',
  '',
  '- 来源目录（sourceDirs）：扫描技能的目录，默认 `~/.agents/skills`（即 `$HOME/.agents/skills`）。配置缺失时启动会自动填入 `~/.agents/skills` 与 `$DSH_HOME/skills`。',
  '- 导入目标（importTarget）：`$DSH_HOME/skills`。「导入」= 把来源技能完整复制到这里；DSH 按此目录加载技能，优先级高于 `~/.agents/skills`。',
  '- 分组（groups）：每个分组有 id、显示名、成员列表（`{name, enabled}` 数组）。`enabled=false` 表示组内停用。id `__all_off__` 为保留字。',
  '- 默认组（defaultGroup）：决定所有会话的模型技能目录；为空（未设置）时全部启用。',
  '- 会话覆盖（perSessionGroups）：按会话 id 记录的单会话分组，当前版本模型目录仍由默认组决定。',
  '- 配置文件：`$DSH_HOME/skill-mgmt.json`，插件改动即时写入；写入受跨进程锁保护，多会话并发安全。',
  '',
  '## 二、启停机制',
  '',
  '- 停用一个技能 = 把该技能的 `SKILL.md` 原子改名为 `SKILL.md.disable`（在源目录与导入目录都存在时两者都处理）。DSH 的技能发现只识别精确文件名 `SKILL.md`，改名后技能从模型目录消失。',
  '- 启用 = 把 `SKILL.md.disable` 原子改回 `SKILL.md`（并清理历史遗留的 `disable-model-invocation` 标记行）。',
  '- 改名是零内容、原子的文件系统操作，比插标记更快、更安全。',
  '- 只有已导入（存在于导入目标）的技能才受启停控制；未导入技能只在扫描列表出现，不影响模型目录。',
  '- 修改默认组或分组后插件会重扫并按组同步启停。',
  '- 全部禁用：默认组设为保留 id `__all_off__`，所有技能目录被清空；改回具体分组或清空默认组即恢复。',
  '',
  '## 三、可用工具',
  '',
  '- `skillmg_get_config`：来源目录、导入目标、默认组、分组列表、禁用数量。',
  '- `skillmg_scan`：全部可用技能（名称、描述、来源目录、是否已导入、是否被禁用）；描述来自 SKILL.md frontmatter。',
  '- `skillmg_import`：导入指定技能（`overwrite: true` 覆盖已导入项）。',
  '- `skillmg_delete`：从导入目标（`$DSH_HOME/skills`）删除指定技能，只删导入副本，不动来源目录；被删技能会从所有分组移除。',
  '- `skillmg_create_group` / `skillmg_delete_group`：创建 / 删除分组。删除当前默认组后默认组自动清空，等价于「全部启用」。',
  '- `skillmg_update_group`：设置分组成员 `[{name, enabled}]`；列表外的技能不属于该分组。',
  '- `skillmg_set_default_group`：设置默认组；空字符串 = 全部启用，`__all_off__` = 全部禁用。',
  '- `skillmg_set_session_group` / `skillmg_get_session`：记录 / 查询当前会话的分组覆盖。',
  '- `skillmg_debug_catalog`：查看运行时技能目录快照与本插件标记的禁用项。',
  '',
  '## 四、AI 自主操作流程',
  '',
  '1. 先 `skillmg_get_config` 查看当前分组、默认组与禁用数量。',
  '2. 建组：`skillmg_scan` 查看全部技能及描述 → `skillmg_create_group` 建组 → `skillmg_update_group` 加入场景匹配的技能（一个技能可属于多个分组）。',
  '3. 让所有会话使用某组：`skillmg_set_default_group` 指定分组 id；全部放行用空字符串；清空模型目录用 `__all_off__`。',
  '4. 用户想用的技能若未导入：`skillmg_import` 导入后再归组。',
  '5. 默认组可以删除；删除后恢复「全部启用」，无需特别保护。',
  '',
  '## 五、注意',
  '',
  '- 修改分组成员或默认组后模型目录立即重建生效；默认组为空 = 全部启用。',
  '- 本技能自身也在来源目录中；若它被停用，说明当前默认组未包含它，将其加回即可。',
].join('\n')

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------
export function apply(ctx) {
  const fs = ctx.get('fs')
  if (fs === undefined) {
    console.error('[dsh-skill-manager] no fs service; skill manager disabled')
    return
  }
  const skillsSvc = ctx.get('skills')
  const dshHomeRaw = ctx.get('dshHomePath')
  const dshHome = (typeof dshHomeRaw === 'string' && dshHomeRaw.length > 0) ? dshHomeRaw : (process.env.DSH_HOME || joinPath(homedir(), '.dsh'))

  // ---- path helpers ----
  function sep() { return dshHome.indexOf('\\') >= 0 ? '\\' : '/' }
  function joinPath(a, b) { return String(a).replace(/[\\/]+$/, '') + sep() + String(b).replace(/^[\\/]+/, '') }
  function dirname(p) { const n = String(p).replace(/[\\/]+$/, ''); const i = Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/')); return i <= 0 ? n : n.slice(0, i) }
  function basename(p) { return String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() }
  const defaultAgentsHome = joinPath(dirname(dshHome), '.agents')
  const defaultImportTarget = joinPath(dshHome, 'skills')
  const CONFIG_PATH = joinPath(dshHome, 'skill-mgmt.json')

  // ---- state & readiness ----
  let state = { sourceDirs: [], importTarget: defaultImportTarget, groups: [], defaultGroup: null, perSessionGroups: {}, disabled: {} }
  let stateReady = false; const waiters = []
  let syncing = false; let syncQueued = false
  let mutex = Promise.resolve()
  function serial(fn) { const run = mutex.then(fn, fn); mutex = run.then(() => {}, () => {}); return run }
  function signalReady() { stateReady = true; while (waiters.length) waiters.pop()() }
  function waitState() { if (stateReady) return Promise.resolve(); return new Promise((res) => waiters.push(res)) }

  // ---- cross-process config lock ----
  // Exclusive lock file so concurrent sessions cannot interleave writes to
  // skill-mgmt.json. Re-entrant within one process (lockDepth) so nested
  // persist/sync calls do not deadlock. Uses node:fs open('wx') which fails
  // atomically when the lock exists.
  const LOCK_PATH = CONFIG_PATH + '.lock'
  let lockFd = undefined
  let lockDepth = 0
  async function acquireLock(timeoutMs = 10000) {
    if (lockDepth > 0) { lockDepth += 1; return }
    const start = Date.now()
    for (;;) {
      try {
        lockFd = await open(LOCK_PATH, 'wx')
        lockDepth = 1
        return
      } catch (e) {
        if (e && (e.code === 'EEXIST' || e.code === 'EPERM')) {
          if (Date.now() - start > timeoutMs) throw new Error('[dsh-skill-manager] config lock timeout: ' + LOCK_PATH)
          await new Promise((r) => setTimeout(r, 120))
          continue
        }
        // Lock dir missing or other error: fall through without lock rather
        // than fail every write.
        return
      }
    }
  }
  async function releaseLock() {
    if (lockDepth === 0) return
    lockDepth -= 1
    if (lockDepth > 0) return
    const fd = lockFd
    lockFd = undefined
    try { if (fd !== undefined) await fd.close() } catch (e) { /* best effort */ }
    try { await unlink(LOCK_PATH) } catch (e) { /* best effort */ }
  }
  async function withConfigLock(fn) {
    await acquireLock()
    try { return await fn() } finally { await releaseLock() }
  }

  // ---- fs helpers (ctx.fs) ----
  async function resolveT(p) { return await fs.resolve(p) }
  async function existsAt(p) { try { const t = await resolveT(p); const i = await fs.stat(t); return i !== undefined } catch (e) { return false } }
  async function readJson(p) { try { const t = await resolveT(p); const i = await fs.stat(t); if (i === undefined) return undefined; return JSON.parse(await fs.readText(t)) } catch (e) { return undefined } }
  async function writeJson(p, v) { const t = await resolveT(p); await fs.writeText(t, JSON.stringify(v, null, 2)) }
  async function readText(p) { const t = await resolveT(p); return await fs.readText(t) }
  async function writeText(p, c) { await fs.writeText(await resolveT(p), c) }
  // Native fs helpers for the atomic rename (ctx.fs has no rename; node:fs does).
  async function nativeExists(p) { try { await access(p); return true } catch (e) { return false } }
  async function renameFile(from, to) { await rename(from, to) }

  // ---- config load / persist ----
  async function loadConfig() {
    const cfg = await readJson(CONFIG_PATH)
    if (cfg && typeof cfg === 'object') {
      state.sourceDirs = Array.isArray(cfg.sourceDirs) ? cfg.sourceDirs : []
      state.importTarget = (typeof cfg.importTarget === 'string' && cfg.importTarget) ? cfg.importTarget : defaultImportTarget
      state.groups = Array.isArray(cfg.groups) ? cfg.groups : []
      state.defaultGroup = (typeof cfg.defaultGroup === 'string' && cfg.defaultGroup) ? cfg.defaultGroup : null
      state.perSessionGroups = (cfg.perSessionGroups && typeof cfg.perSessionGroups === 'object') ? cfg.perSessionGroups : {}
      state.disabled = (cfg.disabled && typeof cfg.disabled === 'object') ? cfg.disabled : {}
    } else {
      state.sourceDirs = []
      for (const c of [joinPath(defaultAgentsHome, 'skills'), joinPath(dshHome, 'skills')]) { if (!state.sourceDirs.includes(c) && await existsAt(c)) state.sourceDirs.push(c) }
    }
    signalReady()
    await withConfigLock(async () => {
      await persist()
      await syncActiveGroup()
    })
    await ensureGuideSkill()
  }
  async function persist() { await writeJson(CONFIG_PATH, state) }

  // ---- frontmatter parsing ----
  function parseFmValue(fm, key) {
    const lines = String(fm).split('\n')
    const re = new RegExp('^\\s*' + key + '\\s*:\\s*(.*)$')
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i])
      if (!m) continue
      let v = m[1].trim()
      if (v === '' || v === '>' || v === '>-' || v === '|' || v === '|-') {
        const keyIndent = (lines[i].match(/^\s*/) || [''])[0].length
        const parts = []
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j]
          if (line.trim() === '') { if (parts.length) parts.push(''); continue }
          const ind = (line.match(/^\s*/) || [''])[0].length
          if (ind <= keyIndent) break
          parts.push(line.trim())
        }
        v = parts.join(' ')
      } else {
        v = v.replace(/^['"]|['"]$/g, '')
      }
      return v
    }
    return ''
  }
  async function parseSummaryText(text, fallbackName) {
    text = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    let name = fallbackName; let description = ''
    if (text.indexOf('---') === 0) {
      const end = text.indexOf('\n---', 3)
      if (end > 0) {
        const fm = text.slice(3, end)
        const nm = fm.match(/^\s*name\s*:\s*(.*)$/m)
        if (nm) { const v = String(nm[1]).trim().replace(/^['"]|['"]$/g, ''); if (v) name = v }
        description = parseFmValue(fm, 'description').replace(/\s+/g, ' ').trim()
      }
    }
    return { name, description }
  }
  async function readSummary(dir) {
    const t = joinPath(dir, 'SKILL.md')
    try {
      if (!(await existsAt(t))) return null
      const text = await readText(t)
      if (!text) return { name: basename(dir), description: '' }
      return await parseSummaryText(text, basename(dir))
    } catch (e) { return null }
  }
  async function readSummaryFile(filePath, fallbackName) {
    try {
      if (!(await nativeExists(filePath))) return null
      const text = await readText(filePath)
      if (!text) return { name: fallbackName, description: '' }
      return await parseSummaryText(text, fallbackName)
    } catch (e) { return null }
  }
  async function listDirEntries(dir) { try { if (!(await existsAt(dir))) return []; const t = await resolveT(dir); const entries = await fs.listDir(t); const out = []; for (const e of entries) if (e && typeof e === 'object' && typeof e.name === 'string') out.push({ name: e.name, type: e.type === 'directory' ? 'directory' : 'file' }); return out } catch (e) { return [] } }

  // ---- scanning ----
  async function scanSkills() {
    const out = []; const byName = {}
    // Scan higher-priority dirs (import target) LAST so their state wins
    // for a same-named skill present in several roots. The import target is
    // the authoritative state holder; anything else is a source of truth for
    // skills not present there.
    const dirs = [...state.sourceDirs].sort((a, b) => {
      const aImp = String(a).toLowerCase() === String(state.importTarget).toLowerCase() ? 1 : 0
      const bImp = String(b).toLowerCase() === String(state.importTarget).toLowerCase() ? 1 : 0
      return aImp - bImp
    })
    for (const dir of dirs) {
      try {
        for (const name of await listDirEntries(dir).then((l) => l.map((e) => e.name))) {
          const dirPath = joinPath(dir, name)
          let sum = await readSummary(dirPath)
          let disabled = await nativeExists(joinPath(dirPath, 'SKILL.md' + DISABLED_SUFFIX))
          if (!sum && disabled) {
            // Disabled skill: read summary from the .disable file so it still
            // appears in listings and can be re-enabled by a later sync.
            const dsum = await readSummaryFile(joinPath(dirPath, 'SKILL.md' + DISABLED_SUFFIX), name)
            if (!dsum) continue
            sum = { name: dsum.name, description: dsum.description }
          }
          if (!sum) continue
          const key = sum.name
          const prev = byName[key]
          if (prev) {
            // Same-named skill already recorded: keep the more authoritative
            // (import-target) entry; otherwise merge the disabled flag.
            const prevIsImp = String(prev.sourceDir).toLowerCase() === String(state.importTarget).toLowerCase()
            const curIsImp = String(dir).toLowerCase() === String(state.importTarget).toLowerCase()
            if (curIsImp && !prevIsImp) {
              prev.sourceDir = dir
              prev.imported = true
            }
            if (disabled) prev.disabled = true
            continue
          }
          byName[key] = { name: sum.name, dirName: name, description: sum.description, sourceDir: dir, imported: await existsAt(joinPath(state.importTarget, name)), disabled }
        }
      } catch (e) { console.error('[dsh-skill-manager] scan dir failed ' + dir, e && e.message) }
    }
    return Object.values(byName).sort((a, b) => a.name.localeCompare(b.name))
  }

  // ---- import (copy source tree into the import target) ----
  async function copyTree(srcDir, dstDir) { const created = []; const skipped = []; await copyRec(srcDir, dstDir, created, skipped); return { created, skipped } }
  async function copyRec(srcDir, dstDir, created, skipped) {
    const entries = await listDirEntries(srcDir)
    const jobs = entries.map((ent) => async () => {
      const s = joinPath(srcDir, ent.name)
      const dst = joinPath(dstDir, ent.name)
      try {
        if (ent.type === 'directory') {
          if (!(await existsAt(dst))) await writeText(joinPath(dst, '.dshkeep'), '')
          await copyRec(s, dst, created, skipped)
        } else {
          const text = await readText(s)
          await writeText(dst, text)
          created.push(ent.name)
        }
      } catch (e) { skipped.push(ent.name) }
    })
    for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((fn) => fn()))
  }
  async function importSkills(args) { const names = (args && Array.isArray(args.names)) ? args.names : []; const reports = []; for (const name of names) { let found = null; for (const dir of state.sourceDirs) if (await existsAt(joinPath(dir, name))) { found = joinPath(dir, name); break } if (!found) { reports.push({ name, ok: false, reason: 'source missing' }); continue } const dst = joinPath(state.importTarget, name); if (await existsAt(dst) && !(args && args.overwrite)) { reports.push({ name, ok: false, reason: 'already imported (use overwrite)' }); continue } try { const r = await copyTree(found, dst); reports.push({ name, ok: true, created: r.created.length, skipped: r.skipped }) } catch (e) { reports.push({ name, ok: false, reason: String((e && e.message) || e) }) } } await syncActiveGroup(); return reports }

  // ---- delete (remove an imported skill from the import target) ----
  // Only affects the DSH skills folder ($DSH_HOME/skills); never touches the
  // source directories. Removes the skill from every group and from the disabled
  // map, then re-applies the active group policy.
  async function deleteSkills(names) {
    const reports = []
    for (const name of names) {
      const dir = joinPath(state.importTarget, name)
      try {
        if (!(await existsAt(dir))) { reports.push({ name, ok: false, reason: 'not imported' }); continue }
        // `dir` is already a real filesystem path (joinPath of the importTarget
        // and the skill name); ctx.fs.resolve returns a fs-service token object,
        // which node:fs/promises rm rejects. Pass the native path string.
        await rm(dir, { recursive: true, force: true })
        delete state.disabled[name]
        for (const g of state.groups || []) if (Array.isArray(g.skills)) g.skills = g.skills.filter((s) => s && s.name !== name)
        reports.push({ name, ok: true })
      } catch (e) { reports.push({ name, ok: false, reason: String((e && e.message) || e) }) }
    }
    await afterGroupChange()
    return reports
  }

  // ---- groups ----
  function groupById(id) { return (state.groups || []).find((g) => g && g.id === id) || null }
  function enabledNames(group) { const set = new Set(); for (const s of (group && group.skills) || []) if (s && typeof s.name === 'string' && s.enabled !== false) set.add(s.name); return set }

  // ---- enable / disable (atomic rename) ----
  // Skill roots that can host the disable rename: the source dir (when it is
  // not the import target) plus the import target itself. Renaming SKILL.md to
  // SKILL.md.disable in every root where it exists removes the skill from DSH
  // discovery entirely (official discovery only recognizes the exact filename
  // `SKILL.md`); renaming back restores it. Atomic, zero-content.
  function candidateMdPaths(skill) {
    const paths = []
    const srcDir = joinPath(skill.sourceDir, skill.dirName)
    const dstDir = joinPath(state.importTarget, skill.dirName)
    const srcMd = joinPath(srcDir, 'SKILL.md')
    const dstMd = joinPath(dstDir, 'SKILL.md')
    if (String(srcDir).toLowerCase() !== String(dstDir).toLowerCase()) paths.push({ md: srcMd, disabled: joinPath(srcDir, 'SKILL.md' + DISABLED_SUFFIX) })
    paths.push({ md: dstMd, disabled: joinPath(dstDir, 'SKILL.md' + DISABLED_SUFFIX) })
    return paths
  }
  async function disableSkill(skill) {
    for (const p of candidateMdPaths(skill)) {
      if (await nativeExists(p.md)) {
        if (!(await nativeExists(p.disabled))) await renameFile(p.md, p.disabled)
      }
    }
    state.disabled[skill.dirName] = true
  }
  async function enableSkill(skill) {
    for (const p of candidateMdPaths(skill)) {
      if (await nativeExists(p.disabled)) await renameFile(p.disabled, p.md)
      // Legacy cleanup: remove the old disable-model-invocation marker line
      // from any SKILL.md we just restored (and from already-present ones),
      // so skills re-enabled under the rename scheme are fully clean.
      if (await nativeExists(p.md)) {
        try {
          const text = await readText(p.md)
          if (text.indexOf(DISABLE_MARKER) >= 0) {
            const next = text.split('\n').filter((l) => l.trim() !== DISABLE_MARKER).join('\n')
            if (next !== text) await writeText(p.md, next)
          }
        } catch (e) { /* best effort */ }
      }
    }
    delete state.disabled[skill.dirName]
  }
  async function skillActuallyDisabled(skill) {
    // Disabled when the highest-priority root (import target first, else
    // source) has its SKILL.md renamed to .disable and no live SKILL.md.
    const impDir = joinPath(state.importTarget, skill.dirName)
    const impMd = joinPath(impDir, 'SKILL.md')
    const impDisabled = joinPath(impDir, 'SKILL.md' + DISABLED_SUFFIX)
    if (await nativeExists(impMd)) return false
    if (await nativeExists(impDisabled)) return true
    const srcDir = joinPath(skill.sourceDir, skill.dirName)
    if (String(srcDir).toLowerCase() !== String(impDir).toLowerCase()) {
      if (await nativeExists(joinPath(srcDir, 'SKILL.md'))) return false
      if (await nativeExists(joinPath(srcDir, 'SKILL.md' + DISABLED_SUFFIX))) return true
    }
    return false
  }

  // ---- group sync ----
  async function syncActiveGroup() { if (syncing) { syncQueued = true; return } syncing = true; try { let enabled = null; if (state.defaultGroup === ALL_OFF) { enabled = new Set() } else if (state.defaultGroup) { const group = groupById(state.defaultGroup); if (group) enabled = enabledNames(group) } const all = await scanSkills(); const failures = []; for (const skill of all) { try { const shouldEnable = enabled === null || enabled.has(skill.name); if (shouldEnable) await enableSkill(skill); else await disableSkill(skill) } catch (e) { failures.push(skill.name + ': ' + ((e && e.message) || e)) } } const known = {}; for (const s of all) known[s.dirName] = true; for (const k of Object.keys(state.disabled)) if (!known[k]) delete state.disabled[k]; await withConfigLock(async () => { await persist() }); if (failures.length) console.error('[dsh-skill-manager] sync partial failures', failures) } finally { syncing = false; if (syncQueued) { syncQueued = false; await syncActiveGroup() } } }
  async function afterGroupChange() { await withConfigLock(async () => { await persist(); await syncActiveGroup() }) }

  // ---- guide skill bootstrap ----
  async function ensureGuideSkill() {
    try {
      if (!state.sourceDirs.length) return
      const src = state.sourceDirs[0]
      const md = joinPath(joinPath(src, GUIDE_NAME), 'SKILL.md')
      if (await existsAt(md)) return
      await writeText(md, GUIDE_SKILL_MD)
      console.log('[dsh-skill-manager] created guide skill at ' + md)
    } catch (e) { console.error('[dsh-skill-manager] ensureGuideSkill failed: ' + ((e && e.message) || e)) }
  }

  // ---- tool output helpers ----
  function textOf(v) { return [{ type: 'text', text: JSON.stringify(v) }] }
  function renderText() { return (_args, value) => textOf(value) }

  // ---- Connection RPC channel (client calls /skillmg/<endpoint>) ----
  ctx.connection.rpc.handle('/skillmg', async (endpoint, payload) => {
    const args = (payload && typeof payload === 'object') ? payload : {}
    switch (endpoint) {
      case 'get-config':
        return {
          dshHome,
          defaultAgentSkills: joinPath(defaultAgentsHome, 'skills'),
          importTarget: state.importTarget,
          sourceDirs: state.sourceDirs,
          defaultGroup: state.defaultGroup,
          groups: (state.groups || []).map((g) => ({ id: g.id, name: g.name || g.id, skills: (g.skills || []).map((s) => ({ name: s.name, enabled: s.enabled !== false })) })),
          perSessionGroups: state.perSessionGroups,
          disabledCount: Object.keys(state.disabled).length,
        }
      case 'scan': {
        try {
          const all = await scanSkills()
          return all.map((s) => ({ name: s.name, description: (s.description || '').slice(0, 120), imported: s.imported, disabled: !!state.disabled[s.dirName] }))
        } catch (e) { console.error('[dsh-skill-manager] scan failed', e && e.message); return [] }
      }
      case 'import': return await serial(() => importSkills(args))
      case 'delete': {
        const names = Array.isArray(args.names) ? args.names.filter((n) => typeof n === 'string' && n) : []
        if (!names.length) return { ok: false, reports: [], reason: 'no names' }
        return await serial(async () => {
          const reports = await deleteSkills(names)
          const ok = reports.filter((r) => r.ok).length
          return { ok: ok > 0, count: ok, total: names.length, reports }
        })
      }
      case 'create-group': return await serial(async () => {
        const id = args.id || ''; if (!id) return { ok: false, reason: 'id required' }
        if (id === ALL_OFF) return { ok: false, reason: 'reserved id' }
        if (groupById(id)) return { ok: false, reason: 'exists' }
        state.groups = state.groups || []; state.groups.push({ id, name: args.name || id, skills: [] })
        await afterGroupChange(); return { ok: true, id }
      })
      case 'delete-group': return await serial(async () => {
        const id = args.id; state.groups = (state.groups || []).filter((g) => g.id !== id)
        if (state.defaultGroup === id) state.defaultGroup = null
        for (const k of Object.keys(state.perSessionGroups || {})) if (state.perSessionGroups[k] === id) delete state.perSessionGroups[k]
        await afterGroupChange(); return { ok: true }
      })
      case 'update-group': return await serial(async () => {
        const g = groupById(args.id); if (!g) return { ok: false, reason: 'not found' }
        if (typeof args.name === 'string') g.name = args.name
        if (Array.isArray(args.skills)) g.skills = args.skills.map((s) => ({ name: typeof s === 'string' ? s : s.name, enabled: !(s && s.enabled === false) }))
        await afterGroupChange(); return { ok: true }
      })
      case 'set-default-group': return await serial(async () => {
        const v = (typeof args.groupId === 'string' && args.groupId) ? args.groupId : null
        state.defaultGroup = v
        await afterGroupChange()
        return { ok: true, defaultGroup: state.defaultGroup, disabledCount: Object.keys(state.disabled).length }
      })
      case 'set-session-group': return await serial(async () => {
        const sid = args.sessionId; const gid = (typeof args.groupId === 'string' && args.groupId) ? args.groupId : null
        if (!sid) return { ok: false, reason: 'sessionId required' }
        if (gid && gid !== ALL_OFF && !groupById(gid)) return { ok: false, reason: 'group not found' }
        state.perSessionGroups = state.perSessionGroups || {}
        if (gid == null) delete state.perSessionGroups[String(sid)]
        else state.perSessionGroups[String(sid)] = gid
        await withConfigLock(async () => { await persist() }); return { ok: true }
      })
      case 'get-session': {
        // Per-session override lookup for the input-bar picker. The browser RPC
        // path carries the session id in the payload (there is no exec context
        // on the Connection channel). Returns the override when present, else the
        // default group id (or null when none / all enabled).
        const sid = args.sessionId
        const override = (sid != null && state.perSessionGroups != null) ? state.perSessionGroups[String(sid)] : undefined
        let activeGroup = null
        if (override != null) {
          activeGroup = (override !== ALL_OFF && groupById(override)) ? groupById(override).id : override
        } else if (state.defaultGroup) {
          const g = groupById(state.defaultGroup); if (g) activeGroup = g.id
        }
        return { sessionId: String(sid), activeGroup, fromOverride: override != null }
      }
      case 'upload': return await serial(async () => {
        const files = Array.isArray(args.files) ? args.files : []
        if (files.length > 500) return { ok: false, count: 0, total: files.length, reports: [], existing: 0, rejected: 0, reason: '文件数过多（>500）' }
        const reports = []; let okCount = 0; let existingCount = 0; let rejectedCount = 0
        const overwrite = !!(args.overwrite)
        const JUNK = /(^|[\\/])(\.ds_store|thumbs\.db|desktop\.ini|\.dshkeep|__macosx)([\\/]|$)/i
        for (const f of files) {
          const raw = String((f && f.path) || '')
          const segs = raw.split(/[\\/]+/).filter(Boolean)
          if (!segs.length) { reports.push({ path: raw || '(空路径)', ok: false, reason: '路径为空' }); rejectedCount++; continue }
          if (segs.indexOf('..') >= 0) { reports.push({ path: raw, ok: false, reason: '不允许上级路径' }); rejectedCount++; continue }
          if (segs.length > 8) { reports.push({ path: raw, ok: false, reason: '层级过深' }); rejectedCount++; continue }
          if (segs.some((s) => s === '.' || /[:*?"<>|]/.test(s) || s.length > 200 || s.charAt(0) === '.')) { reports.push({ path: raw, ok: false, reason: '路径含非法字符或隐藏项' }); rejectedCount++; continue }
          const base = segs[segs.length - 1]
          if (JUNK.test(raw) || JUNK.test(base)) { rejectedCount++; continue }
          const dst = joinPath(state.importTarget, segs.join(sep()))
          try {
            if (!overwrite && await existsAt(dst)) { reports.push({ path: segs.join('/'), ok: false, reason: '已存在' }); existingCount++; continue }
            await writeText(dst, String((f && f.content) || '')); okCount++; reports.push({ path: segs.join('/'), ok: true })
          } catch (e) { reports.push({ path: segs.join('/'), ok: false, reason: String((e && e.message) || e) }); rejectedCount++ }
        }
        if (!state.sourceDirs.includes(state.importTarget)) state.sourceDirs.push(state.importTarget)
        await afterGroupChange()
        return { ok: okCount > 0, count: okCount, total: files.length, reports, existing: existingCount, rejected: rejectedCount }
      })
      default:
        return { ok: false, reason: 'unknown endpoint: ' + endpoint }
    }
  }, { authority: 'loopback' })

  // ---- model tools ----
  const register = (tool) => ctx.tools.register(tool)

  register(defineTool({
    name: 'skillmg_get_config',
    description: 'Show the DSH Skill Manager configuration: source scan directories, import target, the default group, and how many skills the active default group currently disables. The default group may be null (all enabled) or __all_off__ (all disabled).',
    parameters: {},
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async () => ({
      dshHome,
      defaultAgentSkills: joinPath(defaultAgentsHome, 'skills'),
      importTarget: state.importTarget,
      sourceDirs: state.sourceDirs,
      defaultGroup: state.defaultGroup,
      groups: (state.groups || []).map((g) => g.id),
      disabledCount: Object.keys(state.disabled).length,
    }),
  }))

  register(defineTool({
    name: 'skillmg_scan',
    description: 'Scan the configured source skills directories (default ~/.agents/skills) and list every available skill with its name, description (first 200 chars), source directory, whether it is already imported to the DSH skills folder, and whether it is currently disabled (hidden from the model catalog).',
    parameters: {},
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async () => {
      try {
        const all = await scanSkills()
        return all.map((s) => ({ name: s.name, description: (s.description || '').slice(0, 200), sourceDir: s.sourceDir, imported: s.imported, disabled: !!state.disabled[s.dirName] }))
      } catch (e) { return [{ name: 'scan-error', description: String((e && e.message) || e), sourceDir: '', imported: false, disabled: false }] }
    },
  }))

  register(defineTool({
    name: 'skillmg_import',
    description: 'Import one or more skills into the DSH skills folder ($DSH_HOME/skills). Provide an array of exact skill names from skillmg_scan. Set overwrite true to replace an existing import. After import the active group policy is re-applied.',
    parameters: {
      names: { type: 'array', required: true, description: 'Array of exact skill names to import.' },
      overwrite: { type: 'boolean', required: true, description: 'Whether to replace an already-imported skill.' },
    },
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async (args) => serial(() => importSkills(args || {})),
  }))

  register(defineTool({
    name: 'skillmg_delete',
    description: 'Delete one or more imported skills from the DSH skills folder ($DSH_HOME/skills). Provide an array of exact skill names from skillmg_scan. Only removes the copy under the import target; the original in the source directory is left untouched, and the skill is removed from every group. After deletion the active group policy is re-applied.',
    parameters: { names: { type: 'array', required: true, description: 'Array of exact skill names to delete.' } },
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async (args) => serial(() => deleteSkills(Array.isArray(args && args.names) ? args.names : [])),
  }))

  register(defineTool({
    name: 'skillmg_list_groups',
    description: 'List all skill groups with their skills and enabled state.',
    parameters: {},
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async () => (state.groups || []).map((g) => ({ id: g.id, name: g.name || g.id, skills: (g.skills || []).map((s) => ({ name: s.name, enabled: s.enabled !== false })) })),
  }))

  register(defineTool({
    name: 'skillmg_create_group',
    description: 'Create a new skill group with an id and display name. A group is empty until you add skills with skillmg_update_group. The id __all_off__ is reserved.',
    parameters: {
      id: { type: 'string', required: true, description: 'Group id (kebab-case).' },
      name: { type: 'string', required: true, description: 'Display name.' },
    },
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async (args) => serial(async () => {
      const id = (args && args.id) || ''; if (!id) return { ok: false, reason: 'id required' }
      if (id === ALL_OFF) return { ok: false, reason: 'reserved id' }
      if (groupById(id)) return { ok: false, reason: 'exists' }
      state.groups = state.groups || []; state.groups.push({ id, name: (args && args.name) || id, skills: [] })
      await afterGroupChange(); return { ok: true, id }
    }),
  }))

  register(defineTool({
    name: 'skillmg_delete_group',
    description: 'Delete a skill group by id. Deleting the current default group clears it, which means all skills enabled again.',
    parameters: { id: { type: 'string', required: true, description: 'Group id to delete.' } },
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async (args) => serial(async () => {
      const id = args && args.id
      state.groups = (state.groups || []).filter((g) => g.id !== id)
      if (state.defaultGroup === id) state.defaultGroup = null
      for (const k of Object.keys(state.perSessionGroups || {})) if (state.perSessionGroups[k] === id) delete state.perSessionGroups[k]
      await afterGroupChange(); return { ok: true }
    }),
  }))

  register(defineTool({
    name: 'skillmg_update_group',
    description: 'Set which skills belong to a group and whether each is enabled. skills is an array of objects {name, enabled}. A skill present with enabled=true is available when its group is selected; skills absent from the list are not available. Changing the active group immediately reshapes the model skill catalog. Use skillmg_scan to list valid skill names.',
    parameters: {
      id: { type: 'string', required: true, description: 'Group id.' },
      skills: { type: 'array', required: true, description: 'Array of {name, enabled} skill entries.' },
    },
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async (args) => serial(async () => {
      const g = groupById(args && args.id); if (!g) return { ok: false, reason: 'not found' }
      if (args && Array.isArray(args.skills)) g.skills = args.skills.map((s) => ({ name: typeof s === 'string' ? s : s.name, enabled: !(s && s.enabled === false) }))
      await afterGroupChange(); return { ok: true }
    }),
  }))

  register(defineTool({
    name: 'skillmg_set_default_group',
    description: 'Set the default skill group applied to every session. Pass an empty string to clear it (all skills enabled again), or __all_off__ to disable every skill (empty catalog). Changing this immediately reshapes the model skill catalog for every session.',
    parameters: { group_id: { type: 'string', required: true, description: 'Group id, empty string for all enabled, or __all_off__ for all disabled.' } },
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async (args) => serial(async () => {
      const v = (args && typeof args.group_id === 'string' && args.group_id) ? args.group_id : null
      state.defaultGroup = v
      await afterGroupChange()
      return { ok: true, defaultGroup: state.defaultGroup, disabledCount: Object.keys(state.disabled).length }
    }),
  }))

  register(defineTool({
    name: 'skillmg_set_session_group',
    description: 'Record a per-session skill-group override by session id (or clear it with an empty group_id). Persisted for future fine-grained per-session filtering; the model catalog is currently shaped by the default group.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session id.' },
      group_id: { type: 'string', required: true, description: 'Group id, or empty string to clear the override.' },
    },
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async (args) => serial(async () => {
      const sid = args && args.session_id
      const gid = (args && typeof args.group_id === 'string' && args.group_id) ? args.group_id : null
      if (!sid) return { ok: false, reason: 'session_id required' }
      if (gid && gid !== ALL_OFF && !groupById(gid)) return { ok: false, reason: 'group not found' }
      state.perSessionGroups = state.perSessionGroups || {}
      if (gid == null) delete state.perSessionGroups[String(sid)]
      else state.perSessionGroups[String(sid)] = gid
      await withConfigLock(async () => { await persist() }); return { ok: true }
    }),
  }))

  register(defineTool({
    name: 'skillmg_get_session',
    description: 'Return the current session id and its resolved default/override group. Use this before skillmg_set_session_group.',
    parameters: {},
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async (_args, exec) => {
      let sessionId
      try { sessionId = (exec && exec.agent && exec.agent.session) ? exec.agent.session.id : undefined } catch (e) { sessionId = undefined }
      const override = (sessionId != null && state.perSessionGroups != null) ? state.perSessionGroups[String(sessionId)] : undefined
      // Report the CURRENT session's override when present, else fall back to the
      // default group. Returning defaultGroup unconditionally made the input-bar
      // picker snap back to the default after every selection.
      if (override != null) {
        return { sessionId: String(sessionId), activeGroup: override, fromOverride: true }
      }
      const g = state.defaultGroup ? groupById(state.defaultGroup) : null
      return { sessionId: String(sessionId), activeGroup: g ? g.id : null, fromOverride: false }
    },
  }))

  register(defineTool({
    name: 'skillmg_debug_catalog',
    description: 'Internal diagnostics: show the live runtime skill catalog with each skill source and provider, plus which skills this plugin marks disabled. Use to verify which origin wins a duplicate name.',
    parameters: {},
    output: { schema: { type: 'string' }, render: renderText() },
    execute: async (_args, exec) => {
      const out = { snapshot: [], disabled: Object.keys(state.disabled) }
      if (skillsSvc && typeof skillsSvc.snapshot === 'function') {
        try {
          let agent; try { agent = exec && exec.agent } catch (e) { agent = undefined }
          const snap = await skillsSvc.snapshot({ scope: agent, cwd: agent && agent.session && agent.session.header ? agent.session.header.cwd : undefined })
          out.snapshot = (snap.skills || []).map((s) => ({ name: s.name, source: s.source, provider: s.provider }))
          out.complete = !!snap.complete
        } catch (e) { out.snapshotError = String((e && e.message) || e) }
      }
      return out
    },
  }))

  loadConfig().catch((e) => { console.error('[dsh-skill-manager] loadConfig failed', e && e.message); signalReady() })
}
