import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  api,
  proxyImage,
  type BookCacheStatus,
  type DownloadJobSnapshot,
} from '~/lib/api'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { DownloadCenterModal } from '~/components/DownloadCenterModal'
import { CbzExportModal } from '~/components/CbzExportModal'

interface Props {
  bookshelfId: string
}

export function BookDetailView({ bookshelfId }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [cacheMsg, setCacheMsg] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadMsg, setDownloadMsg] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [downloadJob, setDownloadJob] = useState<DownloadJobSnapshot | null>(null)
  const [cachingChapterIndex, setCachingChapterIndex] = useState<number | null>(null)
  const [showDownloadCenter, setShowDownloadCenter] = useState(false)
  const [showCbzExport, setShowCbzExport] = useState(false)

  const {
    data: detail,
    isLoading: loadingBook,
    error: bookError,
  } = useQuery({
    queryKey: ['book', bookshelfId],
    queryFn: () => api.getBook(bookshelfId),
  })

  const {
    data: tocData,
    isLoading: loadingToc,
    isError: tocError,
    error: tocErr,
    refetch: refetchToc,
  } = useQuery({
    queryKey: ['toc', bookshelfId],
    queryFn: () => api.getToc(bookshelfId),
    enabled: Boolean(detail),
    retry: 1,
  })

  const chapters = tocData?.chapters ?? []

  const { data: cacheStatus, refetch: refetchCache } = useQuery({
    queryKey: ['cache-status', bookshelfId, chapters.length],
    queryFn: () => api.getCacheStatus(bookshelfId, chapters.length),
    enabled: chapters.length > 0,
    refetchInterval: (q) => (q.state.data?.caching ? 2000 : false),
  })

  const { data: cachedChaptersData, refetch: refetchCachedChapters } = useQuery({
    queryKey: ['cached-chapters', bookshelfId],
    queryFn: () => api.listCachedChapters(bookshelfId),
    enabled: chapters.length > 0,
    refetchInterval: cacheStatus?.caching ? 2000 : false,
  })

  const cachedChapterIds = new Set(cachedChaptersData?.cachedChapterIds ?? [])

  async function cacheAll() {
    setCacheMsg('')
    try {
      const r = await api.cacheAll(bookshelfId)
      setCacheMsg(r.alreadyRunning ? '缓存任务已在运行' : '已开始缓存全部章节，可在下载中心查看进度')
      await refetchCache()
      await refetchCachedChapters()
    }
    catch (e) {
      setCacheMsg(e instanceof Error ? e.message : '失败')
    }
  }

  async function reloadMeta() {
    setCacheMsg('')
    try {
      await api.reloadMeta(bookshelfId)
      await queryClient.invalidateQueries({ queryKey: ['book', bookshelfId] })
      await queryClient.invalidateQueries({ queryKey: ['toc', bookshelfId] })
      setCacheMsg('元数据已刷新')
    }
    catch (e) {
      setCacheMsg(e instanceof Error ? e.message : '失败')
    }
  }

  async function cacheChapterAt(index: number) {
    const chapter = chapters[index]
    if (!chapter?.id || cachingChapterIndex !== null || cacheStatus?.caching)
      return

    const force = cachedChapterIds.has(chapter.id)
    setCachingChapterIndex(index)
    setCacheMsg('')

    try {
      const result = await api.cacheChapter(bookshelfId, chapter.id, force)
      const chapterName = chapter.name ?? `第 ${index + 1} 章`
      if (result.refreshed)
        setCacheMsg(`「${chapterName}」已重新缓存`)
      else if (result.alreadyCached)
        setCacheMsg(`「${chapterName}」已在缓存中`)
      else
        setCacheMsg(`「${chapterName}」已缓存`)
      await refetchCache()
      await refetchCachedChapters()
    }
    catch (e) {
      setCacheMsg(e instanceof Error ? e.message : '缓存失败')
    }
    finally {
      setCachingChapterIndex(null)
    }
  }

  async function exportBook(format: 'epub') {
    if (!detail || downloading)
      return

    setDownloading(true)
    setDownloadError('')
    setDownloadMsg('')
    setDownloadJob(null)

    try {
      const result = await api.downloadBookWithProgress(
        detail.sourceId,
        detail.bookUrl,
        format,
        setDownloadJob,
        undefined,
        bookshelfId,
      )
      if ('localExport' in result && result.localExport) {
        const files = result.exportedFiles.join('、')
        setDownloadMsg(`已导出 ${result.exportedFiles.length} 个文件到 ${result.exportDir}：${files}`)
      }
    }
    catch (e) {
      setDownloadError(e instanceof Error ? e.message : '导出失败')
    }
    finally {
      setDownloading(false)
      setDownloadJob(null)
      await refetchCache()
    }
  }

  if (loadingBook)
    return <p className="text-center text-muted-foreground py-12">加载中…</p>

  if (bookError || !detail)
    return (
      <p className="text-center text-destructive py-12">
        {bookError instanceof Error ? bookError.message : '加载失败'}
      </p>
    )

  const isComic = detail.sourceType === 2

  function formatCacheProgress(status: BookCacheStatus | undefined, chapterCount: number) {
    if (!status)
      return ''
    const total = status.totalChapters || chapterCount
    if (status.caching && status.progress) {
      const { current, total: progressTotal, message } = status.progress
      const suffix = message ? ` · ${message}` : ''
      return `缓存中 ${current}/${progressTotal || total}${suffix}`
    }
    return `已缓存 ${status.cachedChapters}/${total} 章`
  }

  function formatDownloadProgress(job: DownloadJobSnapshot | null) {
    const progress = job?.progress
    if (!progress)
      return '准备导出...'
    if (progress.phase === 'toc')
      return progress.message ?? '获取目录'
    if (progress.phase === 'pack') {
      if (progress.total > 1)
        return `${progress.message ?? '正在打包'} (${progress.current}/${progress.total})`
      return progress.message ?? '正在打包'
    }
    const cacheHint = progress.cachedChapters
      ? ` · 已用缓存 ${progress.cachedChapters} 章`
      : ''
    return `${progress.current}/${progress.total} 章 · ${progress.message ?? ''}${cacheHint}`
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/">← 书架</Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex gap-4 flex-wrap">
            <div className="w-[140px] shrink-0 aspect-[3/4] rounded-md overflow-hidden bg-muted">
              {detail.coverUrl ? (
                <img
                  src={proxyImage(detail.coverUrl)}
                  alt={detail.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full items-center justify-center text-3xl text-muted-foreground">
                  {detail.name.slice(0, 1)}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-[200px]">
              <CardTitle>{detail.name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {detail.author} · {detail.sourceName}
              </p>
              <p className="text-xs font-mono text-muted-foreground mt-1">
                {bookshelfId}
              </p>
              {detail.intro && (
                <p className="text-sm text-muted-foreground mt-3 line-clamp-4 whitespace-pre-wrap">
                  {detail.intro}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                <Button
                  size="sm"
                  onClick={() => void cacheAll()}
                  disabled={cacheStatus?.caching}
                >
                  {cacheStatus?.caching ? '缓存进行中...' : '缓存全部'}
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowDownloadCenter(true)}
                >
                  下载中心
                </Button>

                {isComic ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowCbzExport(true)}
                    disabled={!chapters.length}
                  >
                    导出 CBZ
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void exportBook('epub')}
                    disabled={downloading || !chapters.length}
                  >
                    {downloading ? '导出中...' : '导出 EPUB'}
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void reloadMeta()}
                  disabled={isComic}
                >
                  刷新目录
                </Button>
              </div>
              {cacheStatus && (
                <p className="text-xs text-muted-foreground mt-2">
                  {formatCacheProgress(cacheStatus, chapters.length)}
                </p>
              )}
              {isComic && (
                <p className="text-xs text-muted-foreground mt-1">
                  导出 CBZ 前需先缓存章节，每 100 章生成一个文件，保存至本地导出目录。
                </p>
              )}
              {!isComic && !downloading && cacheStatus && cacheStatus.cachedChapters > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  导出 EPUB 时将优先读取本地缓存（已缓存 {cacheStatus.cachedChapters}/{chapters.length || cacheStatus.totalChapters} 章）。
                </p>
              )}
              {downloading && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDownloadProgress(downloadJob)}
                </p>
              )}
              {downloadError && (
                <p className="text-xs text-destructive mt-1">{downloadError}</p>
              )}
              {downloadMsg && (
                <p className="text-xs text-muted-foreground mt-1">{downloadMsg}</p>
              )}
              {cacheMsg && (
                <p className="text-xs text-muted-foreground mt-1">{cacheMsg}</p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <h3 className="font-medium mb-2">
            目录 {loadingToc ? '(加载中)' : `(${chapters.length})`}
          </h3>
          {tocError && (
            <p className="text-sm text-destructive mb-2">
              {tocErr instanceof Error ? tocErr.message : '目录加载失败'}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void refetchToc()}
              >
                重试
              </button>
            </p>
          )}
          {!loadingToc && !tocError && chapters.length === 0 && (
            <p className="text-sm text-muted-foreground mb-2">
              暂无章节，
              <button
                type="button"
                className="underline"
                onClick={() => void refetchToc()}
              >
                重新拉取
              </button>
            </p>
          )}
          <div className="max-h-[420px] overflow-auto space-y-1">
            {chapters.map((ch, index) => (
              <div
                key={ch.id ?? ch.url}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left"
                  onClick={() =>
                    navigate({
                      to: '/read/$bookshelfId/$chapterIndex',
                      params: { bookshelfId, chapterIndex: String(index) },
                    })
                  }
                >
                  <span className="truncate block">{ch.name}</span>
                </button>
                {ch.id && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0 h-7 px-2"
                    disabled={
                      cacheStatus?.caching
                      || (cachingChapterIndex !== null && cachingChapterIndex !== index)
                    }
                    onClick={() => void cacheChapterAt(index)}
                  >
                    {cachingChapterIndex === index
                      ? '缓存中'
                      : cachedChapterIds.has(ch.id)
                        ? '重新缓存'
                        : '缓存'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {showDownloadCenter && (
        <DownloadCenterModal
          bookshelfId={bookshelfId}
          isComic={isComic}
          open={showDownloadCenter}
          onClose={() => setShowDownloadCenter(false)}
        />
      )}

      {isComic && showCbzExport && (
        <CbzExportModal
          bookshelfId={bookshelfId}
          sourceId={detail.sourceId}
          bookUrl={detail.bookUrl}
          chapters={chapters}
          open={showCbzExport}
          onClose={() => setShowCbzExport(false)}
        />
      )}
    </div>
  )
}
