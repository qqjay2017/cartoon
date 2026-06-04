import type { BookSource } from '@cartoon/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, DEFAULT_SOURCE_CONFIG } from '~/lib/api'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'

interface Props {
  mode: 'create' | 'edit'
  sourceId?: string
}

export function SourceEditorPage({ mode, sourceId }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [configText, setConfigText] = useState(DEFAULT_SOURCE_CONFIG)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: existing, isLoading } = useQuery({
    queryKey: ['source-full', sourceId],
    queryFn: () => api.getSourceFull(sourceId!),
    enabled: mode === 'edit' && Boolean(sourceId),
  })

  useEffect(() => {
    if (existing) {
      setId(existing.id)
      setName(existing.name)
      setEnabled(existing.enabled)
      setConfigText(JSON.stringify(existing.config, null, 2))
    }
  }, [existing])

  function parseConfig(): BookSource | null {
    try {
      return JSON.parse(configText) as BookSource
    }
    catch {
      return null
    }
  }

  async function save() {
    setError('')
    const config = parseConfig()
    if (!config) {
      setError('配置 JSON 格式无效')
      return
    }

    setSaving(true)
    try {
      if (mode === 'create') {
        await api.createSource({ id: id.trim(), name: name.trim(), config, enabled })
        await queryClient.invalidateQueries({ queryKey: ['sources-manage'] })
        await queryClient.invalidateQueries({ queryKey: ['sources'] })
        navigate({ to: '/sources' })
      }
      else if (sourceId) {
        await api.updateSource(sourceId, { name: name.trim(), config, enabled })
        await queryClient.invalidateQueries({ queryKey: ['sources-manage'] })
        await queryClient.invalidateQueries({ queryKey: ['sources'] })
        await queryClient.invalidateQueries({ queryKey: ['source-full', sourceId] })
        navigate({ to: '/sources' })
      }
    }
    catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
    finally {
      setSaving(false)
    }
  }

  if (mode === 'edit' && isLoading) {
    return <p className="text-muted-foreground py-8">加载中…</p>
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/sources">← 返回书源列表</Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{mode === 'create' ? '新增书源' : '编辑书源'}</CardTitle>
          <CardDescription>
            填写唯一的书源 ID、显示名称，以及 Legado 格式的配置 JSON（存于数据库）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="source-id">书源 ID</Label>
              <Input
                id="source-id"
                value={id}
                onChange={e => setId(e.target.value)}
                disabled={mode === 'edit'}
                placeholder="genwohua"
              />
              {mode === 'edit' && (
                <p className="text-xs text-muted-foreground">编辑时不可修改 ID</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-name">显示名称</Label>
              <Input
                id="source-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="天命皆烬小说"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="enabled">启用此书源</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="config">配置 JSON</Label>
            <Textarea
              id="config"
              className="min-h-[320px]"
              value={configText}
              onChange={e => setConfigText(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/sources">取消</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
