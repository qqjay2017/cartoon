import { createFileRoute } from '@tanstack/react-router'
import { DirectBookDetailPage } from '~/components/DirectBookDetailPage'
import { parseSearchType } from '~/lib/search-types'

export const Route = createFileRoute('/_app/book-detail')({
  validateSearch: (search: Record<string, unknown>) => ({
    sourceId: typeof search.sourceId === 'string' ? search.sourceId : '',
    url: typeof search.url === 'string' ? search.url : '',
    q: typeof search.q === 'string' ? search.q.trim() : '',
    type: parseSearchType(search.type),
  }),
  component: DirectBookDetailPage,
})
