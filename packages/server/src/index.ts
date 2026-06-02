import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import iconv from 'iconv-lite'
import {
  BookService,
  ComicCacheService,
  DownloadService,
  loadSourcesFromDir,
  NovelCacheService,
  SourceRegistry,
  withRetry,
  type BinaryFetcher,
  type DownloadFormat,
  type Fetcher,
} from '@cartoon/core'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { DownloadJobManager } from './download-jobs.js'
import { readProxyEnv, proxyTroubleshootHint, setupOutboundProxy } from './setup-proxy.js'
import { formatCloudflare403Hint, SourceCookieStore } from './source-cookies.js'
import { flareSolverrGet, probeFlareSolverr, readFlareSolverrConfig } from './flaresolverr.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '../../..')
const remoteDir = join(rootDir, 'remote')

const proxyEnv = setupOutboundProxy()

const flareSolverrConfig = readFlareSolverrConfig()
const flareSolverrReady = flareSolverrConfig
  ? await probeFlareSolverr(flareSolverrConfig)
  : false

const sourceCookies = new SourceCookieStore(join(rootDir, 'cache', 'source-cookies.json'))
await sourceCookies.init()

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

  return {
    ...defaultHeaders,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    ...(origin && !headers.Referer && !headers.referer ? { Referer: `${origin}/` } : {}),
    ...headers,
  }
}

function formatSourceFetchError(error: unknown, sourceName?: string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('403'))
    return formatCloudflare403Hint(sourceName, Boolean(flareSolverrConfig))
  if (message.includes('FlareSolverr'))
    return message
  return message
}

async function fetchViaFlareSolverr(
  url: string,
  options: Parameters<Fetcher>[1] = {},
): Promise<string> {
  if (!flareSolverrConfig)
    throw new Error('FlareSolverr 未配置，请设置 FLARESOLVERR_URL=http://127.0.0.1:8191')

  const waitInSeconds = /69shuba\.com\/book\/\d+\/?$/i.test(url) ? 2 : undefined
  const result = await flareSolverrGet(flareSolverrConfig, url, { waitInSeconds })

  if (options.cookieJarKey && result.cookies)
    await sourceCookies.set(options.cookieJarKey, result.cookies)

  return result.html
}

const FETCH_RETRY = { retries: 5, delayMs: 2000 }

async function fetchText(url: string, options: Parameters<Fetcher>[1] = {}): Promise<string> {
  const controller = new AbortController()
  const timeoutMs = options.timeout ?? 60000
  const timeout = timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined

  let body: BodyInit | undefined = options.body as BodyInit | undefined
  if (typeof options.body === 'string' && options.responseCharset?.toLowerCase().includes('gbk'))
    body = iconv.encode(options.body, 'gbk') as unknown as BodyInit
  else if (options.body instanceof Uint8Array)
    body = Buffer.from(options.body) as unknown as BodyInit

  try {
    const headers = buildBrowserHeaders(url, options.headers ?? {})
    if (options.cookieJarKey) {
      const cookie = sourceCookies.get(options.cookieJarKey)
      if (cookie)
        headers.Cookie = cookie
    }

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 403 && options.cookieJarKey && flareSolverrConfig)
        return fetchViaFlareSolverr(url, options)
      throw new Error(`HTTP ${response.status} for ${url}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (options.responseCharset?.toLowerCase().includes('gbk'))
      return iconv.decode(buffer, 'gbk')

    return buffer.toString('utf8')
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('403') && options.cookieJarKey && flareSolverrConfig)
      return fetchViaFlareSolverr(url, options)
    throw error
  }
  finally {
    if (timeout)
      clearTimeout(timeout)
  }
}

async function fetchBinary(url: string, options: Parameters<BinaryFetcher>[1] = {}): Promise<{ data: Uint8Array, contentType?: string }> {
  const controller = new AbortController()
  const timeoutMs = options.timeout ?? 180000
  const timeout = timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined

  try {
    const response = await fetch(url, {
      headers: {
        ...defaultHeaders,
        Referer: new URL(url).origin,
        ...options.headers,
      },
      signal: controller.signal,
    })

    if (!response.ok)
      throw new Error(`HTTP ${response.status} for ${url}`)

    const buffer = await response.arrayBuffer()
    return {
      data: new Uint8Array(buffer),
      contentType: response.headers.get('content-type') ?? undefined,
    }
  }
  finally {
    if (timeout)
      clearTimeout(timeout)
  }
}

const fetcher: Fetcher = (url, options = {}) =>
  withRetry(() => fetchText(url, options), FETCH_RETRY)

const binaryFetcher: BinaryFetcher = (url, options = {}) =>
  withRetry(() => fetchBinary(url, options), FETCH_RETRY)

const sources = await loadSourcesFromDir(remoteDir)
const bookService = new BookService({ fetcher })
const comicCache = new ComicCacheService({ projectRoot: rootDir, bookService, binaryFetcher })
await comicCache.init()
const novelCache = new NovelCacheService({ projectRoot: rootDir, bookService, binaryFetcher })
await novelCache.init()
const downloadService = new DownloadService(bookService, binaryFetcher, comicCache, novelCache)
const downloadJobs = new DownloadJobManager(join(rootDir, 'cache', 'downloads'))
await downloadJobs.init()
const registry = new SourceRegistry(sources, bookService)

const app = new Hono()

app.use('*', cors())

function encodeContentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename)
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '')
    .trim() || 'download'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

function createReadableStreamFromNodeStream(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      stream.on('end', () => controller.close())
      stream.on('error', error => controller.error(error))
    },
    cancel() {
      stream.destroy()
    },
  })
}

app.get('/api/health', c => c.json({
  ok: true,
  proxy: readProxyEnv(),
  flaresolverr: flareSolverrConfig
    ? {
        url: flareSolverrConfig.url,
        ready: flareSolverrReady,
        proxy: flareSolverrConfig.proxyUrl,
      }
    : undefined,
}))

app.get('/api/sources', c => {
  const type = c.req.query('type')
  const parsedType = type === '0' || type === '2' ? Number(type) as 0 | 2 : undefined
  const list = registry.list(parsedType).map(({ id, bookSourceName, bookSourceType, bookSourceGroup, bookSourceUrl, enabledCookieJar }) => ({
    id,
    name: bookSourceName,
    type: bookSourceType,
    group: bookSourceGroup,
    url: bookSourceUrl,
    cookieJar: Boolean(enabledCookieJar),
  }))
  return c.json(list)
})

app.get('/api/search', async (c) => {
  const keyword = c.req.query('q')?.trim()
  if (!keyword)
    return c.json({ error: 'missing q' }, 400)

  const type = c.req.query('type')
  const parsedType = type === '0' || type === '2' ? Number(type) as 0 | 2 : undefined

  try {
    const results = await registry.searchAll(keyword, parsedType)
    return c.json({ keyword, total: results.length, results })
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error) }, 502)
  }
})

app.get('/api/book', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('url')
  const refresh = c.req.query('refresh') === '1'
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  const source = registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  try {
    if (source.bookSourceType === 0 && !refresh) {
      const cached = await novelCache.readBookDetail(sourceId, bookUrl)
      if (cached)
        return c.json(await novelCache.presentBookDetail(cached, sourceId, bookUrl))
    }

    const detail = await bookService.getBookDetail(source, bookUrl)
    if (source.bookSourceType === 0) {
      await novelCache.writeBookDetail(sourceId, bookUrl, detail)
      await novelCache.cacheCover(sourceId, bookUrl, detail.coverUrl)
      return c.json(await novelCache.presentBookDetail(detail, sourceId, bookUrl))
    }
    return c.json(detail)
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
  }
})

app.get('/api/book/open', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('url')
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  const source = registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  try {
    const detail = await bookService.openByUrl(source, bookUrl)
    return c.json(detail)
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
  }
})

app.get('/api/sources/:id/cookies', (c) => {
  const sourceId = c.req.param('id')
  return c.json({
    sourceId,
    cookies: sourceCookies.get(sourceId) ?? '',
    configured: sourceCookies.has(sourceId),
  })
})

app.put('/api/sources/:id/cookies', async (c) => {
  const sourceId = c.req.param('id')
  if (!registry.get(sourceId))
    return c.json({ error: 'source not found' }, 404)

  const body = await c.req.json<{ cookies?: string }>()
  const cookies = await sourceCookies.set(sourceId, body.cookies ?? '')
  return c.json({ sourceId, cookies, configured: Boolean(cookies) })
})

app.get('/api/toc', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('url')
  const refresh = c.req.query('refresh') === '1'
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  const source = registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  try {
    if (source.bookSourceType === 0 && !refresh) {
      const cached = await novelCache.readTocCache(sourceId, bookUrl)
      if (cached?.chapters.length)
        return c.json({ chapters: cached.chapters })
    }

    let tocFetchUrl = bookUrl
    if (source.bookSourceType === 0) {
      const cachedBook = await novelCache.readBookDetail(sourceId, bookUrl)
      if (cachedBook?.tocUrl)
        tocFetchUrl = cachedBook.tocUrl
      else {
        const detail = await bookService.getBookDetail(source, bookUrl)
        tocFetchUrl = detail.tocUrl ?? bookUrl
        if (!cachedBook)
          await novelCache.writeBookDetail(sourceId, bookUrl, detail)
      }
    }

    const chapters = await bookService.getToc(source, tocFetchUrl)
    if (source.bookSourceType === 0)
      await novelCache.writeTocCache(sourceId, bookUrl, chapters, tocFetchUrl)

    return c.json({ chapters })
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
  }
})

app.get('/api/chapter', async (c) => {
  const sourceId = c.req.query('sourceId')
  let chapterUrl = c.req.query('url')
  const bookUrl = c.req.query('bookUrl')
  const tocUrl = c.req.query('tocUrl')
  if (!sourceId || !chapterUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  chapterUrl = fixMgsearcherChapterUrl(chapterUrl, tocUrl, c.req.query('c'), c.req.query('m'))

  const source = registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  if (source.bookSourceType === 2 && bookUrl) {
    const cached = await comicCache.getCachedChapterContent(sourceId, bookUrl, chapterUrl)
    if (cached)
      return c.json({ ...cached, cached: true })
  }

  if (source.bookSourceType === 0 && bookUrl) {
    const cached = await novelCache.readChapterText(sourceId, bookUrl, chapterUrl)
    if (cached)
      return c.json({ text: cached.text, cached: true })
  }

  let content
  try {
    content = await bookService.getChapterContent(source, chapterUrl)
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
  }

  if (source.bookSourceType === 2 && bookUrl && !(await comicCache.hasChapter(sourceId, bookUrl, chapterUrl))) {
    try {
      const detail = await bookService.getBookDetail(source, bookUrl)
      const toc = await bookService.getToc(source, detail.tocUrl ?? bookUrl)
      const chapter = toc.find(ch => ch.url === chapterUrl)
      if (chapter)
        void comicCache.cacheChapter(source, bookUrl, chapter, detail.name).catch(() => {})
    }
    catch {
      // ignore background cache errors
    }
  }

  if (source.bookSourceType === 0 && bookUrl && content.text && !(await novelCache.hasChapter(sourceId, bookUrl, chapterUrl))) {
    try {
      const detail = await bookService.getBookDetail(source, bookUrl)
      const toc = await bookService.getToc(source, detail.tocUrl ?? bookUrl)
      const chapter = toc.find(ch => ch.url === chapterUrl)
      if (chapter)
        void novelCache.writeChapterText(sourceId, bookUrl, chapter, content.text, detail.name).catch(() => {})
    }
    catch {
      // ignore background cache errors
    }
  }

  return c.json(content)
})

function fixMgsearcherChapterUrl(
  chapterUrl: string,
  tocUrl?: string,
  leakedC?: string,
  leakedM?: string,
): string {
  if (!chapterUrl.includes('mgsearcher.com/api/chapter/getinfo'))
    return chapterUrl

  let url = chapterUrl
  const midFromToc = tocUrl?.match(/[?&]mid=(\d+)/)?.[1] ?? leakedM

  if (!url.match(/[?&]c=\d+/) && leakedC)
    url = `${url}${url.includes('?') ? '&' : '?'}c=${leakedC}`

  if (midFromToc) {
    url = url.replace(/([?&])m=&/, `$1m=${midFromToc}&`)
    if (url.endsWith('?m=') || url.endsWith('&m='))
      url = `${url}${midFromToc}`
  }

  return url
}

app.post('/api/download/jobs', async (c) => {
  const body = await c.req.json<{ sourceId?: string, bookUrl?: string, format?: DownloadFormat }>()
  if (!body.sourceId || !body.bookUrl || !body.format)
    return c.json({ error: 'missing sourceId, bookUrl or format' }, 400)
  if (!['epub', 'txt', 'cbz', 'folder'].includes(body.format))
    return c.json({ error: 'invalid format' }, 400)

  const source = registry.get(body.sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  const jobId = downloadJobs.start(onProgress =>
    downloadService.download({
      source,
      bookUrl: body.bookUrl!,
      format: body.format!,
      onProgress,
    }),
  )

  return c.json({ jobId })
})

app.get('/api/download/jobs/:id', (c) => {
  const job = downloadJobs.get(c.req.param('id'))
  if (!job)
    return c.json({ error: 'job not found' }, 404)

  return c.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    filename: job.filename,
    localExport: job.localExport,
    exportDir: job.exportDir,
    exportedFiles: job.exportedFiles,
  })
})

app.get('/api/download/jobs/:id/file', async (c) => {
  const jobId = c.req.param('id')
  const file = await downloadJobs.getFile(jobId)
  if (!file)
    return c.json({ error: 'file not ready' }, 404)

  const response = new Response(createReadableStreamFromNodeStream(createReadStream(file.path)), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': encodeContentDisposition(file.filename),
      'Content-Length': String(file.size),
    },
  })

  void downloadJobs.cleanup(jobId)
  return response
})

app.get('/api/download', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('url')
  const format = c.req.query('format')
  if (!sourceId || !bookUrl || !['epub', 'txt', 'cbz', 'folder'].includes(format ?? ''))
    return c.json({ error: 'missing sourceId, url, or invalid format (epub|txt|cbz|folder)' }, 400)

  const source = registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  const start = c.req.query('start')
  const end = c.req.query('end')

  try {
    const result = await downloadService.download({
      source,
      bookUrl,
      format: format as DownloadFormat,
      start: start === undefined ? undefined : Number(start),
      end: end === undefined ? undefined : Number(end),
    })

    if (result.filePath) {
      const info = await stat(result.filePath)
      return new Response(createReadableStreamFromNodeStream(createReadStream(result.filePath)), {
        headers: {
          'Content-Type': result.mimeType,
          'Content-Disposition': encodeContentDisposition(result.filename),
          'Content-Length': String(info.size),
        },
      })
    }

    if (!result.data)
      return c.json({ error: 'download result empty' }, 500)

    return new Response(Buffer.from(result.data), {
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': encodeContentDisposition(result.filename),
      },
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'download failed'
    return c.json({ error: message }, 500)
  }
})

app.get('/api/cache/config', async (c) => {
  const [comic, novel] = await Promise.all([
    comicCache.getConfig(),
    novelCache.getConfig(),
  ])
  return c.json({ ...comic, ...novel })
})

app.put('/api/cache/config', async (c) => {
  const body = await c.req.json<{ comicDir?: string, novelDir?: string }>()
  if (!body.comicDir?.trim() && !body.novelDir?.trim())
    return c.json({ error: 'missing comicDir or novelDir' }, 400)

  try {
    const result: Record<string, string> = {}
    if (body.comicDir?.trim())
      Object.assign(result, await comicCache.setCacheDir(body.comicDir.trim()))
    if (body.novelDir?.trim())
      Object.assign(result, await novelCache.setCacheDir(body.novelDir.trim()))
    return c.json(result)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'invalid cache dir'
    return c.json({ error: message }, 400)
  }
})

app.get('/api/cache/status', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('bookUrl')
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing sourceId or bookUrl' }, 400)

  const source = registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  const totalChapters = Number(c.req.query('totalChapters') ?? 0)
  if (source.bookSourceType === 0)
    return c.json(await novelCache.getStatus(sourceId, bookUrl, totalChapters))

  return c.json(await comicCache.getStatus(sourceId, bookUrl, totalChapters))
})

app.post('/api/cache/all', async (c) => {
  const body = await c.req.json<{ sourceId?: string, bookUrl?: string }>()
  if (!body.sourceId || !body.bookUrl)
    return c.json({ error: 'missing sourceId or bookUrl' }, 400)

  const source = registry.get(body.sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  const result = source.bookSourceType === 0
    ? novelCache.startCacheAll(source, body.bookUrl)
    : source.bookSourceType === 2
      ? comicCache.startCacheAll(source, body.bookUrl)
      : null
  if (!result)
    return c.json({ error: 'unsupported source type' }, 400)

  return c.json(result)
})

app.post('/api/cache/prefetch', async (c) => {
  const body = await c.req.json<{ sourceId?: string, bookUrl?: string, chapterUrl?: string, count?: number }>()
  if (!body.sourceId || !body.bookUrl || !body.chapterUrl)
    return c.json({ error: 'missing sourceId, bookUrl or chapterUrl' }, 400)

  const source = registry.get(body.sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)
  if (source.bookSourceType !== 2)
    return c.json({ error: 'only comic books can be cached' }, 400)

  const count = Math.min(Math.max(body.count ?? 100, 1), 500)
  const result = comicCache.startPrefetch(source, body.bookUrl, body.chapterUrl, count)
  return c.json(result)
})

app.post('/api/cache/reload-meta', async (c) => {
  const body = await c.req.json<{ sourceId?: string, bookUrl?: string }>()
  if (!body.sourceId || !body.bookUrl)
    return c.json({ error: 'missing sourceId or bookUrl' }, 400)

  const source = registry.get(body.sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)
  if (source.bookSourceType !== 0)
    return c.json({ error: 'only novel books support reload-meta' }, 400)

  try {
    const result = await novelCache.refreshBookMeta(source, body.bookUrl)
    return c.json({ book: result.detail, chapters: result.chapters })
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
  }
})

app.delete('/api/cache', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('bookUrl')
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing sourceId or bookUrl' }, 400)

  await comicCache.clearBook(sourceId, bookUrl)
  await novelCache.clearBook(sourceId, bookUrl)
  return c.json({ ok: true })
})

app.get('/api/cache/novel-cover', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('bookUrl')
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing params' }, 400)

  const cover = await novelCache.readCover(sourceId, bookUrl)
  if (!cover)
    return c.json({ error: 'cover not found' }, 404)

  return new Response(Buffer.from(cover.data), {
    headers: {
      'Content-Type': cover.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})

app.get('/api/cache/image', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('bookUrl')
  const chapterUrl = c.req.query('chapterUrl')
  const page = Number(c.req.query('page') ?? 0)

  if (!sourceId || !bookUrl || !chapterUrl)
    return c.json({ error: 'missing params' }, 400)

  const image = await comicCache.readCachedImage(sourceId, bookUrl, chapterUrl, page)
  if (!image)
    return c.json({ error: 'image not found' }, 404)

  return new Response(Buffer.from(image.data), {
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})

app.get('/api/proxy', async (c) => {
  const url = c.req.query('url')
  if (!url)
    return c.json({ error: 'missing url' }, 400)

  const response = await fetch(url, {
    headers: {
      Referer: new URL(url).origin,
      'User-Agent': 'Mozilla/5.0',
    },
  })

  const buffer = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  return new Response(buffer, {
    headers: { 'Content-Type': contentType },
  })
})

const port = Number(process.env.PORT ?? 8787)
console.log(`[cartoon] loaded ${sources.length} sources from ${remoteDir}`)
console.log(`[cartoon] comic cache dir: ${comicCache.getCacheRoot()}`)
console.log(`[cartoon] novel cache dir: ${novelCache.getCacheRoot()}`)
if (proxyEnv.active) {
  console.log(`[cartoon] outbound proxy: ${proxyEnv.display}`)
  console.log(`[cartoon] ${proxyTroubleshootHint()}`)
}
else
  console.log('[cartoon] outbound proxy: (none)')

if (flareSolverrConfig) {
  console.log(`[cartoon] FlareSolverr: ${flareSolverrConfig.url} · ready=${flareSolverrReady}${flareSolverrConfig.proxyUrl ? ` · proxy=${flareSolverrConfig.proxyUrl}` : ' · proxy=(none)'}`)
  if (!flareSolverrReady)
    console.log('[cartoon] FlareSolverr 不可达，请确认服务已启动且 NO_PROXY 含 localhost,127.0.0.1')
}
else if (sources.some(source => source.enabledCookieJar)) {
  console.log('[cartoon] 检测到 Cloudflare 书源，建议 export FLARESOLVERR_URL=http://127.0.0.1:8191 并启动 FlareSolverr')
}

console.log(`[cartoon] server http://127.0.0.1:${port}`)

serve({ fetch: app.fetch, port })
