export interface FetchOptions {
  headers?: Record<string, string>
  timeout?: number
  method?: 'GET' | 'POST'
  body?: string | Uint8Array
  /** 响应体字符集，如 gbk */
  responseCharset?: string
  /** 从服务端 Cookie 存储读取并附加到请求 */
  cookieJarKey?: string
}

export type Fetcher = (url: string, options?: FetchOptions) => Promise<string>

export interface BinaryFetchResult {
  data: Uint8Array
  contentType?: string
}

export type BinaryFetcher = (url: string, options?: FetchOptions) => Promise<BinaryFetchResult>

export function parseHeaders(raw?: string): Record<string, string> {
  if (!raw)
    return {}

  const trimmed = raw.trim()
  if (trimmed.startsWith('<js>'))
    return {}

  try {
    return JSON.parse(trimmed) as Record<string, string>
  }
  catch {
    return {}
  }
}

export function buildSearchUrl(template: string, keyword: string, page = 1, baseUrl?: string): string {
  let url = template
    .replace(/\{\{key\}\}/g, encodeURIComponent(keyword))
    .replace(/\{\{page\}\}/g, String(page))

  if (!/^https?:\/\//i.test(url) && baseUrl) {
    url = new URL(url, baseUrl).href
  }

  return url
}

export function sourceIdFromName(name: string): string {
  return name.replace(/\s+/g, '-').toLowerCase()
}
