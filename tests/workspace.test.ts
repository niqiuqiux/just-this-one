import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Workspace } from '../src/sync/workspace.ts'
import { EMPTY_WORKSPACE, sameData } from '../src/sync/merge.ts'
import type { RemoteSnapshot, WorkspaceData } from '../src/sync/merge.ts'
import type { CloudTransport } from '../src/sync/cloud.ts'
import { STORAGE_KEY } from '../src/model.ts'
import type { Entry } from '../src/model.ts'

const userA = { id: 'account-a', email: 'a@example.com' }
const userB = { id: 'account-b', email: 'b@example.com' }
const note = (id: string, body = ''): Entry => ({ id, title: id, body, category: '灵感', minutes: 15, isTask: false, done: false, createdAt: 1700000000000 })
class MemoryStorage implements Storage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
class Server implements CloudTransport {
  records = new Map<string, RemoteSnapshot>()
  offline = false
  loseNextResponse = false
  beforeWrite: (() => void) | null = null
  async read(user: string, revision: number) {
    if (this.offline) throw new Error('offline')
    const row = this.records.get(user)
    return row && row.revision > revision ? structuredClone(row) : null
  }
  async write(user: string, revision: number, data: WorkspaceData) {
    if (this.offline) throw new Error('offline')
    this.beforeWrite?.(); this.beforeWrite = null
    const row = this.records.get(user) ?? { revision: 0, data: EMPTY_WORKSPACE }
    const applied = row.revision === revision || sameData(row.data, data)
    const result = applied ? { revision: row.revision + (sameData(row.data, data) ? 0 : 1), data: structuredClone(data) } : row
    if (applied) this.records.set(user, result)
    if (this.loseNextResponse) { this.loseNextResponse = false; throw new Error('lost response') }
    return { applied, snapshot: structuredClone(result) }
  }
}
function device(t: TestContext, server: CloudTransport, storage = new MemoryStorage()) {
  const engine = new Workspace(storage, server, 'test', e => (e as Error).message)
  t.after(() => engine.stop())
  return engine
}
async function login(engine: Workspace, user = userA) { engine.connect(user); await engine.sync() }
function put(engine: Workspace, entry: Entry) {
  engine.update(s => ({ ...s, entries: [entry, ...s.entries.filter(e => e.id !== entry.id)] }))
}

test('two devices synchronize task completion, focus, restoration, deletion and undo', async t => {
  const server = new Server(), a = device(t, server), b = device(t, server)
  await login(a); await login(b)
  put(a, { ...note('task'), isTask: true }); a.update(s => ({ ...s, activeId: 'task' }))
  await a.sync(); await b.sync()
  assert.equal(b.getSnapshot().store.activeId, 'task')
  b.update(s => ({ ...s, activeId: null, entries: s.entries.map(e => ({ ...e, done: true, completedAt: Date.now() })) }))
  await b.sync(); await a.sync()
  assert.equal(a.getSnapshot().store.entries[0].done, true)
  assert.equal(a.getSnapshot().store.activeId, null)
  a.update(s => ({ ...s, entries: s.entries.map(e => ({ ...e, done: false, completedAt: undefined })) }))
  await a.sync(); await b.sync()
  const saved = b.getSnapshot().store.entries[0]
  b.update(s => ({ ...s, entries: [] })); await b.sync(); await a.sync()
  assert.equal(a.getSnapshot().store.entries.length, 0)
  put(b, saved); await b.sync(); await a.sync()
  assert.equal(a.getSnapshot().store.entries[0].done, false)
})

test('offline edits survive a reload and merge with changes from another device', async t => {
  const storage = new MemoryStorage(), server = new Server(), a = device(t, server, storage), b = device(t, server)
  await login(a); await login(b)
  server.offline = true; put(a, note('phone')); await a.sync()
  assert.equal(a.getSnapshot().pending, true)
  const reloaded = device(t, server, storage)
  assert.equal(reloaded.getSnapshot().store.entries[0].id, 'phone')
  server.offline = false; put(b, note('desktop')); await b.sync(); await login(reloaded)
  assert.deepEqual(server.records.get(userA.id)?.data.entries.map(e => e.id).sort(), ['desktop', 'phone'])
  assert.equal(reloaded.getSnapshot().pending, false)
})

test('failed acknowledgement retries without duplicating records', async t => {
  const server = new Server(), a = device(t, server)
  await login(a); put(a, note('a')); server.loseNextResponse = true
  await a.sync(); assert.equal(a.getSnapshot().pending, true)
  await a.sync(); assert.equal(a.getSnapshot().pending, false)
  assert.equal(server.records.get(userA.id)?.data.entries.length, 1)
})

test('edits made while a write is in flight are uploaded in the next revision', async t => {
  const server = new Server(), a = device(t, server)
  await login(a); put(a, note('a', 'first'))
  server.beforeWrite = () => put(a, note('a', 'edited while uploading'))
  await a.sync()
  assert.equal(server.records.get(userA.id)?.data.entries[0].body, 'edited while uploading')
  assert.equal(a.getSnapshot().pending, false)
})

test('stale revisions preserve concurrent edits as conflict copies', async t => {
  const server = new Server(), a = device(t, server)
  await login(a); put(a, note('a', 'base')); await a.sync(); put(a, note('a', 'ours'))
  server.beforeWrite = () => server.records.set(userA.id, { revision: 2, data: { entries: [note('a', 'theirs')], activeId: null } })
  await a.sync()
  assert.deepEqual(server.records.get(userA.id)?.data.entries.map(e => e.body).sort(), ['ours', 'theirs'])
  assert.equal(a.getSnapshot().pending, false)
})

test('accounts remain isolated and logout preserves the guest workspace', async t => {
  const storage = new MemoryStorage(), server = new Server(), a = device(t, server, storage)
  put(a, note('guest')); await login(a)
  assert.equal(a.getSnapshot().store.entries.length, 0)
  a.importLocal(); await a.sync(); put(a, note('private-a')); await a.sync()
  await login(a, userB)
  assert.equal(a.getSnapshot().store.entries.length, 0)
  assert.equal(server.records.has(userB.id), false)
  put(a, note('private-b')); await a.sync(); a.disconnect()
  assert.deepEqual(a.getSnapshot().store.entries.filter(e => !e.example).map(e => e.id), ['guest'])
  assert.ok(storage.getItem(STORAGE_KEY))
  assert.equal(storage.getItem(`${STORAGE_KEY}.test.account.${userB.id}`), null)
})

test('logout is blocked with unsynced changes and corrupt storage is not overwritten', async t => {
  const server = new Server(), storage = new MemoryStorage(), a = device(t, server)
  await login(a); put(a, note('pending')); assert.throws(() => a.disconnect(), /没有同步/)
  storage.setItem(STORAGE_KEY, '{broken')
  const broken = device(t, server, storage); put(broken, note('new'))
  assert.equal(storage.getItem(STORAGE_KEY), '{broken')
  assert.ok(broken.getSnapshot().storageError)
})

test('late responses from a previous account do not change the new account', async t => {
  let release!: (value: RemoteSnapshot) => void
  const server = new Server()
  const transport: CloudTransport = {
    read: (user, revision) => user === userA.id ? new Promise(resolve => { release = resolve }) : server.read(user, revision),
    write: (...args) => server.write(...args),
  }
  const a = device(t, transport)
  a.connect(userA)
  a.connect(userB)
  release({ revision: 1, data: { entries: [note('private-a')], activeId: null } })
  await a.sync(); await a.sync()
  assert.equal(a.getSnapshot().user?.id, userB.id)
  assert.equal(a.getSnapshot().store.entries.length, 0)
  assert.equal(server.records.has(userB.id), false)
})

test('two tabs merge locally pending changes before overwriting the cache', async t => {
  const server = new Server(), storage = new MemoryStorage(), a = device(t, server, storage), b = device(t, server, storage)
  await login(a); await login(b)
  put(a, note('tab-a')); put(b, note('tab-b')); a.reloadFromDisk()
  await a.sync(); await b.sync()
  assert.deepEqual(server.records.get(userA.id)?.data.entries.map(e => e.id).sort(), ['tab-a', 'tab-b'])
})

test('an expired API session offers reauthentication and retains pending edits', async t => {
  let expired = false
  const server = new Server()
  const transport: CloudTransport = {
    read: (user, revision) => { if (expired) throw { code: 'PGRST301' }; return server.read(user, revision) },
    write: (...args) => server.write(...args),
  }
  const a = device(t, transport)
  await login(a); expired = true; put(a, note('keep-me')); await a.sync()
  assert.equal(a.getSnapshot().phase, 'expired')
  assert.equal(a.getSnapshot().pending, true)
  expired = false; await login(a)
  assert.equal(a.getSnapshot().phase, 'synced')
  assert.equal(server.records.get(userA.id)?.data.entries[0].id, 'keep-me')
})
