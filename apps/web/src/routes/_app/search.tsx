import { createFileRoute } from '@tanstack/react-router'
import { SearchResultsPage } from '~/components/SearchResultsPage'
import { parseSearchType } from '~/lib/search-types'

export const Route = createFileRoute('/_app/search')({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q.trim() : '',
    type: parseSearchType(search.type),
  }),
  component: SearchResultsPage,
})
