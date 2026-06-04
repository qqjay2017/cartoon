import { createFileRoute } from '@tanstack/react-router'
import { BookshelfPage } from '~/components/BookshelfPage'

export const Route = createFileRoute('/_app/')({
  component: BookshelfPage,
})
