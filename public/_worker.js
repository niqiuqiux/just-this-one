// Cloudflare Pages advanced mode: keep the browser's API traffic on this origin.
// Only the application endpoints are forwarded; no management or signup endpoints.
const routes = new Map([
  ['/auth/v1/token', ['POST']],
  ['/auth/v1/logout', ['POST']],
  ['/auth/v1/user', ['GET']],
  ['/rest/v1/workspaces', ['GET']],
  ['/rest/v1/rpc/save_workspace', ['POST']],
])
const prefix = '/api/supabase'
const reply = (status, message) => Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function handleRequest(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(`${prefix}/`)) return env.ASSETS.fetch(request)
  const path = url.pathname.slice(prefix.length)
  const methods = routes.get(path)
  if (!methods) return reply(404, 'Not found')
  if (!methods.includes(request.method)) return reply(405, 'Method not allowed')
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return reply(403, 'Origin not allowed')
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return reply(503, 'Cloud sync is not configured')
  const target = new URL(env.SUPABASE_URL)
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.supabase.co')) return reply(503, 'Invalid cloud configuration')
  target.pathname = path
  target.search = url.search
  const headers = new Headers({ apikey: env.SUPABASE_PUBLISHABLE_KEY })
  for (const name of ['authorization', 'content-type', 'accept', 'prefer', 'x-client-info', 'x-supabase-api-version']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  try {
    const upstream = await upstreamFetch(target, {
      method: request.method, headers, body: request.method === 'GET' ? undefined : request.body,
      redirect: 'manual', signal: AbortSignal.timeout(12000),
    })
    if (upstream.status >= 300 && upstream.status < 400) return reply(502, 'Unexpected upstream redirect')
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    for (const name of ['content-type', 'content-range', 'range-unit', 'retry-after', 'x-supabase-api-version']) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch { return reply(502, 'Cloud service temporarily unavailable') }
}

export default { fetch: (request, env) => handleRequest(request, env) }
