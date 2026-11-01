import { loadStore, STORAGE_KEY } from '../model.ts'
import type { Store } from '../model.ts'
import { EMPTY_WORKSPACE, isWorkspaceData, mergeWorkspaces, sameData, workspaceData } from './merge.ts'
import type { RemoteSnapshot, WorkspaceData } from './merge.ts'
import type { CloudTransport, CloudUser } from './cloud.ts'

type Phase = 'local' | 'connecting' | 'syncing' | 'synced' | 'offline' | 'error' | 'expired'
type Cache = { store: Store; base: RemoteSnapshot; lastSynced: number | null }
export type WorkspaceState = {
  store: Store; user: CloudUser | null; phase: Phase; message: string | null;
  storageError: string | null; lastSynced: number | null; pending: boolean; conflicts: number;
}
const emptyStore = (): Store => ({ entries: [], activeId: null, welcomed: true })
const emptyBase = (): RemoteSnapshot => ({ revision: 0, data: EMPTY_WORKSPACE })

export class Workspace {
  private state: WorkspaceState
  private base = emptyBase()
  private listeners = new Set<() => void>()
  private authenticated = false
  private generation = 0
  private running: Promise<void> | null = null
  private rerun = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private unreadable = false
  private diskData: WorkspaceData = EMPTY_WORKSPACE
  private readonly profileKey: string
  private readonly accountPrefix: string
  private readonly storage: Storage
  private readonly transport: CloudTransport | null
  private readonly explainError: (error: unknown) => string

  constructor(storage: Storage, transport: CloudTransport | null, scope: string, explainError: (error: unknown) => string) {
    this.storage = storage; this.transport = transport; this.explainError = explainError
    this.accountPrefix = `${STORAGE_KEY}.${scope}.account.`
    this.profileKey = `${STORAGE_KEY}.${scope}.profile`
    const local = loadStore(storage)
    this.state = { store: local.store, user: null, phase: 'local', message: null, storageError: local.error, lastSynced: null, pending: false, conflicts: 0 }
    this.unreadable = !!local.error
    try {
      const profile = transport && storage.getItem(this.profileKey)
      const user = profile ? JSON.parse(profile) as CloudUser : null
      if (user && typeof user.id === 'string' && typeof user.email === 'string') this.openAccount(user)
    } catch { /* A bad profile must not prevent access to guest records. */ }
  }

  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch }
    this.state.pending = !!this.state.user && !sameData(this.state.store, this.base.data)
    this.listeners.forEach(fn => fn())
  }
  private get cacheKey() { return this.state.user ? `${this.accountPrefix}${this.state.user.id}` : STORAGE_KEY }
  private parseCache(raw: string): Cache {
    const cache = JSON.parse(raw) as Cache
    if (!isWorkspaceData(cache.store) || !isWorkspaceData(cache.base?.data)
      || !Number.isSafeInteger(cache.base.revision) || cache.base.revision < 0) throw new Error('Invalid cache')
    return cache
  }
  private persist() {
    if (this.unreadable) return // Never overwrite data that could not be read.
    try {
      const value: Cache | Store = this.state.user
        ? { store: this.state.store, base: this.base, lastSynced: this.state.lastSynced }
        : this.state.store
      this.storage.setItem(this.cacheKey, JSON.stringify(value))
      if (this.state.user) this.storage.setItem(this.profileKey, JSON.stringify(this.state.user))
      this.diskData = workspaceData(this.state.store)
      if (this.state.storageError) this.publish({ storageError: null })
    } catch {
      this.publish({ storageError: '本地保存失败，请导出备份后检查浏览器存储空间。' })
    }
  }
  private openAccount(user: CloudUser) {
    this.generation++
    this.unreadable = false
    this.base = emptyBase()
    let store = emptyStore(), lastSynced: number | null = null, storageError: string | null = null
    try {
      const raw = this.storage.getItem(`${this.accountPrefix}${user.id}`)
      if (raw) { const cache = this.parseCache(raw); store = cache.store; this.base = cache.base; lastSynced = cache.lastSynced }
    } catch {
      this.unreadable = true
      storageError = '暂时无法读取此账号的本机副本，原有缓存已保留。请先检查浏览器存储设置。'
    }
    this.diskData = workspaceData(store)
    this.publish({ store, user, phase: 'connecting', message: null, lastSynced, storageError, conflicts: 0 })
  }

  connect(user: CloudUser) {
    if (this.state.user?.id !== user.id) {
      this.persist()
      this.openAccount(user)
    }
    this.authenticated = true
    this.persist()
    void this.sync()
  }
  sessionExpired() {
    this.authenticated = false
    this.generation++
    if (this.state.user) this.publish({ phase: 'expired', message: '登录已过期，请重新登录。未同步记录仍在此设备。' })
  }
  disconnect() {
    if (!this.state.user) return
    if (this.state.pending) throw new Error('还有记录没有同步，请先同步或导出备份。')
    // Only clear this account; the original local-only workspace remains separate.
    try {
      this.storage.removeItem(this.cacheKey)
      this.storage.removeItem(this.profileKey)
    } catch {
      this.sessionExpired()
      this.publish({ storageError: '无法清除本机账号副本，请在浏览器设置中清除此站点数据。' })
      throw new Error('已退出云端登录，但本机副本未能清除，请检查浏览器存储设置。')
    }
    this.generation++
    this.authenticated = false
    this.base = emptyBase()
    const local = loadStore(this.storage)
    this.unreadable = !!local.error
    this.publish({ store: local.store, user: null, phase: 'local', message: null, storageError: local.error, lastSynced: null, conflicts: 0 })
  }
  update = (action: Store | ((store: Store) => Store)) => {
    this.reloadFromDisk()
    const store = typeof action === 'function' ? action(this.state.store) : action
    this.publish({ store, phase: this.state.user ? (this.authenticated ? 'syncing' : 'expired') : 'local' })
    this.persist()
    this.schedule()
  }
  private schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.sync(), 600)
  }
  stop() { clearTimeout(this.timer) }
  localEntryCount() { return loadStore(this.storage).store.entries.filter(e => !e.example).length }
  importLocal() {
    if (!this.state.user) return
    const local = loadStore(this.storage)
    if (local.error) throw new Error(local.error)
    const real = workspaceData(local.store)
    const merged = mergeWorkspaces(EMPTY_WORKSPACE, real, this.state.store)
    this.update(s => ({ ...s, ...merged.data, welcomed: true }))
    if (merged.conflicts) this.publish({ conflicts: this.state.conflicts + merged.conflicts })
  }
  dismissConflicts() { this.publish({ conflicts: 0 }) }
  markOffline() {
    if (this.state.user) this.publish({ phase: 'offline', message: '当前离线，记录先保存在此设备，联网后自动同步。' })
  }

  /** Merge another tab's pending edits before writing our own cache. */
  reloadFromDisk() {
    if (!this.state.user || this.unreadable) return
    try {
      const raw = this.storage.getItem(this.cacheKey)
      if (!raw) return
      const cache = this.parseCache(raw)
      if (sameData(cache.store, this.diskData) && cache.base.revision <= this.base.revision) return
      const merged = mergeWorkspaces(this.diskData, this.state.store, cache.store)
      this.diskData = workspaceData(cache.store)
      if (cache.base.revision > this.base.revision) this.base = cache.base
      this.publish({ store: { ...this.state.store, ...merged.data }, conflicts: this.state.conflicts + merged.conflicts })
    } catch { /* Preserve in-memory edits; persist() reports a storage write failure. */ }
  }

  sync = (): Promise<void> => {
    if (!this.transport || !this.state.user || !this.authenticated) return Promise.resolve()
    if (this.running) { this.rerun = true; return this.running }
    const userId = this.state.user.id, generation = this.generation
    const current = () => generation === this.generation && userId === this.state.user?.id && this.authenticated
    this.running = (async () => {
      this.reloadFromDisk()
      this.publish({ phase: 'syncing', message: null })
      try {
        const remote = await this.transport!.read(userId, this.base.revision)
        if (!current()) return
        if (remote) this.receive(remote)
        for (let attempt = 0; attempt < 4 && !sameData(this.state.store, this.base.data); attempt++) {
          const sent = workspaceData(this.state.store)
          const result = await this.transport!.write(userId, this.base.revision, sent)
          if (!current()) return
          // Edits made while uploading stay dirty against the acknowledged snapshot.
          this.receive(result.snapshot, result.applied ? sent : this.base.data)
        }
        if (!current()) return
        if (!sameData(this.state.store, this.base.data)) {
          this.publish({ phase: 'error', message: '其他设备也在修改，稍后会继续同步。本机记录已保留。' })
        } else {
          this.publish({ phase: 'synced', lastSynced: Date.now(), message: null })
        }
        this.persist()
      } catch (error) {
        if (current()) {
          const failure = error as { status?: number; code?: string }
          if (failure?.status === 401 || failure?.code === 'PGRST301') this.sessionExpired()
          else this.publish({ phase: 'error', message: this.explainError(error) })
        }
      }
    })().finally(() => {
      this.running = null
      if (this.rerun) { this.rerun = false; this.schedule() }
    })
    return this.running
  }
  private receive(remote: RemoteSnapshot, base: WorkspaceData = this.base.data) {
    const merged = mergeWorkspaces(base, this.state.store, remote.data)
    this.base = remote
    this.publish({ store: { ...this.state.store, ...merged.data, welcomed: true }, conflicts: this.state.conflicts + merged.conflicts })
    this.persist()
  }
}
