import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type ChapterItem, type DownloadJobSnapshot } from '~/lib/api'
import { Button } from '~/components/ui/button'

interface Props {
  bookshelfId: string
  sourceId: string
  bookUrl: string
  chapters: ChapterItem[]
  open: boolean
  onClose: () => void
}

export function CbzExportModal({ bookshelfId, chapters, open, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [exportJob, setExportJob] = useState<DownloadJobSnapshot | null>(null)
  const [exportMsg, setExportMsg] = useState('')
  const [exportError, setExportError] = useState('')

  const { data: cachedData, isLoading: loadingCached } = useQuery({
    queryKey: ['cbz-cached', bookshelfId],
    queryFn: () => api.getCbzCachedChapters(bookshelfId),
    enabled: open,
  })

  if (!open)
    return null

  const cachedSet = new Set(cachedData?.cachedChapterIds ?? [])
  const cachedChapters = chapters.filter(ch => ch.id && cachedSet.has(ch.id))

  // Auto-generate 100-chapter range buttons based on total chapter list
  const rangeButtons: Array<{
    label: string
    cachedCount: number
    total: number
    chapterIds: string[]
  }> = []

  for (let start = 0; start < chapters.length; start += 100) {
    const end = Math.min(start + 99, chapters.length - 1)
    const rangeChapters = chapters.slice(start, end + 1)
    const cachedInRange = rangeChapters.filter(ch => ch.id && cachedSet.has(ch.id))
    if (cachedInRange.length > 0) {
      rangeButtons.push({
        label: `第${start + 1}-${end + 1}章`,
        cachedCount: cachedInRange.length,
        total: rangeChapters.length,
        chapterIds: cachedInRange.map(ch => ch.id!),
      })
    }
  }

  function selectRange(ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = ids.every(id => next.has(id))
      if (allSelected) {
        ids.forEach(id => next.delete(id))
      }
      else {
        ids.forEach(id => next.add(id))
      }
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(cachedChapters.map(ch => ch.id!)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  function toggleChapter(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id))
        next.delete(id)
      else
        next.add(id)
      return next
    })
  }

  async function exportCbz() {
    if (!selected.size || exporting)
      return

    const orderedIds = chapters
      .filter(ch => ch.id && selected.has(ch.id))
      .map(ch => ch.id!)

    setExporting(true)
    setExportMsg('')
    setExportError('')
    setExportJob(null)

    try {
      const { jobId } = await api.startCbzExport(bookshelfId, orderedIds)

      let pollDelayMs = 2000
      while (true) {
        await new Promise(resolve => setTimeout(resolve, pollDelayMs))
        const job = await api.getDownloadJob(jobId, 2)
        setExportJob(job)

        if (job.status === 'done') {
          const files = job.exportedFiles?.join('、') ?? ''
          setExportMsg(`已导出 ${job.exportedFiles?.length ?? 1} 个文件到 ${job.exportDir}：${files}`)
          break
        }
        if (job.status === 'error') {
          setExportError(job.error ?? '导出失败')
          break
        }
        pollDelayMs = Math.min(pollDelayMs + 500, 4000)
      }
    }
    catch (e) {
      setExportError(e instanceof Error ? e.message : '导出失败')
    }
    finally {
      setExporting(false)
      setExportJob(null)
    }
  }

  function formatExportProgress() {
    if (!exportJob?.progress)
      return '准备中…'
    const { phase, current, total, message } = exportJob.progress
    if (phase === 'pack')
      return `打包中 ${current}/${total}${message ? ` · ${message}` : ''}`
    return message ?? '处理中…'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        role="presentation"
      />
      <div className="relative z-10 bg-background rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-lg">导出 CBZ</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              已缓存 {cachedChapters.length} / {chapters.length} 章，已选 {selected.size} 章
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
          >
            ×
          </button>
        </div>

        {/* Range quick-select buttons */}
        {rangeButtons.length > 0 && (
          <div className="px-4 pt-3 shrink-0">
            <p className="text-xs text-muted-foreground mb-2">按卷快速选择（仅显示含缓存的范围）：</p>
            <div className="flex flex-wrap gap-2">
              {rangeButtons.map(btn => {
                const isFullySelected = btn.chapterIds.every(id => selected.has(id))
                return (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={() => selectRange(btn.chapterIds)}
                    className={`px-3 py-1 rounded-md text-sm border transition-colors ${
                      isFullySelected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted border-muted-foreground/20 hover:bg-accent'
                    }`}
                  >
                    {btn.label}
                    <span className="ml-1 text-xs opacity-70">
                      ({btn.cachedCount}/{btn.total})
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Bulk actions */}
        <div className="flex items-center gap-2 px-4 py-2 shrink-0">
          <Button size="sm" variant="outline" onClick={selectAll} disabled={cachedChapters.length === 0}>
            全选已缓存
          </Button>
          <Button size="sm" variant="outline" onClick={clearAll} disabled={selected.size === 0}>
            取消全选
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">
            每 100 章生成一个 CBZ 文件
          </span>
        </div>

        {/* Chapter list */}
        <div className="overflow-y-auto flex-1 border-t">
          {loadingCached && (
            <p className="text-center text-muted-foreground py-8 text-sm">加载中…</p>
          )}
          {!loadingCached && cachedChapters.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              暂无缓存章节，请先缓存后再导出
            </p>
          )}
          <div className="divide-y">
            {chapters.map((ch, i) => {
              const isCached = ch.id && cachedSet.has(ch.id)
              const isSelected = ch.id ? selected.has(ch.id) : false
              if (!isCached)
                return null
              return (
                <label
                  key={ch.id ?? ch.url}
                  className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => ch.id && toggleChapter(ch.id)}
                    className="accent-primary shrink-0"
                  />
                  <span className="text-xs text-muted-foreground w-10 shrink-0">
                    {i + 1}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm">{ch.name}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t p-4 shrink-0 space-y-2">
          {exporting && (
            <p className="text-xs text-muted-foreground">{formatExportProgress()}</p>
          )}
          {exportMsg && (
            <p className="text-xs text-muted-foreground break-all">{exportMsg}</p>
          )}
          {exportError && (
            <p className="text-xs text-destructive">{exportError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button
              onClick={() => void exportCbz()}
              disabled={selected.size === 0 || exporting}
            >
              {exporting ? '导出中…' : `导出选中 ${selected.size} 章`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
