import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('Postgres enforces ownership, revision checks, idempotency and input validation', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  const alice = '00000000-0000-4000-8000-000000000001', bob = '00000000-0000-4000-8000-000000000002'
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${alice}'), ('${bob}');
  `)
  const migration = await readFile(new URL('../supabase/migrations/20261101102105_workspaces.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  const exposed = await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef")
  assert.equal(exposed.rows.length, 0, 'privileged functions must stay outside the exposed schema')
  const item = { id: 'one', title: '想法', body: '', category: '灵感', minutes: 15, isTask: false, done: false, createdAt: 1700000000000 }
  const payload = { entries: [item], activeId: null }
  const write = async (version: number, value: unknown, owner = alice) => {
    const result = await db.query<{ result: { applied: boolean; snapshot: { revision: number; data: typeof payload } } }>(
      'select public.save_workspace($1, $2::jsonb, $3::uuid) as result', [version, JSON.stringify(value), owner])
    return result.rows[0].result
  }

  await db.exec(`set role anon;`)
  await assert.rejects(write(0, payload), /permission denied/)
  await assert.rejects(db.query('select * from public.workspaces'), /permission denied/)
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${alice}', false);`)
  const first = await write(0, payload)
  assert.equal(first.applied, true); assert.equal(first.snapshot.revision, 1)
  const retry = await write(0, payload)
  assert.equal(retry.applied, true); assert.equal(retry.snapshot.revision, 1)
  const stale = await write(0, { ...payload, entries: [{ ...item, title: '过时的修改' }] })
  assert.equal(stale.applied, false); assert.equal(stale.snapshot.data.entries[0].title, '想法')
  const second = await write(1, { ...payload, entries: [{ ...item, title: '新的修改' }] })
  assert.equal(second.snapshot.revision, 2)
  await assert.rejects(db.query("update public.workspaces set revision = 9"), /permission denied/)
  await assert.rejects(db.query("delete from public.workspaces"), /permission denied/)
  for (const invalid of [null, {}, { entries: null, activeId: null }, { entries: [item, item], activeId: null }, { ...payload, activeId: 'missing' }, { entries: [{ ...item, minutes: -1 }], activeId: null }, { entries: [{ ...item, title: '' }], activeId: null }, { entries: [{ ...item, example: true }], activeId: null }]) {
    await assert.rejects(write(2, invalid), /Invalid workspace/)
  }
  await db.exec(`select set_config('request.jwt.claim.sub', '${bob}', false);`)
  assert.equal((await db.query('select * from public.workspaces')).rows.length, 0)
  await assert.rejects(write(0, payload, alice), /account changed/)
  await write(0, payload, bob)
  const rows = await db.query<{ user_id: string }>('select user_id from public.workspaces')
  assert.deepEqual(rows.rows, [{ user_id: bob }])
  await db.exec(`reset role;`)
  assert.equal((await db.query('select * from public.workspaces')).rows.length, 2)
})
