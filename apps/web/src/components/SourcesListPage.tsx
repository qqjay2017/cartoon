import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus } from 'lucide-react'
import { api } from '~/lib/api'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Switch } from '~/components/ui/switch'

export function SourcesListPage() {
  const queryClient = useQueryClient()
  const { data: sources = [], isLoading } = useQuery({
    queryKey: ['sources-manage'],
    queryFn: () => api.listSourcesManage(),
  })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string, enabled: boolean }) =>
      api.setSourceEnabled(id, !enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources-manage'] })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">书源配置</h2>
          <p className="text-sm text-muted-foreground">书源保存在数据库，ID 与名称均不可重复</p>
        </div>
        <Button asChild>
          <Link to="/sources/new"><Plus className="size-4" />新增书源</Link>
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground">加载中…</p>}

      <div className="space-y-3">
        {sources.map(source => (
          <Card key={source.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  {source.name}
                  <Badge variant={source.enabled ? 'default' : 'secondary'}>
                    {source.enabled ? '启用' : '禁用'}
                  </Badge>
                  <Badge variant="outline">{source.type === 2 ? '漫画' : '小说'}</Badge>
                </CardTitle>
                <CardDescription className="font-mono text-xs mt-1">
                  {source.id} · {source.url}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={source.enabled}
                  onCheckedChange={() => toggle.mutate({ id: source.id, enabled: source.enabled })}
                />
                <Button variant="outline" size="sm" asChild>
                  <Link to="/sources/$sourceId" params={{ sourceId: source.id }}>
                    <Pencil className="size-3.5" />编辑
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              更新于 {new Date(source.updatedAt).toLocaleString()}
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && sources.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            暂无书源，请点击「新增书源」
          </CardContent>
        </Card>
      )}
    </div>
  )
}
