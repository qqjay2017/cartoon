import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BookOpen, Trash2 } from 'lucide-react'
import { api, getReadingProgress, proxyImage } from '~/lib/api'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'

export function BookshelfPage() {
  const queryClient = useQueryClient()
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['bookshelf'],
    queryFn: () => api.listBookshelf(),
  })

  async function remove(id: string) {
    await api.removeBookshelf(id)
    await queryClient.invalidateQueries({ queryKey: ['bookshelf'] })
  }

  if (isLoading) {
    return <p className="text-center text-muted-foreground py-12">加载中…</p>
  }

  if (!items.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          书架还是空的，
          <Link
            to="/config"
            className="text-primary underline-offset-4 hover:underline"
          >
            去添加书籍
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const progress = getReadingProgress(item.id)
        const readTo = progress
          ? `/read/${encodeURIComponent(item.id)}/${progress.chapterIndex}`
          : `/read/${encodeURIComponent(item.id)}/0`

        return (
          <Card key={item.id} className="overflow-hidden">
            <Link to="/book/$bookshelfId" params={{ bookshelfId: item.id }}>
              <div className="mx-auto w-[140px] aspect-[3/4] bg-muted flex items-center justify-center overflow-hidden">
                {item.coverUrl ? (
                  <img
                    src={proxyImage(item.coverUrl)}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-4xl text-muted-foreground">
                    {item.name.slice(0, 1)}
                  </span>
                )}
              </div>
            </Link>
            <CardHeader className="pb-2">
              <CardTitle className="line-clamp-2 text-base">
                {item.name}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{item.sourceName}</p>
              <p className="text-xs font-mono text-muted-foreground/80">
                {item.id}
              </p>
            </CardHeader>
            {item.lastReadChapterName && (
              <CardContent className="pt-0 text-xs text-muted-foreground">
                读到：{item.lastReadChapterName}
              </CardContent>
            )}
            <CardFooter className="gap-2 flex-wrap">
              <Button variant="default" size="sm" asChild>
                <Link to="/book/$bookshelfId" params={{ bookshelfId: item.id }}>
                  详情
                </Link>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <Link to={readTo}>
                  <BookOpen className="size-3.5" />
                  继续
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void remove(item.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
