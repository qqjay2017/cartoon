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
  return `/api/proxy?url=${encodeURIComponent(url)}`
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

  getChapter(sourceId: string, url: string) {
    const params = new URLSearchParams({ sourceId, url })
    return getJson<ChapterContent>(`/api/chapter?${params}`)
  },

  buildDownloadUrl(sourceId: string, bookUrl: string, format: 'epub' | 'cbz', range?: { start?: number, end?: number }) {
    const params = new URLSearchParams({ sourceId, url: bookUrl, format })
    if (range?.start !== undefined)
      params.set('start', String(range.start))
    if (range?.end !== undefined)
      params.set('end', String(range.end))
    return `/api/download?${params}`
  },

  async downloadBook(sourceId: string, bookUrl: string, format: 'epub' | 'cbz', range?: { start?: number, end?: number }) {
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
}

export type { BookshelfItem, SearchBook }
