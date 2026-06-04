import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ReaderView } from '~/components/ReaderView'
import { getReadingProgress } from '~/lib/api'

export const Route = createFileRoute('/read/$bookshelfId/$chapterIndex')({
  component: ReadPage,
})

function ReadPage() {
  const navigate = useNavigate()
  const { bookshelfId: rawId, chapterIndex: rawIndex } = Route.useParams()
  const bookshelfId = decodeURIComponent(rawId)
  const parsed = rawIndex === undefined || rawIndex === ''
    ? (getReadingProgress(bookshelfId)?.chapterIndex ?? 0)
    : Number(rawIndex)

  function onChapterChange(index: number) {
    navigate({
      to: '/read/$bookshelfId/$chapterIndex',
      params: { bookshelfId: rawId, chapterIndex: String(index) },
      replace: true,
    })
  }

  return (
    <ReaderView
      bookshelfId={bookshelfId}
      chapterIndex={Number.isFinite(parsed) ? parsed : 0}
      onChapterChange={onChapterChange}
    />
  )
}
