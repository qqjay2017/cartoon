import { Agent, fetch as undiciFetch } from 'undici'
import { readProxyEnv } from './setup-proxy.js'

const directDispatcher = new Agent()

export interface FlareSolverrConfig {
  url: string
  maxTimeout: number
  proxyUrl?: string
}

export interface FlareSolverrResult {
  html: string
  cookies: string
  userAgent: string
  status: number
}

interface FlareSolverrCookie {
  name: string
  value: string
}

interface FlareSolverrSolution {
  status: number
  response: string
  cookies?: FlareSolverrCookie[]
  userAgent?: string
}

interface FlareSolverrResponse {
  status: 'ok' | 'error'
  message?: string
  solution?: FlareSolverrSolution
}

export function resolveFlareSolverrProxyUrl(proxyUrl?: string): string | undefined {
  const raw = proxyUrl?.trim()
  if (!raw)
    return undefined

  const lower = raw.toLowerCase()
  if (lower === 'none' || lower === 'direct' || lower === 'off')
    return undefined

  try {
    const url = new URL(raw)
    const dockerHost = process.env.FLARESOLVERR_PROXY_HOST?.trim() || 'host.docker.internal'
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      url.hostname = dockerHost
    url.pathname = url.pathname.replace(/\/$/, '') || '/'
    return url.toString().replace(/\/$/, '')
  }
  catch {
    return raw
  }
}

export function readFlareSolverrConfig(): FlareSolverrConfig | undefined {
  const raw = process.env.FLARESOLVERR_URL?.trim()
  if (!raw)
    return undefined

  const url = raw.replace(/\/$/, '')
  const maxTimeout = Number(process.env.FLARESOLVERR_TIMEOUT ?? 120000)
  const proxyUrl = resolveFlareSolverrProxyUrl(
    process.env.FLARESOLVERR_PROXY?.trim()
    || readProxyEnv().httpsProxy
    || readProxyEnv().httpProxy,
  )

  return {
    url,
    maxTimeout: Number.isFinite(maxTimeout) && maxTimeout > 0 ? maxTimeout : 120000,
    proxyUrl,
  }
}

function parseCookieHeader(cookies: string): FlareSolverrCookie[] {
  return cookies
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=')
      if (index <= 0)
        return null
      return {
        name: part.slice(0, index).trim(),
        value: part.slice(index + 1).trim(),
      }
    })
    .filter((item): item is FlareSolverrCookie => Boolean(item?.name))
}

function cookiesToHeader(cookies: FlareSolverrCookie[]): string {
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

export async function flareSolverrGet(
  config: FlareSolverrConfig,
  targetUrl: string,
  options?: { cookies?: string, waitInSeconds?: number },
): Promise<FlareSolverrResult> {
  const payload: Record<string, unknown> = {
    cmd: 'request.get',
    url: targetUrl,
    maxTimeout: config.maxTimeout,
  }

  if (config.proxyUrl)
    payload.proxy = { url: config.proxyUrl }

  if (options?.waitInSeconds && options.waitInSeconds > 0)
    payload.waitInSeconds = options.waitInSeconds

  if (options?.cookies?.trim()) {
    const parsed = parseCookieHeader(options.cookies)
    if (parsed.length)
      payload.cookies = parsed
  }

  const response = await undiciFetch(`${config.url}/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    dispatcher: directDispatcher,
  })

  const text = await response.text()
  let data: FlareSolverrResponse
  try {
    data = JSON.parse(text) as FlareSolverrResponse
  }
  catch {
    throw new Error(`FlareSolverr HTTP ${response.status}: ${text.slice(0, 200)}`)
  }

  if (!response.ok || data.status !== 'ok' || !data.solution) {
    const detail = data.message?.replace(/\\n/g, ' ').trim()
    if (detail?.includes('ERR_PROXY_CONNECTION_FAILED'))
      throw new Error('FlareSolverr 无法连接代理。Docker 内请用 host.docker.internal，例如 export FLARESOLVERR_PROXY=http://host.docker.internal:10808')
    throw new Error(detail ?? `FlareSolverr HTTP ${response.status}`)
  }

  const solution = data.solution
  if (solution.status >= 400)
    throw new Error(`FlareSolverr got HTTP ${solution.status} for ${targetUrl}`)

  return {
    html: solution.response,
    cookies: cookiesToHeader(solution.cookies ?? []),
    userAgent: solution.userAgent ?? '',
    status: solution.status,
  }
}

export async function probeFlareSolverr(config: FlareSolverrConfig): Promise<boolean> {
  try {
    const response = await undiciFetch(`${config.url}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'sessions.list' }),
      dispatcher: directDispatcher,
    })
    if (!response.ok)
      return false
    const data = await response.json() as FlareSolverrResponse
    return data.status === 'ok'
  }
  catch {
    return false
  }
}
