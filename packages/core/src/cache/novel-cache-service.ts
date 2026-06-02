import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { BookService } from '../engine/book-service.js'
import type { BookSource, Chapter } from '../types/book-source.js'
import type { BookCacheStatus, CacheJobProgress } from './comic-cache-service.js'
import { hashKey, normalizeUrl, sanitizePathSegment } from './cache-keys.js'
import { mapPool } from '../utils/async-pool.js'
import { withRetry } from '../utils/retry.js'

export interface NovelCacheConfigFile {
  novelDir?: string
}

export interface CachedNovelChapterMeta {
  name: string
  url: string
  file: string
  cachedAt: string
}

export interface NovelBookCacheMeta {
  sourceId: string
  bookUrl: string
  bookName?: string
  updatedAt: string
  chapters: Record<string, CachedNovelChapterMeta>
}

export interface NovelCacheServiceOptions {
  projectRoot: string
  bookService: BookService
}

const NOVEL_CACHE_CONCURRENCY = 5

export class NovelCacheService {
  private configPath: string
  private cacheRoot: string
  private jobs = new Map<string, CacheJobProgress>()

  constructor(private options: NovelCacheServiceOptions) {
    this.configPath = join(options.projectRoot, 'cache', 'config.json')
    this.cacheRoot = join(options.projectRoot, 'cache', 'novels')
  }

  async init(): Promise<void> {
    await mkdir(join(this.options.projectRoot, 'cache'), { recursive: true })
    this.cacheRoot = await this.resolveCacheRoot()
    await mkdir(this.cacheRoot, { recursive: true })
  }

  getCacheRoot(): string {
    return this.cacheRoot
  }

  async getConfig(): Promise<{ novelDir: string }> {
    return { novelDir: this.cacheRoot }
  }

  async setCacheDir(dir: string): Promise<{ novelDir: string }> {
    const resolved = isAbsolute(dir) ? dir : resolve(this.options.projectRoot, dir)
    await mkdir(resolve(resolved, '..'), { recursive: true })
    await mkdir(resolved, { recursive: true })

    let config: Record<string, string> = {}
    try {
      const raw = await readFile(this.configPath, 'utf8')
      config = JSON.parse(raw) as Record<string, string>
    }
    catch {
      // fresh config
    }

    config.novelDir = resolved
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf8')
    this.cacheRoot = resolved
    return { novelDir: this.cacheRoot }
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
    const chapter = meta?.chapters[this.chapterKey(chapterUrl)]
    if (!chapter?.file)
      return false

    try {
      await access(join(this.getChapterDir(sourceId, bookUrl, chapterUrl), chapter.file), fsConstants.F_OK)
      return true
    }
    catch {
      return false
    }
  }

  async readChapterText(
    sourceId: string,
    bookUrl: string,
    chapterUrl: string,
  ): Promise<{ text: string } | null> {
    const meta = await this.readBookMeta(sourceId, bookUrl)
    const chapter = meta?.chapters[this.chapterKey(chapterUrl)]
    if (!chapter?.file)
      return null

    if (!(await this.hasChapter(sourceId, bookUrl, chapterUrl)))
      return null

    const raw = await readFile(join(this.getChapterDir(sourceId, bookUrl, chapterUrl), chapter.file), 'utf8')
    const parsed = JSON.parse(raw) as { text?: string }
    return parsed.text ? { text: parsed.text } : null
  }

  async writeChapterText(
    sourceId: string,
    bookUrl: string,
    chapter: Chapter,
    text: string,
    bookName?: string,
  ): Promise<void> {
    const chapterDir = this.getChapterDir(sourceId, bookUrl, chapter.url)
    await mkdir(chapterDir, { recursive: true })

    const fileName = 'content.json'
    await writeFile(join(chapterDir, fileName), JSON.stringify({
      name: chapter.name,
      url: normalizeUrl(chapter.url),
      text,
      cachedAt: new Date().toISOString(),
    }), 'utf8')

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
      file: fileName,
      cachedAt: new Date().toISOString(),
    }

    await this.writeBookMeta(sourceId, bookUrl, meta)
  }

  async cacheChapter(
    source: BookSource & { id: string },
    bookUrl: string,
    chapter: Chapter,
    bookName?: string,
  ): Promise<boolean> {
    if (await this.hasChapter(source.id, bookUrl, chapter.url))
      return true

    const content = await this.options.bookService.getChapterContent(source, chapter.url)
    const text = content.text?.trim()
    if (!text)
      return false

    await this.writeChapterText(source.id, bookUrl, chapter, text, bookName)
    return true
  }

  startCacheAll(source: BookSource & { id: string }, bookUrl: string): { started: boolean, alreadyRunning?: boolean } {
    const key = this.bookKey(source.id, bookUrl)
    const existing = this.jobs.get(key)
    if (existing?.running)
      return { started: false, alreadyRunning: true }

    void this.runCacheJob(source, bookUrl)
    return { started: true }
  }

  async clearBook(sourceId: string, bookUrl: string): Promise<void> {
    const key = this.bookKey(sourceId, bookUrl)
    this.jobs.delete(key)
    await rm(this.getBookDir(sourceId, bookUrl), { recursive: true, force: true })
  }

  private async runCacheJob(source: BookSource & { id: string }, bookUrl: string): Promise<void> {
    const key = this.bookKey(source.id, bookUrl)

    try {
      const detail = await this.options.bookService.getBookDetail(source, bookUrl)
      const toc = await this.options.bookService.getToc(source, detail.tocUrl ?? bookUrl)
      if (!toc.length)
        return

      const pending: Chapter[] = []
      for (const chapter of toc) {
        if (!(await this.hasChapter(source.id, bookUrl, chapter.url)))
          pending.push(chapter)
      }

      this.jobs.set(key, {
        running: true,
        current: 0,
        total: pending.length,
        message: pending.length ? '准备缓存' : '已全部缓存',
      })

      let completed = 0
      await mapPool(pending, NOVEL_CACHE_CONCURRENCY, async (chapter) => {
        await withRetry(
          () => this.cacheChapter(source, bookUrl, chapter, detail.name),
          { retries: 2, delayMs: 2000 },
        )
        completed++
        this.jobs.set(key, {
          running: true,
          current: completed,
          total: pending.length,
          message: chapter.name,
        })
      })

      this.jobs.set(key, {
        running: false,
        current: pending.length,
        total: pending.length,
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

  private async readBookMeta(sourceId: string, bookUrl: string): Promise<NovelBookCacheMeta | null> {
    try {
      const raw = await readFile(this.metaPath(sourceId, bookUrl), 'utf8')
      return JSON.parse(raw) as NovelBookCacheMeta
    }
    catch {
      return null
    }
  }

  private async writeBookMeta(sourceId: string, bookUrl: string, meta: NovelBookCacheMeta): Promise<void> {
    const bookDir = this.getBookDir(sourceId, bookUrl)
    await mkdir(bookDir, { recursive: true })
    await writeFile(this.metaPath(sourceId, bookUrl), JSON.stringify(meta, null, 2), 'utf8')
  }

  private async resolveCacheRoot(): Promise<string> {
    try {
      const raw = await readFile(this.configPath, 'utf8')
      const config = JSON.parse(raw) as NovelCacheConfigFile
      if (config.novelDir) {
        return isAbsolute(config.novelDir)
          ? config.novelDir
          : resolve(this.options.projectRoot, config.novelDir)
      }
    }
    catch {
      // use default
    }

    return join(this.options.projectRoot, 'cache', 'novels')
  }
}
