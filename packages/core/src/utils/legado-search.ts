import { isJsRule } from '../engine/js-runtime.js'

export interface LegadoSearchRequest {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string | Uint8Array
  responseCharset?: string
}

export function parseLegadoSearchSpec(
  spec: string,
  baseUrl: string,
  vars: { key?: string, page?: number },
): LegadoSearchRequest {
  const commaIndex = spec.indexOf(',')
  if (commaIndex === -1) {
    return { url: applySearchTemplate(spec, baseUrl, vars) }
  }

  const pathPart = spec.slice(0, commaIndex).trim()
  const optionPart = spec.slice(commaIndex + 1).trim()
  const options = parseLooseJson(optionPart) as {
    charset?: string
    method?: string
    body?: string
    headers?: Record<string, string>
  }

  const url = applySearchTemplate(pathPart, baseUrl, vars)
  const bodyTemplate = options.body ?? ''
  const bodyText = applySearchTemplate(bodyTemplate, baseUrl, vars, { encodeKey: false })

  const request: LegadoSearchRequest = {
    url,
    method: options.method?.toUpperCase() === 'POST' ? 'POST' : 'GET',
    responseCharset: options.charset,
    headers: { ...options.headers },
  }

  if (request.method === 'POST') {
    request.body = bodyText
    request.headers ??= {}
    if (!request.headers['Content-Type'] && !request.headers['content-type']) {
      request.headers['Content-Type'] = options.charset
        ? `application/x-www-form-urlencoded; charset=${options.charset}`
        : 'application/x-www-form-urlencoded'
    }
  }

  return request
}

function applySearchTemplate(
  template: string,
  baseUrl: string,
  vars: { key?: string, page?: number },
  options?: { encodeKey?: boolean },
): string {
  let url = template
  const encodeKey = options?.encodeKey !== false

  if (vars.key !== undefined) {
    const keyValue = encodeKey ? encodeURIComponent(vars.key) : vars.key
    url = url.replace(/\{\{key\}\}/g, keyValue)
  }
  if (vars.page !== undefined)
    url = url.replace(/\{\{page\}\}/g, String(vars.page))

  if (!/^https?:\/\//i.test(url) && baseUrl)
    url = new URL(url, baseUrl).href

  return url
}

function parseLooseJson(raw: string): unknown {
  const normalized = raw
    .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
  return JSON.parse(normalized)
}

export function isDirectBookUrl(keyword: string): boolean {
  return /^https?:\/\//i.test(keyword.trim())
}

export function shouldSkipJsRuleParsing(spec: string): boolean {
  return isJsRule(spec)
}
