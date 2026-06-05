import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import type { BookService } from '../engine/book-service.js'
import type { BookDetail, BookSource, Chapter } from '../types/book-source.js'
import type { BinaryFetcher } from '../utils/http.js'
import { enrichChapterIds } from '../utils/site-ids.js'
import { imageExtFromUrl } from '../download/cbz-builder.js'
import type { BookCacheStatus, CacheJobProgress } from './comic-cache-service.js'
import { mapPool } from '../utils/async-pool.js'
import { withRetry } from '../utils/retry.js'

export interface NovelBookshelfCacheOptions {
  projectRoot: string
  bookService: BookService
  binaryFetcher?: BinaryFetcher
}

const NOVEL_CACHE_CONCURRENCY = 5

export class NovelBookshelfCache {
  private contentRoot: string
  private coverRoot: string
  private jobs = new Map<string, CacheJobProgress>()

  constructor(private options: NovelBookshelfCacheOptions) {
    this.contentRoot = join(options.projectRoot, 'cache', 'content')
    this.coverRoot = join(options.projectRoot, 'cache', 'covers')
  }

  async init(): Promise<void> {
    await mkdir(this.contentRoot, { recursive: true })
    await mkdir(this.coverRoot, { recursive: true })
  }

  getContentRoot(): string {
    return this.contentRoot
  }

  chapterFilePath(bookshelfId: string, chapterId: string): string {
    const safeId = bookshelfId.replace(/:/g, '_')
    return join(this.contentRoot, safeId, `${chapterId}.json`)
  }

  coverFilePath(bookshelfId: string, ext = 'jpg'): string {
    const safeId = bookshelfId.replace(/:/g, '_')
    return join(this.coverRoot, `${safeId}.${ext}`)
  }

  buildCoverApiUrl(bookshelfId: string): string {
    return `/api/cache/novel-cover?bookshelfId=${encodeURIComponent(bookshelfId)}`
  }

  relativeChapterPath(bookshelfId: string, chapterId: string): string {
    const safeId = bookshelfId.replace(/:/g, '_')
    return `content/${safeId}/${chapterId}.json`
  }

  async hasChapter(bookshelfId: string, chapterId: string): Promise<boolean> {
    try {
      await access(this.chapterFilePath(bookshelfId, chapterId), fsConstants.F_OK)
      return true
    }
    catch {
      return false
    }
  }

  async readChapterText(bookshelfId: string, chapterId: string): Promise<{ text: string } | null> {
    try {
      const raw = await readFile(this.chapterFilePath(bookshelfId, chapterId), 'utf8')
      const parsed = JSON.parse(raw) as { text?: string }
      return parsed.text ? { text: parsed.text } : null
    }
    catch {
      return null
    }
  }

  async writeChapterText(
    bookshelfId: string,
    chapterId: string,
    chapter: Chapter,
    text: string,
  ): Promise<string> {
    const filePath = this.chapterFilePath(bookshelfId, chapterId)
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, JSON.stringify({
      name: chapter.name,
      url: chapter.url,
      chapterId,
      text,
      cachedAt: new Date().toISOString(),
    }), 'utf8')
    return this.relativeChapterPath(bookshelfId, chapterId)
  }

  async hasCover(bookshelfId: string): Promise<boolean> {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
      try {
        await access(this.coverFilePath(bookshelfId, ext), fsConstants.F_OK)
        return true
      }
      catch {
        // try next
      }
    }
    return false
  }

  async readCover(bookshelfId: string): Promise<{ data: Uint8Array, contentType: string, ext: string } | null> {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
      try {
        const filePath = this.coverFilePath(bookshelfId, ext)
        await access(filePath, fsConstants.F_OK)
        const data = new Uint8Array(await readFile(filePath))
        return { data, ext, contentType: coverContentType(ext) }
      }
      catch {
        // try next
      }
    }
    return null
  }

  async cacheCover(bookshelfId: string, coverUrl?: string): Promise<void> {
    if (!coverUrl || !this.options.binaryFetcher || !/^https?:\/\//i.test(coverUrl))
      return

    const result = await this.options.binaryFetcher(coverUrl, { timeout: 60000 })
    const ext = imageExtFromUrl(coverUrl, result.contentType)
    await mkdir(this.coverRoot, { recursive: true })
    await writeFile(this.coverFilePath(bookshelfId, ext), result.data)
  }

  async resolveCoverUrl(bookshelfId: string, fallback?: string): Promise<string | undefined> {
    if (await this.hasCover(bookshelfId))
      return this.buildCoverApiUrl(bookshelfId)
    return fallback
  }

  async presentBookDetail(detail: BookDetail, bookshelfId: string): Promise<BookDetail> {
    const coverUrl = await this.resolveCoverUrl(bookshelfId, detail.coverUrl)
    if (!coverUrl)
      return detail
    return { ...detail, coverUrl }
  }

  async cacheChapter(
    source: BookSource & { id: string },
    bookshelfId: string,
    chapter: Chapter,
  ): Promise<boolean> {
    const chapterId = chapter.id ?? chapter.url
    if (await this.hasChapter(bookshelfId, chapterId))
      return true

    const content = await this.options.bookService.getChapterContent(source, chapter.url)
    const text = content.text?.trim()
    if (!text)
      return false

    await this.writeChapterText(bookshelfId, chapterId, chapter, text)
    return true
  }

  getStatus(bookshelfId: string, totalChapters = 0, cachedChapters = 0): BookCacheStatus {
    const job = this.jobs.get(bookshelfId)
    return {
      sourceId: bookshelfId.split(':')[0] ?? bookshelfId,
      bookUrl: bookshelfId,
      cacheDir: join(this.contentRoot, bookshelfId.replace(/:/g, '_')),
      totalChapters,
      cachedChapters,
      caching: Boolean(job?.running),
      progress: job,
    }
  }

  startCacheAll(
    source: BookSource & { id: string },
    bookshelfId: string,
    bookUrl: string,
    chapters: Chapter[],
    bookName?: string,
  ): { started: boolean, alreadyRunning?: boolean } {
    const existing = this.jobs.get(bookshelfId)
    if (existing?.running)
      return { started: false, alreadyRunning: true }

    void this.runCacheJob(source, bookshelfId, bookUrl, chapters, bookName)
    return { started: true }
  }

  async clearBook(bookshelfId: string): Promise<void> {
    this.jobs.delete(bookshelfId)
    const safeId = bookshelfId.replace(/:/g, '_')
    await rm(join(this.contentRoot, safeId), { recursive: true, force: true })
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
      try {
        await rm(this.coverFilePath(bookshelfId, ext), { force: true })
      }
      catch {
        // ignore
      }
    }
  }

  enrichToc(chapters: Chapter[]): Chapter[] {
    return enrichChapterIds(chapters)
  }

  private async runCacheJob(
    source: BookSource & { id: string },
    bookshelfId: string,
    _bookUrl: string,
    toc: Chapter[],
    _bookName?: string,
  ): Promise<void> {
    try {
      const enriched = this.enrichToc(toc)
      const toCache: Chapter[] = []
      for (const ch of enriched) {
        const id = ch.id
        if (!id)
          continue
        if (!(await this.hasChapter(bookshelfId, id)))
          toCache.push(ch)
      }

      this.jobs.set(bookshelfId, {
        running: true,
        current: 0,
        total: toCache.length,
        message: toCache.length ? '准备缓存' : '已全部缓存',
      })

      let completed = 0
      await mapPool(toCache, NOVEL_CACHE_CONCURRENCY, async (chapter) => {
        await withRetry(
          () => this.cacheChapter(source, bookshelfId, chapter),
          { retries: 2, delayMs: 2000 },
        )
        completed++
        this.jobs.set(bookshelfId, {
          running: true,
          current: completed,
          total: toCache.length,
          message: chapter.name,
        })
      })

      this.jobs.set(bookshelfId, {
        running: false,
        current: toCache.length,
        total: toCache.length,
        message: '完成',
      })
    }
    catch (error) {
      this.jobs.set(bookshelfId, {
        running: false,
        current: 0,
        total: 0,
        error: error instanceof Error ? error.message : '缓存失败',
      })
    }
  }
}

function coverContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return 'image/jpeg'
  }
}
