import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, proxyImage } from '~/lib/api'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

interface Props {
  bookshelfId: string
}

export function BookDetailView({ bookshelfId }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [cacheMsg, setCacheMsg] = useState('')

  const { data: detail, isLoading: loadingBook, error: bookError } = useQuery({
    queryKey: ['book', bookshelfId],
    queryFn: () => api.getBook(bookshelfId),
  })

  const { data: tocData, isLoading: loadingToc, isError: tocError, error: tocErr, refetch: refetchToc } = useQuery({
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
    refetchInterval: q => (q.state.data?.caching ? 2000 : false),
  })

  async function cacheAll() {
    setCacheMsg('')
    try {
      const r = await api.cacheAll(bookshelfId)
      setCacheMsg(r.alreadyRunning ? '缓存任务已在运行' : '已开始缓存全部章节')
      await refetchCache()
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

  if (loadingBook)
    return <p className="text-center text-muted-foreground py-12">加载中…</p>

  if (bookError || !detail)
    return <p className="text-center text-destructive py-12">{bookError instanceof Error ? bookError.message : '加载失败'}</p>

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/">← 书架</Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex gap-4 flex-wrap">
            <div className="w-28 shrink-0 aspect-[3/4] rounded-md overflow-hidden bg-muted">
              {detail.coverUrl
                ? <img src={proxyImage(detail.coverUrl)} alt={detail.name} className="h-full w-full object-cover" />
                : <span className="flex h-full items-center justify-center text-3xl text-muted-foreground">{detail.name.slice(0, 1)}</span>}
            </div>
            <div className="flex-1 min-w-[200px]">
              <CardTitle>{detail.name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{detail.author} · {detail.sourceName}</p>
              <p className="text-xs font-mono text-muted-foreground mt-1">{bookshelfId}</p>
              {detail.intro && (
                <p className="text-sm text-muted-foreground mt-3 line-clamp-4 whitespace-pre-wrap">{detail.intro}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" onClick={() => void cacheAll()}>缓存全部</Button>
                <Button size="sm" variant="secondary" onClick={() => void reloadMeta()}>刷新目录</Button>
              </div>
              {cacheStatus && (
                <p className="text-xs text-muted-foreground mt-2">
                  已缓存 {cacheStatus.cachedChapters}/{cacheStatus.totalChapters || chapters.length} 章
                </p>
              )}
              {cacheMsg && <p className="text-xs text-muted-foreground mt-1">{cacheMsg}</p>}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <h3 className="font-medium mb-2">目录 {loadingToc ? '(加载中)' : `(${chapters.length})`}</h3>
          {tocError && (
            <p className="text-sm text-destructive mb-2">
              {tocErr instanceof Error ? tocErr.message : '目录加载失败'}
              {' '}
              <button type="button" className="underline" onClick={() => void refetchToc()}>重试</button>
            </p>
          )}
          {!loadingToc && !tocError && chapters.length === 0 && (
            <p className="text-sm text-muted-foreground mb-2">
              暂无章节，
              <button type="button" className="underline" onClick={() => void refetchToc()}>重新拉取</button>
            </p>
          )}
          <div className="max-h-[420px] overflow-auto space-y-1">
            {chapters.map((ch, index) => (
              <button
                key={ch.id ?? ch.url}
                type="button"
                className="w-full flex justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => navigate({
                  to: '/read/$bookshelfId/$chapterIndex',
                  params: { bookshelfId, chapterIndex: String(index) },
                })}
              >
                <span className="truncate">{ch.name}</span>
                {ch.id && <span className="text-xs text-muted-foreground shrink-0">{ch.id}</span>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
