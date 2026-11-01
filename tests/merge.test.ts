import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeWorkspaces, workspaceData } from '../src/sync/merge.ts'
import type { Entry } from '../src/model.ts'

export const note = (id: string, extra: Partial<Entry> = {}): Entry => ({
  id, title: `想法 ${id}`, body: '', category: '灵感', minutes: 15,
  isTask: false, done: false, createdAt: 1700000000000, ...extra,
})
const data = (...entries: Entry[]) => ({ entries, activeId: null })

test('independent additions, edits and deletions from two devices all survive', () => {
  const a = note('a'), b = note('b'), c = note('c')
  const result = mergeWorkspaces(data(a, b), data({ ...a, body: '手机编辑' }, b, c), data(a))
  assert.deepEqual(result.data.entries.map(e => e.id).sort(), ['a', 'c'])
  assert.equal(result.data.entries.find(e => e.id === 'a')?.body, '手机编辑')
  assert.equal(result.conflicts, 0)
})

test('concurrent edits keep both versions and retry does not duplicate the conflict copy', () => {
  const before = note('a'), left = note('a', { body: '手机版本' }), right = note('a', { body: '电脑版本' })
  const first = mergeWorkspaces(data(before), data(left), data(right))
  assert.deepEqual(first.data.entries.map(e => e.body).sort(), ['手机版本', '电脑版本'].sort())
  assert.equal(first.conflicts, 1)
  const retry = mergeWorkspaces(data(before), data(left), first.data)
  assert.equal(retry.data.entries.length, 2)
})

test('delete/edit conflicts preserve the edit, but unchanged deleted notes do not resurrect', () => {
  const before = note('a'), edited = note('a', { body: '断网时写下的内容' })
  assert.equal(mergeWorkspaces(data(before), data(before), data()).data.entries.length, 0)
  assert.equal(mergeWorkspaces(data(before), data(edited), data()).data.entries[0].body, edited.body)
  assert.equal(mergeWorkspaces(data(before), data(), data(edited)).data.entries[0].body, edited.body)
})

test('sample notes stay local and completed/deleted tasks cannot remain focused', () => {
  const task = note('task', { isTask: true })
  assert.equal(workspaceData({ entries: [note('example', { example: true })], activeId: null }).entries.length, 0)
  assert.equal(workspaceData({ entries: [{ ...task, done: true }], activeId: 'task' }).activeId, null)
  const result = mergeWorkspaces({ entries: [task], activeId: 'task' }, { entries: [task], activeId: 'task' }, data({ ...task, done: true }))
  assert.equal(result.data.activeId, null)
})
