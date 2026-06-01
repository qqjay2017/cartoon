import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BookService,
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
const downloadService = new DownloadService(bookService, binaryFetcher)
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
  const chapterUrl = c.req.query('url')
  if (!sourceId || !chapterUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  const source = registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  const content = await bookService.getChapterContent(source, chapterUrl)
  return c.json(content)
})

app.get('/api/download', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('url')
  const format = c.req.query('format')
  if (!sourceId || !bookUrl || (format !== 'epub' && format !== 'cbz'))
    return c.json({ error: 'missing sourceId, url, or invalid format (epub|cbz)' }, 400)

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
console.log(`[cartoon] server http://127.0.0.1:${port}`)

serve({ fetch: app.fetch, port })
