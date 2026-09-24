// ---------------------------------------------------------------------------
// Per-session skill visibility engine ("scope engine") for DSH >= 0.1.7
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS
// ---------------
// DSH's skill registry is layered per scope: a read merges the GLOBAL layer with
// the viewing scope's chain, the NEAREST layer wins a duplicate name outright,
// and rank only decides duplicates inside one layer. A session ("agent") is a
// scope key whose parent is its preset's generation, so the agent's own layer is
// the nearest one — above whatever the session's preset contributes.
//
// The plugin itself is mounted in the host composition, so its own scope is the
// global layer, which can NEVER shadow a preset-layer skill (verified live: a
// global registration left the skill visible, an agent-scoped one hid it).
//
// Therefore: to control what ONE session sees, register into THAT session's
// layer through its own context (`agent.ctx.get('skills')`), obtained from the
// `agent/created` event. Hiding a skill is the official mechanism: register a
// same-named entry with `invocation.modelInvocable = false`. Nothing on disk is
// touched, and two sessions can hold different sets at the same time.
//
// Everything here is best-effort: any failure degrades to "no shadowing" and the
// caller falls back to the legacy on-disk rename engine.

/** Verdict values for {@link createScopeEngine}. */
export const SCOPE_UNKNOWN = null

/**
 * Compute the set of skill names that must stay visible for one group.
 *
 * Policy: the *scan result* is the managed universe (the configured source dirs),
 * and the group is an allow-list over it — exactly the semantics the legacy
 * rename engine had, minus the disk writes. Skills discovered from roots this
 * plugin does not scan (project-local `.dsh/skills`, bundled packages) are not in
 * the universe and are therefore left alone.
 *
 * @param state - plugin state ({groups, defaultGroup, perSessionGroups}).
 * @param managedNames - names discovered by the plugin's own scan.
 * @param groupId - effective group id, `__all_off__`, or null/'' for all enabled.
 * @param allOffSentinel - the reserved all-disabled group id.
 * @returns visible names.
 */
export function computeVisibleNames(state, managedNames, groupId, allOffSentinel) {
  const all = new Set(managedNames)
  if (groupId === allOffSentinel) return new Set()
  if (groupId === null || groupId === undefined || groupId === '') return all
  const group = (state.groups || []).find((g) => g && g.id === groupId)
  // An unknown group id hides nothing: a stale/typo'd id must not blank a session.
  if (!group) return all
  const visible = new Set()
  for (const entry of group.skills || []) {
    if (entry && typeof entry.name === 'string' && entry.enabled !== false) visible.add(entry.name)
  }
  return visible
}

/**
 * Resolve the effective group for one session.
 *
 * A session's own pick wins; otherwise the configured default. `null`/'' means
 * "all enabled" and `__all_off__` means "none" — the same vocabulary the client
 * picker already uses.
 *
 * @param state - plugin state.
 * @param sessionId - the session id.
 * @returns the effective group id (string) or null for all-enabled.
 */
export function resolveSessionGroupId(state, sessionId) {
  const perSession = state.perSessionGroups || {}
  const own = Object.prototype.hasOwnProperty.call(perSession, sessionId) ? perSession[sessionId] : undefined
  if (own === undefined) return state.defaultGroup ?? null
  if (own === null || own === '') return null
  return own
}

/**
 * Plan the registration changes for one session.
 *
 * @param managedNames - names the plugin manages.
 * @param visibleNames - names that must stay visible.
 * @param shadowedNames - names currently shadowed for this session.
 * @returns `{ toHide, toShow }` name lists.
 */
export function planSync(managedNames, visibleNames, shadowedNames) {
  const managed = new Set(managedNames)
  const visible = new Set(visibleNames)
  const shadowed = new Set(shadowedNames)
  const toHide = []
  for (const name of managed) if (!visible.has(name) && !shadowed.has(name)) toHide.push(name)
  const toShow = []
  for (const name of shadowed) if (!managed.has(name) || visible.has(name)) toShow.push(name)
  return { toHide, toShow }
}

/** Placeholder body for a hidden skill: never loaded by the model, cheap in RAM. */
export function shadowBody(name) {
  return [
    `# ${name}（当前分组已停用）`,
    '',
    '这个技能已被 DSH Skill Manager 的当前技能分组排除，因此对模型不可见。',
    '需要时在分组管理里把它加入当前分组，或切换分组。',
    '',
  ].join('\n')
}

/**
 * Create the per-session visibility engine.
 *
 * @param options.ctx - the plugin's host-plane context.
 * @param options.getState - reads the live plugin state.
 * @param options.getRevision - reads the plugin's config revision counter.
 * @param options.scanManagedSkills - async scan returning `[{name}]` for managed roots.
 * @param options.log - info logger.
 * @param options.warn - warning logger.
 * @returns engine handle.
 */
export function createScopeEngine(options) {
  const { ctx, getState, getRevision, scanManagedSkills, log, warn } = options
  const skills = ctx.get('skills')
  const sessions = new Map()
  const disposers = []
  const scopeCache = { revision: -1, names: null, pending: null }
  let available = SCOPE_UNKNOWN
  let started = false
  let lastReason = 'startup'
  let lastSyncMs = null

  /**
   * The registry must expose the runtime registration API to be usable at all.
   * Property access on a service the calling context does not inject THROWS
   * (Cordis: "cannot get property \"register\" without inject"), so this must never
   * be allowed to escape: on 0.1.7 the plugin died here during apply() — before its
   * tools were registered — because `skills` was missing from `inject`.
   */
  function registrySupportsScopes() {
    try {
      return !!skills && typeof skills.register === 'function' && typeof skills.snapshot === 'function'
    } catch (e) {
      return false
    }
  }

  /** Managed names, cached per config revision (one scan per revision, not per step). */
  async function managedNames() {
    const revision = getRevision()
    if (scopeCache.names && scopeCache.revision === revision) return scopeCache.names
    if (!scopeCache.pending) {
      scopeCache.pending = (async () => {
        const scanned = await scanManagedSkills()
        const names = [...new Set((scanned || []).map((s) => s && s.name).filter((n) => typeof n === 'string' && n))]
        scopeCache.names = names
        scopeCache.revision = revision
        scopeCache.pending = null
        return names
      })().catch((e) => { scopeCache.pending = null; throw e })
    }
    return scopeCache.pending
  }

  function invalidateScan() { scopeCache.names = null; scopeCache.revision = -1 }

  /** A context whose registrations land in THIS agent's layer, or undefined. */
  function agentScopedSkills(agent) {
    try {
      const scoped = agent && agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('skills') : undefined
      return scoped && typeof scoped.register === 'function' ? scoped : undefined
    } catch (e) {
      return undefined
    }
  }

  /**
   * Prove the mechanism on a real agent before trusting it: register an invisible
   * probe entry, read the session's own view, then remove it again.
   */
  async function probe(agent, scoped) {
    const name = 'zz-scope-probe-' + Math.random().toString(36).slice(2, 10)
    let dispose
    try {
      dispose = scoped.register({
        name,
        description: 'scope engine capability probe',
        content: '# probe\n',
        source: 'runtime',
        invocation: { modelInvocable: false, userInvocable: false },
      })
      const snapshot = await skills.snapshot({ scope: agent })
      const seen = !!(snapshot && Array.isArray(snapshot.skills) && snapshot.skills.some((s) => s && s.name === name))
      return seen
    } catch (e) {
      return false
    } finally {
      try { if (dispose) dispose() } catch (e) { /* best effort */ }
    }
  }

  /** Capture the official definition so a shadow preserves description/path/resources. */
  async function capture(record, name) {
    if (record.definitions.has(name)) return record.definitions.get(name)
    const def = await skills.get(name, { scope: record.agent, cwd: record.cwd })
    if (!def) return undefined
    record.definitions.set(name, def)
    return def
  }

  async function syncSession(record, reason) {
    if (available !== true) return 'unavailable'
    const state = getState()
    const managed = await managedNames()
    const groupId = resolveSessionGroupId(state, record.agent.id)
    const revision = getRevision()
    const managedKey = managed.length
    if (record.appliedGroupId === groupId && record.appliedRevision === revision && record.appliedManaged === managedKey) {
      return 'skipped'
    }
    const visible = computeVisibleNames(state, managed, groupId, '__all_off__')
    const { toHide, toShow } = planSync(managed, visible, [...record.shadows.keys()])
    const syncStarted = Date.now()

    for (const name of toShow) {
      const dispose = record.shadows.get(name)
      record.shadows.delete(name)
      try { if (dispose) dispose() } catch (e) { /* best effort */ }
    }

    let hidden = 0
    // Phase 1 — capture EVERY definition before touching the registry. A read
    // reuses the registry's cached collection, while every registration
    // invalidates that cache, so interleaving capture and register makes the whole
    // sync quadratic. Measured live with 69 shadows: 18.2s interleaved; split into
    // two phases it is a fraction of that — and this runs inside `agent/created`,
    // which delays session start.
    const captured = new Map()
    const notLoadable = []
    for (const name of toHide) {
      let def
      try { def = await capture(record, name) } catch (e) { def = undefined }
      if (def) captured.set(name, def)
      else notLoadable.push(name)
    }

    // Phase 2 — register with no interleaved read.
    for (const [name, def] of captured) {
      try {
        const dispose = record.skillsApi.register({
          ...def,
          invocation: { modelInvocable: false, userInvocable: false },
          content: shadowBody(name),
        })
        record.shadows.set(name, dispose)
        hidden += 1
      } catch (e) {
        warn('scope: register shadow for "' + name + '" failed: ' + String((e && e.message) || e))
      }
    }

    // A name no provider can load is not discoverable in the first place, so it
    // needs no shadow: only report one that is genuinely still visible.
    if (notLoadable.length) {
      try {
        const snap = await skills.snapshot({ scope: record.agent, cwd: record.cwd })
        const visibleNow = new Set((snap.skills || [])
          .filter((s) => s && s.invocation && s.invocation.modelInvocable)
          .map((s) => s.name))
        const stuck = notLoadable.filter((name) => visibleNow.has(name))
        if (stuck.length) warn('scope: visible but not shadowable: ' + stuck.join(', '))
      } catch (e) { /* diagnostics only */ }
    }

    record.appliedGroupId = groupId
    record.appliedRevision = revision
    record.appliedManaged = managedKey
    lastSyncMs = Date.now() - syncStarted
    if (toHide.length || toShow.length) {
      lastReason = reason
      log('scope: session ' + record.agent.id + ' group=' + String(groupId) +
        ' visible=' + visible.size + '/' + managed.length + ' hid+' + hidden + ' show-' + toShow.length +
        ' in ' + lastSyncMs + 'ms (' + reason + ')')
    }
    return 'synced'
  }

  async function attach(agent, reason) {
    if (!agent || !agent.id) return
    if (sessions.has(agent.id)) return
    if (!registrySupportsScopes()) {
      if (available !== false) { available = false; warn('scope: registry has no runtime registration API; using the rename engine') }
      return
    }
    const scoped = agentScopedSkills(agent)
    if (!scoped) {
      if (available !== false) { available = false; warn('scope: no agent-scoped skills service; using the rename engine') }
      return
    }
    if (available === SCOPE_UNKNOWN) {
      let ok = false
      try { ok = await probe(agent, scoped) } catch (e) { ok = false }
      available = ok
      if (ok) log('scope: per-session engine verified on agent ' + agent.id + ' (in-memory, no disk writes)')
      else warn('scope: capability probe failed; falling back to the rename engine')
      if (!ok) return
    }
    if (available !== true) return
    const record = {
      agent,
      skillsApi: scoped,
      cwd: (agent.session && agent.session.header && agent.session.header.cwd) || undefined,
      appliedGroupId: undefined,
      appliedRevision: -1,
      appliedManaged: -1,
      shadows: new Map(),
      definitions: new Map(),
    }
    sessions.set(agent.id, record)
    const started = Date.now()
    try {
      await syncSession(record, reason)
      lastSyncMs = Date.now() - started
    } catch (e) {
      warn('scope: initial sync failed: ' + String((e && e.message) || e))
    }
  }

  return {
    /** `true`/`false` once proven, `null` while unknown. */
    get available() { return available },
    /** Optimistic verdict before any agent exists (0.1.7+ shaped registry). */
    optimistic() { return registrySupportsScopes() },
    info() {
      const records = [...sessions.values()]
      return {
        available,
        sessions: records.length,
        shadowed: records.reduce((n, r) => n + r.shadows.size, 0),
        lastReason,
        lastSyncMs,
        probed: Object.keys(sessions).length > 0 || available !== SCOPE_UNKNOWN,
      }
    },
    /** Count the skills a group hides, without touching the registry (for display). */
    hiddenCountFor(groupId) {
      const state = getState()
      const names = scopeCache.names
      if (!names) return null
      const visible = computeVisibleNames(state, names, groupId, '__all_off__')
      let hidden = 0
      for (const name of names) if (!visible.has(name)) hidden += 1
      return hidden
    },
    /** Force every live session to re-evaluate (after a config change). */
    markAllDirty() { for (const record of sessions.values()) record.appliedRevision = -1 },
    /** Drop the scan cache (after files changed on disk). */
    invalidateScan,
    /** Subscribe to the agent lifecycle. Safe to call once. */
    start() {
      if (started) return
      started = true
      disposers.push(ctx.on('agent/created', async ({ agent }) => { await attach(agent, 'agent/created') }))
      // Also adopt agents that existed before this plugin loaded: their
      // `agent/created` has already fired, so the first step is the earliest hook.
      disposers.push(ctx.on('agent/pre-step', async ({ agent }, next) => {
        try {
          if (agent && !sessions.has(agent.id)) await attach(agent, 'agent/pre-step')
          const record = sessions.get(agent && agent.id)
          if (record) await syncSession(record, 'agent/pre-step')
        } catch (e) {
          warn('scope: pre-step sync failed: ' + String((e && e.message) || e))
        }
        return next()
      }))
      disposers.push(ctx.on('dispose', () => {
        for (const record of sessions.values()) {
          for (const dispose of record.shadows.values()) { try { dispose() } catch (e) { /* best effort */ } }
          record.shadows.clear()
        }
        sessions.clear()
        for (const dispose of disposers) { try { dispose() } catch (e) { /* best effort */ } }
        disposers.length = 0
      }))
    },
  }
}
