import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type DownloadCenterResponse, type DownloadTaskItem } from '~/lib/api'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

interface Props {
  bookshelfId: string
  isComic: boolean
  open: boolean
  onClose: () => void
}

type StatusTab = 'all' | 'pending' | 'running' | 'completed' | 'failed' | 'paused'

const STATUS_LABELS: Record<string, string> = {
  pending: '待下载',
  running: '下载中',
  completed: '已完成',
  failed: '下载失败',
  paused: '已暂停',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'default',
  completed: 'secondary',
  failed: 'destructive',
  paused: 'outline',
}

export function DownloadCenterModal({ bookshelfId, open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<StatusTab>('all')
  const [actionMsg, setActionMsg] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['download-center', bookshelfId],
    queryFn: () => api.getDownloadCenterTasks(bookshelfId),
    enabled: open,
    refetchInterval: open ? 2000 : false,
  })

  if (!open)
    return null

  const tasks = data?.tasks ?? []
  const stats = data?.stats

  const filteredTasks: DownloadTaskItem[] = activeTab === 'all'
    ? tasks
    : tasks.filter(t => t.status === activeTab)

  const hasRunning = (stats?.running ?? 0) > 0 || (stats?.pending ?? 0) > 0
  const hasPaused = (stats?.paused ?? 0) > 0
  const hasFailed = (stats?.failed ?? 0) > 0

  async function handlePause() {
    setActionMsg('')
    try {
      await api.pauseDownloadCenter(bookshelfId)
      await queryClient.invalidateQueries({ queryKey: ['download-center', bookshelfId] })
      setActionMsg('已暂停')
    }
    catch (e) {
      setActionMsg(e instanceof Error ? e.message : '失败')
    }
  }

  async function handleResume() {
    setActionMsg('')
    try {
      await api.resumeDownloadCenter(bookshelfId)
      await queryClient.invalidateQueries({ queryKey: ['download-center', bookshelfId] })
      setActionMsg('已恢复')
    }
    catch (e) {
      setActionMsg(e instanceof Error ? e.message : '失败')
    }
  }

  async function handleRetryFailed() {
    setActionMsg('')
    try {
      await api.retryFailedDownloadTasks(bookshelfId)
      await queryClient.invalidateQueries({ queryKey: ['download-center', bookshelfId] })
      setActionMsg('已重试失败章节')
    }
    catch (e) {
      setActionMsg(e instanceof Error ? e.message : '失败')
    }
  }

  const tabs: Array<{ key: StatusTab, label: string, count?: number }> = [
    { key: 'all', label: '全部', count: stats?.total },
    { key: 'running', label: '下载中', count: stats?.running },
    { key: 'pending', label: '待下载', count: stats?.pending },
    { key: 'completed', label: '已完成', count: stats?.completed },
    { key: 'failed', label: '失败', count: stats?.failed },
    { key: 'paused', label: '已暂停', count: stats?.paused },
  ]

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
            <h2 className="font-semibold text-lg">下载中心</h2>
            {stats && (
              <p className="text-xs text-muted-foreground mt-0.5">
                共 {stats.total} 章 · 完成 {stats.completed} · 失败 {stats.failed} · 进行中 {stats.running + stats.pending}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
          >
            ×
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-4 pt-3 shrink-0 flex-wrap">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${
                activeTab === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1 text-xs opacity-80">({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 px-4 py-2 shrink-0">
          {hasRunning && (
            <Button size="sm" variant="secondary" onClick={() => void handlePause()}>
              暂停全部
            </Button>
          )}
          {hasPaused && (
            <Button size="sm" variant="secondary" onClick={() => void handleResume()}>
              继续下载
            </Button>
          )}
          {hasFailed && (
            <Button size="sm" variant="secondary" onClick={() => void handleRetryFailed()}>
              重试失败
            </Button>
          )}
          {actionMsg && (
            <span className="text-xs text-muted-foreground">{actionMsg}</span>
          )}
        </div>

        {/* Task list */}
        <div className="overflow-y-auto flex-1 px-4 pb-4">
          {isLoading && (
            <p className="text-center text-muted-foreground py-8 text-sm">加载中…</p>
          )}
          {!isLoading && filteredTasks.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              {activeTab === 'all' ? '暂无任务，请先点击「缓存全部」' : '无相关任务'}
            </p>
          )}
          <div className="space-y-1">
            {filteredTasks.map(task => (
              <div
                key={task.id}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent"
              >
                <span className="flex-1 min-w-0 truncate">{task.chapterName}</span>
                <Badge variant={STATUS_VARIANT[task.status] ?? 'outline'} className="shrink-0">
                  {STATUS_LABELS[task.status] ?? task.status}
                </Badge>
                {task.error && (
                  <span className="text-xs text-destructive shrink-0 max-w-[120px] truncate" title={task.error}>
                    {task.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
