import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BookService,
  ComicCacheService,
  DownloadService,
  loadSourcesFromDir,
  SourceRegistry,
  type BinaryFetcher,
  type Fetcher,
} from '@cartoon/core'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '../../..')
const remoteDir = join(rootDir, 'remote')

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

const fetcher: Fetcher = async (url, options = {}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 15000)

  try {
    const response = await fetch(url, {
      headers: { ...defaultHeaders, ...options.headers },
      signal: controller.signal,
    })

    if (!response.ok)
      throw new Error(`HTTP ${response.status} for ${url}`)

    return await response.text()
  }
  finally {
    clearTimeout(timeout)
  }
}

const binaryFetcher: BinaryFetcher = async (url, options = {}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 30000)

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
    clearTimeout(timeout)
  }
}

const sources = await loadSourcesFromDir(remoteDir)
const bookService = new BookService({ fetcher })
const comicCache = new ComicCacheService({ projectRoot: rootDir, bookService, binaryFetcher })
await comicCache.init()
const downloadService = new DownloadService(bookService, binaryFetcher, comicCache)
const registry = new SourceRegistry(sources, bookService)

const app = new Hono()

app.use('*', cors())

function encodeContentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`
}

app.get('/api/health', c => c.json({ ok: true }))

app.get('/api/sources', c => {
  const type = c.req.query('type')
  const parsedType = type === '0' || type === '2' ? Number(type) as 0 | 2 : undefined
  const list = registry.list(parsedType).map(({ id, bookSourceName, bookSourceType, bookSourceGroup, bookSourceUrl }) => ({
    id,
    name: bookSourceName,
    type: bookSourceType,
    group: bookSourceGroup,
    url: bookSourceUrl,
  }))
  return c.json(list)
})

app.get('/api/search', async (c) => {
  const keyword = c.req.query('q')?.trim()
  if (!keyword)
    return c.json({ error: 'missing q' }, 400)

  const type = c.req.query('type')
  const parsedType = type === '0' || type === '2' ? Number(type) as 0 | 2 : undefined
  const results = await registry.searchAll(keyword, parsedType)
  return c.json({ keyword, total: results.length, results })
})

app.get('/api/book', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('url')
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  const source = registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  const detail = await bookService.getBookDetail(source, bookUrl)
  return c.json(detail)
})

app.get('/api/toc', async (c) => {
  const sourceId = c.req.query('sourceId')
  const tocUrl = c.req.query('url')
  if (!sourceId || !tocUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  const source = registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  const chapters = await bookService.getToc(source, tocUrl)
  return c.json({ chapters })
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

  const content = await bookService.getChapterContent(source, chapterUrl)

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
      format,
      start: start === undefined ? undefined : Number(start),
      end: end === undefined ? undefined : Number(end),
    })

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
  return c.json(await comicCache.getConfig())
})

app.put('/api/cache/config', async (c) => {
  const body = await c.req.json<{ comicDir?: string }>()
  if (!body.comicDir?.trim())
    return c.json({ error: 'missing comicDir' }, 400)

  try {
    return c.json(await comicCache.setCacheDir(body.comicDir.trim()))
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

  const totalChapters = Number(c.req.query('totalChapters') ?? 0)
  return c.json(await comicCache.getStatus(sourceId, bookUrl, totalChapters))
})

app.post('/api/cache/all', async (c) => {
  const body = await c.req.json<{ sourceId?: string, bookUrl?: string }>()
  if (!body.sourceId || !body.bookUrl)
    return c.json({ error: 'missing sourceId or bookUrl' }, 400)

  const source = registry.get(body.sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)
  if (source.bookSourceType !== 2)
    return c.json({ error: 'only comic books can be cached' }, 400)

  const result = comicCache.startCacheAll(source, body.bookUrl)
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

app.delete('/api/cache', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('bookUrl')
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing sourceId or bookUrl' }, 400)

  await comicCache.clearBook(sourceId, bookUrl)
  return c.json({ ok: true })
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
console.log(`[cartoon] server http://127.0.0.1:${port}`)

serve({ fetch: app.fetch, port })
