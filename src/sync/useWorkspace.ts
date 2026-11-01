import { useEffect, useState, useSyncExternalStore } from 'react'
import { cloudScope, cloudTransport, friendlyCloudError, supabase } from './cloud'
import { Workspace } from './workspace'

export function useWorkspace() {
  const [workspace] = useState(() => new Workspace(localStorage, cloudTransport, cloudScope, friendlyCloudError))
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
  const [authBusy, setAuthBusy] = useState(false)
  useEffect(() => {
    if (!supabase) return
    // The callback does not await another auth call (which would deadlock token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) workspace.connect({ id: session.user.id, email: session.user.email ?? '' })
      else if (event === 'SIGNED_OUT' && !workspace.getSnapshot().pending) {
        try { workspace.disconnect() } catch { /* Storage failure is already shown by the workspace. */ }
      }
      else workspace.sessionExpired()
    })
    const sync = () => { if (document.visibilityState === 'visible') void workspace.sync() }
    const offline = () => workspace.markOffline()
    const storage = (event: StorageEvent) => {
      if (event.key?.includes('workspace.v1')) { workspace.reloadFromDisk(); sync() }
    }
    const interval = setInterval(sync, 30000)
    window.addEventListener('online', sync)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', sync)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', sync)
    return () => {
      subscription.unsubscribe(); clearInterval(interval); workspace.stop()
      window.removeEventListener('online', sync); window.removeEventListener('offline', offline)
      window.removeEventListener('focus', sync); window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [workspace])

  async function signIn(email: string, password: string, importLocal: boolean) {
    if (!supabase) throw new Error('此站点尚未开启云同步。')
    setAuthBusy(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw new Error(friendlyCloudError(error))
      workspace.connect({ id: data.user.id, email: data.user.email ?? '' })
      if (importLocal) workspace.importLocal()
      await workspace.sync()
    } finally { setAuthBusy(false) }
  }
  async function signOut() {
    if (!supabase) return
    setAuthBusy(true)
    try {
      await workspace.sync()
      if (workspace.getSnapshot().pending) throw new Error('还有记录没有同步，请联网同步后再退出。也可以先导出一份备份。')
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw new Error(friendlyCloudError(error))
      workspace.disconnect()
    } finally { setAuthBusy(false) }
  }
  return { ...state, workspace, setStore: workspace.update, signIn, signOut, authBusy }
}
