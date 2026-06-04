import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { api, getReadingProgress, setReadingProgress } from '~/lib/api'

interface Props {
  bookshelfId: string
  chapterIndex: number
  onChapterChange: (index: number) => void
}

export function ReaderView({ bookshelfId, chapterIndex, onChapterChange }: Props) {

  const { data: tocData } = useQuery({
    queryKey: ['toc', bookshelfId],
    queryFn: () => api.getToc(bookshelfId),
  })

  const chapters = tocData?.chapters ?? []
  const chapter = chapters[chapterIndex]
  const chapterId = chapter?.id ?? String(chapterIndex)

  const { data: content, isLoading } = useQuery({
    queryKey: ['chapter', bookshelfId, chapterId],
    queryFn: () => api.getChapter(bookshelfId, chapterId),
    enabled: Boolean(chapter),
  })

  useEffect(() => {
    if (chapter) {
      void api.updateProgress(bookshelfId, chapterId, chapter.name)
      setReadingProgress(bookshelfId, chapterIndex, chapterId)
    }
  }, [bookshelfId, chapterIndex, chapterId, chapter])

  const hasPrev = chapterIndex > 0
  const hasNext = chapterIndex < chapters.length - 1

  return (
    <div className="reader-shell">
      <header className="reader-toolbar">
        <Link to="/book/$bookshelfId" params={{ bookshelfId }}>← 目录</Link>
        <span className="reader-title">{chapter?.name ?? '阅读'}</span>
        <span className="reader-meta">
          {chapters.length ? `${chapterIndex + 1} / ${chapters.length}` : ''}
        </span>
      </header>

      <main className="reader-body">
        {isLoading && <p className="empty">加载中…</p>}
        {content?.text && (
          <article
            className="reader-content"
            dangerouslySetInnerHTML={{ __html: content.text }}
          />
        )}
        {content?.images?.map((src, i) => (
          <img key={i} src={src} alt="" style={{ maxWidth: '100%', display: 'block', margin: '0 auto 12px' }} />
        ))}
      </main>

      <footer className="reader-nav">
        <button type="button" disabled={!hasPrev} onClick={() => onChapterChange(chapterIndex - 1)}>上一章</button>
        <button type="button" disabled={!hasNext} onClick={() => onChapterChange(chapterIndex + 1)}>下一章</button>
      </footer>
    </div>
  )
}
