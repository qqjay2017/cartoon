import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

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
  return { active: Boolean(display), httpsProxy, httpProxy, allProxy, noProxy, display }
}

export function setupOutboundProxy(): ProxyEnvSnapshot {
  const snapshot = readProxyEnv()
  const prefer = (process.env.CARTOON_PROXY ?? 'auto').trim().toLowerCase()
  if (prefer === 'direct' || prefer === 'none' || !snapshot.display) {
    snapshot.active = false
    snapshot.mode = 'none'
    return snapshot
  }
  setGlobalDispatcher(new EnvHttpProxyAgent({
    httpProxy: snapshot.httpProxy,
    httpsProxy: snapshot.httpsProxy,
    noProxy: snapshot.noProxy,
    connectTimeout: 60_000,
    connect: { timeout: 60_000 },
  }))
  snapshot.mode = 'http'
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

export function proxyTroubleshootHint(): string {
  return '若 TLS/ECONNRESET 频繁，可试 export NO_PROXY=localhost,127.0.0.1 或 export CARTOON_PROXY=direct'
}
