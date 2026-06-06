import { createReadStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import {
  bookIdFromUrl,
  bookshelfId,
  chapterIdFromUrl,
  buildCbzExport,
  type BookDetail,
  type BookSource,
  type DownloadFormat,
} from '@cartoon/core'
import {
  addBookshelfItem,
  getBookMeta,
  getBookshelfItem,
  getChapterList,
  getSourceById,
  getSourceCookies,
  listBookshelf,
  createSourceRecord,
  getSourceRecord,
  isSourceIdTaken,
  isSourceNameTaken,
  listSourceRecords,
  listSources,
  removeBookshelfItem,
  updateSourceRecord,
  replaceChapterList,
  setSourceEnabled,
  setTocCachedAt,
  upsertBookMeta,
  upsertChapterContentRecord,
  updateBookshelfProgress,
  getDb,
  listDownloadTasks,
  upsertDownloadTasks,
  updateDownloadTaskStatus,
  pauseActiveTasks,
  resumePausedTasks,
  retryFailedTasks,
  markRunningTasksAsPending,
  clearDownloadTasks,
  type DownloadTaskStatus,
} from '@cartoon/db'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createReadStream as ctxReadStream, getAppContext, reloadRegistry, persistSourceCookies, rootDir } from './context.js'

const app = new Hono()

app.use('*', cors())

function formatSourceFetchError(error: unknown, sourceName?: string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('403'))
    return `${sourceName ?? '书源'} 返回 403，请检查代理或站点限制`
  return message
}

function encodeContentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename)
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '').trim() || 'download'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

function streamFromNode(stream: Readable): ReadableStream<Uint8Array> {
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

async function resolveBookshelfContext(bookshelfIdParam: string) {
  const { db } = getDb()
  const item = await getBookshelfItem(db, bookshelfIdParam)
  if (!item)
    return null
  const source = await getSourceById(db, item.sourceId)
  if (!source)
    return null
  const app = await getAppContext()
  return { item, source, app, db }
}

async function presentBookshelfBookDetail(
  ctx: NonNullable<Awaited<ReturnType<typeof resolveBookshelfContext>>>,
  detail: BookDetail,
): Promise<BookDetail> {
  const coverUrl = await ctx.app.bookshelfCache.resolveCoverUrl(
    ctx.item.id,
    detail.coverUrl ?? ctx.item.coverUrl ?? undefined,
  )
  if (!coverUrl)
    return detail
  return { ...detail, coverUrl }
}

app.get('/api/health', async (c) => {
  const app = await getAppContext()
  return c.json({ ok: true, proxy: app.proxyEnv })
})

app.get('/api/sources', async (c) => {
  const { db } = getDb()
  const type = c.req.query('type')
  const parsedType = type === '0' || type === '2' ? Number(type) as 0 | 2 : undefined
  return c.json(await listSources(db, parsedType))
})

const SOURCE_ID_RE = /^[a-z][a-z0-9-]*$/i

function validateSourceId(id: string): string | null {
  const trimmed = id.trim()
  if (!trimmed)
    return '书源 ID 不能为空'
  if (!SOURCE_ID_RE.test(trimmed))
    return '书源 ID 仅允许字母、数字和连字符，且以字母开头'
  return null
}

app.get('/api/sources/manage', async (c) => {
  const { db } = getDb()
  const rows = await listSourceRecords(db)
  return c.json(rows.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    url: row.config.bookSourceUrl,
    updatedAt: row.updatedAt.toISOString(),
  })))
})

app.get('/api/sources/:id/full', async (c) => {
  const { db } = getDb()
  const id = c.req.param('id')
  const row = await getSourceRecord(db, id)
  if (!row)
    return c.json({ error: 'source not found' }, 404)
  return c.json({
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    config: row.config,
    updatedAt: row.updatedAt.toISOString(),
  })
})

app.post('/api/sources', async (c) => {
  const { db } = getDb()
  const body = await c.req.json<{
    id?: string
    name?: string
    config?: BookSource
    enabled?: boolean
  }>()

  const id = body.id?.trim() ?? ''
  const name = body.name?.trim() ?? ''
  const idErr = validateSourceId(id)
  if (idErr)
    return c.json({ error: idErr }, 400)
  if (!name)
    return c.json({ error: '书源名称不能为空' }, 400)
  if (!body.config?.bookSourceUrl)
    return c.json({ error: '配置 JSON 缺少 bookSourceUrl' }, 400)

  if (await isSourceIdTaken(db, id))
    return c.json({ error: `书源 ID「${id}」已存在` }, 409)
  if (await isSourceNameTaken(db, name))
    return c.json({ error: `书源名称「${name}」已存在` }, 409)

  try {
    await createSourceRecord(db, { id, name, config: body.config, enabled: body.enabled })
    await reloadRegistry()
    return c.json({ ok: true, id })
  }
  catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'create failed' }, 500)
  }
})

app.put('/api/sources/:id', async (c) => {
  const { db } = getDb()
  const id = c.req.param('id')
  const body = await c.req.json<{
    name?: string
    config?: BookSource
    enabled?: boolean
  }>()

  const existing = await getSourceRecord(db, id)
  if (!existing)
    return c.json({ error: 'source not found' }, 404)

  const name = body.name?.trim()
  if (name !== undefined) {
    if (!name)
      return c.json({ error: '书源名称不能为空' }, 400)
    if (await isSourceNameTaken(db, name, id))
      return c.json({ error: `书源名称「${name}」已存在` }, 409)
  }

  if (body.config && !body.config.bookSourceUrl)
    return c.json({ error: '配置 JSON 缺少 bookSourceUrl' }, 400)

  try {
    await updateSourceRecord(db, id, {
      name,
      config: body.config,
      enabled: body.enabled,
    })
    await reloadRegistry()
    const row = await getSourceRecord(db, id)
    return c.json({ ok: true, source: row })
  }
  catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'update failed' }, 500)
  }
})

app.patch('/api/sources/:id', async (c) => {
  const { db } = getDb()
  const id = c.req.param('id')
  const body = await c.req.json<{ enabled?: boolean }>()
  if (body.enabled === undefined)
    return c.json({ error: 'missing enabled' }, 400)
  const source = await getSourceById(db, id)
  if (!source)
    return c.json({ error: 'source not found' }, 404)
  await setSourceEnabled(db, id, body.enabled)
  await reloadRegistry()
  return c.json({ ok: true, id, enabled: body.enabled })
})

app.get('/api/sources/:id/cookies', async (c) => {
  const { db } = getDb()
  const sourceId = c.req.param('id')
  const cookies = await getSourceCookies(db, sourceId)
  return c.json({ sourceId, cookies, configured: Boolean(cookies) })
})

app.put('/api/sources/:id/cookies', async (c) => {
  const sourceId = c.req.param('id')
  const app = await getAppContext()
  if (!app.registry.get(sourceId))
    return c.json({ error: 'source not found' }, 404)
  const body = await c.req.json<{ cookies?: string }>()
  await persistSourceCookies(sourceId, body.cookies ?? '')
  const cookies = body.cookies ?? ''
  return c.json({ sourceId, cookies, configured: Boolean(cookies) })
})

app.get('/api/bookshelf', async (c) => {
  const { db } = getDb()
  const items = await listBookshelf(db)
  const app = await getAppContext()
  return c.json(await Promise.all(items.map(async (item) => ({
    id: item.id,
    sourceId: item.sourceId,
    sourceName: app.registry.get(item.sourceId)?.bookSourceName ?? item.sourceId,
    sourceType: app.registry.get(item.sourceId)?.bookSourceType ?? 0,
    name: item.name,
    author: item.author ?? undefined,
    coverUrl: await app.bookshelfCache.resolveCoverUrl(item.id, item.coverUrl ?? undefined),
    bookUrl: item.bookUrl,
    lastReadChapterId: item.lastReadChapterId ?? undefined,
    lastReadChapterName: item.lastReadChapterName ?? undefined,
    addedAt: item.addedAt,
  }))))
})

app.post('/api/bookshelf', async (c) => {
  const body = await c.req.json<{
    sourceId?: string
    bookUrl?: string
    name?: string
    author?: string
    coverUrl?: string
  }>()
  if (!body.sourceId || !body.bookUrl || !body.name)
    return c.json({ error: 'missing sourceId, bookUrl or name' }, 400)

  const { db } = getDb()
  const source = await getSourceById(db, body.sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  const bookId = bookIdFromUrl(body.bookUrl, source.bookUrlPattern)
  const id = bookshelfId(source.id, bookId)

  await addBookshelfItem(db, {
    id,
    sourceId: source.id,
    bookId,
    bookUrl: body.bookUrl,
    name: body.name,
    author: body.author,
    coverUrl: body.coverUrl,
    addedAt: Date.now(),
  })

  const app = await getAppContext()
  void app.bookshelfCache.cacheCover(id, body.coverUrl)

  return c.json({ id, sourceId: source.id, bookId })
})

app.delete('/api/bookshelf/:id', async (c) => {
  const { db } = getDb()
  const id = c.req.param('id')
  await removeBookshelfItem(db, id)
  const app = await getAppContext()
  await app.bookshelfCache.clearBook(id)
  return c.json({ ok: true })
})

app.patch('/api/bookshelf/:id/progress', async (c) => {
  const { db } = getDb()
  const id = c.req.param('id')
  const body = await c.req.json<{ chapterId?: string, chapterName?: string }>()
  if (!body.chapterId || !body.chapterName)
    return c.json({ error: 'missing chapterId or chapterName' }, 400)
  await updateBookshelfProgress(db, id, body.chapterId, body.chapterName)
  return c.json({ ok: true })
})

app.get('/api/search', async (c) => {
  const keyword = c.req.query('q')?.trim()
  if (!keyword)
    return c.json({ error: 'missing q' }, 400)
  const type = c.req.query('type')
  const parsedType = type === '0' || type === '2' ? Number(type) as 0 | 2 : undefined
  const app = await getAppContext()
  try {
    const results = await app.registry.searchAll(keyword, parsedType)
    return c.json({ keyword, total: results.length, results })
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error) }, 502)
  }
})

app.get('/api/book', async (c) => {
  const bookshelfIdParam = c.req.query('bookshelfId')
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('url')
  const refresh = c.req.query('refresh') === '1'

  if (bookshelfIdParam) {
    const ctx = await resolveBookshelfContext(bookshelfIdParam)
    if (!ctx)
      return c.json({ error: 'bookshelf item not found' }, 404)
    const { item, source, app, db } = ctx

    if (!refresh) {
      const meta = await getBookMeta(db, item.id)
      if (meta?.detail) {
        const detail = meta.detail as BookDetail
        return c.json(await presentBookshelfBookDetail(ctx, detail))
      }
    }

    try {
      const detail = await app.bookService.getBookDetail(source, item.bookUrl)
      await upsertBookMeta(db, item.id, detail)
      if (detail.coverUrl)
        void app.bookshelfCache.cacheCover(item.id, detail.coverUrl)
      return c.json(await presentBookshelfBookDetail(ctx, detail))
    }
    catch (error) {
      return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
    }
  }

  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  const app = await getAppContext()
  const source = app.registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  try {
    const detail = await app.bookService.getBookDetail(source, bookUrl)
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

  const app = await getAppContext()
  const source = app.registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  try {
    return c.json(await app.bookService.openByUrl(source, bookUrl))
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
  }
})

app.get('/api/toc', async (c) => {
  const bookshelfIdParam = c.req.query('bookshelfId')
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('url')
  const refresh = c.req.query('refresh') === '1'

  if (bookshelfIdParam) {
    const ctx = await resolveBookshelfContext(bookshelfIdParam)
    if (!ctx)
      return c.json({ error: 'bookshelf item not found' }, 404)
    const { item, source, app, db } = ctx

    if (!refresh) {
      const cached = await getChapterList(db, item.id)
      if (cached.length)
        return c.json({ chapters: cached })
    }

    try {
      let tocFetchUrl = item.bookUrl
      const meta = await getBookMeta(db, item.id)
      const detail = (meta?.detail as BookDetail | undefined) ?? await app.bookService.getBookDetail(source, item.bookUrl)
      tocFetchUrl = detail.tocUrl ?? item.bookUrl
      const raw = await app.bookService.getToc(source, tocFetchUrl)
      const chapters = app.bookshelfCache.enrichToc(raw)
      await replaceChapterList(db, item.id, chapters)
      await setTocCachedAt(db, item.id, new Date())
      if (!meta)
        await upsertBookMeta(db, item.id, detail)
      return c.json({ chapters })
    }
    catch (error) {
      return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
    }
  }

  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  const app = await getAppContext()
  const source = app.registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  try {
    const detail = await app.bookService.getBookDetail(source, bookUrl)
    const chapters = await app.bookService.getToc(source, detail.tocUrl ?? bookUrl)
    return c.json({ chapters: app.bookshelfCache.enrichToc(chapters) })
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
  }
})

app.get('/api/chapter', async (c) => {
  const bookshelfIdParam = c.req.query('bookshelfId')
  let chapterUrl = c.req.query('url')
  const chapterIdParam = c.req.query('chapterId')
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('bookUrl')
  const tocUrl = c.req.query('tocUrl')

  if (bookshelfIdParam) {
    const ctx = await resolveBookshelfContext(bookshelfIdParam)
    if (!ctx)
      return c.json({ error: 'bookshelf item not found' }, 404)
    const { item, source, app, db } = ctx

    if (!chapterUrl && chapterIdParam) {
      const list = await getChapterList(db, item.id)
      const ch = list.find(x => x.id === chapterIdParam)
      if (ch)
        chapterUrl = ch.url
    }
    if (!chapterUrl)
      return c.json({ error: 'missing url or chapterId' }, 400)

    const chId = chapterIdParam ?? chapterIdFromUrl(chapterUrl)

    if (source.bookSourceType === 0) {
      const cached = await app.bookshelfCache.readChapterText(item.id, chId)
      if (cached)
        return c.json({ text: cached.text, cached: true })
    }

    if (source.bookSourceType === 2) {
      const cached = await app.comicCache.getCachedChapterContent(source.id, item.bookUrl, chapterUrl)
      if (cached)
        return c.json({ ...cached, cached: true })
    }

    try {
      const content = await app.bookService.getChapterContent(source, chapterUrl)
      if (source.bookSourceType === 0 && content.text) {
        const list = await getChapterList(db, item.id)
        const chapter = list.find(ch => ch.id === chId || ch.url === chapterUrl)
        if (chapter) {
          const filePath = await app.bookshelfCache.writeChapterText(item.id, chId, chapter, content.text)
          await upsertChapterContentRecord(db, item.id, chId, filePath)
        }
      }
      return c.json(content)
    }
    catch (error) {
      return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
    }
  }

  if (!sourceId || !chapterUrl)
    return c.json({ error: 'missing sourceId or url' }, 400)

  chapterUrl = fixMgsearcherChapterUrl(chapterUrl, tocUrl, c.req.query('c'), c.req.query('m'))

  const app = await getAppContext()
  const source = app.registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  try {
    return c.json(await app.bookService.getChapterContent(source, chapterUrl))
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, source.bookSourceName) }, 502)
  }
})

function fixMgsearcherChapterUrl(chapterUrl: string, tocUrl?: string, leakedC?: string, leakedM?: string): string {
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
  const body = await c.req.json<{
    sourceId?: string
    bookUrl?: string
    bookshelfId?: string
    format?: DownloadFormat
    start?: number
    end?: number
  }>()
  if (!body.sourceId || !body.bookUrl || !body.format)
    return c.json({ error: 'missing fields' }, 400)

  const app = await getAppContext()
  const source = app.registry.get(body.sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  let shelfChapters: Awaited<ReturnType<typeof getChapterList>> | undefined
  let exportBookUrl = body.bookUrl!
  if (body.bookshelfId) {
    const ctx = await resolveBookshelfContext(body.bookshelfId)
    if (ctx) {
      shelfChapters = await getChapterList(ctx.db, body.bookshelfId)
      exportBookUrl = ctx.item.bookUrl
    }
  }

  const jobId = app.downloadJobs.start(onProgress =>
    app.downloadService.download({
      source,
      bookUrl: exportBookUrl,
      format: body.format!,
      start: body.start,
      end: body.end,
      bookshelfId: body.bookshelfId,
      chapters: shelfChapters,
      onProgress,
    }),
  )
  return c.json({ jobId })
})

app.get('/api/download/jobs/:id', async (c) => {
  const app = await getAppContext()
  const job = app.downloadJobs.get(c.req.param('id'))
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
  const app = await getAppContext()
  const jobId = c.req.param('id')
  const file = await app.downloadJobs.getFile(jobId)
  if (!file)
    return c.json({ error: 'file not ready' }, 404)

  const response = new Response(streamFromNode(ctxReadStream(file.path)), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': encodeContentDisposition(file.filename),
      'Content-Length': String(file.size),
    },
  })
  void app.downloadJobs.cleanup(jobId)
  return response
})

app.get('/api/download', async (c) => {
  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('url')
  const format = c.req.query('format')
  if (!sourceId || !bookUrl || !['epub', 'txt', 'cbz', 'folder'].includes(format ?? ''))
    return c.json({ error: 'invalid params' }, 400)

  const app = await getAppContext()
  const source = app.registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)

  try {
    const result = await app.downloadService.download({
      source,
      bookUrl,
      format: format as DownloadFormat,
      start: c.req.query('start') === undefined ? undefined : Number(c.req.query('start')),
      end: c.req.query('end') === undefined ? undefined : Number(c.req.query('end')),
    })

    if (result.filePath) {
      const info = await stat(result.filePath)
      return new Response(streamFromNode(ctxReadStream(result.filePath)), {
        headers: {
          'Content-Type': result.mimeType,
          'Content-Disposition': encodeContentDisposition(result.filename),
          'Content-Length': String(info.size),
        },
      })
    }

    if (!result.data)
      return c.json({ error: 'empty result' }, 500)

    return new Response(Buffer.from(result.data), {
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': encodeContentDisposition(result.filename),
      },
    })
  }
  catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'download failed' }, 500)
  }
})

app.get('/api/cache/config', async (c) => {
  const app = await getAppContext()
  const comic = await app.comicCache.getConfig()
  return c.json({ ...comic, contentDir: app.bookshelfCache.getContentRoot() })
})

app.put('/api/cache/config', async (c) => {
  const body = await c.req.json<{ comicDir?: string }>()
  if (!body.comicDir?.trim())
    return c.json({ error: 'missing comicDir' }, 400)
  const app = await getAppContext()
  return c.json(await app.comicCache.setCacheDir(body.comicDir.trim()))
})

app.get('/api/cache/status', async (c) => {
  const bookshelfIdParam = c.req.query('bookshelfId')
  const totalChapters = Number(c.req.query('totalChapters') ?? 0)

  if (bookshelfIdParam) {
    const ctx = await resolveBookshelfContext(bookshelfIdParam)
    if (!ctx)
      return c.json({ error: 'not found' }, 404)
    if (ctx.source.bookSourceType === 2)
      return c.json(await ctx.app.comicCache.getStatus(ctx.source.id, ctx.item.bookUrl, totalChapters))
    const chapters = await getChapterList(ctx.db, bookshelfIdParam)
    const cached = await ctx.app.bookshelfCache.countCachedChapters(bookshelfIdParam, chapters)
    return c.json(ctx.app.bookshelfCache.getStatus(bookshelfIdParam, totalChapters, cached))
  }

  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('bookUrl')
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing bookshelfId or sourceId+bookUrl' }, 400)

  const app = await getAppContext()
  const source = app.registry.get(sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)
  return c.json(await app.comicCache.getStatus(sourceId, bookUrl, totalChapters))
})

app.get('/api/cache/chapters', async (c) => {
  const bookshelfIdParam = c.req.query('bookshelfId')
  if (!bookshelfIdParam)
    return c.json({ error: 'missing bookshelfId' }, 400)

  const ctx = await resolveBookshelfContext(bookshelfIdParam)
  if (!ctx)
    return c.json({ error: 'not found' }, 404)

  if (ctx.source.bookSourceType === 2) {
    const cachedChapterIds = await ctx.app.comicCache.listCachedChapterKeys(
      ctx.source.id,
      ctx.item.bookUrl,
    )
    return c.json({ cachedChapterIds })
  }

  const cachedChapterIds = await ctx.app.bookshelfCache.listCachedChapterIds(
    bookshelfIdParam,
    await getChapterList(ctx.db, bookshelfIdParam),
  )
  return c.json({ cachedChapterIds })
})

app.post('/api/cache/chapter', async (c) => {
  const body = await c.req.json<{ bookshelfId?: string, chapterId?: string, force?: boolean }>()
  if (!body.bookshelfId || !body.chapterId)
    return c.json({ error: 'missing bookshelfId or chapterId' }, 400)

  const force = Boolean(body.force)

  const ctx = await resolveBookshelfContext(body.bookshelfId)
  if (!ctx)
    return c.json({ error: 'not found' }, 404)

  const list = await getChapterList(ctx.db, ctx.item.id)
  const chapter = list.find(ch => ch.id === body.chapterId)
  if (!chapter)
    return c.json({ error: 'chapter not found' }, 404)

  try {
    if (ctx.source.bookSourceType === 2) {
      const alreadyCached = await ctx.app.comicCache.hasChapter(
        ctx.source.id,
        ctx.item.bookUrl,
        chapter.url,
      )
      const ok = await ctx.app.comicCache.cacheChapter(
        ctx.source,
        ctx.item.bookUrl,
        chapter,
        ctx.item.name,
        { force },
      )
      if (!ok)
        return c.json({ error: '章节无图片或缓存失败' }, 502)
      return c.json({ ok: true, alreadyCached: alreadyCached && !force, refreshed: alreadyCached && force })
    }

    if (ctx.source.bookSourceType === 0) {
      const chapterId = chapter.id!
      const alreadyCached = await ctx.app.bookshelfCache.hasChapter(ctx.item.id, chapterId)
      const result = await ctx.app.bookshelfCache.cacheChapter(ctx.source, ctx.item.id, chapter, { force })
      if (!result.ok)
        return c.json({ error: '章节无正文或缓存失败' }, 502)
      if (result.filePath)
        await upsertChapterContentRecord(ctx.db, ctx.item.id, chapterId, result.filePath)
      return c.json({
        ok: true,
        alreadyCached: alreadyCached && !force,
        refreshed: result.refreshed || (alreadyCached && force),
      })
    }

    return c.json({ error: 'unsupported source type' }, 400)
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, ctx.source.bookSourceName) }, 502)
  }
})

app.post('/api/cache/all', async (c) => {
  const body = await c.req.json<{ bookshelfId?: string, sourceId?: string, bookUrl?: string }>()
  const app = await getAppContext()

  if (body.bookshelfId) {
    const ctx = await resolveBookshelfContext(body.bookshelfId)
    if (!ctx)
      return c.json({ error: 'not found' }, 404)
    const chapters = await getChapterList(ctx.db, ctx.item.id)
    if (!chapters.length)
      return c.json({ error: 'toc empty, open book first' }, 400)

    const bookshelfIdParam = body.bookshelfId

    if (ctx.source.bookSourceType === 2) {
      // Comic: create per-chapter download tasks
      const cachedKeys = new Set(await ctx.app.comicCache.listCachedChapterKeys(ctx.source.id, ctx.item.bookUrl))
      const tasks = chapters.map((ch, i) => {
        const key = ctx.app.comicCache.chapterKey(ch.url)
        const status: DownloadTaskStatus = cachedKeys.has(key) ? 'completed' : 'pending'
        return {
          id: `${bookshelfIdParam}::${ch.id ?? ch.url}`,
          bookshelfId: bookshelfIdParam,
          chapterId: ch.id ?? ch.url,
          chapterName: ch.name,
          chapterUrl: ch.url,
          sortIndex: i,
          status,
        }
      })
      await upsertDownloadTasks(ctx.db, tasks)

      const onChapterDone = async (chapter: { id?: string, url: string }, ok: boolean, error?: string) => {
        const taskId = `${bookshelfIdParam}::${chapter.id ?? chapter.url}`
        await updateDownloadTaskStatus(ctx.db, taskId, ok ? 'completed' : 'failed', error)
      }

      const result = ctx.app.comicCache.startCacheAll(
        ctx.source,
        ctx.item.bookUrl,
        chapters,
        ctx.item.name,
        onChapterDone,
      )
      return c.json(result)
    }

    if (ctx.source.bookSourceType === 0) {
      // Novel: create per-chapter download tasks
      const cachedIds = new Set(await ctx.app.bookshelfCache.listCachedChapterIds(bookshelfIdParam, chapters))
      const tasks = chapters.map((ch, i) => {
        const status: DownloadTaskStatus = ch.id && cachedIds.has(ch.id) ? 'completed' : 'pending'
        return {
          id: `${bookshelfIdParam}::${ch.id ?? ch.url}`,
          bookshelfId: bookshelfIdParam,
          chapterId: ch.id ?? ch.url,
          chapterName: ch.name,
          chapterUrl: ch.url,
          sortIndex: i,
          status,
        }
      })
      await upsertDownloadTasks(ctx.db, tasks)

      const result = ctx.app.bookshelfCache.startCacheAll(
        ctx.source,
        ctx.item.id,
        ctx.item.bookUrl,
        chapters,
        ctx.item.name,
        async (chapterId, filePath) => {
          await upsertChapterContentRecord(ctx.db, ctx.item.id, chapterId, filePath)
        },
        async (chapter, ok, error) => {
          const taskId = `${bookshelfIdParam}::${chapter.id ?? chapter.url}`
          await updateDownloadTaskStatus(ctx.db, taskId, ok ? 'completed' : 'failed', error)
        },
      )
      return c.json(result)
    }

    return c.json({ error: 'unsupported source type' }, 400)
  }

  if (!body.sourceId || !body.bookUrl)
    return c.json({ error: 'missing bookshelfId or sourceId+bookUrl' }, 400)

  const source = app.registry.get(body.sourceId)
  if (!source)
    return c.json({ error: 'source not found' }, 404)
  if (source.bookSourceType === 2)
    return c.json(app.comicCache.startCacheAll(source, body.bookUrl))

  return c.json({ error: 'novel cache requires bookshelfId' }, 400)
})

app.post('/api/cache/prefetch', async (c) => {
  const body = await c.req.json<{ sourceId?: string, bookUrl?: string, chapterUrl?: string, count?: number }>()
  if (!body.sourceId || !body.bookUrl || !body.chapterUrl)
    return c.json({ error: 'missing fields' }, 400)
  const app = await getAppContext()
  const source = app.registry.get(body.sourceId)
  if (!source || source.bookSourceType !== 2)
    return c.json({ error: 'comic only' }, 400)
  const count = Math.min(Math.max(body.count ?? 100, 1), 500)
  return c.json(app.comicCache.startPrefetch(source, body.bookUrl, body.chapterUrl, count))
})

app.post('/api/cache/reload-meta', async (c) => {
  const body = await c.req.json<{ bookshelfId?: string }>()
  if (!body.bookshelfId)
    return c.json({ error: 'missing bookshelfId' }, 400)

  const ctx = await resolveBookshelfContext(body.bookshelfId)
  if (!ctx)
    return c.json({ error: 'not found' }, 404)

  try {
    const detail = await ctx.app.bookService.getBookDetail(ctx.source, ctx.item.bookUrl)
    const tocUrl = detail.tocUrl ?? ctx.item.bookUrl
    const raw = await ctx.app.bookService.getToc(ctx.source, tocUrl)
    const chapters = ctx.app.bookshelfCache.enrichToc(raw)
    await upsertBookMeta(ctx.db, ctx.item.id, detail)
    await replaceChapterList(ctx.db, ctx.item.id, chapters)
    await setTocCachedAt(ctx.db, ctx.item.id, new Date())
    if (detail.coverUrl)
      await ctx.app.bookshelfCache.cacheCover(ctx.item.id, detail.coverUrl)
    return c.json({
      book: await presentBookshelfBookDetail(ctx, detail),
      chapters,
    })
  }
  catch (error) {
    return c.json({ error: formatSourceFetchError(error, ctx.source.bookSourceName) }, 502)
  }
})

app.delete('/api/cache', async (c) => {
  const bookshelfIdParam = c.req.query('bookshelfId')
  const app = await getAppContext()

  if (bookshelfIdParam) {
    const ctx = await resolveBookshelfContext(bookshelfIdParam)
    if (!ctx)
      return c.json({ error: 'not found' }, 404)
    if (ctx.source.bookSourceType === 2)
      await app.comicCache.clearBook(ctx.source.id, ctx.item.bookUrl)
    else
      await app.bookshelfCache.clearBook(bookshelfIdParam)
    await clearDownloadTasks(ctx.db, bookshelfIdParam)
    return c.json({ ok: true })
  }

  const sourceId = c.req.query('sourceId')
  const bookUrl = c.req.query('bookUrl')
  if (!sourceId || !bookUrl)
    return c.json({ error: 'missing params' }, 400)
  await app.comicCache.clearBook(sourceId, bookUrl)
  return c.json({ ok: true })
})

app.get('/api/cache/novel-cover', async (c) => {
  const bookshelfIdParam = c.req.query('bookshelfId')
  if (!bookshelfIdParam)
    return c.json({ error: 'missing bookshelfId' }, 400)

  const app = await getAppContext()
  let cover = await app.bookshelfCache.readCover(bookshelfIdParam)
  if (!cover) {
    const ctx = await resolveBookshelfContext(bookshelfIdParam)
    if (ctx?.item.coverUrl) {
      await app.bookshelfCache.cacheCover(bookshelfIdParam, ctx.item.coverUrl)
      cover = await app.bookshelfCache.readCover(bookshelfIdParam)
    }
  }
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

  const app = await getAppContext()
  const image = await app.comicCache.readCachedImage(sourceId, bookUrl, chapterUrl, page)
  if (!image)
    return c.json({ error: 'not found' }, 404)

  return new Response(Buffer.from(image.data), {
    headers: { 'Content-Type': image.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
  })
})

app.get('/api/proxy', async (c) => {
  const url = c.req.query('url')
  if (!url)
    return c.json({ error: 'missing url' }, 400)
  const response = await fetch(url, { headers: { Referer: new URL(url).origin, 'User-Agent': defaultHeaders['User-Agent'] } })
  const buffer = await response.arrayBuffer()
  return new Response(buffer, { headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream' } })
})

// ─── Download Center ──────────────────────────────────────────────────────────

app.get('/api/download-center/tasks', async (c) => {
  const bookshelfIdParam = c.req.query('bookshelfId')
  if (!bookshelfIdParam)
    return c.json({ error: 'missing bookshelfId' }, 400)

  const { db } = getDb()
  const tasks = await listDownloadTasks(db, bookshelfIdParam)

  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    running: tasks.filter(t => t.status === 'running').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
    paused: tasks.filter(t => t.status === 'paused').length,
  }

  return c.json({ tasks, stats })
})

app.post('/api/download-center/pause', async (c) => {
  const body = await c.req.json<{ bookshelfId?: string }>()
  if (!body.bookshelfId)
    return c.json({ error: 'missing bookshelfId' }, 400)

  const ctx = await resolveBookshelfContext(body.bookshelfId)
  if (!ctx)
    return c.json({ error: 'not found' }, 404)

  // Cancel the running cache job
  if (ctx.source.bookSourceType === 2)
    ctx.app.comicCache.cancelCacheJob(ctx.source.id, ctx.item.bookUrl)
  else
    ctx.app.bookshelfCache.cancelCacheJob(body.bookshelfId)

  // Mark DB tasks
  await pauseActiveTasks(ctx.db, body.bookshelfId)
  return c.json({ ok: true })
})

app.post('/api/download-center/resume', async (c) => {
  const body = await c.req.json<{ bookshelfId?: string }>()
  if (!body.bookshelfId)
    return c.json({ error: 'missing bookshelfId' }, 400)

  const ctx = await resolveBookshelfContext(body.bookshelfId)
  if (!ctx)
    return c.json({ error: 'not found' }, 404)

  // Reset paused tasks to pending
  await resumePausedTasks(ctx.db, body.bookshelfId)

  // Get the pending chapters and restart
  const allChapters = await getChapterList(ctx.db, body.bookshelfId)
  const pendingTasks = await listDownloadTasks(ctx.db, body.bookshelfId)
  const pendingIds = new Set(pendingTasks.filter(t => t.status === 'pending').map(t => t.chapterId))
  const pendingChapters = allChapters.filter(ch => pendingIds.has(ch.id ?? ch.url))

  if (!pendingChapters.length)
    return c.json({ ok: true, started: false, message: '没有待处理章节' })

  if (ctx.source.bookSourceType === 2) {
    const onChapterDone = async (chapter: { id?: string, url: string }, ok: boolean, error?: string) => {
      const taskId = `${body.bookshelfId}::${chapter.id ?? chapter.url}`
      await updateDownloadTaskStatus(ctx.db, taskId, ok ? 'completed' : 'failed', error)
    }
    const result = ctx.app.comicCache.startCacheAll(ctx.source, ctx.item.bookUrl, pendingChapters, ctx.item.name, onChapterDone)
    return c.json({ ok: true, ...result })
  }

  if (ctx.source.bookSourceType === 0) {
    const result = ctx.app.bookshelfCache.startCacheAll(
      ctx.source,
      ctx.item.id,
      ctx.item.bookUrl,
      pendingChapters,
      ctx.item.name,
      async (chapterId, filePath) => {
        await upsertChapterContentRecord(ctx.db, ctx.item.id, chapterId, filePath)
      },
      async (chapter, ok, error) => {
        const taskId = `${body.bookshelfId}::${chapter.id ?? chapter.url}`
        await updateDownloadTaskStatus(ctx.db, taskId, ok ? 'completed' : 'failed', error)
      },
    )
    return c.json({ ok: true, ...result })
  }

  return c.json({ error: 'unsupported source type' }, 400)
})

app.post('/api/download-center/retry-failed', async (c) => {
  const body = await c.req.json<{ bookshelfId?: string }>()
  if (!body.bookshelfId)
    return c.json({ error: 'missing bookshelfId' }, 400)

  const ctx = await resolveBookshelfContext(body.bookshelfId)
  if (!ctx)
    return c.json({ error: 'not found' }, 404)

  await retryFailedTasks(ctx.db, body.bookshelfId)

  // Get newly-pending (previously failed) chapters and restart
  const allChapters = await getChapterList(ctx.db, body.bookshelfId)
  const updatedTasks = await listDownloadTasks(ctx.db, body.bookshelfId)
  const pendingIds = new Set(updatedTasks.filter(t => t.status === 'pending').map(t => t.chapterId))
  const pendingChapters = allChapters.filter(ch => pendingIds.has(ch.id ?? ch.url))

  if (!pendingChapters.length)
    return c.json({ ok: true, started: false, message: '没有失败章节' })

  if (ctx.source.bookSourceType === 2) {
    const onChapterDone = async (chapter: { id?: string, url: string }, ok: boolean, error?: string) => {
      const taskId = `${body.bookshelfId}::${chapter.id ?? chapter.url}`
      await updateDownloadTaskStatus(ctx.db, taskId, ok ? 'completed' : 'failed', error)
    }
    const result = ctx.app.comicCache.startCacheAll(ctx.source, ctx.item.bookUrl, pendingChapters, ctx.item.name, onChapterDone)
    return c.json({ ok: true, ...result })
  }

  if (ctx.source.bookSourceType === 0) {
    const result = ctx.app.bookshelfCache.startCacheAll(
      ctx.source,
      ctx.item.id,
      ctx.item.bookUrl,
      pendingChapters,
      ctx.item.name,
      async (chapterId, filePath) => {
        await upsertChapterContentRecord(ctx.db, ctx.item.id, chapterId, filePath)
      },
      async (chapter, ok, error) => {
        const taskId = `${body.bookshelfId}::${chapter.id ?? chapter.url}`
        await updateDownloadTaskStatus(ctx.db, taskId, ok ? 'completed' : 'failed', error)
      },
    )
    return c.json({ ok: true, ...result })
  }

  return c.json({ error: 'unsupported source type' }, 400)
})

// ─── CBZ Export (from cached chapters only) ───────────────────────────────────

app.post('/api/cbz/export', async (c) => {
  const body = await c.req.json<{ bookshelfId?: string, chapterIds?: string[] }>()
  if (!body.bookshelfId || !body.chapterIds?.length)
    return c.json({ error: 'missing bookshelfId or chapterIds' }, 400)

  const ctx = await resolveBookshelfContext(body.bookshelfId)
  if (!ctx)
    return c.json({ error: 'not found' }, 404)
  if (ctx.source.bookSourceType !== 2)
    return c.json({ error: '仅漫画书源支持 CBZ 导出' }, 400)

  const allChapters = await getChapterList(ctx.db, body.bookshelfId)
  const selectedSet = new Set(body.chapterIds)
  const selected = allChapters.filter(ch => ch.id && selectedSet.has(ch.id))

  if (!selected.length)
    return c.json({ error: '未找到选中章节' }, 400)

  // Map each selected chapter to its 1-based position in the full TOC for correct filenames
  const tocIndexMap = new Map(allChapters.map((ch, i) => [ch.id!, i + 1]))
  const chapterNumbers = selected.map(ch => tocIndexMap.get(ch.id!) ?? 0)

  const safeId = body.bookshelfId.replace(/:/g, '_')
  const exportsDir = join(rootDir, 'cache', 'exports', safeId)
  const bookName = ctx.item.name

  const jobId = ctx.app.downloadJobs.start(async (onProgress) => {
    const partCount = Math.ceil(selected.length / 100)
    const { exportedFiles } = await buildCbzExport(
      ctx.app.comicCache,
      ctx.source.id,
      ctx.item.bookUrl,
      bookName,
      selected,
      exportsDir,
      chapterNumbers,
      (current, total, filename) => {
        onProgress({ phase: 'pack', current, total, message: `打包 ${filename}` })
      },
    )
    return {
      localExport: true as const,
      filename: exportedFiles[0] ?? 'export.cbz',
      mimeType: 'application/vnd.comicbook+zip',
      exportDir: exportsDir,
      exportedFiles,
    }
  })

  return c.json({ jobId })
})

app.get('/api/cbz/cached-chapters', async (c) => {
  const bookshelfIdParam = c.req.query('bookshelfId')
  if (!bookshelfIdParam)
    return c.json({ error: 'missing bookshelfId' }, 400)

  const ctx = await resolveBookshelfContext(bookshelfIdParam)
  if (!ctx)
    return c.json({ error: 'not found' }, 404)
  if (ctx.source.bookSourceType !== 2)
    return c.json({ cachedChapterIds: [] })

  const cachedKeys = new Set(
    await ctx.app.comicCache.listCachedChapterKeys(ctx.source.id, ctx.item.bookUrl),
  )
  const chapters = await getChapterList(ctx.db, bookshelfIdParam)
  const cachedChapterIds = chapters
    .filter(ch => ch.id && cachedKeys.has(ctx.app.comicCache.chapterKey(ch.url)))
    .map(ch => ch.id!)

  return c.json({ cachedChapterIds })
})

const defaultHeaders = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }

export const apiApp = app

export async function handleApiRequest(request: Request): Promise<Response> {
  await getAppContext()
  return apiApp.fetch(request)
}
