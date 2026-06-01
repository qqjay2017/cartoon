import { buildCbz, cbzFilename, imageExtFromUrl } from './cbz-builder.js'
import { buildEpub, epubFilename } from './epub-builder.js'
import type { BookService } from '../engine/book-service.js'
import type { BookSource } from '../types/book-source.js'
import type { BinaryFetcher } from '../utils/http.js'

export type DownloadFormat = 'epub' | 'cbz'

export interface DownloadProgress {
  phase: 'toc' | 'chapters' | 'pack'
  current: number
  total: number
  message?: string
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
  data: Uint8Array
  filename: string
  mimeType: string
}

export class DownloadService {
  constructor(
    private bookService: BookService,
    private binaryFetcher: BinaryFetcher,
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

    if (format === 'epub') {
      if (source.bookSourceType !== 0)
        throw new Error('该书源不是小说类型，请使用 CBZ 下载')

      const epubChapters = []
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i]!
        options.onProgress?.({
          phase: 'chapters',
          current: i + 1,
          total: chapters.length,
          message: chapter.name,
        })
        const content = await this.bookService.getChapterContent(source, chapter.url)
        epubChapters.push({
          title: chapter.name,
          html: content.text ?? '',
        })
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
        chapters: epubChapters,
      })

      return {
        data,
        filename: epubFilename(detail.name),
        mimeType: 'application/epub+zip',
      }
    }

    if (source.bookSourceType !== 2)
      throw new Error('该书源不是漫画类型，请使用 EPUB 下载')

    const pages: Array<{ data: Uint8Array, ext: string }> = []
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]!
      options.onProgress?.({
        phase: 'chapters',
        current: i + 1,
        total: chapters.length,
        message: chapter.name,
      })
      const content = await this.bookService.getChapterContent(source, chapter.url)
      const images = content.images ?? []
      for (const imageUrl of images) {
        const fetched = await this.fetchImage(imageUrl)
        pages.push(fetched)
      }
    }

    if (!pages.length)
      throw new Error('未获取到漫画图片')

    options.onProgress?.({ phase: 'pack', current: 1, total: 1, message: '打包 CBZ' })
    const data = await buildCbz(pages)

    return {
      data,
      filename: cbzFilename(detail.name),
      mimeType: 'application/vnd.comicbook+zip',
    }
  }

  private async fetchImage(url: string): Promise<{ data: Uint8Array, ext: string }> {
    const result = await this.binaryFetcher(url)
    return {
      data: result.data,
      ext: imageExtFromUrl(url, result.contentType),
    }
  }
}
