import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
] as const

const PROXY_CONNECT_TIMEOUT_MS = 60_000

export interface ProxyEnvSnapshot {
  active: boolean
  mode?: 'http' | 'none'
  httpsProxy?: string
  httpProxy?: string
  allProxy?: string
  noProxy?: string
  display?: string
}

export function readProxyEnv(): ProxyEnvSnapshot {
  const httpsProxy = pickEnv('HTTPS_PROXY', 'https_proxy')
  const httpProxy = pickEnv('HTTP_PROXY', 'http_proxy')
  const allProxy = pickEnv('ALL_PROXY', 'all_proxy')
  const noProxy = pickEnv('NO_PROXY', 'no_proxy')
  const display = httpsProxy || httpProxy || allProxy

  return {
    active: Boolean(display),
    httpsProxy,
    httpProxy,
    allProxy,
    noProxy,
    display,
  }
}

/** 在首次 fetch 前调用，让 Node 出站请求走系统代理环境变量 */
export function setupOutboundProxy(): ProxyEnvSnapshot {
  const snapshot = readProxyEnv()
  const prefer = (process.env.CARTOON_PROXY ?? 'auto').trim().toLowerCase()

  if (prefer === 'direct' || prefer === 'none' || !snapshot.display) {
    snapshot.active = false
    snapshot.mode = 'none'
    return snapshot
  }

  try {
    setGlobalDispatcher(new EnvHttpProxyAgent({
      httpProxy: snapshot.httpProxy,
      httpsProxy: snapshot.httpsProxy,
      noProxy: snapshot.noProxy,
      connectTimeout: PROXY_CONNECT_TIMEOUT_MS,
      connect: { timeout: PROXY_CONNECT_TIMEOUT_MS },
    }))
    snapshot.mode = 'http'
  }
  catch (error) {
    console.warn('[cartoon] proxy setup failed:', error)
    snapshot.active = false
    snapshot.mode = 'none'
    snapshot.display = undefined
    return snapshot
  }

  const parts = [
    snapshot.mode && `mode=${snapshot.mode}`,
    snapshot.httpsProxy && `HTTPS_PROXY=${snapshot.httpsProxy}`,
    snapshot.httpProxy && `HTTP_PROXY=${snapshot.httpProxy}`,
    snapshot.allProxy && `ALL_PROXY=${snapshot.allProxy}`,
    snapshot.noProxy && `NO_PROXY=${snapshot.noProxy}`,
  ].filter(Boolean)

  snapshot.display = parts.join(' · ') || snapshot.display
  return snapshot
}

function pickEnv(...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value)
      return value
  }
  return undefined
}

export function listProxyEnvKeys(): string[] {
  return PROXY_ENV_KEYS.filter(key => Boolean(process.env[key]?.trim()))
}

export function proxyTroubleshootHint(): string {
  return '若 TLS/ECONNRESET 频繁，可试 export NO_PROXY=manhuafree.com,localhost,127.0.0.1 或 export CARTOON_PROXY=direct 直连'
}
