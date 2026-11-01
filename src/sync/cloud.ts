import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isWorkspaceData } from './merge.ts'
import type { RemoteSnapshot, WorkspaceData } from './merge.ts'

export type CloudUser = { id: string; email: string }
export interface CloudTransport {
  read(userId: string, afterRevision: number): Promise<RemoteSnapshot | null>
  write(userId: string, revision: number, data: WorkspaceData): Promise<{ applied: boolean; snapshot: RemoteSnapshot }>
}

function configuredUrl() {
  try {
    const url = new URL(import.meta.env.VITE_SUPABASE_URL?.trim() ?? '')
    if (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin
  } catch { /* An incomplete deployment stays usable in local mode. */ }
  return undefined
}
const url = configuredUrl()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
export const cloudConfigured = !!url && !!key
export const cloudScope = url ? new URL(url).host : 'local'
const apiUrl = import.meta.env.VITE_SUPABASE_PROXY === 'true' ? `${window.location.origin}/api/supabase` : url
export const supabase: SupabaseClient | null = cloudConfigured ? createClient(apiUrl!, key!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: `just-this-one.auth.${cloudScope}` },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) }) },
}) : null

function snapshot(value: unknown): RemoteSnapshot {
  const row = value as RemoteSnapshot
  if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0 || !isWorkspaceData(row.data)) {
    throw new Error('云端记录格式不正确，已保留本机记录。')
  }
  return row
}

export const cloudTransport: CloudTransport | null = supabase ? {
  async read(userId, afterRevision) {
    const { data, error } = await supabase!.from('workspaces').select('revision, data')
      .eq('user_id', userId).gt('revision', afterRevision).maybeSingle()
    if (error) throw error
    return data ? snapshot(data) : null
  },
  async write(userId, revision, data) {
    const { data: result, error } = await supabase!.rpc('save_workspace', { expected_revision: revision, workspace: data, expected_user_id: userId })
    if (error) throw error
    if (typeof result?.applied !== 'boolean') throw new Error('云端返回异常，已保留本机记录。')
    return { applied: result.applied, snapshot: snapshot(result.snapshot) }
  },
} : null

export function friendlyCloudError(error: unknown): string {
  const e = error as { message?: string; code?: string; status?: number }
  if (e?.status === 429 || /rate.limit/i.test(e?.message ?? '')) return '请求有点频繁，请稍后再试。'
  if (e?.code === 'invalid_credentials') return '邮箱或密码不正确，请检查后重试。'
  if (e?.code === 'email_not_confirmed') return '邮箱尚未确认，请先完成邮箱验证。'
  if (e?.code === 'PGRST202' || e?.code === '42P01') return '云同步尚未配置完成，请联系站点维护者。'
  if (e?.status === 401 || e?.code === 'PGRST301' || /jwt.*expired|refresh.token/i.test(e?.message ?? '')) return '登录已过期，请重新登录。未同步记录仍在此设备。'
  if (e?.code === '22023') return '记录超出云端容量或格式限制，请先导出备份，再整理记录。'
  return '暂时连接不上云端，记录仍在此设备。网络恢复后会自动重试。'
}
