import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Plain JS is deployed unchanged as a Pages Worker.
import worker, { handleRequest } from '../public/_worker.js'

const env = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-test-key',
  ASSETS: { fetch: async () => new Response('static page') },
}
test('proxy forwards auth without cookies or client-supplied API keys, and never caches responses', async () => {
  let received: { url: URL; init: RequestInit } | undefined
  const request = new Request('https://app.example/api/supabase/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { Origin: 'https://app.example', Cookie: 'private=cookie', apikey: 'override', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'test-password' }),
  })
  const response = await handleRequest(request, env, async (url: URL, init: RequestInit) => {
    received = { url, init }
    return Response.json({ access_token: 'test-token' }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
  })
  assert.equal(received!.url.href, 'https://example.supabase.co/auth/v1/token?grant_type=password')
  const headers = new Headers(received!.init.headers)
  assert.equal(headers.get('apikey'), 'public-test-key')
  assert.equal(headers.get('cookie'), null)
  assert.equal(received!.init.redirect, 'manual')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), { access_token: 'test-token' })
})

test('proxy blocks other origins, management paths, signup, direct writes and redirects', async () => {
  const unused = async () => { throw new Error('must not call upstream') }
  for (const [path, method, origin, status] of [
    ['/auth/v1/token', 'POST', 'https://other.example', 403],
    ['/auth/v1/admin/users', 'GET', 'https://app.example', 404],
    ['/auth/v1/signup', 'POST', 'https://app.example', 404],
    ['/rest/v1/workspaces', 'DELETE', 'https://app.example', 405],
  ] as const) {
    const response = await handleRequest(new Request(`https://app.example/api/supabase${path}`, { method, headers: { Origin: origin } }), env, unused)
    assert.equal(response.status, status)
  }
  const request = new Request('https://app.example/api/supabase/rest/v1/workspaces')
  assert.equal((await handleRequest(request, env, async () => Response.redirect('https://unrelated.example'))).status, 502)
  assert.equal((await handleRequest(request, { ...env, SUPABASE_URL: '' }, unused)).status, 503)
  assert.equal(await (await handleRequest(new Request('https://app.example/'), env, unused)).text(), 'static page')
})

test('Pages execution context is not mistaken for an upstream fetch implementation', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ ok: true })
    const result = await worker.fetch(new Request('https://app.example/api/supabase/rest/v1/workspaces'), env, { waitUntil() {} })
    assert.equal(result.status, 200)
  } finally { globalThis.fetch = original }
})
