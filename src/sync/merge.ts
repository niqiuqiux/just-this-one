import { isEntry } from '../model.ts'
import type { Entry, Store } from '../model.ts'

export type WorkspaceData = Pick<Store, 'entries' | 'activeId'>
export type RemoteSnapshot = { revision: number; data: WorkspaceData }
export const EMPTY_WORKSPACE: WorkspaceData = { entries: [], activeId: null }

// Explicit fields keep comparisons stable across JSONB's key ordering.
function cleanEntry(e: Entry): Entry {
  return {
    id: e.id, title: e.title, body: e.body, category: e.category, minutes: e.minutes,
    isTask: e.isTask, done: e.done, createdAt: e.createdAt,
    ...(e.completedAt !== undefined ? { completedAt: e.completedAt } : {}),
  }
}

export function workspaceData(store: WorkspaceData): WorkspaceData {
  const entries = store.entries.filter(e => !e.example).map(cleanEntry)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  return { entries, activeId: entries.some(e => e.id === store.activeId && e.isTask && !e.done) ? store.activeId : null }
}

export function sameData(a: WorkspaceData, b: WorkspaceData): boolean {
  return JSON.stringify(workspaceData(a)) === JSON.stringify(workspaceData(b))
}

export function isWorkspaceData(value: unknown): value is WorkspaceData {
  if (!value || typeof value !== 'object') return false
  const data = value as WorkspaceData
  return Array.isArray(data.entries) && data.entries.every(isEntry)
    && new Set(data.entries.map(e => e.id)).size === data.entries.length
    && (data.activeId === null || typeof data.activeId === 'string')
}

function sameEntry(a: Entry | undefined, b: Entry | undefined) {
  return JSON.stringify(a && cleanEntry(a)) === JSON.stringify(b && cleanEntry(b))
}

function conflictCopy(entry: Entry): Entry {
  // Stable IDs make retrying the same merge idempotent, including after a lost response.
  const value = JSON.stringify(cleanEntry(entry))
  let a = 2166136261, b = 5381
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619)
    b = Math.imul(b, 33) ^ value.charCodeAt(i)
  }
  return { ...entry, id: `conflict-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`, title: `${entry.title.slice(0, 110)}（同步副本）` }
}

/** Three-way merge: unchanged records follow the other device, divergent edits keep both. */
export function mergeWorkspaces(base: WorkspaceData, local: WorkspaceData, remote: WorkspaceData): { data: WorkspaceData; conflicts: number } {
  const maps = [base, local, remote].map(s => new Map(workspaceData(s).entries.map(e => [e.id, e])))
  const [before, ours, theirs] = maps
  const entries = new Map<string, Entry>()
  const copies: Entry[] = []
  let conflicts = 0
  for (const id of new Set(maps.flatMap(m => [...m.keys()]))) {
    const old = before.get(id), left = ours.get(id), right = theirs.get(id)
    if (sameEntry(left, old)) { if (right) entries.set(id, right) }
    else if (sameEntry(right, old) || sameEntry(left, right)) { if (left) entries.set(id, left) }
    else {
      // A deletion never silently destroys a concurrent edit.
      if (right) entries.set(id, right)
      if (left) copies.push(conflictCopy(left))
      conflicts++
    }
  }
  for (const copy of copies) if (!entries.has(copy.id)) entries.set(copy.id, copy)
  const activeId = local.activeId === base.activeId ? remote.activeId : local.activeId
  return { data: workspaceData({ entries: [...entries.values()], activeId }), conflicts }
}
