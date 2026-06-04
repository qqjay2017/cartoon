import { createReadStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import iconv from 'iconv-lite'
import {
  BookService,
  ComicCacheService,
  DownloadService,
  NovelBookshelfCache,
  SourceRegistry,
  withRetry,
  type BinaryFetcher,
  type Fetcher,
} from '@cartoon/core'
import {
  getDb,
  getEnabledSources,
  getSourceCookies,
  setSourceCookies,
} from '@cartoon/db'
import { DownloadJobManager } from './download-jobs.js'
import { readProxyEnv, setupOutboundProxy } from './setup-proxy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const rootDir = join(__dirname, '../../../..')

let ctx: AppContext | undefined

export interface AppContext {
  rootDir: string
  proxyEnv: ReturnType<typeof readProxyEnv>
  bookService: BookService
  registry: SourceRegistry
  comicCache: ComicCacheService
  bookshelfCache: NovelBookshelfCache
  downloadService: DownloadService
  downloadJobs: DownloadJobManager
  fetcher: Fetcher
  binaryFetcher: BinaryFetcher
}

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

function buildBrowserHeaders(url: string, headers: Record<string, string> = {}): Record<string, string> {
  let origin = ''
  try {
    origin = new URL(url).origin
  }
  catch {
    // ignore
  }
  const isJsonApi = /mgsearcher\.com\/api\//i.test(url)
  return {
    ...defaultHeaders,
    Accept: isJsonApi
      ? 'application/json, text/plain, */*'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    ...(origin && !headers.Referer && !headers.referer ? { Referer: `${origin}/` } : {}),
    ...headers,
  }
}

const FETCH_RETRY = { retries: 5, delayMs: 2000 }

async function createFetchers(): Promise<{ fetcher: Fetcher, binaryFetcher: BinaryFetcher }> {
  async function fetchText(url: string, options: Parameters<Fetcher>[1] = {}): Promise<string> {
    const controller = new AbortController()
    const timeoutMs = options.timeout ?? 60000
    const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined

    let body: BodyInit | undefined = options.body as BodyInit | undefined
    if (typeof options.body === 'string' && options.responseCharset?.toLowerCase().includes('gbk'))
      body = iconv.encode(options.body, 'gbk') as unknown as BodyInit
    else if (options.body instanceof Uint8Array)
      body = Buffer.from(options.body) as unknown as BodyInit

    try {
      const headers = buildBrowserHeaders(url, options.headers ?? {})
      if (options.cookieJarKey) {
        const { db } = getDb()
        const cookie = await getSourceCookies(db, options.cookieJarKey)
        if (cookie)
          headers.Cookie = cookie
      }

      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
      })

      if (!response.ok)
        throw new Error(`HTTP ${response.status} for ${url}`)

      const buffer = Buffer.from(await response.arrayBuffer())
      if (options.responseCharset?.toLowerCase().includes('gbk'))
        return iconv.decode(buffer, 'gbk')
      return buffer.toString('utf8')
    }
    finally {
      if (timeout)
        clearTimeout(timeout)
    }
  }

  async function fetchBinary(url: string, options: Parameters<BinaryFetcher>[1] = {}): Promise<{ data: Uint8Array, contentType?: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 180000)
    try {
      const response = await fetch(url, {
        headers: { ...defaultHeaders, Referer: new URL(url).origin, ...options.headers },
        signal: controller.signal,
      })
      if (!response.ok)
        throw new Error(`HTTP ${response.status} for ${url}`)
      const buffer = await response.arrayBuffer()
      return { data: new Uint8Array(buffer), contentType: response.headers.get('content-type') ?? undefined }
    }
    finally {
      clearTimeout(timeout)
    }
  }

  const fetcher: Fetcher = (url, options = {}) => withRetry(() => fetchText(url, options), FETCH_RETRY)
  const binaryFetcher: BinaryFetcher = (url, options = {}) => withRetry(() => fetchBinary(url, options), FETCH_RETRY)

  return { fetcher, binaryFetcher }
}

export async function getAppContext(): Promise<AppContext> {
  if (ctx)
    return ctx

  const proxyEnv = setupOutboundProxy()
  const { fetcher, binaryFetcher } = await createFetchers()
  const bookService = new BookService({ fetcher })

  const { db } = getDb()
  const sources = await getEnabledSources(db)
  const registry = new SourceRegistry(sources, bookService)

  const comicCache = new ComicCacheService({ projectRoot: rootDir, bookService, binaryFetcher })
  await comicCache.init()

  const bookshelfCache = new NovelBookshelfCache({ projectRoot: rootDir, bookService, binaryFetcher })
  await bookshelfCache.init()

  const downloadService = new DownloadService(bookService, binaryFetcher, comicCache, undefined)
  const downloadJobs = new DownloadJobManager(join(rootDir, 'cache', 'downloads'))
  await downloadJobs.init()

  ctx = {
    rootDir,
    proxyEnv: readProxyEnv(),
    bookService,
    registry,
    comicCache,
    bookshelfCache,
    downloadService,
    downloadJobs,
    fetcher,
    binaryFetcher,
  }

  console.log(`[cartoon] loaded ${sources.length} sources from database`)
  console.log(`[cartoon] comic cache: ${comicCache.getCacheRoot()}`)
  console.log(`[cartoon] content cache: ${bookshelfCache.getContentRoot()}`)

  return ctx
}

export async function reloadRegistry() {
  const { db } = getDb()
  const sources = await getEnabledSources(db)
  const app = await getAppContext()
  app.registry.reload(sources)
}

export { createReadStream }

export async function persistSourceCookies(sourceId: string, cookies: string) {
  const { db } = getDb()
  await setSourceCookies(db, sourceId, cookies)
}
