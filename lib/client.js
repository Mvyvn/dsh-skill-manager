// dsh-skill-manager — DSH Skill Manager, client half.
//
// A hand-written browser bundle served by the web profile's client-modules
// mechanism (dsh.client manifest in package.json). Wrapped in the shell's
// __ModuleLoader__ format; speaks to the host through the generic Connection
// RPC channel /skillmg (POST + client-request / server-response envelope, the
// same protocol as @deepseek-ai/dsh-client-connection's createWebConnectionRpc).
// No build step: this file is the final artifact.
//
// UI: Settings -> "Skill 管理" (import / upload / groups / default group) plus
// a session-scoped group picker in the conversation input bar.
//
// License: MIT. Author: 沐云 (Mvyvn) <mvyvn@qq.com>
// Repository: https://github.com/Mvyvn/dsh-skill-manager
window.__ModuleLoader__.load({
  id: 'dsh-skill-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var react = require('react')
    var createElement = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect
    var useRef = react.useRef
    var ALL_OFF = '__all_off__'

    // ---- Connection RPC caller (mirrors createWebConnectionRpc) ----
    function rpcId() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      return 'rpc-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    }
    function rpcCall(channel, endpoint, payload) {
      var message = { type: 'client-request', rpcId: rpcId(), method: endpoint, payload: payload === undefined ? {} : payload }
      return fetch(new URL(channel + '/' + endpoint, window.location.origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      }).then(function (res) {
        if (!res.ok) throw new Error('skillmg RPC ' + endpoint + ': HTTP ' + res.status)
        return res.json()
      }).then(function (full) {
        if (!full || full.type !== 'server-response' || full.rpcId !== message.rpcId) throw new Error('skillmg RPC envelope mismatch for ' + endpoint)
        return full.result
      })
    }

    // ---- styles ----
    var CSS = [
      '.skmg-section{display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-height:0;overflow-y:auto}',
      '.skmg-box{display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.skmg-heading{padding:14px 0 4px;font-size:12px;line-height:17px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}',
      '.skmg-heading:first-child{padding-top:0}',
      '.skmg-note{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
      '.skmg-ok{padding:8px 0 2px;font-size:12px;line-height:17px;color:var(--dsw-alias-state-success-primary)}',
      '.skmg-error{padding:8px 0 2px;font-size:12px;line-height:17px;color:var(--dsw-alias-state-error-primary)}',
      '.skmg-hbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.skmg-count{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.skmg-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.skmg-rowText{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.skmg-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '.skmg-desc{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
      '.skmg-path{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);word-break:break-all;text-align:right}',
      '.skmg-toggle{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));cursor:pointer}',
      '.skmg-input{flex:1;min-width:0;padding:4px 8px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px}',
      '.skmg-input:focus-visible{outline:2px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));outline-offset:1px}',
      '.skmg-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:4px 12px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;cursor:pointer;transition:background .12s ease,border-color .12s ease}',
      '.skmg-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}',
      '.skmg-btn.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-bg-layer-2))}',
      '.skmg-btn.on:hover{filter:none;background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-bg-layer-2))}',
      '.skmg-btn.primary{color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border:none;border-radius:18px;height:36px;padding:0 18px;font-size:14px;line-height:22px}',
      '.skmg-btn.primary:hover:not(:disabled){filter:none;background:var(--dsw-alias-button-primary-fill-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)))}',
      '.skmg-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.skmg-btn.danger:hover{background:var(--dsw-alias-bg-layer-1)}',
      '.skmg-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.skmg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px}',
      '.skmg-card{position:relative;display:flex;flex-direction:column;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;font:inherit;color:inherit;cursor:pointer;transition:background .12s ease,border-color .12s ease}',
      '.skmg-card:not(.on):hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}',
      '.skmg-card.on{border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-bg-layer-2))}',
      '.skmg-cardMain{display:flex;flex-direction:column;gap:2px;width:100%;padding:10px 12px;border:0;border-radius:inherit;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer}',
      '.skmg-cardMain:focus-visible{outline:2px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));outline-offset:2px}',
      '.skmg-cardTop{display:flex;align-items:center;gap:6px;min-width:0}',
      '.skmg-cardTitle{flex:1;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.skmg-card.on .skmg-cardTitle{color:var(--dsw-alias-label-primary)}',
      '.skmg-cardDesc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.skmg-card.on .skmg-cardDesc{color:var(--dsw-alias-label-secondary)}',
      '.skmg-cardCheck{display:inline-flex;align-items:center;flex:none;color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));font-size:13px;font-weight:700}',
      '.skmg-tag{display:inline-flex;align-items:center;flex:none;height:16px;padding:0 5px;border-radius:4px;font-size:10px;line-height:16px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.skmg-tag.ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.skmg-tag.warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.skmg-cardFoot{display:flex;align-items:center;gap:6px;padding:2px 12px 8px}',
      '.skmg-footToggle{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer}',
      '.skmg-footToggle input{margin:0}',
      '.skmg-groupCard{position:relative;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;transition:border-color .12s ease,background .12s ease}',
      '.skmg-groupCard:hover{border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l2))}',
      '.skmg-groupCard.open{border-color:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2))}',
      '.skmg-groupMain{width:100%;display:flex;align-items:center;gap:8px;min-width:0;padding:10px 12px;border:0;border-radius:8px;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer;outline:none}',
      '.skmg-groupMain:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}',
      '.skmg-groupMain:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.skmg-groupName{flex:1;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.skmg-groupChevron{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));flex:none;font-size:11px;transition:transform .12s ease}',
      '.skmg-groupChevron.open{transform:rotate(180deg)}',
      '.skmg-groupActions{display:inline-flex;align-items:center;gap:4px;flex:none;opacity:0;transition:opacity .12s ease}',
      '.skmg-groupCard:hover .skmg-groupActions,.skmg-groupCard:focus-within .skmg-groupActions{opacity:1}',
      '.skmg-groupSetDefault{height:22px;display:inline-flex;align-items:center;border:0;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;line-height:1;padding:0 8px}',
      '.skmg-groupSetDefault:hover{color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}',
      '.skmg-groupDel{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer;font-size:12px;line-height:1}',
      '.skmg-groupDel:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}',
      '.skmg-menu{position:absolute;left:0;right:auto;bottom:calc(100% + 8px);z-index:60;display:flex;flex-direction:column;gap:2px;min-width:min(240px,100%);max-width:min(280px,calc(100vw - 32px));max-height:min(360px,calc(100vh - 96px));overflow-y:auto;padding:4px;border:1px solid var(--dsw-alias-border-inverted,var(--dsw-alias-border-l2));background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));border-radius:12px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.2));color:var(--dsw-alias-label-primary)}',
      '.skmg-menuItem{appearance:none;width:100%;min-height:36px;display:flex;align-items:center;gap:8px;padding:6px 10px;border:0;border-radius:8px;background:transparent;font:inherit;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer}',
      '.skmg-menuItem:hover,.skmg-menuItem.on{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}',
      '.skmg-menuItem:focus-visible{outline:2px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));outline-offset:-1px}',
      '.skmg-menuTitle{min-width:0;flex:1;font-size:13px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.skmg-menuDesc{min-width:0;flex:none;max-width:45%;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.skmg-menuCheck{flex:none;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}',
      '.skmg-inputTrigger{min-width:0;max-width:220px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}',
      '.skmg-inputTrigger:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}',
      '.skmg-inputTrigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3,var(--dsw-alias-border-l2))}',
      '.skmg-inputTriggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
      '.skmg-inputChevron{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary)));flex:none;display:inline-flex;font-size:11px;transition:transform .12s ease}',
      '.skmg-inputChevron.open{transform:rotate(180deg)}',
    ].join('')

    function injectCss() {
      var el = document.createElement('style')
      el.setAttribute('data-dsh-skill-manager', '')
      el.textContent = CSS
      document.head.appendChild(el)
      return el
    }

    // ---- components ----
    function useRpc(endpoint, args) {
      var pair = useState(null)
      var data = pair[0]
      var setData = pair[1]
      var refreshPair = useState(0)
      var refresh = refreshPair[0]
      var setRefresh = refreshPair[1]
      useEffect(function () {
        var alive = true
        rpcCall('/skillmg', endpoint, args || {}).then(function (d) { if (alive) setData(d) }).catch(function () {})
        return function () { alive = false }
      }, [refresh])
      return { data: data, reload: function () { setRefresh(function (x) { return x + 1 }) } }
    }

    function Btn(props) {
      var rest = Object.assign({}, props)
      var children = rest.children; delete rest.children
      var cls = rest.className; delete rest.className
      return createElement('button', Object.assign({ type: 'button', className: 'skmg-btn' + (cls ? ' ' + cls : '') }, rest), children)
    }

    function Tag(props) {
      return createElement('span', { className: 'skmg-tag' + (props.cls ? ' ' + props.cls : '') }, props.children)
    }

    function Card(props) {
      return createElement('div', { className: 'skmg-card' + (props.selected ? ' on' : '') },
        createElement('button', { type: 'button', className: 'skmg-cardMain', onClick: props.onClick, title: props.desc || props.title },
          createElement('span', { className: 'skmg-cardTop' },
            createElement('span', { className: 'skmg-cardTitle' }, props.title),
            props.tag ? createElement(Tag, { cls: props.tagCls }, props.tag) : null,
            props.selected ? createElement('span', { className: 'skmg-cardCheck' }, '✓') : null
          ),
          createElement('span', { className: 'skmg-cardDesc' }, props.desc || '')
        ),
        props.children || null
      )
    }

    // ---- zip unpack (browser side; deflate via DecompressionStream) ----
    function inflateRaw(comp) {
      if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('当前浏览器不支持 zip 解压，请改用「上传文件夹」'))
      var ds = new DecompressionStream('deflate-raw')
      var stream = new Blob([comp]).stream().pipeThrough(ds)
      return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab) })
    }
    function parseZip(buf) {
      var u8 = new Uint8Array(buf)
      var dv = new DataView(buf)
      var len = u8.length
      var eocd = -1
      var min = Math.max(0, len - 65557)
      for (var i = len - 22; i >= min; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break } }
      if (eocd < 0) return Promise.reject(new Error('不是有效的 zip 文件'))
      var count = dv.getUint16(eocd + 10, true)
      var cdSize = dv.getUint32(eocd + 12, true)
      var cdOffset = dv.getUint32(eocd + 16, true)
      if (cdOffset + cdSize > len) return Promise.reject(new Error('zip 目录损坏'))
      var entries = []
      var p = cdOffset
      var end = cdOffset + cdSize
      while (p + 46 <= end && entries.length < 500) {
        if (dv.getUint32(p, true) !== 0x02014b50) break
        var method = dv.getUint16(p + 10, true)
        var compSize = dv.getUint32(p + 20, true)
        var nameLen = dv.getUint16(p + 28, true)
        var extraLen = dv.getUint16(p + 30, true)
        var commentLen = dv.getUint16(p + 32, true)
        var localOffset = dv.getUint32(p + 42, true)
        var name = ''
        try { name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nameLen)) } catch (e) {}
        entries.push({ name: name, method: method, compSize: compSize, localOffset: localOffset })
        p += 46 + nameLen + extraLen + commentLen
      }
      var jobs = []
      for (var j = 0; j < entries.length; j++) {
        var en = entries[j]
        var enName = en.name
        var enMethod = en.method
        if (!enName || enName.endsWith('/')) continue
        var lp = en.localOffset
        if (lp + 30 > len || dv.getUint32(lp, true) !== 0x04034b50) continue
        var lNameLen = dv.getUint16(lp + 26, true)
        var lExtraLen = dv.getUint16(lp + 28, true)
        var dataStart = lp + 30 + lNameLen + lExtraLen
        if (dataStart + en.compSize > len) continue
        var comp = u8.subarray(dataStart, dataStart + en.compSize)
        // IMPORTANT: capture this entry's identity in a FRESH block-scoped
        // binding before starting the async inflate. `var` is function-scoped,
        // so a `.then` callback that reads a shared `var` later (after the loop
        // advances) sees the LAST entry's name instead of this one's, silently
        // overwriting every compressed file into a single wrong destination.
        let thisName = enName
        const thisBytes = enMethod === 0 ? comp : null
        if (enMethod === 0) jobs.push(Promise.resolve({ name: thisName, bytes: thisBytes }))
        else if (enMethod === 8) jobs.push(inflateRaw(comp).then(function (raw) { return { name: thisName, bytes: raw } }))
      }
      return Promise.all(jobs)
    }

    var JUNK = /(^|[\\/])(\.ds_store|thumbs\.db|desktop\.ini|\.dshkeep|\.gitignore|__macosx)([\\/]|$)/i
    function isJunkPath(p) { return JUNK.test(p) || /(^|[\\/])\.[^\\/]+([\\/]|$)/.test(p) }
    function decodeText(bytes) {
      try { return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } } catch (e) {}
      try { return { ok: true, text: new TextDecoder('gbk').decode(bytes) } } catch (e) {}
      return { ok: false, text: '' }
    }

    // ---- settings page ----
    function SkillManagerPage() {
      var cfg = useRpc('get-config')
      var tabPair = useState('import')
      var tab = tabPair[0]
      var setTab = tabPair[1]
      var tabs = [['import', '技能导入'], ['groups', '分组管理']]
      return createElement('div', { className: 'skmg-section' },
        createElement('div', { className: 'skmg-hbar', style: { padding: '4px 0 10px' } },
          tabs.map(function (t) { return createElement(Btn, { key: t[0], className: tab === t[0] ? 'on' : '', onClick: function () { setTab(t[0]) } }, t[1]) })
        ),
        tab === 'import' ? createElement(ImportTab, { cfg: cfg }) : createElement(GroupsTab, { cfg: cfg })
      )
    }

    function ImportTab(props) {
      var cfg = props.cfg
      var scan = useRpc('scan')
      var selectedPair = useState({})
      var selected = selectedPair[0]
      var setSelected = selectedPair[1]
      var overwritePair = useState(false)
      var overwrite = overwritePair[0]
      var setOverwrite = overwritePair[1]
      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var reportPair = useState(null)
      var report = reportPair[0]
      var setReport = reportPair[1]
      var uploadingPair = useState(false)
      var uploading = uploadingPair[0]
      var setUploading = uploadingPair[1]
      var uploadMsgPair = useState(null)
      var uploadMsg = uploadMsgPair[0]
      var setUploadMsg = uploadMsgPair[1]
      var zipRef = useRef(null)
      var dirRef = useRef(null)
      var items = scan.data || []
      var target = (cfg.data && cfg.data.importTarget) || ''
      var selNames = items.filter(function (i) { return selected[i.name] }).map(function (i) { return i.name })
      var allSelected = items.length > 0 && selNames.length === items.length
      function toggle(name) { setSelected(function (p) { var n = Object.assign({}, p); n[name] = !n[name]; return n }) }
      function setAll(v) { var n = {}; items.forEach(function (i) { n[i.name] = v }); setSelected(n) }
      function doImport() {
        if (!selNames.length || busy) return
        setBusy(true); setReport(null)
        rpcCall('/skillmg', 'import', { names: selNames, overwrite: overwrite }).then(function (r) { setReport(r); setBusy(false); scan.reload(); cfg.reload() })
          .catch(function (e) { setReport([{ name: '操作失败', ok: false, reason: String((e && e.message) || e) }]); setBusy(false) })
      }
      function doUpload(files, isZip) {
        if (uploading) return
        setUploading(true); setUploadMsg(null)
        var payloads = []
        var finish = function (msg) { setUploadMsg(msg); setUploading(false) }
        var send = function () {
          var total = 0
          for (var k = 0; k < payloads.length; k++) total += payloads[k].content.length
          if (total > 16 * 1024 * 1024) { finish({ ok: false, text: '内容过大（超过 16MB），请分批上传' }); return }
          rpcCall('/skillmg', 'upload', { files: payloads, overwrite: false }).then(function (res) {
            var existing = (res && res.existing) || 0
            var rejected = (res && res.rejected) || 0
            var failed = (res && res.reports) ? res.reports.filter(function (r) { return !r.ok }).length : 0
            finish({ ok: !!(res && res.ok), text: '已写入 ' + (res ? res.count : 0) + ' 个文件' + (existing ? '，' + existing + ' 个已存在已跳过' : '') + (rejected ? '，' + rejected + ' 个被拒绝' : '') + (failed ? '，' + failed + ' 个失败' : '') })
            scan.reload(); cfg.reload()
          }).catch(function (e) { finish({ ok: false, text: '上传失败：' + String((e && e.message) || e) }) })
        }
        var collectFile = function (rel, buf) {
          if (!rel || isJunkPath(rel)) return Promise.resolve()
          if (buf.byteLength > 2 * 1024 * 1024) return Promise.resolve()
          var d = decodeText(new Uint8Array(buf))
          if (d.ok) payloads.push({ path: rel, content: d.text })
          return Promise.resolve()
        }
        var jobs = []
        if (isZip) {
          jobs.push(files[0].arrayBuffer().then(function (buf) {
            return parseZip(buf).then(function (entries) {
              var inner = []
              for (var i = 0; i < entries.length; i++) inner.push(collectFile(entries[i].name, entries[i].bytes))
              return Promise.all(inner)
            })
          }).catch(function (e) { throw e }))
        } else {
          for (var i = 0; i < files.length; i++) {
            (function (f) { jobs.push(f.arrayBuffer().then(function (buf) { return collectFile(f.webkitRelativePath, buf) })) })(files[i])
          }
        }
        Promise.all(jobs).then(function () {
          if (!payloads.length) { finish({ ok: false, text: '没有可导入的文本文件（隐藏/系统文件已自动跳过）' }); return }
          send()
        }).catch(function (e) { finish({ ok: false, text: '上传失败：' + String((e && e.message) || e) }) })
      }
      function onZipChange(e) { var file = e.target.files && e.target.files[0]; e.target.value = ''; if (file) doUpload([file], true) }
      function onDirChange(e) { var files = Array.prototype.slice.call((e.target.files) || []); e.target.value = ''; if (files.length) doUpload(files, false) }
      var okCount = (report || []).filter(function (r) { return r.ok }).length
      return createElement('div', { className: 'skmg-box' },
        createElement('div', { className: 'skmg-heading' }, '扫描与导入'),
        createElement('div', { className: 'skmg-row' },
          createElement('span', { className: 'skmg-rowText' },
            createElement('span', { className: 'skmg-title' }, '导入目标'),
            createElement('span', { className: 'skmg-desc' }, '从来源目录导入到此文件夹，之后即可用分组启停控制模型目录')
          ),
          createElement('span', { className: 'skmg-path' }, target)
        ),
        createElement('div', { className: 'skmg-hbar' },
          createElement(Btn, { onClick: function () { if (zipRef.current) zipRef.current.click() }, disabled: uploading }, '上传压缩包'),
          createElement(Btn, { onClick: function () { if (dirRef.current) dirRef.current.click() }, disabled: uploading }, '上传文件夹'),
          createElement('input', { ref: zipRef, type: 'file', accept: '.zip,application/zip', style: { display: 'none' }, onChange: onZipChange }),
          createElement('input', { ref: dirRef, type: 'file', webkitdirectory: '', multiple: '', style: { display: 'none' }, onChange: onDirChange }),
          createElement('span', { className: 'skmg-count' }, '上传后写入导入目标；同名已存在文件会自动跳过'),
          uploading ? createElement('span', { className: 'skmg-count' }, '上传中…') : null,
          uploadMsg ? createElement('span', { className: uploadMsg.ok ? 'skmg-ok' : 'skmg-error', style: { padding: 0 } }, uploadMsg.text) : null
        ),
        createElement('div', { className: 'skmg-hbar' },
          createElement(Btn, { onClick: function () { setAll(!allSelected) } }, allSelected ? '取消全选' : '全选'),
          createElement(Btn, { onClick: function () { setAll(false) } }, '清空'),
          createElement('label', { className: 'skmg-footToggle' },
            createElement('input', { type: 'checkbox', className: 'skmg-toggle', checked: overwrite, onChange: function (e) { setOverwrite(e.target.checked) } }),
            '覆盖已导入'
          ),
          createElement('span', { className: 'skmg-count' }, '共 ' + items.length + ' 个技能')
        ),
        !scan.data ? createElement('div', { className: 'skmg-note' }, '正在加载技能列表…') :
        createElement('div', { className: 'skmg-grid' },
          items.map(function (it) { return createElement(Card, {
            key: it.name,
            title: it.name,
            desc: it.description || '（无描述）',
            selected: !!selected[it.name],
            onClick: function () { toggle(it.name) },
            tag: it.imported ? '已导入' : '未导入',
            tagCls: it.imported ? 'ok' : '',
          }) })
        ),
        createElement('div', { className: 'skmg-hbar', style: { padding: '4px 0' } },
          createElement(Btn, { className: 'primary', disabled: busy || !selNames.length, onClick: doImport }, busy ? '导入中…' : '导入所选（' + selNames.length + '）')
        ),
        report ? createElement('div', {},
          createElement('div', { className: okCount === report.length ? 'skmg-ok' : 'skmg-error' }, '导入结果：成功 ' + okCount + ' / ' + report.length),
          report.filter(function (r) { return !r.ok }).map(function (r) { return createElement('div', { key: r.name + (r.reason || ''), className: 'skmg-error' }, '· ' + r.name + '：' + (r.reason || '失败')) })
        ) : null
      )
    }

    function GroupsTab(props) {
      var cfg = props.cfg
      var newNamePair = useState('')
      var newName = newNamePair[0]
      var setNewName = newNamePair[1]
      var openIdPair = useState(null)
      var openId = openIdPair[0]
      var setOpenId = openIdPair[1]
      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var groups = (cfg.data && cfg.data.groups) || []
      var defaultGroup = (cfg.data && cfg.data.defaultGroup) || ''
      var reloadCfg = cfg.reload
      function add() {
        var raw = (newName || '').trim()
        if (!raw) return
        var id = raw.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || 'group-' + Date.now()
        rpcCall('/skillmg', 'create-group', { id: id, name: raw }).then(function () { setNewName(''); reloadCfg() })
      }
      function del(id) { rpcCall('/skillmg', 'delete-group', { id: id }).then(function () { if (openId === id) setOpenId(null); reloadCfg() }) }
      function setDefault(v) {
        if (busy) return
        setBusy(true)
        rpcCall('/skillmg', 'set-default-group', { groupId: v }).then(function () { reloadCfg() }).catch(function () {}).then(function () { setBusy(false) })
      }
      return createElement('div', { className: 'skmg-box' },
        createElement('div', { className: 'skmg-heading' }, '默认分组'),
        createElement('div', { className: 'skmg-note' }, '设为默认后，组内启用的技能即成为所有会话的模型目录；「全部启用」恢复全部技能，「全部禁用」清空目录。'),
        createElement('div', { className: 'skmg-grid' },
          createElement(Card, { title: '全部启用', desc: busy ? '正在处理…' : '不使用任何分组过滤', selected: !defaultGroup && !busy, onClick: busy ? undefined : function () { setDefault('') } }),
          createElement(Card, { title: '全部禁用', desc: busy ? '正在处理…' : '清空所有会话的模型技能目录', selected: defaultGroup === ALL_OFF && !busy, onClick: busy ? undefined : function () { setDefault(ALL_OFF) } })
        ),
        busy ? createElement('div', { className: 'skmg-note' }, '正在同步技能目录…') : null,
        createElement('div', { className: 'skmg-heading' }, '分组列表'),
        createElement('div', { className: 'skmg-hbar' },
          createElement('input', { className: 'skmg-input', placeholder: '新分组名称（如：嵌入式开发）', value: newName, onChange: function (e) { setNewName(e.target.value) }, onKeyDown: function (e) { if (e.key === 'Enter') add() } }),
          createElement(Btn, { className: 'primary', onClick: add, disabled: !(newName || '').trim() }, '新建分组')
        ),
        groups.length === 0 ? createElement('div', { className: 'skmg-note' }, '还没有分组，先在上方新建一个。') :
        groups.map(function (g) {
          var total = (g.skills || []).length
          var enabled = (g.skills || []).filter(function (s) { return s.enabled !== false }).length
          var open = openId === g.id
          var onDefault = defaultGroup === g.id
          return createElement('div', { key: g.id, className: 'skmg-groupCard' + (open ? ' open' : '') },
            createElement('div', { className: 'skmg-groupMain', role: 'button', tabIndex: 0, title: open ? '收起' : '展开编辑', onClick: function () { setOpenId(open ? null : g.id) }, onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(open ? null : g.id) } } },
              createElement('span', { className: 'skmg-groupName' }, g.name),
              onDefault ? createElement(Tag, { cls: 'ok' }, '默认') : null,
              createElement('span', { className: 'skmg-groupActions' },
                onDefault ? null : createElement('button', { type: 'button', className: 'skmg-groupSetDefault', title: '设为默认分组', disabled: busy, onClick: function (e) { e.stopPropagation(); setDefault(g.id) } }, busy ? '处理中…' : '设为默认'),
                createElement('button', { type: 'button', className: 'skmg-groupDel', title: '删除分组', 'aria-label': '删除分组 ' + g.name, disabled: busy, onClick: function (e) { e.stopPropagation(); del(g.id) } }, '✕')
              ),
              createElement('span', { className: 'skmg-count' }, total + ' 技能 / ' + enabled + ' 启用'),
              createElement('span', { className: 'skmg-groupChevron' + (open ? ' open' : ''), 'aria-hidden': true }, '▾')
            ),
            open ? createElement(GroupEditor, { group: g, reloadCfg: reloadCfg }) : null
          )
        })
      )
    }

    function GroupEditor(props) {
      var group = props.group
      var reloadCfg = props.reloadCfg
      var scan = useRpc('scan')
      var items = scan.data || []
      function inGroup(name) { return (group.skills || []).some(function (s) { return s.name === name }) }
      function enabledOf(name) { var s = (group.skills || []).find(function (x) { return x.name === name }); return s ? s.enabled !== false : false }
      function updateSkills(skills) { rpcCall('/skillmg', 'update-group', { id: group.id, skills: skills }).then(function () { reloadCfg() }) }
      function toggleIn(name, val) {
        var skills = (group.skills || []).map(function (s) { return Object.assign({}, s) })
        var idx = skills.findIndex(function (s) { return s.name === name })
        if (val && idx < 0) skills.push({ name: name, enabled: true })
        if (!val && idx >= 0) skills.splice(idx, 1)
        updateSkills(skills)
      }
      function toggleEnabled(name) {
        var skills = (group.skills || []).map(function (s) { return s.name === name ? Object.assign({}, s, { enabled: !(s.enabled !== false) }) : Object.assign({}, s) })
        updateSkills(skills)
      }
      return createElement('div', { className: 'skmg-box', style: { padding: '4px 12px 10px' } },
        createElement('div', { className: 'skmg-note' }, '点击卡片加入 / 移出分组：亮色 = 已加入，浅色 = 未加入；已加入的技能可在卡片底部单独停用。'),
        !scan.data ? createElement('div', { className: 'skmg-note' }, '正在加载技能列表…') :
        createElement('div', { className: 'skmg-grid' },
          items.map(function (it) {
            var on = inGroup(it.name)
            var en = enabledOf(it.name)
            return createElement(Card, {
              key: it.name,
              title: it.name,
              desc: it.description || '（无描述）',
              selected: on,
              onClick: function () { toggleIn(it.name, !on) },
              tag: on && !en ? '已停用' : undefined,
              tagCls: 'warn',
            },
              on ? createElement('div', { className: 'skmg-cardFoot' },
                createElement('label', { className: 'skmg-footToggle' },
                  createElement('input', { type: 'checkbox', className: 'skmg-toggle', checked: en, onClick: function (e) { e.stopPropagation() }, onChange: function () { toggleEnabled(it.name) } }),
                  '启用'
                )
              ) : null
            )
          })
        )
      )
    }

    // ---- input-bar group picker (official Menu style, session-scoped) ----
    function InputGroupPicker(props) {
      var sessionId = props.sessionId
      var openPair = useState(false)
      var open = openPair[0]
      var setOpen = openPair[1]
      var cfgPair = useState(null)
      var cfg = cfgPair[0]
      var setCfg = cfgPair[1]
      var curPair = useState('')
      var cur = curPair[0]
      var setCur = curPair[1]
      function load() {
        rpcCall('/skillmg', 'get-config', {}).then(function (d) { setCfg(d) })
        rpcCall('/skillmg', 'get-session', {}).then(function (d) { if (d) setCur(d.activeGroup || '') })
      }
      useEffect(function () { load() }, [open])
      var groups = (cfg && cfg.groups) || []
      var defaultGroup = (cfg && cfg.defaultGroup) || ''
      var defaultLabel = defaultGroup === ALL_OFF ? '全部禁用' : (defaultGroup ? ((groups.find(function (g) { return g.id === defaultGroup }) || {}).name || defaultGroup) : '全部启用')
      var active = cur || defaultGroup
      var label = active === ALL_OFF ? '全部禁用' : (active ? ((groups.find(function (g) { return g.id === active }) || {}).name || active) : '全部启用')
      function pick(v) {
        rpcCall('/skillmg', 'set-session-group', { sessionId: String(sessionId), groupId: v }).then(function () { setCur(v); setOpen(false); load() })
      }
      return createElement('div', { style: { position: 'relative', display: 'inline-flex' } },
        createElement('button', {
          type: 'button',
          className: 'skmg-inputTrigger',
          title: '为当前会话选择技能组',
          'aria-label': '技能组，当前：' + label,
          onClick: function () { setOpen(!open) },
        },
          createElement('span', { className: 'skmg-inputTriggerLabel' }, '技能组：' + label),
          createElement('span', { className: 'skmg-inputChevron' + (open ? ' open' : ''), 'aria-hidden': true }, '▾')
        ),
        open ? createElement('div', { className: 'skmg-menu' },
          createElement('button', { type: 'button', className: 'skmg-menuItem' + (cur === '' ? ' on' : ''), onClick: function () { pick('') } },
            createElement('span', { className: 'skmg-menuTitle' }, '跟随默认（' + defaultLabel + '）'),
            cur === '' ? createElement('span', { className: 'skmg-menuCheck' }, '✓') : null
          ),
          groups.map(function (g) { return createElement('button', { key: g.id, type: 'button', className: 'skmg-menuItem' + (cur === g.id ? ' on' : ''), onClick: function () { pick(g.id) } },
            createElement('span', { className: 'skmg-menuTitle' }, g.name),
            createElement('span', { className: 'skmg-menuDesc' }, (g.skills || []).length + ' 个技能'),
            cur === g.id ? createElement('span', { className: 'skmg-menuCheck' }, '✓') : null
          ) })
        ) : null
      )
    }

    // ---- plugin body ----
    exports.inject = ['slots']
    exports.apply = function apply(ctx) {
      var slots = ctx.slots
      var styleEl = injectCss()
      ctx.effect(function () {
        return function () { if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) }
      }, 'dsh-skill-manager: styles')

      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'skill-manager', order: 30, label: function () { return 'Skill 管理' } },
          function () { return createElement(SkillManagerPage, null) }
        )
      })

      slots.inject('conversation.input.left', function () {
        return slots.register(
          { name: 'conversation.input.left', id: 'skill-manager-input-group', order: 0 },
          function (props) { return createElement(InputGroupPicker, { sessionId: props.sessionId }) }
        )
      })
    }

    return module.exports
  },
})
