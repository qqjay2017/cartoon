import { EnvHttpProxyAgent, ProxyAgent, setGlobalDispatcher } from 'undici'

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
] as const

export interface ProxyEnvSnapshot {
  active: boolean
  httpsProxy?: string
  httpProxy?: string
  allProxy?: string
  display?: string
}

export function readProxyEnv(): ProxyEnvSnapshot {
  const httpsProxy = pickEnv('HTTPS_PROXY', 'https_proxy')
  const httpProxy = pickEnv('HTTP_PROXY', 'http_proxy')
  const allProxy = pickEnv('ALL_PROXY', 'all_proxy')
  const display = httpsProxy || httpProxy || allProxy

  return {
    active: Boolean(display),
    httpsProxy,
    httpProxy,
    allProxy,
    display,
  }
}

/** 在首次 fetch 前调用，让 Node 出站请求走系统代理环境变量 */
export function setupOutboundProxy(): ProxyEnvSnapshot {
  const snapshot = readProxyEnv()
  if (!snapshot.display)
    return snapshot

  try {
    if (snapshot.httpProxy || snapshot.httpsProxy) {
      setGlobalDispatcher(new EnvHttpProxyAgent())
    }
    else if (snapshot.allProxy) {
      setGlobalDispatcher(new ProxyAgent(snapshot.allProxy))
    }
  }
  catch (error) {
    console.warn('[cartoon] proxy setup failed:', error)
    snapshot.active = false
    snapshot.display = undefined
    return snapshot
  }

  const parts = [
    snapshot.httpsProxy && `HTTPS_PROXY=${snapshot.httpsProxy}`,
    snapshot.httpProxy && `HTTP_PROXY=${snapshot.httpProxy}`,
    snapshot.allProxy && `ALL_PROXY=${snapshot.allProxy}`,
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
