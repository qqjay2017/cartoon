import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { imageExtFromUrl } from '../download/cbz-builder.js'
import type { CbzPageInput } from '../download/cbz-builder.js'
import type { BookService } from '../engine/book-service.js'
import type { BookSource, Chapter } from '../types/book-source.js'
import type { BinaryFetcher } from '../utils/http.js'
import { hashKey, normalizeUrl, sanitizePathSegment } from './cache-keys.js'
import { mapPool } from '../utils/async-pool.js'
import { withRetry } from '../utils/retry.js'

/** 普通书源：多章节并行缓存 */
const COMIC_CHAPTER_CONCURRENCY = 5
/** mgsearcher 章节 API 有频控，并发略低 */
const MGSEARCHER_CHAPTER_CONCURRENCY = 4
/** 单章内多图并行下载（CDN） */
const COMIC_IMAGE_FETCH_CONCURRENCY = 6

function isRateLimitedChapterApi(url: string): boolean {
  return /mgsearcher\.com/i.test(url)
}

function chapterConcurrency(chapters: Chapter[]): number {
  const sample = chapters.find(ch => ch.url)?.url ?? ''
  return isRateLimitedChapterApi(sample)
    ? MGSEARCHER_CHAPTER_CONCURRENCY
    : COMIC_CHAPTER_CONCURRENCY
}

export interface ComicCacheConfigFile {
  comicDir?: string
}

export interface CachedChapterMeta {
  name: string
  url: string
  files: string[]
  cachedAt: string
}

export interface BookCacheMeta {
  sourceId: string
  bookUrl: string
  bookName?: string
  updatedAt: string
  chapters: Record<string, CachedChapterMeta>
}

export interface CacheJobProgress {
  running: boolean
  current: number
  total: number
  message?: string
  error?: string
}

export interface BookCacheStatus {
  sourceId: string
  bookUrl: string
  cacheDir: string
  totalChapters: number
  cachedChapters: number
  caching: boolean
  progress?: CacheJobProgress
}

export interface ComicCacheServiceOptions {
  projectRoot: string
  bookService: BookService
  binaryFetcher: BinaryFetcher
}

export class ComicCacheService {
  private configPath: string
  private cacheRoot: string
  private jobs = new Map<string, CacheJobProgress>()

  constructor(private options: ComicCacheServiceOptions) {
    this.configPath = join(options.projectRoot, 'cache', 'config.json')
    this.cacheRoot = join(options.projectRoot, 'cache', 'comics')
  }

  async init(): Promise<void> {
    await mkdir(join(this.options.projectRoot, 'cache'), { recursive: true })
    this.cacheRoot = await this.resolveCacheRoot()
    await mkdir(this.cacheRoot, { recursive: true })
  }

  getCacheRoot(): string {
    return this.cacheRoot
  }

  async getConfig(): Promise<{ comicDir: string }> {
    return { comicDir: this.cacheRoot }
  }

  async setCacheDir(dir: string): Promise<{ comicDir: string }> {
    const resolved = isAbsolute(dir) ? dir : resolve(this.options.projectRoot, dir)
    await mkdir(resolve(resolved, '..'), { recursive: true })
    await mkdir(resolved, { recursive: true })

    const config: ComicCacheConfigFile = { comicDir: resolved }
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf8')
    this.cacheRoot = resolved
    return { comicDir: this.cacheRoot }
  }

  bookKey(sourceId: string, bookUrl: string): string {
    return `${sanitizePathSegment(sourceId, 48)}/${hashKey(normalizeUrl(bookUrl))}`
  }

  chapterKey(chapterUrl: string): string {
    return hashKey(normalizeUrl(chapterUrl))
  }

  getBookDir(sourceId: string, bookUrl: string): string {
    return join(this.cacheRoot, this.bookKey(sourceId, bookUrl))
  }

  getChapterDir(sourceId: string, bookUrl: string, chapterUrl: string): string {
    return join(this.getBookDir(sourceId, bookUrl), 'chapters', this.chapterKey(chapterUrl))
  }

  buildImageApiUrl(sourceId: string, bookUrl: string, chapterUrl: string, page: number): string {
    const params = new URLSearchParams({
      sourceId,
      bookUrl,
      chapterUrl,
      page: String(page),
    })
    return `/api/cache/image?${params.toString()}`
  }

  async listCachedChapterKeys(sourceId: string, bookUrl: string): Promise<string[]> {
    const meta = await this.readBookMeta(sourceId, bookUrl)
    return meta ? Object.keys(meta.chapters) : []
  }

  async getStatus(
    sourceId: string,
    bookUrl: string,
    totalChapters = 0,
  ): Promise<BookCacheStatus> {
    const meta = await this.readBookMeta(sourceId, bookUrl)
    const cachedChapters = meta ? Object.keys(meta.chapters).length : 0
    const job = this.jobs.get(this.bookKey(sourceId, bookUrl))

    return {
      sourceId,
      bookUrl,
      cacheDir: this.getBookDir(sourceId, bookUrl),
      totalChapters,
      cachedChapters,
      caching: Boolean(job?.running),
      progress: job,
    }
  }

  async hasChapter(sourceId: string, bookUrl: string, chapterUrl: string): Promise<boolean> {
    const meta = await this.readBookMeta(sourceId, bookUrl)
    if (!meta)
      return false

    const chapter = meta.chapters[this.chapterKey(chapterUrl)]
    if (!chapter?.files.length)
      return false

    const chapterDir = this.getChapterDir(sourceId, bookUrl, chapterUrl)
    try {
      for (const file of chapter.files) {
        await access(join(chapterDir, file), fsConstants.F_OK)
      }
      return true
    }
    catch {
      return false
    }
  }

  async getCachedChapterContent(
    sourceId: string,
    bookUrl: string,
    chapterUrl: string,
  ): Promise<{ images: string[] } | null> {
    const meta = await this.readBookMeta(sourceId, bookUrl)
    if (!meta)
      return null

    const chapter = meta.chapters[this.chapterKey(chapterUrl)]
    if (!chapter?.files.length)
      return null

    if (!(await this.hasChapter(sourceId, bookUrl, chapterUrl)))
      return null

    return {
      images: chapter.files.map((_, index) =>
        this.buildImageApiUrl(sourceId, bookUrl, chapterUrl, index),
      ),
    }
  }

  async listChapterFiles(
    sourceId: string,
    bookUrl: string,
    chapterUrl: string,
  ): Promise<string[] | null> {
    if (!(await this.hasChapter(sourceId, bookUrl, chapterUrl)))
      return null

    const meta = await this.readBookMeta(sourceId, bookUrl)
    return meta?.chapters[this.chapterKey(chapterUrl)]?.files ?? null
  }

  async readCachedChapterPages(
    sourceId: string,
    bookUrl: string,
    chapterUrl: string,
  ): Promise<Array<{ data: Uint8Array, ext: string }> | null> {
    const meta = await this.readBookMeta(sourceId, bookUrl)
    if (!meta)
      return null

    const chapter = meta.chapters[this.chapterKey(chapterUrl)]
    if (!chapter?.files.length)
      return null

    const chapterDir = this.getChapterDir(sourceId, bookUrl, chapterUrl)
    const pages: Array<{ data: Uint8Array, ext: string }> = []

    for (const file of chapter.files) {
      const buffer = await readFile(join(chapterDir, file))
      const ext = file.split('.').pop() ?? 'jpg'
      pages.push({ data: new Uint8Array(buffer), ext })
    }

    return pages
  }

  async readCachedImage(
    sourceId: string,
    bookUrl: string,
    chapterUrl: string,
    page: number,
  ): Promise<{ data: Uint8Array, contentType: string } | null> {
    const meta = await this.readBookMeta(sourceId, bookUrl)
    if (!meta)
      return null

    const chapter = meta.chapters[this.chapterKey(chapterUrl)]
    const file = chapter?.files[page]
    if (!file)
      return null

    const filePath = join(this.getChapterDir(sourceId, bookUrl, chapterUrl), file)
    const data = new Uint8Array(await readFile(filePath))
    return { data, contentType: mimeTypeForExt(file.split('.').pop() ?? 'jpg') }
  }

  async writeChapterPages(
    sourceId: string,
    bookUrl: string,
    chapter: Chapter,
    pages: CbzPageInput[],
    bookName?: string,
  ): Promise<void> {
    if (!pages.length)
      return

    const chapterDir = this.getChapterDir(sourceId, bookUrl, chapter.url)
    await mkdir(chapterDir, { recursive: true })

    const files: string[] = []
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!
      const ext = page.ext.replace(/^\./, '') || 'jpg'
      const fileName = `${String(i + 1).padStart(3, '0')}.${ext}`
      await writeFile(join(chapterDir, fileName), page.data)
      files.push(fileName)
    }

    const meta = await this.readBookMeta(sourceId, bookUrl) ?? {
      sourceId,
      bookUrl: normalizeUrl(bookUrl),
      updatedAt: new Date().toISOString(),
      chapters: {},
    }

    meta.bookName = bookName ?? meta.bookName
    meta.updatedAt = new Date().toISOString()
    meta.chapters[this.chapterKey(chapter.url)] = {
      name: chapter.name,
      url: normalizeUrl(chapter.url),
      files,
      cachedAt: new Date().toISOString(),
    }

    await this.writeBookMeta(sourceId, bookUrl, meta)
  }

  /** 将打包好的 CBZ 写入该书缓存目录（与 chapters/、meta.json 同级） */
  async saveCbzExport(
    sourceId: string,
    bookUrl: string,
    data: Uint8Array,
    filename: string,
  ): Promise<string> {
    const bookDir = this.getBookDir(sourceId, bookUrl)
    await mkdir(bookDir, { recursive: true })
    const filePath = join(bookDir, filename)
    await writeFile(filePath, data)
    return filePath
  }

  async cacheChapter(
    source: BookSource & { id: string },
    bookUrl: string,
    chapter: Chapter,
    bookName?: string,
  ): Promise<boolean> {
    if (await this.hasChapter(source.id, bookUrl, chapter.url))
      return true

    const content = await withRetry(
      () => this.options.bookService.getChapterContent(source, chapter.url),
      { retries: 6, delayMs: 2500 },
    )
    const imageUrls = content.images ?? []
    if (!imageUrls.length)
      return false

    const pages = await mapPool(imageUrls, COMIC_IMAGE_FETCH_CONCURRENCY, async (imageUrl) => {
      const fetched = await withRetry(
        () => this.options.binaryFetcher(imageUrl),
        { retries: 4, delayMs: 1500 },
      )
      return {
        data: fetched.data,
        ext: imageExtFromUrl(imageUrl, fetched.contentType),
      }
    })

    await this.writeChapterPages(source.id, bookUrl, chapter, pages, bookName)
    return true
  }

  startCacheAll(
    source: BookSource & { id: string },
    bookUrl: string,
    chapters?: Chapter[],
    bookName?: string,
  ): { started: boolean, alreadyRunning?: boolean } {
    const key = this.bookKey(source.id, bookUrl)
    const existing = this.jobs.get(key)
    if (existing?.running)
      return { started: false, alreadyRunning: true }

    void this.runCacheJob(source, bookUrl, 'all', undefined, 100, chapters, bookName)
    return { started: true }
  }

  startPrefetch(
    source: BookSource & { id: string },
    bookUrl: string,
    chapterUrl: string,
    count = 100,
  ): { started: boolean, alreadyRunning?: boolean } {
    const key = this.bookKey(source.id, bookUrl)
    const existing = this.jobs.get(key)
    if (existing?.running)
      return { started: false, alreadyRunning: true }

    void this.runCacheJob(source, bookUrl, 'prefetch', chapterUrl, count)
    return { started: true }
  }

  async clearBook(sourceId: string, bookUrl: string): Promise<void> {
    const key = this.bookKey(sourceId, bookUrl)
    this.jobs.delete(key)
    const bookDir = this.getBookDir(sourceId, bookUrl)
    await rm(bookDir, { recursive: true, force: true })
  }

  private async runCacheJob(
    source: BookSource & { id: string },
    bookUrl: string,
    mode: 'all' | 'prefetch',
    fromChapterUrl?: string,
    prefetchCount = 100,
    presetChapters?: Chapter[],
    presetBookName?: string,
  ): Promise<void> {
    const key = this.bookKey(source.id, bookUrl)

    try {
      let chapters: Chapter[] = presetChapters ?? []
      let bookName = presetBookName

      if (!chapters.length) {
        const detail = await this.options.bookService.getBookDetail(source, bookUrl)
        bookName = detail.name
        chapters = await this.options.bookService.getToc(source, detail.tocUrl ?? bookUrl)
      }

      if (!chapters.length)
        return

      if (mode === 'prefetch' && fromChapterUrl) {
        const index = chapters.findIndex(ch =>
          normalizeUrl(ch.url) === normalizeUrl(fromChapterUrl) || ch.url === fromChapterUrl,
        )
        if (index < 0)
          return
        const start = index + 1
        const end = Math.min(chapters.length, start + prefetchCount)
        chapters = chapters.slice(start, end)
      }

      const pending: Chapter[] = []
      for (const chapter of chapters) {
        if (!(await this.hasChapter(source.id, bookUrl, chapter.url)))
          pending.push(chapter)
      }

      const alreadyCached = chapters.length - pending.length
      const totalChapters = chapters.length

      this.jobs.set(key, {
        running: true,
        current: alreadyCached,
        total: totalChapters,
        message: pending.length ? '准备缓存' : '已全部缓存',
      })

      let completed = 0
      const concurrency = chapterConcurrency(pending)
      await mapPool(pending, concurrency, async (chapter) => {
        try {
          await this.cacheChapter(source, bookUrl, chapter, bookName)
        }
        catch (error) {
          console.error(`[comic-cache] ${chapter.name}:`, error)
        }
        completed++
        this.jobs.set(key, {
          running: true,
          current: alreadyCached + completed,
          total: totalChapters,
          message: chapter.name,
        })
      })

      this.jobs.set(key, {
        running: false,
        current: totalChapters,
        total: totalChapters,
        message: '完成',
      })
    }
    catch (error) {
      this.jobs.set(key, {
        running: false,
        current: 0,
        total: 0,
        error: error instanceof Error ? error.message : '缓存失败',
      })
    }
  }

  private metaPath(sourceId: string, bookUrl: string): string {
    return join(this.getBookDir(sourceId, bookUrl), 'meta.json')
  }

  private async readBookMeta(sourceId: string, bookUrl: string): Promise<BookCacheMeta | null> {
    try {
      const raw = await readFile(this.metaPath(sourceId, bookUrl), 'utf8')
      return JSON.parse(raw) as BookCacheMeta
    }
    catch {
      return null
    }
  }

  private async writeBookMeta(sourceId: string, bookUrl: string, meta: BookCacheMeta): Promise<void> {
    const bookDir = this.getBookDir(sourceId, bookUrl)
    await mkdir(bookDir, { recursive: true })
    await writeFile(this.metaPath(sourceId, bookUrl), JSON.stringify(meta, null, 2), 'utf8')
  }

  private async resolveCacheRoot(): Promise<string> {
    try {
      const raw = await readFile(this.configPath, 'utf8')
      const config = JSON.parse(raw) as ComicCacheConfigFile
      if (config.comicDir) {
        return isAbsolute(config.comicDir)
          ? config.comicDir
          : resolve(this.options.projectRoot, config.comicDir)
      }
    }
    catch {
      // use default
    }

    return join(this.options.projectRoot, 'cache', 'comics')
  }
}

function mimeTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return 'image/jpeg'
  }
}
