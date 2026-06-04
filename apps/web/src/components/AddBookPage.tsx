import type { BookSourceType } from '@cartoon/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '~/lib/api'
import { SEARCH_TYPE_OPTIONS } from '~/lib/search-types'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

export function AddBookPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [searchType, setSearchType] = useState<BookSourceType>(0)
  const [manualSourceId, setManualSourceId] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [error, setError] = useState('')

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.listSources(),
  })

  function goSearch() {
    const q = keyword.trim()
    if (!q)
      return
    setError('')
    navigate({
      to: '/search',
      search: { q, type: searchType },
    })
  }

  async function openManual() {
    if (!manualSourceId || !manualUrl.trim())
      return
    setError('')
    try {
      const detail = await api.openBookByUrl(manualSourceId, manualUrl.trim())
      const { id } = await api.addBookshelf({
        sourceId: detail.sourceId,
        bookUrl: detail.bookUrl,
        name: detail.name,
        author: detail.author,
        coverUrl: detail.coverUrl,
      })
      await queryClient.invalidateQueries({ queryKey: ['bookshelf'] })
      navigate({ to: '/book/$bookshelfId', params: { bookshelfId: id } })
    }
    catch (e) {
      setError(e instanceof Error ? e.message : '打开失败')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>搜索添加</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="search-keyword">关键词</Label>
            <Input
              id="search-keyword"
              className="max-w-lg"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="书名、作者等"
              onKeyDown={e => e.key === 'Enter' && goSearch()}
            />
          </div>
          <div className="space-y-2">
            <Label>搜索类型</Label>
            <div className="flex flex-wrap gap-2">
              {SEARCH_TYPE_OPTIONS.map(opt => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={searchType === opt.value ? 'default' : 'outline'}
                  onClick={() => setSearchType(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
          <Button onClick={goSearch} disabled={!keyword.trim()}>
            搜索
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>手动添加</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            粘贴书籍详情页，如 https://www.genwohua.com/xs/4854/
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>书源</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={manualSourceId}
                onChange={e => setManualSourceId(e.target.value)}
              >
                <option value="">选择书源</option>
                {sources.filter(s => s.enabled !== false).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>书籍 URL</Label>
              <Input
                value={manualUrl}
                onChange={e => setManualUrl(e.target.value)}
                placeholder="https://www.genwohua.com/xs/4854/"
              />
            </div>
          </div>
          <Button onClick={() => void openManual()}>添加</Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
