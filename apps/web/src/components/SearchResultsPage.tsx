import type { ReactNode } from 'react'
import type { SearchBook } from '@cartoon/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, SearchX } from 'lucide-react'
import { Route } from '~/routes/_app/search'
import { api } from '~/lib/api'
import { searchTypeLabel } from '~/lib/search-types'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'

export function SearchResultsPage() {
  const { q, type } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['search', q, type],
    queryFn: () => api.search(q, type),
    enabled: q.length > 0,
    staleTime: 60_000,
  })

  const results = data?.results ?? []
  const loading = q.length > 0 && (isLoading || (isFetching && !data))

  async function addToBookshelf(book: SearchBook) {
    const { id } = await api.addBookshelf({
      sourceId: book.sourceId,
      bookUrl: book.bookUrl,
      name: book.name,
      author: book.author,
      coverUrl: book.coverUrl,
    })
    await queryClient.invalidateQueries({ queryKey: ['bookshelf'] })
    navigate({ to: '/book/$bookshelfId', params: { bookshelfId: id } })
  }

  if (!q) {
    return (
      <SearchShell title="搜索">
        <EmptyState
          icon={<SearchX className="size-10 text-muted-foreground" />}
          title="暂无搜索关键词"
          description="请从添加页输入关键词并选择类型后搜索。"
          action={(
            <Button asChild variant="secondary">
              <Link to="/config">去搜索</Link>
            </Button>
          )}
        />
      </SearchShell>
    )
  }

  return (
    <SearchShell
      title="搜索结果"
      subtitle={`「${q}」· ${searchTypeLabel(type)}`}
    >
      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p>正在搜索，请稍候…</p>
        </div>
      )}

      {isError && !loading && (
        <EmptyState
          icon={<SearchX className="size-10 text-destructive" />}
          title="搜索失败"
          description={error instanceof Error ? error.message : '请稍后重试'}
          action={(
            <Button asChild variant="secondary">
              <Link to="/config">修改关键词</Link>
            </Button>
          )}
        />
      )}

      {!loading && !isError && results.length === 0 && (
        <EmptyState
          icon={<SearchX className="size-10 text-muted-foreground" />}
          title="没有找到相关书籍"
          description={`未在${searchTypeLabel(type)}书源中搜到「${q}」，可换关键词或切换类型再试。`}
          action={(
            <Button asChild variant="secondary">
              <Link to="/config">重新搜索</Link>
            </Button>
          )}
        />
      )}

      {!loading && !isError && results.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            共找到
            {' '}
            {results.length}
            {' '}
            条结果
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {results.map(book => (
              <Card key={`${book.sourceId}-${book.bookUrl}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base line-clamp-2">{book.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {book.author || '未知作者'}
                    {' '}
                    ·
                    {' '}
                    {book.sourceName}
                  </p>
                  {book.intro && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{book.intro}</p>
                  )}
                </CardHeader>
                <CardFooter className="gap-2">
                  <Button size="sm" onClick={() => void addToBookshelf(book)}>加入书架</Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link
                      to="/book-detail"
                      search={{
                        sourceId: book.sourceId,
                        url: book.bookUrl,
                        q,
                        type,
                      }}
                    >
                      查看
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </>
      )}
    </SearchShell>
  )
}

function SearchShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/config">← 返回添加</Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        {icon}
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground max-w-md">{description}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  )
}
