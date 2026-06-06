import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import type { BookService } from '../engine/book-service.js'
import type { BookDetail, BookSource, Chapter } from '../types/book-source.js'
import type { BinaryFetcher } from '../utils/http.js'
import { chapterIdFromUrl, enrichChapterIds } from '../utils/site-ids.js'
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
  private abortFlags = new Map<string, boolean>()

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
    options?: { force?: boolean },
  ): Promise<{ ok: boolean, alreadyCached?: boolean, refreshed?: boolean, filePath?: string }> {
    const chapterId = chapter.id ?? chapterIdFromUrl(chapter.url)
    const exists = await this.hasChapter(bookshelfId, chapterId)
    if (exists && !options?.force)
      return { ok: true, alreadyCached: true }

    const content = await this.options.bookService.getChapterContent(source, chapter.url)
    const text = content.text?.trim()
    if (!text)
      return { ok: false }

    const filePath = await this.writeChapterText(bookshelfId, chapterId, chapter, text)
    return { ok: true, refreshed: exists, filePath }
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
    onChapterCached?: (chapterId: string, filePath: string) => Promise<void>,
    onChapterDone?: (chapter: Chapter, ok: boolean, error?: string) => void,
  ): { started: boolean, alreadyRunning?: boolean } {
    const existing = this.jobs.get(bookshelfId)
    if (existing?.running)
      return { started: false, alreadyRunning: true }

    this.abortFlags.set(bookshelfId, false)
    void this.runCacheJob(source, bookshelfId, bookUrl, chapters, bookName, onChapterCached, onChapterDone)
    return { started: true }
  }

  cancelCacheJob(bookshelfId: string): void {
    this.abortFlags.set(bookshelfId, true)
  }

  isJobRunning(bookshelfId: string): boolean {
    return Boolean(this.jobs.get(bookshelfId)?.running)
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

  async listCachedChapterIds(bookshelfId: string, chapters: Chapter[]): Promise<string[]> {
    const ids: string[] = []
    for (const ch of chapters) {
      const id = ch.id
      if (id && await this.hasChapter(bookshelfId, id))
        ids.push(id)
    }
    return ids
  }

  async countCachedChapters(bookshelfId: string, chapters: Chapter[]): Promise<number> {
    let count = 0
    for (const ch of chapters) {
      const id = ch.id
      if (id && await this.hasChapter(bookshelfId, id))
        count++
    }
    return count
  }

  private async runCacheJob(
    source: BookSource & { id: string },
    bookshelfId: string,
    _bookUrl: string,
    toc: Chapter[],
    _bookName?: string,
    onChapterCached?: (chapterId: string, filePath: string) => Promise<void>,
    onChapterDone?: (chapter: Chapter, ok: boolean, error?: string) => void,
  ): Promise<void> {
    try {
      const enriched = this.enrichToc(toc)
      const withIds = enriched.filter(ch => ch.id)
      const toCache: Chapter[] = []
      for (const ch of withIds) {
        if (!(await this.hasChapter(bookshelfId, ch.id!)))
          toCache.push(ch)
      }

      const alreadyCached = withIds.length - toCache.length
      const totalChapters = withIds.length

      this.jobs.set(bookshelfId, {
        running: true,
        current: alreadyCached,
        total: totalChapters,
        message: toCache.length ? '准备缓存' : '已全部缓存',
      })

      let completed = 0
      await mapPool(toCache, NOVEL_CACHE_CONCURRENCY, async (chapter) => {
        if (this.abortFlags.get(bookshelfId)) {
          return
        }

        let ok = false
        let errorMsg: string | undefined
        let filePath: string | undefined
        try {
          const result = await withRetry(
            () => this.cacheChapter(source, bookshelfId, chapter),
            { retries: 2, delayMs: 2000 },
          )
          ok = result.ok
          filePath = result.filePath
          if (!result.ok)
            errorMsg = '章节无正文'
        }
        catch (err) {
          errorMsg = err instanceof Error ? err.message : '缓存失败'
        }

        if (ok && filePath && chapter.id && onChapterCached)
          await onChapterCached(chapter.id, filePath)

        onChapterDone?.(chapter, ok, errorMsg)

        completed++
        this.jobs.set(bookshelfId, {
          running: true,
          current: alreadyCached + completed,
          total: totalChapters,
          message: chapter.name,
        })
      })

      this.jobs.set(bookshelfId, {
        running: false,
        current: totalChapters,
        total: totalChapters,
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
