import type { SearchBook } from '@cartoon/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, proxyImage } from '~/lib/api'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

export function AddBookPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [manualSourceId, setManualSourceId] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState<SearchBook[]>([])

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.listSources(0),
  })

  async function search() {
    if (!keyword.trim())
      return
    setError('')
    try {
      const data = await api.search(keyword.trim(), 0)
      setResults(data.results)
    }
    catch (e) {
      setError(e instanceof Error ? e.message : '搜索失败')
    }
  }

  async function addToBookshelf(book: SearchBook) {
    try {
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
    catch (e) {
      setError(e instanceof Error ? e.message : '添加失败')
    }
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
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-md flex-1"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="输入关键词"
              onKeyDown={e => e.key === 'Enter' && void search()}
            />
            <Button onClick={() => void search()}>搜索</Button>
          </div>
          {results.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {results.map(book => (
                <Card key={`${book.sourceId}-${book.bookUrl}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{book.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{book.author} · {book.sourceName}</p>
                  </CardHeader>
                  <CardFooter>
                    <Button size="sm" onClick={() => void addToBookshelf(book)}>加入书架</Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
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
