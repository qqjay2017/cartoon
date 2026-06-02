import { join } from 'node:path'
import type { ComicCacheService } from '../cache/comic-cache-service.js'
import { buildCbzFromCache } from './cbz-from-cache.js'
import { CBZ_CHAPTERS_PER_FILE, cbzPartFilename, imageExtFromUrl } from './cbz-builder.js'
import { buildComicFolder, folderFilename } from './folder-builder.js'
import { buildEpub, epubFilename } from './epub-builder.js'
import { buildTxt, txtFilename } from './txt-builder.js'
import type { BookService } from '../engine/book-service.js'
import type { BookSource, Chapter } from '../types/book-source.js'
import type { BinaryFetcher } from '../utils/http.js'
import { mapPool } from '../utils/async-pool.js'
import { withRetry } from '../utils/retry.js'

export type DownloadFormat = 'epub' | 'txt' | 'cbz' | 'folder'

export interface DownloadProgress {
  phase: 'toc' | 'chapters' | 'pack'
  current: number
  total: number
  message?: string
  fromCache?: boolean
  cachedChapters?: number
}

export interface DownloadOptions {
  source: BookSource & { id: string }
  bookUrl: string
  format: DownloadFormat
  start?: number
  end?: number
  onProgress?: (progress: DownloadProgress) => void
}

export interface DownloadResult {
  filename: string
  mimeType: string
  data?: Uint8Array
  /** 大文件（如 CBZ）流式写入磁盘后的路径，避免超过 Node 2GB 内存限制 */
  filePath?: string
  /** 已写入本地缓存目录，无需浏览器下载 */
  localExport?: boolean
  exportDir?: string
  exportedFiles?: string[]
}

const COMIC_CHAPTER_CONCURRENCY = 3
const COMIC_IMAGE_CONCURRENCY = 4
const DOWNLOAD_FETCH_TIMEOUT = 300000

export class DownloadService {
  constructor(
    private bookService: BookService,
    private binaryFetcher: BinaryFetcher,
    private comicCache?: ComicCacheService,
  ) {}

  async download(options: DownloadOptions): Promise<DownloadResult> {
    const { source, bookUrl, format } = options
    const detail = await this.bookService.getBookDetail(source, bookUrl)

    options.onProgress?.({ phase: 'toc', current: 0, total: 1, message: '获取目录' })
    const toc = await this.bookService.getToc(source, detail.tocUrl ?? bookUrl)
    if (!toc.length)
      throw new Error('目录为空，无法下载')

    const start = Math.max(0, options.start ?? 0)
    const end = Math.min(toc.length - 1, options.end ?? toc.length - 1)
    const chapters = toc.slice(start, end + 1)

    if (format === 'epub' || format === 'txt') {
      if (source.bookSourceType !== 0)
        throw new Error('该书源不是小说类型，请使用 CBZ 或文件夹下载')

      const novelChapters = []
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i]!
        options.onProgress?.({
          phase: 'chapters',
          current: i + 1,
          total: chapters.length,
          message: chapter.name,
        })
        const content = await this.bookService.getChapterContent(source, chapter.url)
        novelChapters.push({
          title: chapter.name,
          html: content.text ?? '',
        })
      }

      if (format === 'txt') {
        options.onProgress?.({ phase: 'pack', current: 1, total: 1, message: '打包 TXT' })
        const data = buildTxt({
          title: detail.name,
          author: detail.author,
          intro: detail.intro,
          chapters: novelChapters.map(ch => ({ title: ch.title, text: ch.html })),
        })
        return {
          data,
          filename: txtFilename(detail.name),
          mimeType: 'text/plain; charset=utf-8',
        }
      }

      options.onProgress?.({ phase: 'pack', current: 1, total: 1, message: '打包 EPUB' })

      let cover: Uint8Array | undefined
      let coverExt = 'jpg'
      if (detail.coverUrl) {
        try {
          const fetched = await this.fetchImage(detail.coverUrl)
          cover = fetched.data
          coverExt = fetched.ext
        }
        catch {
          // optional cover
        }
      }

      const data = await buildEpub({
        title: detail.name,
        author: detail.author,
        intro: detail.intro,
        cover,
        coverExt,
        chapters: novelChapters,
      })

      return {
        data,
        filename: epubFilename(detail.name),
        mimeType: 'application/epub+zip',
      }
    }

    if (source.bookSourceType !== 2)
      throw new Error('该书源不是漫画类型，请使用 EPUB 或 TXT 下载')

    if (format === 'folder') {
      const comicChapters = await this.fetchComicChapters(
        source,
        bookUrl,
        chapters,
        detail.name,
        options.onProgress,
      )
      options.onProgress?.({ phase: 'pack', current: 1, total: 1, message: '打包文件夹' })
      const data = await buildComicFolder(detail.name, comicChapters)
      return {
        data,
        filename: folderFilename(detail.name),
        mimeType: 'application/zip',
      }
    }

    if (!this.comicCache)
      throw new Error('CBZ 导出需要本地缓存服务')

    await this.ensureComicChaptersCached(
      source,
      bookUrl,
      chapters,
      detail.name,
      options.onProgress,
    )

    const bookDir = this.comicCache.getBookDir(source.id, bookUrl)
    const exportedFiles: string[] = []
    const partCount = Math.ceil(chapters.length / CBZ_CHAPTERS_PER_FILE)

    for (let partIndex = 0; partIndex < partCount; partIndex++) {
      const chunkStart = partIndex * CBZ_CHAPTERS_PER_FILE
      const chunk = chapters.slice(chunkStart, chunkStart + CBZ_CHAPTERS_PER_FILE)
      const chapterStart = start + chunkStart + 1
      const chapterEnd = start + chunkStart + chunk.length

      options.onProgress?.({
        phase: 'pack',
        current: partIndex + 1,
        total: partCount,
        message: `打包 CBZ ${chapterStart}-${chapterEnd}`,
      })

      const filename = cbzPartFilename(detail.name, chapterStart, chapterEnd)
      const filePath = join(bookDir, filename)
      await buildCbzFromCache(this.comicCache, source.id, bookUrl, chunk, filePath)
      exportedFiles.push(filename)
    }

    return {
      localExport: true,
      exportDir: bookDir,
      exportedFiles,
      filename: exportedFiles[0] ?? cbzPartFilename(detail.name, 1, chapters.length),
      mimeType: 'application/vnd.comicbook+zip',
    }
  }

  private async ensureComicChaptersCached(
    source: BookSource & { id: string },
    bookUrl: string,
    chapters: Chapter[],
    bookName: string,
    onProgress?: DownloadOptions['onProgress'],
  ): Promise<void> {
    let completed = 0
    let cachedCount = 0

    const report = (chapter: Chapter, fromCache: boolean) => {
      completed++
      if (fromCache)
        cachedCount++
      onProgress?.({
        phase: 'chapters',
        current: completed,
        total: chapters.length,
        message: fromCache ? `${chapter.name}（本地缓存）` : chapter.name,
        fromCache,
        cachedChapters: cachedCount,
      })
    }

    await mapPool(
      chapters,
      COMIC_CHAPTER_CONCURRENCY,
      async (chapter) => {
        await withRetry(async () => {
          if (this.comicCache && await this.comicCache.hasChapter(source.id, bookUrl, chapter.url)) {
            report(chapter, true)
            return
          }

          const content = await withRetry(
            () => this.bookService.getChapterContent(source, chapter.url),
            { retries: 3, delayMs: 2000 },
          )
          const images = content.images ?? []
          if (!images.length)
            throw new Error(`章节无图片：${chapter.name}`)

          const pages = await mapPool(images, COMIC_IMAGE_CONCURRENCY, async (imageUrl) =>
            this.fetchImage(imageUrl),
          )

          if (pages.length && this.comicCache)
            await this.comicCache.writeChapterPages(source.id, bookUrl, chapter, pages, bookName)

          report(chapter, false)
        }, { retries: 2, delayMs: 2500 })
      },
    )
  }

  private async fetchComicChapters(
    source: BookSource & { id: string },
    bookUrl: string,
    chapters: Chapter[],
    bookName: string,
    onProgress?: DownloadOptions['onProgress'],
  ) {
    const results: Array<{ name: string, pages: Array<{ data: Uint8Array, ext: string }> } | null> =
      new Array(chapters.length).fill(null)
    let completed = 0
    let cachedCount = 0

    const report = (chapter: Chapter, fromCache: boolean) => {
      completed++
      if (fromCache)
        cachedCount++
      onProgress?.({
        phase: 'chapters',
        current: completed,
        total: chapters.length,
        message: fromCache ? `${chapter.name}（本地缓存）` : chapter.name,
        fromCache,
        cachedChapters: cachedCount,
      })
    }

    await mapPool(
      chapters.map((chapter, index) => ({ chapter, index })),
      COMIC_CHAPTER_CONCURRENCY,
      async ({ chapter, index }) => {
        await withRetry(async () => {
          const cachedPages = this.comicCache
            ? await this.comicCache.readCachedChapterPages(source.id, bookUrl, chapter.url)
            : null

          if (cachedPages?.length) {
            results[index] = { name: chapter.name, pages: cachedPages }
            report(chapter, true)
            return
          }

          const content = await withRetry(
            () => this.bookService.getChapterContent(source, chapter.url),
            { retries: 3, delayMs: 2000 },
          )
          const images = content.images ?? []
          if (!images.length)
            throw new Error(`章节无图片：${chapter.name}`)

          const pages = await mapPool(images, COMIC_IMAGE_CONCURRENCY, async (imageUrl) =>
            this.fetchImage(imageUrl),
          )

          if (pages.length && this.comicCache)
            await this.comicCache.writeChapterPages(source.id, bookUrl, chapter, pages, bookName)

          results[index] = { name: chapter.name, pages }
          report(chapter, false)
        }, { retries: 2, delayMs: 2500 })
      },
    )

    const comicChapters = results.filter((item): item is NonNullable<typeof item> => Boolean(item?.pages.length))
    if (!comicChapters.length)
      throw new Error('未获取到漫画图片')

    return comicChapters
  }

  private async fetchImage(url: string): Promise<{ data: Uint8Array, ext: string }> {
    return withRetry(async () => {
      const result = await this.binaryFetcher(url, { timeout: DOWNLOAD_FETCH_TIMEOUT })
      return {
        data: result.data,
        ext: imageExtFromUrl(url, result.contentType),
      }
    }, { retries: 4, delayMs: 2000 })
  }
}
