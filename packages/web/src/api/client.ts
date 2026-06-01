import type { BookSourceType, BookshelfItem, ChapterContent, SearchBook } from '@cartoon/core'

export interface SourceSummary {
  id: string
  name: string
  type: BookSourceType
  group?: string
  url: string
}

export interface BookDetailResponse extends SearchBook {
  tocUrl?: string
}

export interface ChapterItem {
  name: string
  url: string
  updateTime?: string
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(await response.text())
  return response.json() as Promise<T>
}

export function proxyImage(url?: string) {
  if (!url)
    return ''
  if (url.startsWith('/api/cache/'))
    return url
  return `/api/proxy?url=${encodeURIComponent(url)}`
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

export const api = {
  listSources(type?: BookSourceType) {
    const query = type === undefined ? '' : `?type=${type}`
    return getJson<SourceSummary[]>(`/api/sources${query}`)
  },

  search(keyword: string, type?: BookSourceType) {
    const params = new URLSearchParams({ q: keyword })
    if (type !== undefined)
      params.set('type', String(type))
    return getJson<{ keyword: string, total: number, results: SearchBook[] }>(`/api/search?${params}`)
  },

  getBook(sourceId: string, url: string) {
    const params = new URLSearchParams({ sourceId, url })
    return getJson<BookDetailResponse>(`/api/book?${params}`)
  },

  getToc(sourceId: string, url: string) {
    const params = new URLSearchParams({ sourceId, url })
    return getJson<{ chapters: ChapterItem[] }>(`/api/toc?${params}`)
  },

  getChapter(sourceId: string, url: string, bookUrl?: string) {
    const params = new URLSearchParams({ sourceId, url })
    if (bookUrl)
      params.set('bookUrl', bookUrl)
    return getJson<ChapterContent & { cached?: boolean }>(`/api/chapter?${params}`)
  },

  buildDownloadUrl(sourceId: string, bookUrl: string, format: DownloadFormat, range?: { start?: number, end?: number }) {
    const params = new URLSearchParams({ sourceId, url: bookUrl, format })
    if (range?.start !== undefined)
      params.set('start', String(range.start))
    if (range?.end !== undefined)
      params.set('end', String(range.end))
    return `/api/download?${params}`
  },

  async downloadBook(sourceId: string, bookUrl: string, format: DownloadFormat, range?: { start?: number, end?: number }) {
    const url = this.buildDownloadUrl(sourceId, bookUrl, format, range)
    const response = await fetch(url)
    if (!response.ok) {
      const text = await response.text()
      try {
        const json = JSON.parse(text) as { error?: string }
        throw new Error(json.error ?? text)
      }
      catch {
        throw new Error(text || '下载失败')
      }
    }

    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i)
    const filename = decodeURIComponent(filenameMatch?.[1] ?? filenameMatch?.[2] ?? `download.${format}`)

    return { blob, filename }
  },

  getCacheConfig() {
    return getJson<{ comicDir: string }>('/api/cache/config')
  },

  setCacheConfig(comicDir: string) {
    return fetch('/api/cache/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comicDir }),
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(await response.text())
      return response.json() as Promise<{ comicDir: string }>
    })
  },

  getCacheStatus(sourceId: string, bookUrl: string, totalChapters?: number) {
    const params = new URLSearchParams({ sourceId, bookUrl })
    if (totalChapters !== undefined)
      params.set('totalChapters', String(totalChapters))
    return getJson<BookCacheStatus>(`/api/cache/status?${params}`)
  },

  cacheAll(sourceId: string, bookUrl: string) {
    return fetch('/api/cache/all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, bookUrl }),
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(await response.text())
      return response.json() as Promise<{ started: boolean, alreadyRunning?: boolean }>
    })
  },

  prefetchCache(sourceId: string, bookUrl: string, chapterUrl: string, count = 100) {
    return fetch('/api/cache/prefetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, bookUrl, chapterUrl, count }),
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(await response.text())
      return response.json() as Promise<{ started: boolean, alreadyRunning?: boolean }>
    })
  },

  clearCache(sourceId: string, bookUrl: string) {
    const params = new URLSearchParams({ sourceId, bookUrl })
    return fetch(`/api/cache?${params}`, { method: 'DELETE' }).then(async (response) => {
      if (!response.ok)
        throw new Error(await response.text())
      return response.json() as Promise<{ ok: boolean }>
    })
  },
}

export type { BookshelfItem, SearchBook }

export type DownloadFormat = 'epub' | 'txt' | 'cbz' | 'folder'

export const DOWNLOAD_FORMAT_LABELS: Record<DownloadFormat, string> = {
  epub: 'EPUB',
  txt: 'TXT',
  cbz: 'CBZ',
  folder: '文件夹 (ZIP)',
}
