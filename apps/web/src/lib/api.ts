import type { BookSource, BookSourceType, SearchBook } from '@cartoon/core'

export interface SourceSummary {
  id: string
  name: string
  type: BookSourceType
  group?: string
  url: string
  enabled?: boolean
  cookieJar?: boolean
}

export interface SourceManageItem {
  id: string
  name: string
  type: BookSourceType
  enabled: boolean
  url: string
  updatedAt: string
}

export interface SourceFull {
  id: string
  name: string
  type: BookSourceType
  enabled: boolean
  config: BookSource
  updatedAt: string
}

export interface BookshelfItem {
  id: string
  sourceId: string
  sourceName: string
  sourceType: BookSourceType
  name: string
  author?: string
  coverUrl?: string
  bookUrl: string
  lastReadChapterId?: string
  lastReadChapterName?: string
  addedAt: number
}

export interface ChapterItem {
  name: string
  url: string
  id?: string
  updateTime?: string
}

export interface BookDetailResponse extends SearchBook {
  tocUrl?: string
}

export type DownloadFormat = 'epub' | 'txt' | 'cbz' | 'folder'

export interface DownloadProgress {
  phase: 'toc' | 'chapters' | 'pack'
  current: number
  total: number
  message?: string
  fromCache?: boolean
  cachedChapters?: number
}

export interface DownloadJobSnapshot {
  id: string
  status: 'running' | 'done' | 'error'
  progress?: DownloadProgress
  error?: string
  filename?: string
  localExport?: boolean
  exportDir?: string
  exportedFiles?: string[]
}

export interface CacheJobProgress {
  running: boolean
  current: number
  total: number
  message?: string
  error?: string
}

export interface BookCacheStatus {
  cachedChapters: number
  totalChapters: number
  caching: boolean
  progress?: CacheJobProgress
}

const DOWNLOAD_JOB_POLL_MIN_MS = 2500
const DOWNLOAD_JOB_POLL_MAX_MS = 5000
const DOWNLOAD_JOB_POLL_BACKOFF_MS = 500

function downloadProgressKey(job: DownloadJobSnapshot): string {
  if (!job.progress)
    return job.status
  const { phase, current, total, message } = job.progress
  return `${phase}:${current}:${total}:${message ?? ''}`
}

async function fetchJsonWithRetry<T>(url: string, retries = 5): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getJson<T>(url)
    }
    catch (error) {
      lastError = error
      if (attempt >= retries)
        throw error instanceof Error ? error : new Error(String(error))
      await new Promise(resolve => setTimeout(resolve, 1000 + attempt * 500))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function readApiError(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const json = JSON.parse(text) as { error?: string }
    if (json.error)
      return json.error
  }
  catch {
    // not json
  }
  return text || `HTTP ${response.status}`
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(await readApiError(response))
  return response.json() as Promise<T>
}

async function mutateJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok)
    throw new Error(await readApiError(response))
  return response.json() as Promise<T>
}

export function proxyImage(url?: string) {
  if (!url)
    return ''
  if (url.startsWith('/api/'))
    return url
  return `/api/proxy?url=${encodeURIComponent(url)}`
}

export const api = {
  listSources(type?: BookSourceType) {
    const query = type === undefined ? '' : `?type=${type}`
    return getJson<SourceSummary[]>(`/api/sources${query}`)
  },

  listSourcesManage() {
    return getJson<SourceManageItem[]>('/api/sources/manage')
  },

  getSourceFull(id: string) {
    return getJson<SourceFull>(`/api/sources/${encodeURIComponent(id)}/full`)
  },

  createSource(body: { id: string, name: string, config: BookSource, enabled?: boolean }) {
    return mutateJson<{ ok: boolean, id: string }>('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  },

  updateSource(id: string, body: { name?: string, config?: BookSource, enabled?: boolean }) {
    return mutateJson<{ ok: boolean }>(`/api/sources/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  },

  setSourceEnabled(id: string, enabled: boolean) {
    return mutateJson<{ ok: boolean }>(`/api/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
  },

  listBookshelf() {
    return getJson<BookshelfItem[]>('/api/bookshelf')
  },

  addBookshelf(item: { sourceId: string, bookUrl: string, name: string, author?: string, coverUrl?: string }) {
    return mutateJson<{ id: string }>('/api/bookshelf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    })
  },

  removeBookshelf(id: string) {
    return fetch(`/api/bookshelf/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(async (r) => {
      if (!r.ok)
        throw new Error(await readApiError(r))
    })
  },

  updateProgress(id: string, chapterId: string, chapterName: string) {
    return fetch(`/api/bookshelf/${encodeURIComponent(id)}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId, chapterName }),
    })
  },

  search(keyword: string, type?: BookSourceType) {
    const params = new URLSearchParams({ q: keyword })
    if (type !== undefined)
      params.set('type', String(type))
    return getJson<{ results: SearchBook[] }>(`/api/search?${params}`)
  },

  openBookByUrl(sourceId: string, bookUrl: string) {
    return getJson<BookDetailResponse>(`/api/book/open?${new URLSearchParams({ sourceId, url: bookUrl })}`)
  },

  getBook(bookshelfId: string) {
    return getJson<BookDetailResponse>(`/api/book?${new URLSearchParams({ bookshelfId })}`)
  },

  getToc(bookshelfId: string, refresh = false) {
    const params = new URLSearchParams({ bookshelfId })
    if (refresh)
      params.set('refresh', '1')
    return getJson<{ chapters: ChapterItem[] }>(`/api/toc?${params}`)
  },

  getChapter(bookshelfId: string, chapterId: string) {
    const params = new URLSearchParams({ bookshelfId, chapterId })
    return getJson<{ text?: string, images?: string[], cached?: boolean }>(`/api/chapter?${params}`)
  },

  cacheAll(bookshelfId: string) {
    return mutateJson<{ started: boolean, alreadyRunning?: boolean }>('/api/cache/all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookshelfId }),
    })
  },

  listCachedChapters(bookshelfId: string) {
    const params = new URLSearchParams({ bookshelfId })
    return getJson<{ cachedChapterIds: string[] }>(`/api/cache/chapters?${params}`)
  },

  cacheChapter(bookshelfId: string, chapterId: string) {
    return mutateJson<{ ok: boolean, alreadyCached?: boolean }>('/api/cache/chapter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookshelfId, chapterId }),
    })
  },

  getCacheStatus(bookshelfId: string, totalChapters?: number) {
    const params = new URLSearchParams({ bookshelfId })
    if (totalChapters !== undefined)
      params.set('totalChapters', String(totalChapters))
    return getJson<BookCacheStatus>(`/api/cache/status?${params}`)
  },

  startDownloadJob(
    sourceId: string,
    bookUrl: string,
    format: DownloadFormat,
    range?: { start?: number, end?: number },
  ) {
    return mutateJson<{ jobId: string }>('/api/download/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, bookUrl, format, ...range }),
    })
  },

  getDownloadJob(jobId: string, retries = 5) {
    return fetchJsonWithRetry<DownloadJobSnapshot>(`/api/download/jobs/${jobId}`, retries)
  },

  async downloadBookWithProgress(
    sourceId: string,
    bookUrl: string,
    format: DownloadFormat,
    onProgress: (job: DownloadJobSnapshot) => void,
    range?: { start?: number, end?: number },
  ) {
    const { jobId } = await this.startDownloadJob(sourceId, bookUrl, format, range)
    let lastSnapshot: DownloadJobSnapshot = {
      id: jobId,
      status: 'running',
      progress: { phase: 'toc', current: 0, total: 1, message: '任务已创建' },
    }

    let pollDelayMs = DOWNLOAD_JOB_POLL_MIN_MS
    let lastProgressKey = ''

    while (true) {
      const job = await this.getDownloadJob(jobId, 2)
      lastSnapshot = job
      onProgress(job)

      if (job.status === 'done') {
        if (job.localExport) {
          return {
            localExport: true as const,
            exportDir: job.exportDir ?? '',
            exportedFiles: job.exportedFiles ?? [],
          }
        }
        return { filename: job.filename ?? `download.${format}` }
      }

      if (job.status === 'error')
        throw new Error(job.error ?? '下载失败')

      const progressKey = downloadProgressKey(job)
      if (progressKey === lastProgressKey)
        pollDelayMs = Math.min(pollDelayMs + DOWNLOAD_JOB_POLL_BACKOFF_MS, DOWNLOAD_JOB_POLL_MAX_MS)
      else
        pollDelayMs = DOWNLOAD_JOB_POLL_MIN_MS
      lastProgressKey = progressKey

      await new Promise(resolve => setTimeout(resolve, pollDelayMs))
    }
  },

  reloadMeta(bookshelfId: string) {
    return mutateJson<{ book: BookDetailResponse, chapters: ChapterItem[] }>('/api/cache/reload-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookshelfId }),
    })
  },
}

export function getReadingProgress(bookshelfId: string): { chapterIndex: number, chapterId?: string } | null {
  try {
    const raw = localStorage.getItem('cartoon-reading-progress')
    const map = JSON.parse(raw ?? '{}') as Record<string, { chapterIndex: number, chapterId?: string }>
    return map[bookshelfId] ?? null
  }
  catch {
    return null
  }
}

export function setReadingProgress(bookshelfId: string, chapterIndex: number, chapterId?: string) {
  try {
    const raw = localStorage.getItem('cartoon-reading-progress')
    const map = JSON.parse(raw ?? '{}') as Record<string, { chapterIndex: number, chapterId?: string }>
    map[bookshelfId] = { chapterIndex, chapterId }
    localStorage.setItem('cartoon-reading-progress', JSON.stringify(map))
  }
  catch {
    // ignore
  }
}

export const DEFAULT_SOURCE_CONFIG = `{
  "bookSourceName": "新书源",
  "bookSourceUrl": "https://example.com",
  "bookSourceType": 0,
  "enabled": true,
  "searchUrl": "/search?keyword={{key}}",
  "ruleSearch": {},
  "ruleBookInfo": {},
  "ruleToc": {},
  "ruleContent": {}
}`
