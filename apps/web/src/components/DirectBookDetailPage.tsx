import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Route } from '~/routes/_app/book-detail'
import { api, proxyImage } from '~/lib/api'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

export function DirectBookDetailPage() {
  const { sourceId, url, q, type } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: detail,
    isLoading: loadingBook,
    isError: bookError,
    error: bookErr,
  } = useQuery({
    queryKey: ['direct-book', sourceId, url],
    queryFn: () => api.openBookByUrl(sourceId, url),
    enabled: Boolean(sourceId && url),
  })

  const {
    data: tocData,
    isLoading: loadingToc,
    isError: tocError,
    error: tocErr,
  } = useQuery({
    queryKey: ['direct-toc', sourceId, url],
    queryFn: () => api.getTocByUrl(sourceId, url),
    enabled: Boolean(sourceId && url),
    retry: 1,
  })

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!detail)
        throw new Error('书籍详情未加载')
      return api.addBookshelf({
        sourceId: detail.sourceId,
        bookUrl: detail.bookUrl,
        name: detail.name,
        author: detail.author,
        coverUrl: detail.coverUrl,
      })
    },
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ['bookshelf'] })
      navigate({ to: '/book/$bookshelfId', params: { bookshelfId: id } })
    },
  })

  const chapters = tocData?.chapters ?? []
  const backSearch = q ? { q, type } : undefined

  if (!sourceId || !url) {
    return (
      <BookDetailShell backSearch={backSearch}>
        <Card>
          <CardContent className="py-12 text-center text-destructive">
            缺少书源或书籍地址
          </CardContent>
        </Card>
      </BookDetailShell>
    )
  }

  if (loadingBook) {
    return (
      <BookDetailShell backSearch={backSearch}>
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span>加载中...</span>
        </div>
      </BookDetailShell>
    )
  }

  if (bookError || !detail) {
    return (
      <BookDetailShell backSearch={backSearch}>
        <Card>
          <CardContent className="py-12 text-center text-destructive">
            {bookErr instanceof Error ? bookErr.message : '加载失败'}
          </CardContent>
        </Card>
      </BookDetailShell>
    )
  }

  return (
    <BookDetailShell backSearch={backSearch}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-4">
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
                {detail.author || '未知作者'} · {detail.sourceName}
              </p>
              {detail.intro && (
                <p className="text-sm text-muted-foreground mt-3 line-clamp-4 whitespace-pre-wrap">
                  {detail.intro}
                </p>
              )}
              <div className="mt-4">
                <Button
                  size="sm"
                  onClick={() => addMutation.mutate()}
                  disabled={addMutation.isPending}
                >
                  {addMutation.isPending ? '加入中...' : '加入书架'}
                </Button>
              </div>
              {addMutation.isError && (
                <p className="text-xs text-destructive mt-2">
                  {addMutation.error instanceof Error
                    ? addMutation.error.message
                    : '加入书架失败'}
                </p>
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
              {tocErr instanceof Error ? tocErr.message : '目录加载失败'}
            </p>
          )}
          {!loadingToc && !tocError && chapters.length === 0 && (
            <p className="text-sm text-muted-foreground mb-2">暂无章节</p>
          )}
          <div className="max-h-[420px] overflow-auto space-y-1">
            {chapters.map(ch => (
              <div
                key={ch.id ?? ch.url}
                className="rounded-md px-3 py-2 text-sm hover:bg-accent"
              >
                <span className="truncate block">{ch.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </BookDetailShell>
  )
}

function BookDetailShell({
  backSearch,
  children,
}: {
  backSearch?: { q: string, type: 0 | 2 }
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Button variant="ghost" size="sm" asChild>
        {backSearch ? (
          <Link to="/search" search={backSearch}>← 返回搜索</Link>
        ) : (
          <Link to="/config">← 返回添加</Link>
        )}
      </Button>
      {children}
    </div>
  )
}
