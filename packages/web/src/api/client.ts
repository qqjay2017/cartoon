import type { BookSourceType, BookshelfItem, ChapterContent, SearchBook } from '@cartoon/core'

export interface SourceSummary {
  id: string
  name: string
  type: BookSourceType
  group?: string
  url: string
  cookieJar?: boolean
}

export interface SourceCookiesResponse {
  sourceId: string
  cookies: string
  configured: boolean
}

export interface BookDetailResponse extends SearchBook {
  tocUrl?: string
}

export interface ChapterItem {
  name: string
  url: string
  updateTime?: string
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

function isTransientFetchError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError')
    return true
  if (error instanceof TypeError)
    return true
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return msg.includes('aborted')
      || msg.includes('failed to fetch')
      || msg.includes('network')
      || msg.includes('load failed')
  }
  return false
}

function normalizeFetchError(error: unknown): Error {
  if (isTransientFetchError(error))
    return new Error('网络连接暂时中断，后台任务可能仍在进行，请稍候…')
  if (error instanceof Error)
    return error
  return new Error(String(error))
}

async function fetchJsonWithRetry<T>(url: string, retries = 5): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getJson<T>(url)
    }
    catch (error) {
      lastError = error
      if (!isTransientFetchError(error) || attempt >= retries)
        throw normalizeFetchError(error)
      await new Promise(resolve => setTimeout(resolve, 1000 + attempt * 500))
    }
  }
  throw normalizeFetchError(lastError)
}

function triggerBrowserDownload(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
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

const DOWNLOAD_JOB_POLL_MIN_MS = 2500
const DOWNLOAD_JOB_POLL_MAX_MS = 5000
const DOWNLOAD_JOB_POLL_BACKOFF_MS = 500

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

function downloadProgressKey(job: DownloadJobSnapshot): string {
  if (!job.progress)
    return job.status
  const { phase, current, total, message } = job.progress
  return `${job.status}:${phase}:${current}:${total}:${message ?? ''}`
}

export const api = {
  listSources(type?: BookSourceType) {
    const query = type === undefined ? '' : `?type=${type}`
    return getJson<SourceSummary[]>(`/api/sources${query}`)
  },

  getSourceCookies(sourceId: string) {
    return getJson<SourceCookiesResponse>(`/api/sources/${encodeURIComponent(sourceId)}/cookies`)
  },

  async setSourceCookies(sourceId: string, cookies: string) {
    const response = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/cookies`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies }),
    })
    if (!response.ok)
      throw new Error(await readApiError(response))
    return response.json() as Promise<SourceCookiesResponse>
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

  openBookByUrl(sourceId: string, bookUrl: string) {
    return getJson<BookDetailResponse>(`/api/book/open?${new URLSearchParams({ sourceId, url: bookUrl })}`)
  },

  getToc(sourceId: string, url: string) {
    const params = new URLSearchParams({ sourceId, url })
    return getJson<{ chapters: ChapterItem[] }>(`/api/toc?${params}`)
  },

  getChapter(sourceId: string, url: string, bookUrl?: string, tocUrl?: string) {
    const params = new URLSearchParams({ sourceId, url })
    if (bookUrl)
      params.set('bookUrl', bookUrl)
    if (tocUrl)
      params.set('tocUrl', tocUrl)
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

  startDownloadJob(sourceId: string, bookUrl: string, format: DownloadFormat) {
    return fetch('/api/download/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, bookUrl, format }),
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(await response.text())
      return response.json() as Promise<{ jobId: string }>
    })
  },

  getDownloadJob(jobId: string, retries = 5) {
    return fetchJsonWithRetry<DownloadJobSnapshot>(`/api/download/jobs/${jobId}`, retries)
  },

  triggerDownloadJobFile(jobId: string, filename: string) {
    triggerBrowserDownload(`/api/download/jobs/${jobId}/file`, filename)
  },

  async downloadBookWithProgress(
    sourceId: string,
    bookUrl: string,
    format: DownloadFormat,
    onProgress: (job: DownloadJobSnapshot) => void,
  ) {
    const { jobId } = await this.startDownloadJob(sourceId, bookUrl, format)
    let lastSnapshot: DownloadJobSnapshot = {
      id: jobId,
      status: 'running',
      progress: { phase: 'toc', current: 0, total: 1, message: '任务已创建' },
    }

    let pollDelayMs = DOWNLOAD_JOB_POLL_MIN_MS
    let lastProgressKey = ''

    while (true) {
      try {
        const job = await this.getDownloadJob(jobId, 2)
        lastSnapshot = job
        onProgress(job)

        if (job.status === 'done') {
          if (job.localExport) {
            return {
              localExport: true,
              exportDir: job.exportDir ?? '',
              exportedFiles: job.exportedFiles ?? [],
            }
          }

          const filename = job.filename ?? `download.${format}`
          this.triggerDownloadJobFile(jobId, filename)
          return { filename }
        }

        if (job.status === 'error')
          throw new Error(job.error ?? '下载失败')

        const progressKey = downloadProgressKey(job)
        if (progressKey === lastProgressKey)
          pollDelayMs = Math.min(pollDelayMs + DOWNLOAD_JOB_POLL_BACKOFF_MS, DOWNLOAD_JOB_POLL_MAX_MS)
        else {
          pollDelayMs = DOWNLOAD_JOB_POLL_MIN_MS
          lastProgressKey = progressKey
        }
      }
      catch (error) {
        if (isTransientFetchError(error)) {
          onProgress(lastSnapshot)
          await new Promise(resolve => setTimeout(resolve, DOWNLOAD_JOB_POLL_MIN_MS))
          continue
        }
        throw normalizeFetchError(error)
      }

      await new Promise(resolve => setTimeout(resolve, pollDelayMs))
    }
  },

  getCacheConfig() {
    return getJson<{ comicDir: string, novelDir?: string }>('/api/cache/config')
  },

  setCacheConfig(dir: string, type: 'comic' | 'novel' = 'comic') {
    return fetch('/api/cache/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(type === 'novel' ? { novelDir: dir } : { comicDir: dir }),
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(await response.text())
      return response.json() as Promise<{ comicDir?: string, novelDir?: string }>
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
