import { createFileRoute } from '@tanstack/react-router'
import { BookDetailView } from '~/components/BookDetailView'

export const Route = createFileRoute('/book/$bookshelfId')({
  component: BookPage,
})

function BookPage() {
  const { bookshelfId } = Route.useParams()
  return <BookDetailView bookshelfId={decodeURIComponent(bookshelfId)} />
}
