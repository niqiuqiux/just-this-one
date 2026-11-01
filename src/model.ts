export const CATEGORIES = ['灵感', '工作', '生活', '学习'] as const
export type Category = typeof CATEGORIES[number]
export type Page = 'notes' | 'draw' | 'done'
export type Entry = {
  id: string
  title: string
  body: string
  category: Category
  minutes: number
  isTask: boolean
  done: boolean
  createdAt: number
  completedAt?: number
  example?: boolean
}
export type Store = { entries: Entry[]; activeId: string | null; welcomed: boolean }
// Keeps the project's original working name so data already saved in browsers still loads.
export const STORAGE_KEY = 'yaoyaole.workspace.v1'

export function exampleStore(): Store {
  const now = Date.now()
  return {
    activeId: null,
    welcomed: false,
    entries: [
      { id: 'example-1', title: '做一个属于自己的灵感角落', body: '把突然冒出来的想法留住。不用很完整，一句话也很好。', category: '灵感', minutes: 15, isTask: false, done: false, createdAt: now - 600000, example: true },
      { id: 'example-2', title: '出门走走，给大脑放个风', body: '不带目的地，看看街角的树。顺便买一杯喜欢的咖啡。', category: '生活', minutes: 15, isTask: true, done: false, createdAt: now - 1800000, example: true },
      { id: 'example-3', title: '读完一直想看的那一章', body: '不追求进度。安静读上几页，记下一句喜欢的话。', category: '学习', minutes: 30, isTask: true, done: false, createdAt: now - 3600000, example: true },
      { id: 'example-4', title: '把桌面收拾得清爽一点', body: '从眼前这一小块开始。把不用的东西归位，留点空白。', category: '生活', minutes: 5, isTask: true, done: false, createdAt: now - 7200000, example: true },
      { id: 'example-5', title: '如果想法也有一个收件箱', body: '先收集，再整理。也许可以每周随机翻出一个旧灵感，让它重新发芽。', category: '灵感', minutes: 15, isTask: false, done: false, createdAt: now - 10800000, example: true },
      { id: 'example-6', title: '给明天留一张小清单', body: '只写最想完成的三件事。剩下的，交给明天的自己。', category: '工作', minutes: 5, isTask: true, done: false, createdAt: now - 14400000, example: true },
    ],
  }
}

export function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 200
    && typeof e.title === 'string' && e.title.trim().length > 0 && e.title.length <= 120
    && typeof e.body === 'string' && e.body.length <= 5000
    && CATEGORIES.includes(e.category as Category) && typeof e.minutes === 'number' && Number.isFinite(e.minutes) && e.minutes > 0 && e.minutes <= 1440
    && typeof e.isTask === 'boolean' && typeof e.done === 'boolean'
    && typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) && e.createdAt >= 0 && e.createdAt <= 8640000000000000
    && (e.completedAt === undefined || typeof e.completedAt === 'number' && Number.isFinite(e.completedAt) && e.completedAt >= 0 && e.completedAt <= 8640000000000000)
    && (e.example === undefined || typeof e.example === 'boolean')
}

export function loadStore(storage: Pick<Storage, 'getItem'> = localStorage): { store: Store; error: string | null } {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return { store: exampleStore(), error: null }
    const parsed = JSON.parse(raw) as Store
    if (!parsed || !Array.isArray(parsed.entries) || !parsed.entries.every(isEntry) || new Set(parsed.entries.map(e => e.id)).size !== parsed.entries.length) throw new Error('invalid')
    return { store: { entries: parsed.entries, activeId: parsed.activeId ?? null, welcomed: !!parsed.welcomed }, error: null }
  } catch {
    return { store: { entries: [], activeId: null, welcomed: true }, error: '暂时无法读取本地记录，请先检查浏览器的存储设置。' }
  }
}

export function randomIndex(length: number): number {
  // Rejection sampling keeps every candidate equally likely.
  const limit = Math.floor(0x100000000 / length) * length
  const buffer = new Uint32Array(1)
  do { crypto.getRandomValues(buffer) } while (buffer[0] >= limit)
  return buffer[0] % length
}

export function relativeTime(value: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value)
}
