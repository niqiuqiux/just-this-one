import { useState } from 'react'
import { Cloud, CheckCheck, LoaderCircle, LogIn, LogOut, RefreshCw, WifiOff } from 'lucide-react'
import { cloudConfigured } from './cloud'
import type { useWorkspace } from './useWorkspace'
import type { WorkspaceState } from './workspace'

export function syncLabel(state: Pick<WorkspaceState, 'user' | 'phase' | 'pending'>) {
  if (!state.user) return cloudConfigured ? '登录后跨端同步' : '已保存在此设备'
  if (state.phase === 'connecting') return '正在连接云端'
  if (state.phase === 'syncing') return state.pending ? '正在同步记录' : '正在检查同步'
  if (state.phase === 'expired') return '登录已过期'
  if (state.phase === 'synced' && !state.pending) return '已同步到云端'
  return state.pending ? '本机有待同步记录' : '暂时无法连接云端'
}

export function SyncPanel({ sync }: { sync: ReturnType<typeof useWorkspace> }) {
  const [email, setEmail] = useState(sync.user?.email ?? '')
  const [password, setPassword] = useState('')
  const [importLocal, setImportLocal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const localCount = sync.workspace.localEntryCount()
  const needsLogin = !sync.user || sync.phase === 'expired'
  const busy = sync.phase === 'syncing' || sync.phase === 'connecting'
  const StatusIcon = busy ? LoaderCircle : sync.phase === 'synced' ? CheckCheck : sync.phase === 'offline' ? WifiOff : Cloud

  return <section className="sync-panel" aria-label="账号与云同步">
    <div className="sync-heading"><span className="sync-icon"><Cloud size={20} /></span><div><h3>想法，跟你去每一端</h3><p>手机记一笔，回到电脑接着做。</p></div></div>
    {!cloudConfigured ? <p className="sync-description">此站点尚未开启云同步。现在的记录保存在此设备，也可以随时导出备份。</p>
      : needsLogin ? <form className="sync-form" onSubmit={async e => {
        e.preventDefault(); setError(null)
        try { await sync.signIn(email, password, importLocal); setPassword(''); setImportLocal(false) }
        catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试。') }
      }}>
        <p className="sync-description">在不同设备登录同一个账号，就能接着记录和完成任务。账号由站点所有者创建。</p>
        {sync.phase === 'expired' && <p className="sync-message" role="status">{sync.message}</p>}
        <label htmlFor="sync-email">邮箱</label><input id="sync-email" type="email" autoComplete="username" placeholder="你的账号邮箱" required value={email} onChange={e => setEmail(e.target.value)} disabled={sync.authBusy} />
        <label htmlFor="sync-password">密码</label><input id="sync-password" type="password" autoComplete="current-password" placeholder="输入密码" required value={password} onChange={e => setPassword(e.target.value)} disabled={sync.authBusy} />
        {!sync.user && localCount > 0 && <label className="sync-import"><input type="checkbox" checked={importLocal} onChange={e => setImportLocal(e.target.checked)} disabled={sync.authBusy} /><span>将此设备的 {localCount} 条记录合并到账号<small>示例不会上传，本机原记录也会保留。</small></span></label>}
        {error && <p className="sync-error" role="alert">{error}</p>}
        <button type="submit" className="button primary full-width" disabled={sync.authBusy}>{sync.authBusy ? <LoaderCircle size={16} className="spin" /> : <LogIn size={16} />}{sync.authBusy ? '正在登录…' : '登录并开启同步'}</button>
      </form> : <div className="sync-account">
        <span className="sync-email" title={sync.user?.email}>{sync.user?.email}</span>
        <div className={`sync-state ${sync.phase === 'synced' ? 'is-synced' : ''}`} role="status"><StatusIcon size={16} className={busy ? 'spin' : ''} /><span>{syncLabel(sync)}</span></div>
        {sync.message && <p className="sync-message">{sync.message}</p>}
        {sync.lastSynced && <p className="sync-timestamp">上次同步：{new Date(sync.lastSynced).toLocaleString('zh-CN')}</p>}
        <p className="sync-description">更改会自动同步，打开页面时也会检查更新。断网时可在当前页面继续记录，联网后补传。</p>
        <div className="sync-actions"><button className="button secondary" disabled={busy || sync.authBusy} onClick={() => void sync.workspace.sync()}><RefreshCw size={15} />立即同步</button><button className="text-button" disabled={sync.authBusy || busy || sync.pending} onClick={async () => {
          setError(null)
          try { await sync.signOut() } catch (cause) { setError(cause instanceof Error ? cause.message : '退出失败，请重试。') }
        }}><LogOut size={15} />退出登录</button></div>
        <p className="sync-footnote">{sync.pending ? '同步完成后可退出，避免遗失尚未上传的记录。' : '退出后会清除此账号在本机的记录副本，云端记录仍保留。'}</p>
        {error && <p className="sync-error" role="alert">{error}</p>}
      </div>}
  </section>
}
